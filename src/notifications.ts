import { hashKey, randomKey } from './workspaces';
import type { Env } from './env';
import { azureConfigured } from './azure';
import { isQuietHour, localClock } from './schedule';
import { hasSensitiveContent } from './memory';
export type { Env } from './env';

export async function sendTelegram(env: Env, chatId: string, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json() as { ok?: boolean };
  // Do not include the Telegram URL or response body: they can expose secrets.
  if (!response.ok || !result.ok) throw new Error('Telegram notification failed; check your bot token and chat ID.');
}

export async function connectTelegram(env: Env, workspaceId: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) throw new Error('Telegram is not configured.');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(10_000) });
  const bot = await response.json() as { ok: boolean; result?: { username?: string } };
  const username = bot.result?.username;
  if (!response.ok || !bot.ok || !username || !/^[A-Za-z0-9_]+$/.test(username)) throw new Error('Telegram bot unavailable.');
  const key = randomKey();
  const expiresAt = Date.now() + 10 * 60_000;
  await env.DB.prepare('INSERT INTO telegram_links(key_hash,workspace_id,expires_at) VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET key_hash = excluded.key_hash, expires_at = excluded.expires_at')
    .bind(await hashKey(key), workspaceId, expiresAt).run();
  return { telegram_url: `https://t.me/${username}?start=${key}`, expires_at: new Date(expiresAt).toISOString(), instruction: 'Open this one-time link and tap Start in a private chat with the bot. This connects reminders, not access to your learning. Do not share the link.' };
}

export async function telegramWebhook(request: Request, env: Env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
  let update: { update_id?: number; message?: { text?: string; chat?: { id?: number; type?: string } } };
  try { update = await request.json(); }
  catch { return new Response('Bad request', { status: 400 }); }
  const message = update.message;
  const chatId = message?.chat?.id;
  if (message?.chat?.type !== 'private' || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(update.update_id) || !message?.text) return new Response('OK');
  if (!(await env.AI_LIMITER.limit({ key: `telegram:${chatId}` })).success) return new Response('OK');
  const safeText = hasSensitiveContent(message.text) ? '[Stick: sensitive content redacted]' : message.text.slice(0, 4000);
  return env.TELEGRAM_AGENT.get(env.TELEGRAM_AGENT.idFromName(String(chatId))).fetch('https://stick-agent/inbox', {
    method: 'POST', body: JSON.stringify({ id: `telegram:${update.update_id}`, chatId: String(chatId), kind: 'message', text: safeText }),
  });
}

export async function notifyDue(env: Env, now = Date.now()) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !azureConfigured(env)) return;
  const due = await env.DB.prepare('SELECT w.*, COUNT(*) AS count FROM workspaces w JOIN learnings l ON l.workspace_id = w.id JOIN cards c ON c.learning_id = l.id WHERE w.telegram_chat_id IS NOT NULL AND w.notifications_enabled=1 AND w.unanswered_pings<3 AND w.last_sent_at <= ? AND c.due_at <= ? GROUP BY w.id ORDER BY w.last_sent_at LIMIT 100')
    .bind(now - 4 * 60 * 60_000, now).all<{ id: string; telegram_chat_id: string; timezone: string; quiet_start: number; quiet_end: number; question_day: string; questions_today: number; daily_limit: number }>();
  for (const workspace of due.results) {
    const clock = localClock(workspace.timezone, now);
    if (isQuietHour(clock.hour, workspace.quiet_start, workspace.quiet_end) || (workspace.question_day === clock.day && workspace.questions_today >= workspace.daily_limit)) continue;
    const claimed = await env.DB.prepare('UPDATE workspaces SET last_sent_at = ? WHERE id = ? AND last_sent_at <= ? AND telegram_chat_id = ?')
      .bind(now, workspace.id, now - 4 * 60 * 60_000, workspace.telegram_chat_id).run();
    if (!claimed.meta.changes) continue;
    try {
      const response = await env.TELEGRAM_AGENT.get(env.TELEGRAM_AGENT.idFromName(workspace.telegram_chat_id)).fetch('https://stick-agent/inbox', {
        method: 'POST', body: JSON.stringify({ id: `scheduled:${workspace.id}:${now}`, kind: 'scheduled', chatId: workspace.telegram_chat_id, workspaceId: workspace.id }),
      });
      if (!response.ok) throw new Error('Queue unavailable');
    } catch {
      await env.DB.prepare('UPDATE workspaces SET last_sent_at = 0 WHERE id = ? AND last_sent_at = ?').bind(workspace.id, now).run();
      console.error('Stick quiz enqueue failed; will retry at the next scheduled check.');
    }
  }
}

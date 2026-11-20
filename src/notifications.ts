import { hashKey, randomKey } from './workspaces';

export interface Env {
  DB: D1Database;
  WORKSPACE_LIMITER: RateLimit;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

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
  let update: { message?: { text?: string; chat?: { id?: number; type?: string } } };
  try { update = await request.json(); }
  catch { return new Response('Bad request', { status: 400 }); }
  const message = update.message;
  const chatId = message?.chat?.id;
  const key = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(message?.text ?? '')?.[1];
  // Never link group chats or accept a user-supplied workspace ID.
  if (!key || message?.chat?.type !== 'private' || !Number.isSafeInteger(chatId)) return new Response('OK');
  const keyHash = await hashKey(key);
  const now = Date.now();
  // Consume and update atomically. A replay cannot reassign the destination.
  const changes = await env.DB.batch([
    env.DB.prepare('UPDATE workspaces SET telegram_chat_id = ?, last_sent_at = 0 WHERE id IN (SELECT workspace_id FROM telegram_links WHERE key_hash = ? AND expires_at > ?)')
      .bind(String(chatId), keyHash, now),
    env.DB.prepare('DELETE FROM telegram_links WHERE key_hash = ?').bind(keyHash),
  ]);
  if (changes[0].meta.changes) {
    try { await sendTelegram(env, String(chatId), '🧠 Your Quiztime workspace is connected. I’ll remind you when recall questions are due. You can disconnect reminders from Codex.'); }
    catch { console.error('Telegram pairing confirmation failed.'); }
  }
  return new Response('OK');
}

export async function notifyDue(env: Env, now = Date.now()) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return;
  const due = await env.DB.prepare('SELECT w.id, w.telegram_chat_id, COUNT(*) AS count FROM workspaces w JOIN learnings l ON l.workspace_id = w.id JOIN cards c ON c.learning_id = l.id WHERE w.telegram_chat_id IS NOT NULL AND w.last_sent_at <= ? AND c.due_at <= ? GROUP BY w.id ORDER BY w.last_sent_at LIMIT 100')
    .bind(now - 24 * 60 * 60_000, now).all<{ id: string; telegram_chat_id: string; count: number }>();
  for (const workspace of due.results) {
    const claimed = await env.DB.prepare('UPDATE workspaces SET last_sent_at = ? WHERE id = ? AND last_sent_at <= ? AND telegram_chat_id = ?')
      .bind(now, workspace.id, now - 24 * 60 * 60_000, workspace.telegram_chat_id).run();
    if (!claimed.meta.changes) continue;
    try {
      await sendTelegram(env, workspace.telegram_chat_id, `🧠 Quiztime: ${workspace.count} recall question${workspace.count === 1 ? '' : 's'} ready. Open Codex and say “Quiz me on my due learning.” Try answering before looking at your notes.`);
    } catch {
      await env.DB.prepare('UPDATE workspaces SET last_sent_at = 0 WHERE id = ? AND last_sent_at = ?').bind(workspace.id, now).run();
      console.error('Quiztime reminder failed; will retry at the next scheduled check.');
    }
  }
}

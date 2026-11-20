import { z } from 'zod';
import type { Env } from './env';

export const preferencesSchema = z.object({
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use an IANA timezone'),
  quiet_start: z.number().int().min(0).max(23), quiet_end: z.number().int().min(0).max(23),
  daily_limit: z.number().int().min(1).max(10), desired_retention: z.number().min(0.8).max(0.97),
  capture_enabled: z.boolean(), notifications_enabled: z.boolean(),
});

export async function getPreferences(db: D1Database, workspaceId: string) {
  const row = await db.prepare('SELECT timezone,quiet_start,quiet_end,daily_limit,desired_retention,capture_enabled,notifications_enabled,telegram_chat_id,unanswered_pings FROM workspaces WHERE id = ?').bind(workspaceId).first();
  return row ? { ...row, capture_enabled: Boolean(row.capture_enabled), notifications_enabled: Boolean(row.notifications_enabled), telegram_connected: Boolean(row.telegram_chat_id), telegram_chat_id: undefined } : null;
}

export async function setPreferences(db: D1Database, workspaceId: string, input: z.infer<typeof preferencesSchema>) {
  await db.prepare('UPDATE workspaces SET timezone=?,quiet_start=?,quiet_end=?,daily_limit=?,desired_retention=?,capture_enabled=?,notifications_enabled=?,unanswered_pings=0 WHERE id=?')
    .bind(input.timezone, input.quiet_start, input.quiet_end, input.daily_limit, input.desired_retention, Number(input.capture_enabled), Number(input.notifications_enabled), workspaceId).run();
  return getPreferences(db, workspaceId);
}

export async function snapshot(env: Env, workspaceId: string, sessionId: string | null) {
  const sessions = await env.DB.prepare('SELECT s.id,s.title,s.source_agent,s.created_at,s.last_activity_at,COUNT(l.id) AS entry_count FROM sessions s LEFT JOIN learnings l ON l.session_id=s.id AND l.workspace_id=s.workspace_id WHERE s.workspace_id=? GROUP BY s.id ORDER BY s.last_activity_at DESC LIMIT 100').bind(workspaceId).all();
  const legacy = await env.DB.prepare('SELECT COUNT(*) AS count FROM learnings WHERE workspace_id=? AND session_id IS NULL').bind(workspaceId).first<{ count: number }>();
  const filter = !sessionId ? '' : sessionId === 'legacy' ? ' AND l.session_id IS NULL' : ' AND l.session_id = ?';
  const values = sessionId && sessionId !== 'legacy' ? [workspaceId, sessionId] : [workspaceId];
  const entries = await env.DB.prepare(`SELECT l.id,l.title,l.user_question,l.summary,l.created_at,l.entry_type,l.insights,l.tags,l.source_urls,l.session_id,s.title AS session_title,s.source_agent,(SELECT COUNT(*) FROM cards c WHERE c.learning_id=l.id) AS card_count FROM learnings l LEFT JOIN sessions s ON s.id=l.session_id WHERE l.workspace_id=?${filter} ORDER BY l.created_at DESC,l.id DESC LIMIT 50`).bind(...values).all<{ title: string; insights: string; tags: string; source_urls: string; [key: string]: unknown }>();
  const stats = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM learnings WHERE workspace_id=?) AS entries,(SELECT COUNT(*) FROM cards c JOIN learnings l ON l.id=c.learning_id WHERE l.workspace_id=?) AS cards,(SELECT COUNT(*) FROM cards c JOIN learnings l ON l.id=c.learning_id WHERE l.workspace_id=? AND c.due_at<=?) AS due_cards,(SELECT COUNT(*) FROM attempts a JOIN cards c ON c.id=a.card_id JOIN learnings l ON l.id=c.learning_id WHERE l.workspace_id=? AND a.rating IS NOT NULL) AS completed_reviews").bind(workspaceId, workspaceId, workspaceId, Date.now(), workspaceId).first();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM learnings l WHERE l.workspace_id=?${filter}`).bind(...values).first<{ count: number }>();
  return {
    stats, preferences: await getPreferences(env.DB, workspaceId),
    sessions: [...sessions.results, ...(legacy?.count ? [{ id: 'legacy', title: 'Earlier saves', source_agent: 'agent', entry_count: legacy.count }] : [])],
    entries: entries.results.map(row => ({ ...row, insights: JSON.parse(row.insights as string), tags: JSON.parse(row.tags as string), source_urls: JSON.parse(row.source_urls as string) })),
    total_entries: total?.count ?? 0, azure_configured: Boolean(env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT && env.AZURE_OPENAI_API_KEY),
    telegram_available: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET),
  };
}

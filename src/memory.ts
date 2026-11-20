import { z } from 'zod';
import { cardSchema, insightSchema, extractInsights } from './azure';
import type { Env } from './env';

export const captureSchema = z.object({
  session_key: z.string().trim().min(1).max(120),
  session_title: z.string().trim().min(1).max(200),
  source_agent: z.string().trim().min(1).max(80).default('agent'),
  event_id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  user_message: z.string().trim().min(1).max(2000),
  summary: z.string().trim().min(1).max(8000),
  insights: z.array(insightSchema).max(5).default([]),
  cards: z.array(cardSchema).max(5).default([]),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  source_urls: z.array(z.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol))).max(10).default([]),
  extract_with_ai: z.boolean().default(false),
  first_review_in_minutes: z.number().int().min(0).max(10080).default(60),
});
export type Capture = z.infer<typeof captureSchema>;

export function hasSensitiveContent(value: string) {
  return /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|\/mcp\/[A-Za-z0-9_-]{43}|(?:api[_ -]?key|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{12,})/i.test(value);
}

export async function captureInteraction(env: Env, workspaceId: string, input: Capture) {
  if (hasSensitiveContent(JSON.stringify(input))) return { saved: false, reason: 'Possible credential/private link detected. Send a redacted summary instead.' };
  const settings = await env.DB.prepare('SELECT capture_enabled FROM workspaces WHERE id = ?').bind(workspaceId).first<{ capture_enabled: number }>();
  if (!settings?.capture_enabled) return { saved: false, reason: 'Automatic capture is paused for this workspace.' };
  const storedEvent = JSON.stringify([input.session_key, input.event_id]);
  const duplicate = await env.DB.prepare('SELECT id,session_id FROM learnings WHERE workspace_id = ? AND event_id = ?').bind(workspaceId, storedEvent).first();
  if (duplicate) return { saved: true, duplicate: true, learning_id: duplicate.id, session_id: duplicate.session_id };
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM learnings WHERE workspace_id = ?').bind(workspaceId).first<{ count: number }>();
  if ((count?.count ?? 0) >= 1000) throw new Error('Workspace limit reached. Delete unused entries before saving more.');
  // Model sees only the sanitized summary and user message, never workspace keys.
  const extraction = input.extract_with_ai ? await extractInsights(env, workspaceId, { summary: input.summary, user_message: input.user_message }) : input;
  const now = Date.now();
  const learningId = crypto.randomUUID();
  const proposedSession = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions(id,workspace_id,session_key,title,source_agent,created_at,last_activity_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,session_key) DO UPDATE SET last_activity_at = excluded.last_activity_at')
    .bind(proposedSession, workspaceId, input.session_key, input.session_title, input.source_agent, now, now).run();
  const session = await env.DB.prepare('SELECT id FROM sessions WHERE workspace_id = ? AND session_key = ?').bind(workspaceId, input.session_key).first<{ id: string }>();
  const cards = extraction.insights.length ? extraction.cards : [];
  const priority = extraction.insights.some(insight => insight.importance === 'high') ? 3 : extraction.insights.every(insight => insight.importance === 'low') ? 1 : 2;
  const dueAt = now + input.first_review_in_minutes * 60_000;
  // INSERT OR IGNORE plus conditional card inserts makes concurrent event retries safe.
  const inserted = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO learnings(id,title,user_question,summary,source_urls,tags,created_at,workspace_id,session_id,event_id,entry_type,insights) VALUES (?,?,?,?,?,?,?,?,?,?,'interaction',?)")
      .bind(learningId, input.title, input.user_message, input.summary, JSON.stringify(input.source_urls), JSON.stringify(input.tags), now, workspaceId, session!.id, storedEvent, JSON.stringify(extraction.insights)),
    ...cards.map(card => env.DB.prepare('INSERT INTO cards(id,learning_id,question,expected_answer,due_at,priority) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM learnings WHERE id = ? AND workspace_id = ?)')
      .bind(crypto.randomUUID(), learningId, card.question, card.expected_answer, dueAt, priority, learningId, workspaceId)),
  ]);
  if (!inserted[0].meta.changes) {
    const existing = await env.DB.prepare('SELECT id,session_id FROM learnings WHERE workspace_id = ? AND event_id = ?').bind(workspaceId, storedEvent).first();
    return { saved: true, duplicate: true, learning_id: existing?.id, session_id: existing?.session_id };
  }
  return { saved: true, learning_id: learningId, session_id: session!.id, insights_saved: extraction.insights.length, cards_saved: cards.length, first_review_at: cards.length ? new Date(dueAt).toISOString() : null };
}

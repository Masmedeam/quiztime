import type { Env } from './env';
import { azureConfigured, coachTurn } from './azure';
import { captureInteraction, captureSchema, hasSensitiveContent } from './memory';
import { hashKey } from './workspaces';
import { finishReview } from './reviews';
import { isQuietHour, localClock } from './schedule';

export interface BotEvent { id: string; chatId: string; kind: 'message' | 'scheduled'; text?: string; workspaceId?: string }
interface BotWorkspace { id: string; timezone: string; quiet_start: number; quiet_end: number; daily_limit: number; question_day: string; questions_today: number; unanswered_pings: number; notifications_enabled: number; capture_enabled: number }
interface Attempt { id: string; card_id: string; question: string; expected_answer: string; title: string; status: string; user_answer: string | null }

async function activeAttempt(env: Env, workspaceId: string) {
  return env.DB.prepare("SELECT a.id,a.card_id,a.status,a.user_answer,c.question,c.expected_answer,l.title FROM attempts a JOIN cards c ON c.id=a.card_id JOIN learnings l ON l.id=c.learning_id WHERE l.workspace_id=? AND a.channel='telegram' AND a.status!='graded' ORDER BY a.created_at LIMIT 1")
    .bind(workspaceId).first<Attempt>();
}

async function nextQuestion(env: Env, workspace: BotWorkspace, proactive: boolean, exclude?: string) {
  const now = Date.now();
  const clock = localClock(workspace.timezone, now);
  if (proactive && (!workspace.notifications_enabled || isQuietHour(clock.hour, workspace.quiet_start, workspace.quiet_end) || workspace.unanswered_pings >= 3 || (workspace.question_day === clock.day && workspace.questions_today >= workspace.daily_limit))) return '';
  let attempt = await activeAttempt(env, workspace.id);
  if (!attempt) {
    const card = await env.DB.prepare("SELECT c.id FROM cards c JOIN learnings l ON l.id=c.learning_id WHERE l.workspace_id=? AND (?=0 OR c.due_at<=?) AND c.id!=? AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.card_id=c.id AND a.status!='graded' AND a.channel!='telegram') ORDER BY CASE WHEN c.due_at<=? THEN 0 ELSE 1 END,c.priority DESC,c.lapses DESC,c.due_at LIMIT 1")
      .bind(workspace.id, Number(proactive), now, exclude ?? '', now).first<{ id: string }>();
    if (!card) return proactive ? '' : 'No saved question is available right now. Save a recall question with your agent, or ask me about your saved insights.';
    await env.DB.prepare("INSERT OR IGNORE INTO attempts(id,card_id,status,created_at,channel) VALUES (?,?,'asked',?,'telegram')").bind(crypto.randomUUID(), card.id, now).run();
    attempt = await activeAttempt(env, workspace.id);
  }
  if (!attempt) return '';
  await env.DB.prepare('UPDATE workspaces SET questions_today=CASE WHEN question_day=? THEN questions_today+1 ELSE 1 END,question_day=?,unanswered_pings=unanswered_pings+?,notifications_enabled=CASE WHEN ?=1 AND unanswered_pings>=2 THEN 0 ELSE notifications_enabled END WHERE id=?')
    .bind(clock.day, clock.day, Number(proactive), Number(proactive), workspace.id).run();
  return `Stick · ${attempt.title}\n\n${attempt.question}\n\nReply with your answer, ask for a hint, or send /skip. No notes needed.`;
}

export async function handleBotEvent(env: Env, event: BotEvent): Promise<string> {
  const text = (event.text ?? '').slice(0, 4000).trim();
  const pairingKey = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(text)?.[1];
  if (pairingKey) {
    const hash = await hashKey(pairingKey);
    const now = Date.now();
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE workspaces SET telegram_chat_id=NULL WHERE telegram_chat_id=? AND id NOT IN (SELECT workspace_id FROM telegram_links WHERE key_hash=? AND expires_at>?) AND EXISTS (SELECT 1 FROM telegram_links WHERE key_hash=? AND expires_at>?)').bind(event.chatId, hash, now, hash, now),
      env.DB.prepare('UPDATE workspaces SET telegram_chat_id=?,notifications_enabled=1,unanswered_pings=0 WHERE id IN (SELECT workspace_id FROM telegram_links WHERE key_hash=? AND expires_at>?)').bind(event.chatId, hash, now),
      env.DB.prepare('DELETE FROM telegram_links WHERE key_hash=?').bind(hash),
    ]);
    return result[1].meta.changes ? 'Your Stick space is connected.\n\nSend /quiz for one recall question. Answer directly here, or ask follow-up questions about your saved insights.\n\n/skip skips a question; /stop pauses proactive quizzes; /resume restores them.' : 'That pairing link has expired or was already used. Create a new link from your Stick space.';
  }
  if (hasSensitiveContent(text) || text === '[Stick: sensitive content redacted]') return 'That looks like it contains a credential or private link. I won’t store it or send it to Azure. Please send a redacted question instead.';
  const workspace = await env.DB.prepare('SELECT id,timezone,quiet_start,quiet_end,daily_limit,question_day,questions_today,unanswered_pings,notifications_enabled,capture_enabled FROM workspaces WHERE telegram_chat_id=? ORDER BY created_at DESC LIMIT 1').bind(event.chatId).first<BotWorkspace>();
  if (!workspace || (event.workspaceId && event.workspaceId !== workspace.id)) return event.kind === 'scheduled' ? '' : 'Connect your private space first: open Stick and choose Connect Telegram. No sign-in is needed.';
  const cached = await env.DB.prepare("SELECT content FROM chat_messages WHERE workspace_id=? AND event_id=? AND role='assistant'").bind(workspace.id, event.id).first<{ content: string }>();
  if (cached) return cached.content;
  if (event.kind === 'message') await env.DB.prepare('UPDATE workspaces SET unanswered_pings=0 WHERE id=?').bind(workspace.id).run();
  let reply: string;
  if (text === '/stop') {
    await env.DB.prepare('UPDATE workspaces SET notifications_enabled=0 WHERE id=?').bind(workspace.id).run();
    reply = 'Proactive quizzes are paused. You can still ask questions or send /quiz. Send /resume whenever you want reminders again.';
  } else if (text === '/resume') {
    await env.DB.prepare('UPDATE workspaces SET notifications_enabled=1,unanswered_pings=0 WHERE id=?').bind(workspace.id).run();
    reply = 'Proactive quizzes are enabled again. I’ll respect your timezone, quiet hours and daily question limit.';
  } else if (text === '/help' || text === '/start') {
    reply = 'Stick remembers insights from your agent sessions.\n\n/quiz — one saved question, even before it is due\n/skip — skip without advancing its review schedule\n/stop — pause proactive quizzes\n/resume — enable them again\n\nYou can answer a quiz or ask follow-up questions directly here.';
  } else if (!azureConfigured(env)) {
    reply = 'The Azure coach is not configured by the server operator yet. Your saved insights are safe; you can still review them with your MCP agent.';
  } else if (event.kind === 'scheduled' || ['/quiz', '/next', '/skip'].includes(text) || /^(?:please\s+)?(?:quiz me|test me|give me (?:a |one )?(?:quiz|question)|ask me (?:a |one )?question)(?:\s+please)?[.!?]*$/i.test(text)) {
    let excluded: string | undefined;
    if (text === '/skip') {
      const attempt = await activeAttempt(env, workspace.id);
      if (attempt) {
        excluded = attempt.card_id;
        await env.DB.prepare("UPDATE attempts SET status='graded',feedback='Skipped without rescheduling' WHERE id=? AND channel='telegram'").bind(attempt.id).run();
      }
    }
    reply = await nextQuestion(env, workspace, event.kind === 'scheduled', excluded);
  } else {
    if (!(await env.AI_LIMITER.limit({ key: workspace.id })).success) return 'Let’s take a moment. Try again in a minute.';
    const active = await activeAttempt(env, workspace.id);
    const context = await env.DB.prepare('SELECT title,summary,insights FROM learnings WHERE workspace_id=? ORDER BY created_at DESC LIMIT 6').bind(workspace.id).all();
    const history = await env.DB.prepare('SELECT role,content FROM chat_messages WHERE workspace_id=? ORDER BY id DESC LIMIT 10').bind(workspace.id).all();
    const answer = active?.status === 'answered' ? active.user_answer! : text;
    const result = await coachTurn(env, workspace.id, { message: answer, pending_quiz: active ? { question: active.question, reference: active.expected_answer } : null, recent_insights: context.results, history: history.results.reverse() });
    reply = result.reply;
    if (active && result.kind === 'answer' && result.rating) {
      await env.DB.prepare("UPDATE attempts SET user_answer=?,answered_at=?,status='answered' WHERE id=? AND status='asked' AND channel='telegram'").bind(answer, Date.now(), active.id).run();
      const review = await finishReview(env, workspace.id, active.id, result.rating, reply);
      reply += `\n\nNext review: ${new Date(review.next_review_at).toLocaleDateString('en', { timeZone: workspace.timezone, month: 'short', day: 'numeric' })}. Send /quiz for another question, or ask me to explain further.`;
    } else if (result.kind === 'discussion' && workspace.capture_enabled) {
      await captureInteraction(env, workspace.id, captureSchema.parse({ session_key: `telegram:${event.chatId}`, session_title: 'Telegram conversations', source_agent: 'Stick Telegram', event_id: event.id, title: result.insights[0]?.title ?? 'Telegram follow-up', user_message: text, summary: reply, insights: result.insights, cards: result.cards }));
    }
  }
  if (!reply) return '';
  await env.DB.batch([
    ...(event.kind === 'message' ? [env.DB.prepare("INSERT OR IGNORE INTO chat_messages(workspace_id,event_id,role,content,created_at) VALUES (?,?,'user',?,?)").bind(workspace.id, event.id, text, Date.now())] : []),
    env.DB.prepare("INSERT OR IGNORE INTO chat_messages(workspace_id,event_id,role,content,created_at) VALUES (?,?,'assistant',?,?)").bind(workspace.id, event.id, reply, Date.now()),
    env.DB.prepare('DELETE FROM chat_messages WHERE workspace_id=? AND id NOT IN (SELECT id FROM chat_messages WHERE workspace_id=? ORDER BY id DESC LIMIT 100)').bind(workspace.id, workspace.id),
  ]);
  return reply;
}

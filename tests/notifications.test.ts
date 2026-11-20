import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectTelegram, notifyDue, telegramWebhook } from '../src/notifications';
import { handleBotEvent } from '../src/bot';
import { fixture } from './fixture';

test('cron requires configured Azure/Telegram, respects quiet hours and queues scoped quiz jobs', async t => {
  const { env, sqlite, jobs } = fixture(); t.after(() => sqlite.close());
  env.AZURE_OPENAI_API_KEY = undefined;
  await notifyDue(env); assert.equal(jobs.length, 0);
  env.AZURE_OPENAI_API_KEY = 'test-key';
  const now = Date.UTC(2026, 10, 20, 12);
  sqlite.exec("UPDATE workspaces SET quiet_start=9,quiet_end=17 WHERE id='b'");
  await notifyDue(env, now);
  assert.equal(jobs.length, 1); assert.equal(jobs[0].workspaceId, 'a'); assert.equal(jobs[0].chatId, '111');
  await notifyDue(env, now + 3600_000); assert.equal(jobs.length, 1);
  await notifyDue(env, now + 4 * 3600_000); assert.equal(jobs.length, 2);
});
test('daily budget and repeated unanswered quizzes suppress proactive jobs', async t => {
  const { env, sqlite, jobs } = fixture(); t.after(() => sqlite.close());
  sqlite.exec("UPDATE workspaces SET unanswered_pings=3 WHERE id='a'; UPDATE workspaces SET question_day='2026-11-20',questions_today=3 WHERE id='b'");
  await notifyDue(env, Date.UTC(2026, 10, 20, 12)); assert.equal(jobs.length, 0);
});
test('webhook authenticates, ignores groups, and accepts messages into the durable inbox', async t => {
  const { env, sqlite, jobs } = fixture(); t.after(() => sqlite.close());
  const webhook = (secret: string, type = 'private') => telegramWebhook(new Request('https://example.com/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ update_id: 12, message: { text: '/quiz', chat: { id: 111, type } } }) }), env);
  assert.equal((await webhook('wrong')).status, 403);
  await webhook('test-hook', 'group'); assert.equal(jobs.length, 0);
  assert.equal((await webhook('test-hook')).status, 200); assert.equal(jobs.length, 1);
});
test('pairing links are single-use/expiring and a chat switches spaces without mixing their data', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, result: { username: 'StickBot' } }));
  const link = await connectTelegram(env, 'a');
  const key = new URL(link.telegram_url).searchParams.get('start');
  const first = await handleBotEvent(env, { id: 'p1', chatId: '222', kind: 'message', text: `/start ${key}` });
  assert.ok(first.includes('connected'));
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id='a'").get()?.telegram_chat_id, '222');
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id='b'").get()?.telegram_chat_id, null);
  await handleBotEvent(env, { id: 'p2', chatId: '333', kind: 'message', text: `/start ${key}` });
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id='a'").get()?.telegram_chat_id, '222');
  const expired = await connectTelegram(env, 'a'); sqlite.exec('UPDATE telegram_links SET expires_at=0');
  await handleBotEvent(env, { id: 'p3', chatId: '444', kind: 'message', text: `/start ${new URL(expired.telegram_url).searchParams.get('start')}` });
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id='a'").get()?.telegram_chat_id, '222');
});

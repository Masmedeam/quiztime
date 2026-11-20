import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectTelegram, notifyDue, telegramWebhook, type Env } from '../src/notifications';
import { testDb } from './db';
import { hashKey } from '../src/workspaces';

function fixture() {
  const { db, sqlite } = testDb();
  const env = { DB: db, TELEGRAM_BOT_TOKEN: 'test-bot', TELEGRAM_WEBHOOK_SECRET: 'test-hook' } as Env;
  sqlite.exec(`INSERT INTO workspaces(id,key_hash,created_at,telegram_chat_id) VALUES ('a','hash-a',0,'111'),('b','hash-b',0,'222');
    INSERT INTO learnings(id,title,user_question,summary,created_at,workspace_id) VALUES ('l-a','A','Q','S',0,'a'),('l-b','B','Q','S',0,'b');
    INSERT INTO cards(id,learning_id,question,expected_answer,due_at) VALUES ('c-a','l-a','Q','A',0),('c-b','l-b','Q','A',0);`);
  return { env, sqlite };
}

test('missing Telegram credentials and no due cards cause no sends', async t => {
  const { env, sqlite } = fixture();
  t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Must not send'); });
  env.TELEGRAM_BOT_TOKEN = undefined;
  await notifyDue(env);
  env.TELEGRAM_BOT_TOKEN = 'test-bot';
  sqlite.exec('UPDATE cards SET due_at = 9999999999999');
  await notifyDue(env);
});

test('each workspace gets only its own count, throttled to once per 24h', async t => {
  const { env, sqlite } = fixture();
  t.after(() => sqlite.close());
  sqlite.exec("INSERT INTO cards(id,learning_id,question,expected_answer,due_at) VALUES ('c-a2','l-a','Q','A',0)");
  const messages: Array<{ chat_id: string; text: string }> = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    messages.push(JSON.parse(init.body as string)); return Response.json({ ok: true });
  });
  const now = 2 * 86400_000;
  await notifyDue(env, now);
  assert.equal(messages.length, 2);
  assert.ok(messages.find(m => m.chat_id === '111')?.text.includes('2 recall questions'));
  assert.ok(messages.find(m => m.chat_id === '222')?.text.includes('1 recall question'));
  await notifyDue(env, now + 3600_000);
  assert.equal(messages.length, 2);
  await notifyDue(env, now + 86400_000);
  assert.equal(messages.length, 4);
});

test('failed delivery releases only the failing workspace claim', async t => {
  const { env, sqlite } = fixture();
  t.after(() => sqlite.close());
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return Response.json({ ok: body.chat_id === '222' }, { status: body.chat_id === '222' ? 200 : 400 });
  });
  await notifyDue(env, 2 * 86400_000);
  assert.equal(sqlite.prepare("SELECT last_sent_at FROM workspaces WHERE id = 'a'").get()?.last_sent_at, 0);
  assert.equal(sqlite.prepare("SELECT last_sent_at FROM workspaces WHERE id = 'b'").get()?.last_sent_at, 2 * 86400_000);
});

test('Telegram pairing is private-chat-only, expiring, browser-login-free, and single use', async t => {
  const { env, sqlite } = fixture();
  t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async (url: unknown) => String(url).endsWith('/getMe') ? Response.json({ ok: true, result: { username: 'QuiztimeBot' } }) : Response.json({ ok: true }));
  const pairing = await connectTelegram(env, 'a');
  const key = new URL(pairing.telegram_url).searchParams.get('start')!;
  assert.equal(sqlite.prepare("SELECT key_hash FROM telegram_links WHERE workspace_id = 'a'").get()?.key_hash, await hashKey(key));
  const webhook = (chatId: number, type = 'private', secret = 'test-hook', value = key) => telegramWebhook(new Request('https://example.com/telegram/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { text: `/start ${value}`, chat: { id: chatId, type } } }),
  }), env);
  assert.equal((await webhook(333, 'private', 'wrong-secret')).status, 403);
  await webhook(333, 'group');
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id = 'a'").get()?.telegram_chat_id, '111');
  await webhook(333);
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id = 'a'").get()?.telegram_chat_id, '333');
  await webhook(444);
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id = 'a'").get()?.telegram_chat_id, '333');
  const expired = await connectTelegram(env, 'a');
  sqlite.exec('UPDATE telegram_links SET expires_at = 0');
  await webhook(555, 'private', 'test-hook', new URL(expired.telegram_url).searchParams.get('start')!);
  assert.equal(sqlite.prepare("SELECT telegram_chat_id FROM workspaces WHERE id = 'a'").get()?.telegram_chat_id, '333');
});

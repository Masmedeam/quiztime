import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBotEvent } from '../src/bot';
import { fixture } from './fixture';

test('Telegram asks one scoped question, accepts an answer, grades once, and supports follow-up chat', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; const request = JSON.parse(init.body as string);
    assert.ok(!request.messages[1].content.includes('Private B question'));
    return Response.json({ choices: [{ message: { content: JSON.stringify(calls === 1 ? { kind: 'answer', rating: 'good', reply: 'Correct: either all changes succeed or none do.', insights: [], cards: [] } : { kind: 'discussion', rating: null, reply: 'Atomicity avoids partially applied changes.', insights: [{ title: 'Atomicity', explanation: 'Transactions keep updates all-or-nothing.', kind: 'concept', importance: 'high' }], cards: [{ question: 'Why is atomicity useful?', expected_answer: 'It prevents partial changes.' }] }) } }] });
  });
  const asked = await handleBotEvent(env, { id: 'q1', chatId: '111', kind: 'message', text: '/quiz' });
  assert.ok(asked.includes('Explain atomic transactions')); assert.ok(!asked.includes('All-or-nothing changes')); assert.equal(calls, 0);
  const answer = { id: 'a1', chatId: '111', kind: 'message' as const, text: 'All changes succeed or none do.' };
  const reply = await handleBotEvent(env, answer); assert.ok(reply.includes('Correct')); assert.equal(calls, 1);
  await handleBotEvent(env, answer); assert.equal(calls, 1);
  assert.equal(sqlite.prepare("SELECT review_count FROM cards WHERE id='c-a'").get()?.review_count, 1);
  assert.equal(sqlite.prepare("SELECT review_count FROM cards WHERE id='c-b'").get()?.review_count, 0);
  await handleBotEvent(env, { id: 'f1', chatId: '111', kind: 'message', text: 'Why is that useful?' });
  assert.equal(calls, 2); assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM learnings WHERE workspace_id='a' AND entry_type='interaction'").get()?.n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE workspace_id='a'").get()?.n, 1);
});
test('clarifying questions do not get graded; skip/stop/resume preserve review semantics', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: JSON.stringify({ kind: 'discussion', rating: null, reply: 'Think about what happens if one update fails.', insights: [], cards: [] }) } }] }));
  await handleBotEvent(env, { id: 'q', chatId: '111', kind: 'message', text: '/quiz' });
  await handleBotEvent(env, { id: 'h', chatId: '111', kind: 'message', text: 'Can you give me a hint?' });
  assert.equal(sqlite.prepare("SELECT status FROM attempts WHERE card_id='c-a'").get()?.status, 'asked');
  await handleBotEvent(env, { id: 's', chatId: '111', kind: 'message', text: '/skip' });
  assert.equal(sqlite.prepare("SELECT due_at FROM cards WHERE id='c-a'").get()?.due_at, 0);
  await handleBotEvent(env, { id: 'stop', chatId: '111', kind: 'message', text: '/stop' });
  assert.equal(sqlite.prepare("SELECT notifications_enabled FROM workspaces WHERE id='a'").get()?.notifications_enabled, 0);
  await handleBotEvent(env, { id: 'resume', chatId: '111', kind: 'message', text: '/resume' });
  assert.equal(sqlite.prepare("SELECT notifications_enabled FROM workspaces WHERE id='a'").get()?.notifications_enabled, 1);
});
test('credentials in Telegram are neither sent to Azure nor persisted', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('No external request allowed'); });
  const reply = await handleBotEvent(env, { id: 'secret', chatId: '111', kind: 'message', text: 'api_key=abcdefghijklmnopqrstuvwxyz123456' });
  assert.ok(reply.includes('redacted'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM chat_messages').get()?.n, 0);
});

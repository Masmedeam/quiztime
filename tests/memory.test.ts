import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureInteraction, captureSchema } from '../src/memory';
import { snapshot } from '../src/dashboard';
import { fixture } from './fixture';

const input = (event: string, session = 'session-one') => captureSchema.parse({ session_key: session, session_title: session, source_agent: 'Codex', event_id: event, title: 'Debugging a race condition', user_message: 'Why did this update run twice?', summary: 'We diagnosed retries and made writes idempotent.', insights: [{ title: 'Idempotency', explanation: 'Repeated operations should have the same effect.', kind: 'technique', importance: 'high' }], cards: [{ question: 'Why use an idempotency key?', expected_answer: 'To prevent duplicate effects on retry.' }] });

test('capture is idempotent and dashboard filters by actual session without leaking workspaces', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  const a = await captureInteraction(env, 'a', input('e1'));
  const repeat = await captureInteraction(env, 'a', input('e1')); assert.equal(repeat.duplicate, true);
  await captureInteraction(env, 'a', input('e2', 'session-two'));
  const b = await captureInteraction(env, 'b', input('e1'));
  assert.notEqual(a.learning_id, b.learning_id);
  const own = await snapshot(env, 'a', String(a.session_id)); assert.equal(own.entries.length, 1); assert.equal(own.entries[0].title, 'Debugging a race condition');
  assert.equal((await snapshot(env, 'b', String(a.session_id))).entries.length, 0);
  assert.equal((await snapshot(env, 'a', null)).sessions.length, 3); // Two captured sessions + earlier manual save.
  assert.equal(sqlite.prepare("SELECT priority FROM cards WHERE learning_id=?").get(String(a.learning_id))?.priority, 3);
});
test('ordinary interactions can be saved without quiz cards; capture pause and secret filtering work', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  const empty = { ...input('empty'), insights: [], cards: [] };
  assert.equal((await captureInteraction(env, 'a', empty)).cards_saved, 0);
  const secret = { ...input('secret'), summary: 'api_key=abcdefghijklmnopqrstuvwxyz123456' };
  assert.equal((await captureInteraction(env, 'a', secret)).saved, false);
  sqlite.exec("UPDATE workspaces SET capture_enabled=0 WHERE id='a'");
  assert.equal((await captureInteraction(env, 'a', input('paused'))).saved, false);
});

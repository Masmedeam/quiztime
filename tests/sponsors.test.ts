import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignReviewPolicy, track } from '../src/telemetry';
import { datasetName, searchCognee } from '../src/cognee';
import { captureInteraction, captureSchema } from '../src/memory';
import { fixture } from './fixture';

test('telemetry is a no-op without keys', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('No telemetry request expected'); });
  await track(env, 'a', 'card_reviewed', { rating: 'good' });
  assert.deepEqual(await assignReviewPolicy(env, 'a'), { desired_retention: 0.9, daily_limit: 3, group: 'default' });
});

test('one track call reaches Amplitude and Statsig with the same anonymous id and no content', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  env.AMPLITUDE_API_KEY = 'amp'; env.STATSIG_SERVER_SECRET = 'secret-statsig';
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(init.body as string), headers: init.headers }); return Response.json({}); });
  await captureInteraction(env, 'a', captureSchema.parse({ session_key: 's', session_title: 'T', event_id: 'e1', title: 'Secret topic title', user_message: 'private user message', summary: 'private summary', insights: [{ title: 'I', explanation: 'E', kind: 'concept' }], cards: [{ question: 'private question', expected_answer: 'private answer' }] }));
  const amplitude = calls.find(call => call.url.includes('amplitude'))!;
  const statsig = calls.find(call => call.url.includes('statsig'))!;
  assert.equal(amplitude.body.events[0].user_id, 'a');
  assert.equal(amplitude.body.events[0].event_type, 'interaction_captured');
  assert.equal(statsig.body.events[0].user.userID, 'a');
  assert.equal(statsig.headers['statsig-api-key'], 'secret-statsig');
  assert.ok(!JSON.stringify(calls).includes('private'), 'analytics payloads must not contain learning content');
});

test('Statsig review policy is clamped to preference bounds and falls back on failure', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  env.STATSIG_SERVER_SECRET = 'secret';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ value: { desired_retention: 0.5, daily_limit: 99 }, group_name: 'Aggressive' }));
  assert.deepEqual(await assignReviewPolicy(env, 'a'), { desired_retention: 0.8, daily_limit: 10, group: 'Aggressive' });
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('down'); });
  assert.equal((await assignReviewPolicy(env, 'a')).group, 'default');
});

test('Cognee gets one isolated dataset per workspace, and outages never block saving', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  env.COGNEE_API_URL = 'https://tenant.example.cognee.ai'; env.COGNEE_API_KEY = 'cog';
  const urls: string[] = [];
  const forms: FormData[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    urls.push(url.pathname);
    if (init.body instanceof FormData) forms.push(init.body);
    return Response.json({});
  });
  const input = (id: string) => captureSchema.parse({ session_key: 's', session_title: 'T', event_id: id, title: 'ACID', user_message: 'm', summary: 'Atomic transactions', insights: [{ title: 'Atomicity', explanation: 'All or nothing', kind: 'concept' }], cards: [] });
  assert.equal((await captureInteraction(env, 'a', input('e1'))).saved, true);
  assert.deepEqual(urls, ['/api/v1/add', '/api/v1/cognify']);
  assert.equal(forms[0].get('datasetName'), datasetName('a'));
  assert.ok(String(forms[0].get('raw_data')).includes('Atomicity'));
  assert.notEqual(datasetName('a'), datasetName('b'));
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('cognee down'); });
  assert.equal((await captureInteraction(env, 'a', input('e2'))).saved, true);
  assert.equal(await searchCognee(env, 'a', 'ACID'), null);
});

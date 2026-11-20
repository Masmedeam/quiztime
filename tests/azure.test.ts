import { test } from 'node:test';
import assert from 'node:assert/strict';
import { azureUrl, extractInsights } from '../src/azure';
import { fixture } from './fixture';

test('Azure supports v1 and deployment endpoints, uses server-only credentials and validates responses', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  assert.equal(azureUrl(env).pathname, '/openai/v1/chat/completions');
  env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com';
  assert.equal(azureUrl(env).pathname, '/openai/deployments/test-deployment/chat/completions');
  assert.ok(azureUrl(env).searchParams.has('api-version'));
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal((init.headers as Record<string,string>)['api-key'], 'test-key');
    assert.ok(!(init.body as string).includes('hash-a'));
    return Response.json({ choices: [{ message: { content: '{"insights":[],"cards":[]}' } }] });
  });
  assert.deepEqual(await extractInsights(env, 'a', { summary: 'A normal exchange' }), { insights: [], cards: [] });
});
test('Azure daily cap blocks calls and upstream error details never leak', async t => {
  const { env, sqlite } = fixture(); t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('secret upstream URL'); });
  await assert.rejects(extractInsights(env, 'a', {}), /temporarily unavailable/);
  assert.equal(sqlite.prepare('SELECT calls FROM ai_usage').get()?.calls, 1);
  sqlite.exec('UPDATE ai_usage SET calls=100');
  await assert.rejects(extractInsights(env, 'a', {}), /Daily AI limit/);
});

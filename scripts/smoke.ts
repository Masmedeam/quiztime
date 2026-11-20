import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origin = new URL(process.env.QUIZTIME_ORIGIN ?? 'http://localhost:8787').origin;
const headers = { 'Content-Type': 'application/json' };
const home = await fetch(origin);
assert.equal(home.status, 200);
assert.ok(home.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'"));
const crossOrigin = await fetch(`${origin}/workspaces`, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: '{}' });
assert.equal(crossOrigin.status, 403);
const oldEndpoint = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: '{}' });
assert.equal(oldEndpoint.status, 404);
const unknown = await fetch(`${origin}/mcp/${'x'.repeat(43)}`, { method: 'POST', headers, body: '{}' });
assert.equal(unknown.status, 404);
console.log('PASS: public homepage, safe creation origin checks, no shared MCP endpoint');

const connections: Array<{ client: Client; url: string }> = [];
async function makeClient(name: string) {
  const response = await fetch(`${origin}/workspaces`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { mcp_url } = await response.json() as { mcp_url: string };
  assert.match(new URL(mcp_url).pathname, /^\/mcp\/[A-Za-z0-9_-]{43}$/);
  const client = new Client({ name, version: '2.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp_url)));
  connections.push({ client, url: mcp_url });
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, JSON.stringify(response));
  return JSON.parse((response.content as Array<{ text: string }>)[0].text);
}
async function denied(client: Client, name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(response.isError, true);
}

try {
  const a = await makeClient('workspace-a-smoke');
  const b = await makeClient('workspace-b-smoke');
  assert.notEqual(connections[0].url, connections[1].url);
  assert.equal((await a.listTools()).tools.length, 12);
  console.log('PASS: anonymous private workspace creation and 12-tool discovery without auth headers');
  const saved = await call(a, 'save_learning', {
    title: `Smoke test ${Date.now()}`, user_question: 'Why does active recall help?',
    summary: 'Retrieving information from memory strengthens later recall and reveals knowledge gaps.',
    tags: ['smoke-test'], first_review_in_minutes: 0,
    cards: [{ question: 'What is active recall?', expected_answer: 'Retrieving information from memory rather than rereading.' }],
  });
  const list = await call(a, 'list_learnings', { search: 'Smoke test', limit: 50 });
  assert.ok(list.some((item: { id: string }) => item.id === saved.learning_id));
  assert.equal((await call(b, 'list_learnings', { search: 'Smoke test' })).length, 0);
  assert.equal((await call(b, 'get_due_reviews')).due_count, 0);
  assert.equal((await call(b, 'get_stats')).learnings, 0);
  const wrongQuestion = await call(b, 'next_question', { card_id: saved.card_ids[0] });
  assert.equal(wrongQuestion.attempt_id, undefined);
  const wrongDelete = await call(b, 'delete_learning', { learning_id: saved.learning_id, confirm: true });
  assert.equal(wrongDelete.deleted, false);
  const due = await call(a, 'get_due_reviews');
  assert.equal(due.due_count, 1);
  assert.equal(due.cards[0].card_id, saved.card_ids[0]);
  assert.equal(due.cards[0].expected_answer, undefined);
  const question = await call(a, 'next_question', { card_id: saved.card_ids[0] });
  assert.ok(question.attempt_id);
  assert.equal(question.expected_answer, undefined);
  assert.equal((await call(a, 'next_question', { card_id: saved.card_ids[0] })).attempt_id, question.attempt_id);
  await denied(b, 'submit_answer', { attempt_id: question.attempt_id, user_answer: 'Unauthorized overwrite' });
  await denied(b, 'record_review', { attempt_id: question.attempt_id, rating: 'easy', feedback: 'Unauthorized grade' });
  await denied(a, 'record_review', { attempt_id: question.attempt_id, rating: 'good', feedback: 'Premature grade' });
  console.log('PASS: workspace isolation for summaries, stats, due cards, question IDs, deletion, and answer/grade IDs');
  const answer = await call(a, 'submit_answer', { attempt_id: question.attempt_id, user_answer: 'Retrieve information from memory instead of rereading.' });
  assert.ok(answer.expected_answer);
  assert.equal(answer.user_answer, 'Retrieve information from memory instead of rereading.');
  await denied(b, 'submit_answer', { attempt_id: question.attempt_id, user_answer: 'Unauthorized read' });
  await denied(b, 'record_review', { attempt_id: question.attempt_id, rating: 'easy', feedback: 'Unauthorized grade' });
  const review = await call(a, 'record_review', { attempt_id: question.attempt_id, rating: 'good', feedback: 'Correct unaided recall.' });
  assert.equal(review.interval_minutes, 1440);
  await denied(a, 'record_review', { attempt_id: question.attempt_id, rating: 'good', feedback: 'Duplicate grade' });
  assert.equal((await call(a, 'get_due_reviews')).due_count, 0);
  assert.equal((await call(a, 'get_stats')).completed_reviews, 1);
  assert.equal((await call(b, 'get_stats')).completed_reviews, 0);
  console.log('PASS: hidden answers, resumable quiz, feedback, next-day scheduling, duplicate grade rejection');
  await call(a, 'delete_learning', { learning_id: saved.learning_id, confirm: true });
  for (const key of ['learnings', 'cards', 'completed_reviews', 'successful_reviews']) assert.equal((await call(a, 'get_stats'))[key], 0);
  console.log('PASS: learning deletion cascades to cards and review history');
} finally {
  for (const { client, url } of connections) {
    try {
      await call(client, 'delete_workspace', { confirm: true });
      const revoked = await fetch(url, { method: 'POST', headers, body: '{}' });
      assert.equal(revoked.status, 404);
    } finally { await client.close(); }
  }
  console.log('PASS: only generated test workspaces deleted and their links revoked');
}

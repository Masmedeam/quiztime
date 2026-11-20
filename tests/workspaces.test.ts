import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, findWorkspace, hashKey, homepage } from '../src/workspaces';
import { testDb } from './db';

test('anonymous links use random 256-bit keys stored only as hashes', async t => {
  const { db, sqlite } = testDb();
  t.after(() => sqlite.close());
  const a = await createWorkspace(db, 'https://example.com');
  const b = await createWorkspace(db, 'https://example.com');
  const key = new URL(a.mcp_url).pathname.split('/')[2];
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.mcp_url, b.mcp_url);
  const workspace = await findWorkspace(db, key);
  assert.ok(workspace);
  assert.equal(sqlite.prepare('SELECT key_hash FROM workspaces WHERE id = ?').get(workspace.id)?.key_hash, await hashKey(key));
  assert.equal(await findWorkspace(db, 'x'.repeat(43)), null);
  assert.equal(await findWorkspace(db, 'invalid'), null);
  sqlite.prepare('DELETE FROM workspaces WHERE id = ?').run(workspace.id);
  assert.equal(await findWorkspace(db, key), null);
});

test('workspace deletion removes owned data but preserves legacy unassigned data', async t => {
  const { db, sqlite } = testDb();
  t.after(() => sqlite.close());
  const workspace = await createWorkspace(db, 'https://example.com');
  const owner = await findWorkspace(db, new URL(workspace.mcp_url).pathname.split('/')[2]);
  sqlite.prepare("INSERT INTO learnings(id,title,user_question,summary,created_at,workspace_id) VALUES ('owned','T','Q','S',0,?)").run(owner!.id);
  sqlite.exec("INSERT INTO learnings(id,title,user_question,summary,created_at) VALUES ('legacy','T','Q','S',0); INSERT INTO cards(id,learning_id,question,expected_answer,due_at) VALUES ('card','owned','Q','A',0); INSERT INTO attempts(id,card_id,status,created_at) VALUES ('attempt','card','asked',0)");
  sqlite.prepare('DELETE FROM workspaces WHERE id = ?').run(owner!.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cards').get()?.n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attempts').get()?.n, 0);
  assert.equal(sqlite.prepare('SELECT id FROM learnings').get()?.id, 'legacy');
});

test('homepage does not embed keys, load third-party assets, or cache user links', async () => {
  const page = homepage();
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
  assert.ok(page.headers.get('Content-Security-Policy')?.includes("default-src 'none'"));
  const html = await page.text();
  assert.ok(html.includes('Create a private space'));
  assert.ok(!html.includes('bearer_token'));
});

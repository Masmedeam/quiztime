import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fixture } from '../tests/fixture';
import { handleBotEvent } from '../src/bot';

const { env, sqlite } = fixture();
try {
  env.AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT ?? `https://${process.env.AZURE_RESOURCE_NAME}.openai.azure.com/openai/v1/`;
  env.AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-6-luna';
  env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY ?? JSON.parse(readFileSync(`${homedir()}/.local/share/opencode/auth.json`, 'utf8')).azure?.key;
  assert.ok(env.AZURE_OPENAI_API_KEY, 'Configure Azure or explicitly use the local OpenCode credential store.');
  const question = await handleBotEvent(env, { id: 'live-q', chatId: '111', kind: 'message', text: '/quiz' });
  assert.ok(question.includes('Explain atomic transactions'));
  const answer = await handleBotEvent(env, { id: 'live-a', chatId: '111', kind: 'message', text: 'All changes either commit together or none do, so partial updates cannot occur.' });
  assert.ok(answer.includes('Next review:'));
  assert.equal(sqlite.prepare("SELECT review_count FROM cards WHERE id='c-a'").get()?.review_count, 1);
  const discussion = await handleBotEvent(env, { id: 'live-follow', chatId: '111', kind: 'message', text: 'Why is that useful when an application crashes halfway through?' });
  assert.ok(discussion.length > 20);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM learnings WHERE workspace_id='a' AND entry_type='interaction'").get()?.n, 1);
  assert.equal(sqlite.prepare("SELECT review_count FROM cards WHERE id='c-b'").get()?.review_count, 0);
  console.log('PASS: live Azure coach answered/grading JSON, FSRS update, follow-up discussion and session capture. No real Telegram messages were sent.');
} finally { sqlite.close(); }

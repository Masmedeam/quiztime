import { testDb } from './db';
import type { Env } from '../src/env';
import type { BotEvent } from '../src/bot';

export function fixture() {
  const { db, sqlite } = testDb();
  const jobs: BotEvent[] = [];
  const env = {
    DB: db, WORKSPACE_LIMITER: { limit: async () => ({ success: true }) }, AI_LIMITER: { limit: async () => ({ success: true }) },
    TELEGRAM_BOT_TOKEN: 'test-bot', TELEGRAM_WEBHOOK_SECRET: 'test-hook',
    AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/openai/v1/', AZURE_OPENAI_DEPLOYMENT: 'test-deployment', AZURE_OPENAI_API_KEY: 'test-key',
    TELEGRAM_AGENT: { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: unknown, init: RequestInit) => { jobs.push(JSON.parse(init.body as string)); return new Response('OK'); } }) },
  } as unknown as Env;
  sqlite.exec(`INSERT INTO workspaces(id,key_hash,created_at,telegram_chat_id,quiet_start,quiet_end) VALUES ('a','hash-a',0,'111',0,0),('b','hash-b',0,'222',0,0);
    INSERT INTO learnings(id,title,user_question,summary,created_at,workspace_id) VALUES ('l-a','A','Q','S',0,'a'),('l-b','B','Q','S',0,'b');
    INSERT INTO cards(id,learning_id,question,expected_answer,due_at) VALUES ('c-a','l-a','Explain atomic transactions','All-or-nothing changes',0),('c-b','l-b','Private B question','Private B answer',0);`);
  return { env, sqlite, jobs };
}

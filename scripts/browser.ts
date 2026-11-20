import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origin = process.env.STICK_ORIGIN ?? 'http://localhost:8787';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
let client: Client | undefined;
try {
  await page.goto(origin);
  assert.ok((await page.title()).includes('Stick'));
  mkdirSync('.stick/artifacts', { recursive: true, mode: 0o700 });
  await page.screenshot({ path: '.stick/artifacts/home.png', fullPage: true });
  await page.locator('#create').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('.empty').waitFor();
  const link = await page.locator('#link').inputValue();
  assert.ok((await page.locator('#command').inputValue()).includes('mcp add stick'));
  client = new Client({ name: 'stick-browser-test', version: '3.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(link)));
  const capture = async (session: string, title: string) => {
    const result = await client!.callTool({ name: 'capture_interaction', arguments: { session_key: session, session_title: session, event_id: session, title, user_message: 'How does this work?', summary: 'A real saved summary. <script>window.__stickXss=true</script>', insights: [{ title: 'A saved insight', explanation: 'Captured from an actual session.', kind: 'concept', importance: 'medium' }], cards: [] } });
    assert.ok(!result.isError);
  };
  await capture('Session one', 'First interaction');
  await capture('Session two', 'Second interaction');
  await page.reload();
  await page.locator('article').first().waitFor();
  assert.equal(await page.locator('article').count(), 2);
  assert.equal(await page.locator('#entries-count').textContent(), '2');
  await page.getByRole('button', { name: 'Session one 1' }).click();
  await page.waitForFunction(() => {
    const document = (globalThis as unknown as { document: { querySelectorAll(s: string): { length: number }; querySelector(s: string): { textContent: string | null } | null } }).document;
    return document.querySelectorAll('article').length === 1 && document.querySelector('article h3')?.textContent === 'First interaction';
  });
  assert.equal(await page.locator('.insight strong').textContent(), 'A saved insight');
  assert.equal(await page.evaluate(() => (globalThis as unknown as { __stickXss?: boolean }).__stickXss), undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => { const window = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return window.document.documentElement.scrollWidth <= window.innerWidth; }));
  await page.locator('.preferences summary').click();
  await page.locator('#capture').uncheck();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/preferences') && response.request().method() === 'PATCH' && response.status() === 200),
    page.locator('#save-preferences').click(),
  ]);
  await page.reload();
  await page.locator('article').first().waitFor();
  assert.equal(await page.locator('#capture').isChecked(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: Stick desktop/mobile frontend, workspace creation, persisted link, real session filtering, safe text rendering, preferences');
} finally {
  if (client) { await client.callTool({ name: 'delete_workspace', arguments: { confirm: true } }); await client.close(); }
  await browser.close();
}

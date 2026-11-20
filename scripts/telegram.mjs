import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const values = { ...process.env };
try {
  for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match && !values[match[1]]) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }

for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']) {
  if (!values[name]) throw new Error(`Set ${name} in private .dev.vars or your shell environment first.`);
}
if (!/^[A-Za-z0-9_-]{32,256}$/.test(values.TELEGRAM_WEBHOOK_SECRET)) throw new Error('Use a random 32–256-character webhook secret (letters, numbers, underscore, hyphen).');
for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']) {
  const child = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: values[name], stdio: ['pipe', 'inherit', 'inherit'] });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
const origin = new URL(values.STICK_ORIGIN ?? values.QUIZTIME_ORIGIN ?? 'https://quiztime-mcp.hidden-pond-5e6a.workers.dev').origin;
if (!origin.startsWith('https://')) throw new Error('Telegram webhooks require a public HTTPS endpoint.');
try {
  const response = await fetch(`https://api.telegram.org/bot${values.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${origin}/telegram/webhook`, secret_token: values.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('setup failed');
  console.log('Stick Telegram webhook registered. Connect Telegram from your private space, then send /quiz.');
} catch {
  // Never print the bot API URL or fetch error: those may include the secret.
  console.error('Telegram webhook registration failed. Verify the bot token and deployed HTTPS endpoint.');
  process.exitCode = 1;
}

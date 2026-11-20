import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const values = { ...process.env };
try {
  for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n')) {
    const match = /^([A-Z_]+)\s*=\s*(.+)$/.exec(line.trim());
    if (match && !values[match[1]]) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const names = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_KEY'];
for (const name of names) if (!values[name]) throw new Error(`Set ${name} in private .dev.vars or the environment first. Never paste keys into chat.`);
if (!values.AZURE_OPENAI_ENDPOINT.startsWith('https://')) throw new Error('Use a trusted HTTPS Azure OpenAI endpoint.');
if (values.AZURE_OPENAI_API_VERSION) names.push('AZURE_OPENAI_API_VERSION');
for (const name of names) {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: values[name], stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Azure configuration uploaded to Stick. Test a Telegram reply after pairing your space.');

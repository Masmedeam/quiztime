import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Explicit opt-in import. Do not log or copy the user's credential to project files.
const authFile = process.env.OPENCODE_AUTH_FILE ?? `${homedir()}/.local/share/opencode/auth.json`;
const auth = JSON.parse(readFileSync(authFile, 'utf8')).azure;
const resource = process.env.AZURE_RESOURCE_NAME;
if (auth?.type !== 'api' || !auth.key || !resource || !/^[a-zA-Z0-9-]+$/.test(resource)) throw new Error('OpenCode Azure API credentials and AZURE_RESOURCE_NAME are required.');
const endpoint = `https://${resource}.openai.azure.com/openai/v1/`;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-6-luna';
try {
  const response = await fetch(`https://${resource}.openai.azure.com/openai/deployments?api-version=2023-03-15-preview`, { headers: { 'api-key': auth.key }, signal: AbortSignal.timeout(15000) });
  const inventory = await response.json();
  if (!response.ok || !(inventory.data ?? []).some(item => item.id === deployment)) throw new Error('deployment unavailable');
} catch { throw new Error('Could not validate the selected Azure deployment. No credentials were exposed.'); }
console.log(`Importing Azure configuration for deployment ${deployment}. The key stays server-side.`);
const result = spawnSync('node', ['scripts/azure.mjs'], {
  stdio: 'inherit', env: { ...process.env, AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_DEPLOYMENT: deployment, AZURE_OPENAI_API_KEY: auth.key },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

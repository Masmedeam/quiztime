import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const origin = process.env.STICK_ORIGIN ?? 'https://quiztime-mcp.hidden-pond-5e6a.workers.dev';
const response = await fetch(`${origin}/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(response.status, 201);
const { mcp_url } = await response.json();
const client = new Client({ name: 'stick-codex-verification', version: '3.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(mcp_url)));
try {
  const run = spawnSync('codex', ['-c', `mcp_servers.stick={url=${JSON.stringify(mcp_url)},default_tools_approval_mode="auto"}`, 'exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--json', 'Why should an HTTP webhook handler make writes idempotent? Explain briefly. I have opted into Stick automatic capture for this conversation. Use only Stick MCP tools if needed; do not print private URLs, run shell commands, delete data, or change files.'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  if (run.error) throw new Error('Codex verification could not complete.');
  assert.equal(run.status, 0, 'Codex process failed; raw logs withheld to protect private links.');
  const events = run.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  assert.ok(events.some(event => event.item?.type === 'mcp_tool_call' && event.item.tool === 'capture_interaction'), 'Codex did not automatically call capture_interaction.');
  const stats = await client.callTool({ name: 'get_stats', arguments: {} });
  assert.ok(JSON.parse(stats.content[0].text).learnings >= 1);
  const sessions = await client.callTool({ name: 'list_sessions', arguments: {} });
  assert.ok(JSON.parse(sessions.content[0].text).length >= 1);
  console.log('PASS: Codex automatically captured a normal opted-in exchange and its session through Stick MCP.');
} finally {
  await client.callTool({ name: 'delete_workspace', arguments: { confirm: true } });
  await client.close();
}

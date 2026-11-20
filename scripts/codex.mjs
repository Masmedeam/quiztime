import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const mode = process.argv[2] ?? 'local';
  if (!['local', 'remote'].includes(mode)) throw new Error('Usage: node scripts/codex.mjs local|remote [Codex arguments]');
  let url = process.env.QUIZTIME_URL;
  if (!url) {
    const stateFile = new URL(`../.quiztime/${mode}.json`, import.meta.url);
    try { url = JSON.parse(readFileSync(stateFile, 'utf8')).mcp_url; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!url) {
      const origin = mode === 'local' ? 'http://localhost:8787' : 'https://quiztime-mcp.hidden-pond-5e6a.workers.dev';
      const response = await fetch(`${origin}/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(`Could not create workspace (HTTP ${response.status}). Start the server or try again later.`);
      const workspace = await response.json();
      mkdirSync(new URL('../.quiztime/', import.meta.url), { recursive: true, mode: 0o700 });
      writeFileSync(stateFile, JSON.stringify(workspace), { mode: 0o600, flag: 'wx' });
      url = workspace.mcp_url;
      console.log(`Created a private ${mode} workspace. Its link is saved in .quiztime/${mode}.json (keep it private).`);
    }
  }
  if (!/^\/mcp\/[A-Za-z0-9_-]{43}$/.test(new URL(url).pathname)) throw new Error('QUIZTIME_URL must be a private workspace MCP link created at the homepage.');
  // Per-process config avoids overwriting the user's global Codex configuration.
  const args = ['-c', `mcp_servers.quiztime={url=${JSON.stringify(url)}}`, ...process.argv.slice(3)];
  const interactive = !process.argv.slice(3).includes('exec');
  const child = spawnSync('codex', args, { stdio: [interactive ? 'inherit' : 'ignore', 'inherit', 'inherit'] });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

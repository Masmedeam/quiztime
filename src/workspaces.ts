export interface Workspace {
  id: string;
  telegram_chat_id: string | null;
}

export function randomKey() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export async function hashKey(key: string) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).toString('hex');
}

export async function createWorkspace(db: D1Database, origin: string) {
  const key = randomKey();
  const workspaceId = crypto.randomUUID();
  await db.prepare('INSERT INTO workspaces(id,key_hash,created_at) VALUES (?,?,?)')
    .bind(workspaceId, await hashKey(key), Date.now()).run();
  return { mcp_url: `${origin}/mcp/${key}`, warning: 'Keep this link private. Anyone with it can access this workspace. There is no account or lost-link recovery.' };
}

export async function findWorkspace(db: D1Database, key: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return db.prepare('SELECT id, telegram_chat_id FROM workspaces WHERE key_hash = ?')
    .bind(await hashKey(key)).first<Workspace>();
}

export function homepage() {
  const nonce = randomKey();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quiztime — learn, recall, remember</title>
<style nonce="${nonce}">
body{font:17px/1.6 system-ui,sans-serif;color:#182b26;background:#f3f6f2;max-width:720px;margin:9vh auto;padding:24px}
h1{font-size:44px;line-height:1.1;margin-bottom:12px}h2{font-size:22px}button{background:#176d50;color:white;border:0;border-radius:10px;padding:14px 24px;font:inherit;cursor:pointer}button:disabled{opacity:.5}section{margin-top:28px;padding:24px;background:white;border-radius:16px;border:1px solid #dbe5dd}textarea{width:100%;box-sizing:border-box;padding:12px;font:14px monospace;resize:vertical;border:1px solid #c9d7cd;border-radius:8px}small{display:block;color:#53675c}code{overflow-wrap:anywhere}#error{color:#a12626}
</style></head><body>
<small>QUIZTIME · ANONYMOUS LEARNING WORKSPACES</small>
<h1>Learn it. Recall it.<br>Remember it.</h1>
<p>Save what you learn with Codex, then quiz yourself with spaced repetition. No account, email, or sign-in required.</p>
<button id="create">Create my private workspace</button><p id="error" role="alert"></p>
<section id="setup" hidden><h2>Your workspace is ready</h2>
<p>Save this private MCP link somewhere safe:</p><textarea id="link" readonly rows="3" aria-label="Private MCP link"></textarea>
<p><strong>Anyone with this link can read and change your learning.</strong> We cannot recover a lost link. Do not post it publicly or commit it.</p>
<h2>Connect Codex</h2><p>Run this in your terminal:</p><textarea id="command" readonly rows="3" aria-label="Codex connection command"></textarea>
<p>Restart Codex, then ask:</p><p><em>“Teach me TCP vs UDP, save it in Quiztime with two recall questions, and make the first review due immediately. Then quiz me one question at a time.”</em></p>
<small>Re-use this link on other devices to access the same workspace. A new link creates a separate workspace.</small></section>
<section><h2>How it works</h2><ol><li>Codex summarizes learning you choose to save.</li><li>Quiztime stores your summaries and recall questions privately behind your link.</li><li>Answer before seeing the reference answer. Reviews adjust based on your recall.</li></ol><p>Optional Telegram reminders can ping you when questions are due. Ask Codex to connect Telegram after setup.</p><small>Quiztime cannot automatically read your other chats or browser history. Your AI client must call its learning tools.</small></section>
<script nonce="${nonce}">
document.getElementById('create').addEventListener('click',async()=>{
const button=document.getElementById('create');button.disabled=true;document.getElementById('error').textContent='';
try{const response=await fetch('/workspaces',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error(response.status===429?'Too many workspace requests. Try again in a minute.':'Could not create a workspace. Please try again.');const data=await response.json();document.getElementById('link').value=data.mcp_url;document.getElementById('command').value='codex mcp add quiztime --url '+data.mcp_url;document.getElementById('setup').hidden=false;button.textContent='Workspace created';}catch(error){document.getElementById('error').textContent=error.message;button.disabled=false;}
});
</script></body></html>`;
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff',
  } });
}

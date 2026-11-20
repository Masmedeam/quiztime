import { renderHomepage } from './frontend';

export interface Workspace { id: string; telegram_chat_id: string | null }

export function randomKey() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}
export async function hashKey(key: string) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).toString('hex');
}
export async function createWorkspace(db: D1Database, origin: string, options: { id?: string; desired_retention?: number; daily_limit?: number } = {}) {
  const key = randomKey();
  await db.prepare('INSERT INTO workspaces(id,key_hash,created_at,desired_retention,daily_limit) VALUES (?,?,?,?,?)')
    .bind(options.id ?? crypto.randomUUID(), await hashKey(key), Date.now(), options.desired_retention ?? 0.9, options.daily_limit ?? 3).run();
  return { mcp_url: `${origin}/mcp/${key}`, dashboard_url: `${origin}/#${key}`, warning: 'Keep this link private. Anyone with it can access this workspace. There is no account or lost-link recovery.' };
}
export async function findWorkspace(db: D1Database, key: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return db.prepare('SELECT id, telegram_chat_id FROM workspaces WHERE key_hash = ?').bind(await hashKey(key)).first<Workspace>();
}
export function homepage() { return renderHomepage(); }

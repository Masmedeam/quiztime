import type { Env } from './env';

// Cognee builds a per-workspace knowledge graph from saved learning, so Stick can
// connect today's insight to older ones (better cards, better Telegram follow-ups).
// Only redacted summaries/insights are sent, never raw chat, answers or links.
// Everything is a no-op without COGNEE_API_URL + COGNEE_API_KEY, and failures never
// block saving: D1 stays the source of truth.

export function cogneeConfigured(env: Env) {
  return Boolean(env.COGNEE_API_URL && env.COGNEE_API_KEY);
}

// One dataset per workspace keeps graphs isolated between anonymous workspaces.
export const datasetName = (workspaceId: string) => `stick_${workspaceId.replace(/[^A-Za-z0-9]/g, '_')}`;

function cogneeFetch(env: Env, path: string, init: RequestInit & { timeout?: number } = {}) {
  const url = new URL(path, env.COGNEE_API_URL);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Cognee requires HTTPS.');
  return fetch(url, { ...init, headers: { 'X-Api-Key': env.COGNEE_API_KEY!, ...init.headers }, signal: AbortSignal.timeout(init.timeout ?? 8000) });
}

export interface CogneeLearning { title: string; summary: string; tags?: string[]; insights?: Array<{ title: string; explanation: string; kind?: string }> }

/** Add one learning to the workspace graph and start (background) graph building. */
export async function rememberInCognee(env: Env, workspaceId: string, learning: CogneeLearning) {
  if (!cogneeConfigured(env)) return false;
  try {
    const text = [
      `Learning: ${learning.title}`,
      learning.summary,
      ...(learning.insights ?? []).map(insight => `${insight.kind ?? 'insight'}: ${insight.title}. ${insight.explanation}`),
      learning.tags?.length ? `Topics: ${learning.tags.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const form = new FormData();
    form.append('datasetName', datasetName(workspaceId));
    form.append('raw_data', text);
    const added = await cogneeFetch(env, '/api/v1/add', { method: 'POST', body: form });
    if (!added.ok) throw new Error(`add ${added.status}`);
    const cognify = await cogneeFetch(env, '/api/v1/cognify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasets: [datasetName(workspaceId)], runInBackground: true }),
    });
    if (!cognify.ok) throw new Error(`cognify ${cognify.status}`);
    return true;
  } catch {
    console.error('Cognee ingestion failed; learning is still saved in D1.');
    return false;
  }
}

/** Ask the workspace graph how a topic connects to earlier learning. Returns null when unavailable. */
export async function searchCognee(env: Env, workspaceId: string, query: string, searchType = 'GRAPH_COMPLETION') {
  if (!cogneeConfigured(env)) return null;
  try {
    const response = await cogneeFetch(env, '/api/v1/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 20_000,
      body: JSON.stringify({ query: query.slice(0, 1000), searchType, datasets: [datasetName(workspaceId)], topK: 8 }),
    });
    // 404 = nothing ingested for this workspace yet.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`search ${response.status}`);
    const results = await response.json() as Array<{ search_result?: unknown } | unknown>;
    const flat = results.map(item => (item && typeof item === 'object' && 'search_result' in item ? (item as { search_result: unknown }).search_result : item));
    const text = flat.map(value => (typeof value === 'string' ? value : JSON.stringify(value))).join('\n').trim();
    return text ? text.slice(0, 4000) : null;
  } catch {
    console.error('Cognee search failed.');
    return null;
  }
}

/** Delete the workspace's whole graph (used by delete_workspace). */
export async function forgetInCognee(env: Env, workspaceId: string) {
  if (!cogneeConfigured(env)) return;
  try {
    const list = await cogneeFetch(env, '/api/v1/datasets');
    if (!list.ok) throw new Error(`list ${list.status}`);
    const datasets = await list.json() as Array<{ id: string; name: string }>;
    const dataset = datasets.find(item => item.name === datasetName(workspaceId));
    if (dataset) await cogneeFetch(env, `/api/v1/datasets/${encodeURIComponent(dataset.id)}`, { method: 'DELETE' });
  } catch {
    console.error('Cognee dataset deletion failed.');
  }
}

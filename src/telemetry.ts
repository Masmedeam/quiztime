import type { Env } from './env';

// Amplitude (product analytics) + Statsig (experiments), wired as one package:
// - Statsig assigns each new workspace a review-policy variant.
// - Every product event goes to BOTH Amplitude (funnels/retention charts) and
//   Statsig (experiment metrics), keyed by the same anonymous workspace id.
// Privacy: events carry counts, ratings and channels only, never learning text,
// questions, answers, chat ids or workspace links. Both are no-ops without keys.

export type EventProps = Record<string, string | number | boolean | null | undefined>;

export const REVIEW_POLICY_EXPERIMENT = 'stick_review_policy';
export interface ReviewPolicy { desired_retention: number; daily_limit: number; group: string }
const DEFAULT_POLICY: ReviewPolicy = { desired_retention: 0.9, daily_limit: 3, group: 'default' };

const clean = (props: EventProps) => Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

/** Send one event to Amplitude and Statsig. Never throws: analytics must not break learning. */
export async function track(env: Env, workspaceId: string, event: string, props: EventProps = {}, userProps?: EventProps) {
  const time = Date.now();
  const eventProps = clean(props);
  const sends: Promise<unknown>[] = [];
  if (env.AMPLITUDE_API_KEY) {
    sends.push(post(env.AMPLITUDE_API_URL ?? 'https://api2.amplitude.com/2/httpapi', {}, {
      api_key: env.AMPLITUDE_API_KEY,
      events: [{ user_id: workspaceId, event_type: event, time, insert_id: crypto.randomUUID(), event_properties: eventProps, ...(userProps ? { user_properties: { $set: clean(userProps) } } : {}) }],
    }));
  }
  if (env.STATSIG_SERVER_SECRET) {
    // Statsig metadata values must be strings.
    const metadata = Object.fromEntries(Object.entries(eventProps).map(([key, value]) => [key, String(value)]));
    sends.push(post('https://api.statsig.com/v1/log_event', { 'statsig-api-key': env.STATSIG_SERVER_SECRET }, {
      events: [{ eventName: event, user: { userID: workspaceId }, time, metadata, ...(typeof props.value === 'number' ? { value: props.value } : {}) }],
    }));
  }
  const results = await Promise.allSettled(sends);
  if (results.some(result => result.status === 'rejected')) console.error(`Telemetry delivery failed for ${event}.`);
}

/**
 * Ask Statsig which review policy a new workspace gets. Statsig logs the exposure
 * automatically. Values are clamped to the same bounds as user preferences, and
 * any failure falls back to the defaults so workspace creation never breaks.
 */
export async function assignReviewPolicy(env: Env, workspaceId: string): Promise<ReviewPolicy> {
  if (!env.STATSIG_SERVER_SECRET) return DEFAULT_POLICY;
  try {
    const response = await post('https://api.statsig.com/v1/get_config', { 'statsig-api-key': env.STATSIG_SERVER_SECRET }, { configName: REVIEW_POLICY_EXPERIMENT, user: { userID: workspaceId } });
    const config = await response.json() as { value?: { desired_retention?: unknown; daily_limit?: unknown }; group_name?: string; rule_id?: string; group?: string };
    const retention = Number(config.value?.desired_retention);
    const limit = Number(config.value?.daily_limit);
    return {
      desired_retention: Number.isFinite(retention) ? Math.min(0.97, Math.max(0.8, retention)) : DEFAULT_POLICY.desired_retention,
      daily_limit: Number.isInteger(limit) ? Math.min(10, Math.max(1, limit)) : DEFAULT_POLICY.daily_limit,
      group: String(config.group_name ?? config.group ?? config.rule_id ?? 'default').slice(0, 80),
    };
  } catch {
    console.error('Statsig assignment failed; using default review policy.');
    return DEFAULT_POLICY;
  }
}

import type { Env } from './env';
import { scheduleReview, type Rating } from './schedule';
import { track } from './telemetry';

export async function finishReview(env: Env, workspaceId: string, attemptId: string, rating: Rating, feedback: string, now = Date.now()) {
  const attempt = await env.DB.prepare("SELECT a.card_id, a.channel, c.fsrs_state, c.review_count, w.desired_retention FROM attempts a JOIN cards c ON c.id = a.card_id JOIN learnings l ON l.id = c.learning_id JOIN workspaces w ON w.id = l.workspace_id WHERE a.id = ? AND a.status = 'answered' AND l.workspace_id = ?")
    .bind(attemptId, workspaceId).first<{ card_id: string; channel: string; fsrs_state: string | null; review_count: number; desired_retention: number }>();
  if (!attempt) throw new Error('Submit an answer first; attempt may already be graded.');
  const schedule = scheduleReview(attempt.fsrs_state, rating, now, attempt.desired_retention);
  const changes = await env.DB.batch([
    env.DB.prepare("UPDATE cards SET due_at = ?, interval_minutes = ?, fsrs_state = ?, review_count = review_count + 1, lapses = lapses + ? WHERE id = ? AND learning_id IN (SELECT id FROM learnings WHERE workspace_id = ?) AND EXISTS (SELECT 1 FROM attempts WHERE id = ? AND status = 'answered')")
      .bind(schedule.due_at, schedule.interval_minutes, schedule.fsrs_state, rating === 'again' ? 1 : 0, attempt.card_id, workspaceId, attemptId),
    env.DB.prepare("UPDATE attempts SET status = 'graded', rating = ?, feedback = ?, graded_at = ?, fsrs_log = ? WHERE id = ? AND status = 'answered' AND card_id IN (SELECT c.id FROM cards c JOIN learnings l ON l.id = c.learning_id WHERE l.workspace_id = ?)")
      .bind(rating, feedback, now, schedule.fsrs_log, attemptId, workspaceId),
  ]);
  if (!changes[0].meta.changes) throw new Error('Attempt already graded.');
  // value = 1 for successful recall: Statsig's experiment metric is mean(value) = recall rate.
  await track(env, workspaceId, 'card_reviewed', {
    rating, recalled: rating === 'good' || rating === 'easy', value: rating === 'good' || rating === 'easy' ? 1 : 0,
    channel: attempt.channel, review_number: attempt.review_count + 1, interval_minutes: schedule.interval_minutes, desired_retention: attempt.desired_retention,
  });
  return { rating, feedback, next_review_at: new Date(schedule.due_at).toISOString(), interval_minutes: schedule.interval_minutes, scheduler: 'FSRS-6' };
}

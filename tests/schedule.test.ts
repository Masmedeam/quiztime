import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietHour, localClock, scheduleReview } from '../src/schedule';

test('FSRS persists memory state/log and stronger recall schedules later reviews', () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const again = scheduleReview(null, 'again', now);
  const good = scheduleReview(null, 'good', now);
  const easy = scheduleReview(null, 'easy', now);
  assert.ok(again.due_at > now);
  assert.ok(good.due_at > again.due_at);
  assert.ok(easy.due_at >= good.due_at);
  assert.equal(JSON.parse(good.fsrs_state).reps, 1);
  assert.ok(JSON.parse(good.fsrs_log).rating);
  const next = scheduleReview(good.fsrs_state, 'good', good.due_at);
  assert.equal(JSON.parse(next.fsrs_state).reps, 2);
  assert.ok(next.interval_minutes >= good.interval_minutes);
});
test('higher target retention increases review frequency and intervals stay capped', () => {
  const now = Date.UTC(2026, 10, 20, 12);
  assert.ok(scheduleReview(null, 'easy', now, .97).interval_minutes <= scheduleReview(null, 'easy', now, .8).interval_minutes);
  let state: string | null = null;
  let time = now;
  for (let i = 0; i < 25; i++) {
    const scheduled = scheduleReview(state, 'easy', time);
    assert.ok(scheduled.interval_minutes <= 365 * 1440);
    state = scheduled.fsrs_state; time = scheduled.due_at;
  }
});
test('quiet hours handle overnight/same-day ranges and timezones correctly', () => {
  assert.equal(isQuietHour(23, 22, 8), true);
  assert.equal(isQuietHour(7, 22, 8), true);
  assert.equal(isQuietHour(12, 22, 8), false);
  assert.equal(isQuietHour(12, 9, 17), true);
  assert.equal(isQuietHour(12, 0, 0), false);
  assert.deepEqual(localClock('Asia/Tokyo', Date.UTC(2026, 0, 1, 20)), { day: '2026-01-02', hour: 5 });
});

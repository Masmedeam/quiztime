import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReview } from '../src/schedule';

test('first reviews: again 10m, hard/good 1d, easy 4d', () => {
  for (const [rating, minutes] of [['again', 10], ['hard', 1440], ['good', 1440], ['easy', 5760]] as const) {
    assert.deepEqual(scheduleReview(0, rating, 1000), { interval_minutes: minutes, due_at: 1000 + minutes * 60_000 });
  }
});
test('successful recall grows the interval; failure resets it', () => {
  assert.equal(scheduleReview(1440, 'good', 0).interval_minutes, 2880);
  assert.equal(scheduleReview(1440, 'easy', 0).interval_minutes, 4320);
  assert.equal(scheduleReview(1440, 'hard', 0).interval_minutes, 1728);
  assert.equal(scheduleReview(10080, 'again', 0).interval_minutes, 10);
});
test('maximum interval is one year', () => {
  assert.equal(scheduleReview(365 * 1440, 'easy', 0).interval_minutes, 365 * 1440);
});

export type Rating = 'again' | 'hard' | 'good' | 'easy';

// A deliberately simple, transparent spaced-repetition schedule, not FSRS.
export function scheduleReview(intervalMinutes: number, rating: Rating, now: number) {
  const day = 1440;
  const intervals = {
    again: 10,
    hard: Math.max(day, Math.round(intervalMinutes * 1.2)),
    good: intervalMinutes < day ? day : Math.round(intervalMinutes * 2),
    easy: intervalMinutes < day ? 4 * day : Math.round(intervalMinutes * 3),
  };
  const interval = Math.min(365 * day, intervals[rating]);
  return { interval_minutes: interval, due_at: now + interval * 60_000 };
}

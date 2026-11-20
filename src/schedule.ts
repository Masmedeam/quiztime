import { createEmptyCard, fsrs, Rating as Grade, type Card } from 'ts-fsrs';
export type Rating = 'again' | 'hard' | 'good' | 'easy';

export function scheduleReview(state: string | null, rating: Rating, now: number, retention = 0.9) {
  const scheduler = fsrs({ request_retention: retention, maximum_interval: 365, enable_fuzz: false, enable_short_term: true, learning_steps: ['10m'], relearning_steps: ['10m'] });
  const stored = state ? JSON.parse(state) : null;
  const card: Card = stored ? { ...stored, due: new Date(stored.due), last_review: stored.last_review ? new Date(stored.last_review) : undefined } : createEmptyCard(new Date(now));
  const grade = ({ again: Grade.Again, hard: Grade.Hard, good: Grade.Good, easy: Grade.Easy } as const)[rating];
  const review = scheduler.next(card, new Date(now), grade);
  review.card.due = new Date(Math.min(review.card.due.getTime(), now + 365 * 24 * 60 * 60_000));
  review.card.scheduled_days = Math.min(review.card.scheduled_days, 365);
  review.log.scheduled_days = Math.min(review.log.scheduled_days, 365);
  return {
    due_at: review.card.due.getTime(),
    interval_minutes: Math.max(1, Math.round((review.card.due.getTime() - now) / 60_000)),
    fsrs_state: JSON.stringify(review.card), fsrs_log: JSON.stringify(review.log),
  };
}

export function localClock(timezone: string, now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export function isQuietHour(hour: number, start: number, end: number) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

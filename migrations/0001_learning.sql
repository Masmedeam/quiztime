PRAGMA foreign_keys = ON;
CREATE TABLE learnings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  user_question TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_urls TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  learning_id TEXT NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_due ON cards(due_at);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('asked', 'answered', 'graded')),
  user_answer TEXT,
  rating TEXT,
  feedback TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  graded_at INTEGER
);
CREATE UNIQUE INDEX one_open_attempt ON attempts(card_id) WHERE status != 'graded';
CREATE TABLE reminder_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_sent_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO reminder_state(id) VALUES (1);

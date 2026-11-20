CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  title TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  UNIQUE(workspace_id, session_key)
);
ALTER TABLE learnings ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE learnings ADD COLUMN event_id TEXT;
ALTER TABLE learnings ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'learning';
ALTER TABLE learnings ADD COLUMN insights TEXT NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX learning_event ON learnings(workspace_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX learning_session ON learnings(workspace_id, session_id, created_at);
ALTER TABLE cards ADD COLUMN fsrs_state TEXT;
ALTER TABLE cards ADD COLUMN priority INTEGER NOT NULL DEFAULT 2;
ALTER TABLE attempts ADD COLUMN channel TEXT NOT NULL DEFAULT 'mcp';
ALTER TABLE attempts ADD COLUMN fsrs_log TEXT;
ALTER TABLE workspaces ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE workspaces ADD COLUMN quiet_start INTEGER NOT NULL DEFAULT 22;
ALTER TABLE workspaces ADD COLUMN quiet_end INTEGER NOT NULL DEFAULT 8;
ALTER TABLE workspaces ADD COLUMN daily_limit INTEGER NOT NULL DEFAULT 3;
ALTER TABLE workspaces ADD COLUMN desired_retention REAL NOT NULL DEFAULT 0.9;
ALTER TABLE workspaces ADD COLUMN capture_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspaces ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspaces ADD COLUMN question_day TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN questions_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN unanswered_pings INTEGER NOT NULL DEFAULT 0;
CREATE TABLE ai_usage (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id, day)
);
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(workspace_id,event_id,role)
);

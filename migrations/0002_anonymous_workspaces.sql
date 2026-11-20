CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  telegram_chat_id TEXT,
  last_sent_at INTEGER NOT NULL DEFAULT 0
);
-- Existing single-owner data is preserved but never exposed to a new workspace.
ALTER TABLE learnings ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX learnings_workspace ON learnings(workspace_id, created_at);
CREATE TABLE telegram_links (
  key_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

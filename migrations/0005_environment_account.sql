-- Stable ownership for Worker-configured accounts. Retain a tombstone on deletion.
CREATE TABLE environment_account (
  id INTEGER PRIMARY KEY CHECK(id=1),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

-- Retain the one-time marker even if the initialized account is deleted.
CREATE TABLE bootstrap_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at INTEGER NOT NULL
);

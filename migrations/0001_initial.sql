PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('session','device')),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE TABLE sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  highest_id INTEGER NOT NULL DEFAULT 0,
  body TEXT,
  etag TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE nodes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL,
  parent_id INTEGER,
  type TEXT NOT NULL CHECK(type IN ('folder','bookmark')),
  title TEXT NOT NULL,
  url TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  PRIMARY KEY(user_id,node_id),
  FOREIGN KEY(user_id,parent_id) REFERENCES nodes(user_id,node_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK((node_id=0 AND parent_id IS NULL AND type='folder') OR (node_id>0 AND parent_id IS NOT NULL)),
  CHECK((type='folder' AND url IS NULL) OR (type='bookmark' AND url IS NOT NULL))
);
CREATE INDEX nodes_parent ON nodes(user_id,parent_id,deleted,position);
CREATE INDEX nodes_version ON nodes(user_id,version);
CREATE TABLE sync_locks (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE staging (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  body TEXT NOT NULL,
  etag TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
-- CHECK violation intentionally aborts an entire D1 batch on a stale lease/version.
CREATE TABLE transaction_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_time ON audit_logs(created_at);
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(key,bucket)
);
CREATE INDEX rate_time ON rate_limits(bucket);

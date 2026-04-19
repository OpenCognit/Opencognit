CREATE TABLE IF NOT EXISTS worker_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT,
  capabilities TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'online',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  active_runs INTEGER NOT NULL DEFAULT 0,
  total_runs INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT,
  registriert_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS worker_nodes_status_idx ON worker_nodes (status, last_heartbeat_at);

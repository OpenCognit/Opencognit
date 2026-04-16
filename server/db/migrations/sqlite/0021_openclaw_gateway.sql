-- OpenClaw Gateway Integration
-- Adds verbindungsTyp='openclaw' support (SQLite text columns don't enforce enums)
-- and a table to store per-company connection tokens for OpenClaw agents to join.

CREATE TABLE IF NOT EXISTS openclaw_tokens (
  id          TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  token       TEXT NOT NULL UNIQUE,
  beschreibung TEXT,
  erstellt_am TEXT NOT NULL,
  letzter_join TEXT
);

CREATE INDEX IF NOT EXISTS idx_openclaw_tokens_unternehmen
  ON openclaw_tokens(unternehmen_id);

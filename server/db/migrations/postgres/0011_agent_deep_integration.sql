-- Migration 0011: Agent Deep Integration — iterative summaries + full-text search
-- Note: SQLite FTS5 virtual tables are not available in PostgreSQL.
-- Full-text search on chat_nachrichten and palace_drawers uses tsvector + GIN indexes.

CREATE TABLE IF NOT EXISTS palace_summaries (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  inhalt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  komprimierte_turns INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_palace_summaries_expert ON palace_summaries(expert_id);

-- Full-text search via tsvector (PostgreSQL-native, replaces FTS5)
ALTER TABLE chat_nachrichten ADD COLUMN IF NOT EXISTS nachricht_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(nachricht, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_chat_nachrichten_fts ON chat_nachrichten USING GIN(nachricht_tsv);

ALTER TABLE palace_drawers ADD COLUMN IF NOT EXISTS inhalt_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(inhalt, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_palace_drawers_fts ON palace_drawers USING GIN(inhalt_tsv);

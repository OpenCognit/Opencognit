-- Agent Deep Integration: Iterative Summaries + FTS5 Volltextsuche

-- Persistente Context-Summaries (iterativ aktualisiert, nie überschrieben)
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

-- FTS5 Volltextsuche über Chat-Nachrichten (Session Search)
CREATE VIRTUAL TABLE IF NOT EXISTS fts_nachrichten USING fts5(
  nachricht,
  content='chat_nachrichten',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- FTS5 Volltextsuche über Palace Drawers
CREATE VIRTUAL TABLE IF NOT EXISTS fts_drawers USING fts5(
  inhalt,
  content='palace_drawers',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- Trigger um FTS5 bei INSERT/DELETE synchron zu halten
CREATE TRIGGER IF NOT EXISTS fts_nachrichten_ai AFTER INSERT ON chat_nachrichten BEGIN
  INSERT INTO fts_nachrichten(rowid, nachricht) VALUES (new.rowid, new.nachricht);
END;

CREATE TRIGGER IF NOT EXISTS fts_drawers_ai AFTER INSERT ON palace_drawers BEGIN
  INSERT INTO fts_drawers(rowid, inhalt) VALUES (new.rowid, new.inhalt);
END;

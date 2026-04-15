-- Migration 0014: Agent Coordination — P2P Messaging & Multi-Agent Meetings

ALTER TABLE chat_nachrichten ADD COLUMN IF NOT EXISTS von_expert_id TEXT;
ALTER TABLE chat_nachrichten ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE TABLE IF NOT EXISTS agenten_meetings (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  titel TEXT NOT NULL,
  veranstalter_expert_id TEXT NOT NULL REFERENCES experten(id),
  teilnehmer_ids TEXT NOT NULL,
  antworten TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  ergebnis TEXT,
  erstellt_am TEXT NOT NULL,
  abgeschlossen_am TEXT
);

CREATE INDEX IF NOT EXISTS idx_meetings_company ON agenten_meetings(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON agenten_meetings(status);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_nachrichten(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_von_expert ON chat_nachrichten(von_expert_id) WHERE von_expert_id IS NOT NULL;

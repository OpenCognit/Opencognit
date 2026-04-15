-- Agent Coordination: P2P Messaging & Multi-Agent Meetings
-- Adds sender tracking and thread grouping to chat messages,
-- plus a new meetings table for structured multi-agent coordination.

ALTER TABLE chat_nachrichten ADD COLUMN von_expert_id TEXT;
ALTER TABLE chat_nachrichten ADD COLUMN thread_id TEXT;

CREATE TABLE IF NOT EXISTS agenten_meetings (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  titel TEXT NOT NULL,
  veranstalter_expert_id TEXT NOT NULL REFERENCES experten(id),
  teilnehmer_ids TEXT NOT NULL,   -- JSON array of expert IDs
  antworten TEXT DEFAULT '{}',    -- JSON map { expertId: "response" }
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | cancelled
  ergebnis TEXT,                  -- final CEO synthesis
  erstellt_am TEXT NOT NULL,
  abgeschlossen_am TEXT
);

CREATE INDEX IF NOT EXISTS idx_meetings_company ON agenten_meetings(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON agenten_meetings(status);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_nachrichten(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_von_expert ON chat_nachrichten(von_expert_id) WHERE von_expert_id IS NOT NULL;

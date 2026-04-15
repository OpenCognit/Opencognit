-- Phase 9: Glass Agent, Whiteboard, Skill Library

-- Glass Agent: real-time trace events
CREATE TABLE IF NOT EXISTS trace_ereignisse (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  run_id TEXT,
  typ TEXT NOT NULL,
  titel TEXT NOT NULL,
  details TEXT,
  erstellt_am TEXT NOT NULL
);

-- Skill Library: company-level markdown knowledge base
CREATE TABLE IF NOT EXISTS skills_library (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  name TEXT NOT NULL,
  beschreibung TEXT,
  inhalt TEXT NOT NULL,
  tags TEXT,
  erstellt_von TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

-- Expert <-> Skill Library assignment
CREATE TABLE IF NOT EXISTS experten_skills (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  skill_id TEXT NOT NULL REFERENCES skills_library(id),
  erstellt_am TEXT NOT NULL
);

-- Whiteboard: shared project state for agent collaboration
ALTER TABLE projekte ADD COLUMN whiteboard_state TEXT;

-- Index for fast trace lookup per expert
CREATE INDEX IF NOT EXISTS idx_trace_expert ON trace_ereignisse(expert_id, erstellt_am);
CREATE INDEX IF NOT EXISTS idx_trace_run ON trace_ereignisse(run_id);

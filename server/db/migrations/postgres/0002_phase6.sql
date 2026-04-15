-- Migration 0002 — Phase 6: Execution Workspaces, Agent Instructions, Work Products

-- Agent Instructions: system prompt per agent
ALTER TABLE experten ADD COLUMN IF NOT EXISTS system_prompt TEXT;

-- Execution Workspace path per task
ALTER TABLE aufgaben ADD COLUMN IF NOT EXISTS workspace_path TEXT;

-- Work Products: what agents actually produced
CREATE TABLE IF NOT EXISTS work_products (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  aufgabe_id TEXT NOT NULL REFERENCES aufgaben(id),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  run_id TEXT REFERENCES arbeitszyklen(id),
  typ TEXT NOT NULL DEFAULT 'file',
  name TEXT NOT NULL,
  pfad TEXT,
  inhalt TEXT,
  groesse_bytes INTEGER,
  mime_typ TEXT,
  erstellt_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_products_aufgabe ON work_products(aufgabe_id);
CREATE INDEX IF NOT EXISTS idx_work_products_expert ON work_products(expert_id, erstellt_am);

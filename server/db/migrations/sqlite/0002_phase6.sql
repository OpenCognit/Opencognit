-- Migration 0002 — Phase 6: Execution Workspaces, Agent Instructions, Work Products

-- Agent Instructions: system prompt per agent
ALTER TABLE experten ADD COLUMN system_prompt TEXT;

-- Execution Workspace path per task
ALTER TABLE aufgaben ADD COLUMN workspace_path TEXT;

-- Work Products: what agents actually produced
CREATE TABLE IF NOT EXISTS work_products (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  aufgabe_id TEXT NOT NULL REFERENCES aufgaben(id),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  run_id TEXT REFERENCES arbeitszyklen(id),
  typ TEXT NOT NULL DEFAULT 'file', -- file, text, url, directory
  name TEXT NOT NULL,               -- filename or title
  pfad TEXT,                        -- absolute path (for files/dirs)
  inhalt TEXT,                      -- text content (for text type)
  groesse_bytes INTEGER,            -- file size
  mime_typ TEXT,                    -- MIME type if known
  erstellt_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_products_aufgabe ON work_products(aufgabe_id);
CREATE INDEX IF NOT EXISTS idx_work_products_expert ON work_products(expert_id, erstellt_am);

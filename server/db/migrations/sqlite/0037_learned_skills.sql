-- Learned Skills: auto-extracted recipes from successful work cycles.
-- Shared company-wide; other agents can reuse the pattern via context injection.
CREATE TABLE learned_skills (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id) ON DELETE CASCADE,
  source_agent_id TEXT REFERENCES experten(id) ON DELETE SET NULL,
  source_task_id TEXT REFERENCES aufgaben(id) ON DELETE SET NULL,
  source_run_id TEXT REFERENCES arbeitszyklen(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  pattern TEXT NOT NULL,
  recipe TEXT NOT NULL,
  keywords TEXT,
  confidence INTEGER NOT NULL DEFAULT 50,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  extracted_by TEXT NOT NULL DEFAULT 'heuristic' CHECK(extracted_by IN ('heuristic', 'llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX learned_skills_company_idx ON learned_skills(unternehmen_id);
CREATE INDEX learned_skills_keywords_idx ON learned_skills(unternehmen_id, is_disabled);

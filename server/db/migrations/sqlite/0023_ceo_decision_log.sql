-- CEO Decision Log: persistent red thread across orchestrator planning cycles
CREATE TABLE IF NOT EXISTS ceo_decision_log (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  run_id TEXT NOT NULL,
  erstellt_am TEXT NOT NULL,
  focus_summary TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  goals_snapshot TEXT,
  pending_task_count INTEGER NOT NULL DEFAULT 0,
  team_summary TEXT
);

CREATE INDEX IF NOT EXISTS ceo_decision_log_expert_idx ON ceo_decision_log(expert_id, erstellt_am);

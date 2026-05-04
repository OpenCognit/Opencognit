-- Task Checkpoints (Hermes-inspired structured agent feedback)
CREATE TABLE task_checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES arbeitszyklen(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL REFERENCES experten(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES unternehmen(id) ON DELETE CASCADE,
  state_label TEXT NOT NULL CHECK(state_label IN ('DONE','BLOCKED','NEEDS_INPUT','HANDOFF','IN_PROGRESS')),
  files_changed TEXT, -- JSON array
  commands_run TEXT, -- JSON array
  result TEXT,
  blocker TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX checkpoint_task_idx ON task_checkpoints(task_id);
CREATE INDEX checkpoint_run_idx ON task_checkpoints(run_id);
CREATE INDEX checkpoint_agent_idx ON task_checkpoints(agent_id);
CREATE INDEX checkpoint_company_idx ON task_checkpoints(company_id);

-- Schema alignment: bring PG schema into parity with SQLite schema.
-- Adds missing columns + indexes that existed in SQLite but were never ported to PG.
-- Safe to run on any existing PG install — all statements use IF NOT EXISTS guards.

-- benutzer: oauth columns
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS oauth_id TEXT;

-- unternehmen: workspace directory
ALTER TABLE unternehmen ADD COLUMN IF NOT EXISTS work_dir TEXT;

-- experten: orchestrator, advisor, soul, messaging
ALTER TABLE experten ADD COLUMN IF NOT EXISTS is_orchestrator BOOLEAN DEFAULT false;
ALTER TABLE experten ADD COLUMN IF NOT EXISTS advisor_id TEXT REFERENCES experten(id);
ALTER TABLE experten ADD COLUMN IF NOT EXISTS advisor_strategy TEXT NOT NULL DEFAULT 'none';
ALTER TABLE experten ADD COLUMN IF NOT EXISTS advisor_config TEXT;
ALTER TABLE experten ADD COLUMN IF NOT EXISTS soul_path TEXT;
ALTER TABLE experten ADD COLUMN IF NOT EXISTS soul_version TEXT;
ALTER TABLE experten ADD COLUMN IF NOT EXISTS nachrichten_count INTEGER NOT NULL DEFAULT 0;

-- aufgaben: maximizer mode flag
ALTER TABLE aufgaben ADD COLUMN IF NOT EXISTS is_maximizer_mode BOOLEAN DEFAULT false;

-- chat_nachrichten: agent-to-agent routing
ALTER TABLE chat_nachrichten ADD COLUMN IF NOT EXISTS von_expert_id TEXT;
ALTER TABLE chat_nachrichten ADD COLUMN IF NOT EXISTS thread_id TEXT;

-- projekte: whiteboard + workdir
ALTER TABLE projekte ADD COLUMN IF NOT EXISTS whiteboard_state TEXT;
ALTER TABLE projekte ADD COLUMN IF NOT EXISTS work_dir TEXT;

-- einstellungen: move to composite PK (schluessel + unternehmenId)
-- NOTE: Postgres doesn't allow dropping a PK + creating a composite one with IF NOT EXISTS.
-- We only add the column here; the PK migration (if needed) must be handled manually
-- on existing installs as it may conflict with existing single-PK data.
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS unternehmen_id TEXT NOT NULL DEFAULT '';

-- Indexes
CREATE INDEX IF NOT EXISTS aufgaben_zugewiesen_an_idx       ON aufgaben(zugewiesen_an);
CREATE INDEX IF NOT EXISTS aufgaben_unternehmen_status_idx  ON aufgaben(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS aufgaben_execution_locked_idx    ON aufgaben(execution_locked_at);
CREATE INDEX IF NOT EXISTS chat_nachrichten_expert_gelesen_idx ON chat_nachrichten(expert_id, gelesen);
CREATE INDEX IF NOT EXISTS chat_nachrichten_expert_am_idx      ON chat_nachrichten(expert_id, erstellt_am);
CREATE INDEX IF NOT EXISTS wakeup_expert_status_idx        ON agent_wakeup_requests(expert_id, status);
CREATE INDEX IF NOT EXISTS wakeup_unternehmen_status_idx   ON agent_wakeup_requests(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS trace_expert_am_idx             ON trace_ereignisse(expert_id, erstellt_am);
CREATE INDEX IF NOT EXISTS trace_unternehmen_am_idx        ON trace_ereignisse(unternehmen_id, erstellt_am);
CREATE INDEX IF NOT EXISTS kg_subject_valid_idx            ON palace_kg(subject, valid_until);
CREATE INDEX IF NOT EXISTS kg_unternehmen_subject_idx      ON palace_kg(unternehmen_id, subject);
CREATE INDEX IF NOT EXISTS ceo_decision_log_expert_idx     ON ceo_decision_log(expert_id, erstellt_am);
CREATE INDEX IF NOT EXISTS expert_config_history_expert_idx ON expert_config_history(expert_id, changed_at);
CREATE INDEX IF NOT EXISTS worker_nodes_status_idx         ON worker_nodes(status, last_heartbeat_at);

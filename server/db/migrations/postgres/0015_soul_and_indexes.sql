-- Migration 0015: SOUL Document fields + Performance Indexes
ALTER TABLE experten ADD COLUMN IF NOT EXISTS soul_path TEXT;
ALTER TABLE experten ADD COLUMN IF NOT EXISTS soul_version TEXT;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_trace_expert_id ON trace_ereignisse(expert_id);
CREATE INDEX IF NOT EXISTS idx_trace_erstellt_am ON trace_ereignisse(erstellt_am);
CREATE INDEX IF NOT EXISTS idx_wakeup_expert_status ON agent_wakeup_requests(expert_id, status);
CREATE INDEX IF NOT EXISTS idx_aufgaben_company_status ON aufgaben(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS idx_kosten_expert_erstellt ON kostenbuchungen(expert_id, erstellt_am);
CREATE INDEX IF NOT EXISTS idx_zyklen_expert_erstellt ON arbeitszyklen(expert_id, erstellt_am);

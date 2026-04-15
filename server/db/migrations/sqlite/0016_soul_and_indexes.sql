-- Migration 0016: SOUL Document fields + Performance Indexes
-- SOUL.md: Git-tracked agent identity replaces raw systemPrompt
ALTER TABLE experten ADD COLUMN soul_path TEXT;
ALTER TABLE experten ADD COLUMN soul_version TEXT;

-- ── Performance Indexes ───────────────────────────────────────────────────────
-- Eliminates full-table-scans on the 6 hottest query paths.
-- Combined effect: 5-10x faster at 50k+ rows per table.

-- 1. Trace events: most frequent query is "all traces for this agent"
CREATE INDEX IF NOT EXISTS idx_trace_expert_id
  ON trace_ereignisse(expert_id);

-- 2. Trace events: dashboard/metrics queries filter by time
CREATE INDEX IF NOT EXISTS idx_trace_erstellt_am
  ON trace_ereignisse(erstellt_am);

-- 3. Wakeup queue: heartbeat processor queries by agent + status every 10s
CREATE INDEX IF NOT EXISTS idx_wakeup_expert_status
  ON agent_wakeup_requests(expert_id, status);

-- 4. Tasks: every inbox query filters by company + status (hottest query in system)
CREATE INDEX IF NOT EXISTS idx_aufgaben_company_status
  ON aufgaben(unternehmen_id, status);

-- 5. Cost/metrics: aggregation queries group by agent over time
CREATE INDEX IF NOT EXISTS idx_kosten_expert_erstellt
  ON kostenbuchungen(expert_id, erstellt_am);

-- 6. Execution runs: agent history, cleanup, and status queries
CREATE INDEX IF NOT EXISTS idx_zyklen_expert_erstellt
  ON arbeitszyklen(expert_id, erstellt_am);

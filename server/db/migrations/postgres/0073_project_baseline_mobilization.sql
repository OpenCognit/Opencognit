-- =============================================================================
-- Migration 0073: PR-PAW-2+3+4+5 — Baseline Setup, Mobilization, Activation
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_baselines (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    award_id        TEXT NOT NULL,
    baseline_version INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'draft',
    approved_by     TEXT,
    approved_am     TEXT,
    locked_am       TEXT,
    locked_by       TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_project_baselines_project
    ON project_baselines(projekt_id);
CREATE INDEX IF NOT EXISTS idx_project_baselines_award
    ON project_baselines(award_id);

CREATE TABLE IF NOT EXISTS project_budget_baselines (
    id              SERIAL PRIMARY KEY,
    baseline_id     TEXT NOT NULL,
    boq_item_id     TEXT,
    cost_code_id    TEXT,
    activity_id     TEXT,
    approved_amount DOUBLE PRECISION NOT NULL,
    tendered_amount DOUBLE PRECISION,
    variance_amount DOUBLE PRECISION,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_project_budget_baselines_baseline
    ON project_budget_baselines(baseline_id);

CREATE TABLE IF NOT EXISTS project_schedule_baselines (
    id              SERIAL PRIMARY KEY,
    baseline_id     TEXT NOT NULL,
    activity_name   TEXT NOT NULL,
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    duration_days   INTEGER,
    predecessor     TEXT,
    critical_path   INTEGER DEFAULT 0,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_project_schedule_baselines_baseline
    ON project_schedule_baselines(baseline_id);

CREATE TABLE IF NOT EXISTS project_mobilization_plans (
    id              SERIAL PRIMARY KEY,
    award_id        TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    target_start_date TEXT,
    status          TEXT NOT NULL DEFAULT 'planning',
    approved_by     TEXT,
    approved_am     TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_project_mobilization_plans_award
    ON project_mobilization_plans(award_id);

CREATE TABLE IF NOT EXISTS project_mobilization_items (
    id              SERIAL PRIMARY KEY,
    mobilization_plan_id TEXT NOT NULL,
    item            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general',
    owner           TEXT,
    due_date        TEXT,
    completed       INTEGER NOT NULL DEFAULT 0,
    completed_by    TEXT,
    completed_am    TEXT,
    blocker         INTEGER DEFAULT 0,
    blocker_reason  TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_project_mobilization_items_plan
    ON project_mobilization_items(mobilization_plan_id);
CREATE INDEX IF NOT EXISTS idx_project_mobilization_items_blocker
    ON project_mobilization_items(blocker);

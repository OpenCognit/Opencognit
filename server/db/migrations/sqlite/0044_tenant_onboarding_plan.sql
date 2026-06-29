-- =============================================================================
-- Migration 0044: PR-CS-1 — Tenant Onboarding Plan
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_onboarding_plans (
    id                      TEXT PRIMARY KEY NOT NULL,
    unternehmen_id          TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'not_started',
    progress_pct            REAL NOT NULL DEFAULT 0,
    blocker                 TEXT,
    assigned_to             TEXT,
    target_completion_date  TEXT,
    abgeschlossen_am        TEXT,
    erstellt_am             TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_plans_unternehmen
    ON tenant_onboarding_plans(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_plans_status
    ON tenant_onboarding_plans(status);

CREATE TABLE IF NOT EXISTS tenant_onboarding_tasks (
    id              TEXT PRIMARY KEY NOT NULL,
    plan_id         TEXT NOT NULL,
    aufgabe         TEXT NOT NULL,
    kategorie       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    owner           TEXT,
    due_date        TEXT,
    kommentar       TEXT,
    abgeschlossen_am TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_tasks_plan
    ON tenant_onboarding_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_tasks_kategorie
    ON tenant_onboarding_tasks(kategorie);

CREATE TABLE IF NOT EXISTS tenant_health_scores (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    score           INTEGER NOT NULL,
    setup_score     INTEGER,
    adoption_score  INTEGER,
    support_score   INTEGER,
    risk_flags      TEXT,
    snapshot_am     TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_health_scores_unternehmen
    ON tenant_health_scores(unternehmen_id);

CREATE TABLE IF NOT EXISTS tenant_usage_snapshots (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    active_users        INTEGER,
    total_users         INTEGER,
    modules_active      TEXT,
    workflows_completed INTEGER,
    daily_work_submitted INTEGER,
    approvals_completed INTEGER,
    snapshot_am         TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_snapshots_unternehmen
    ON tenant_usage_snapshots(unternehmen_id);

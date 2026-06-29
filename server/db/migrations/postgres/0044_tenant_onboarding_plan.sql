-- =============================================================================
-- Migration 0044: PR-CS-1 — Tenant Onboarding Plan (PostgreSQL)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_onboarding_plans (
    id                      SERIAL PRIMARY KEY,
    unternehmen_id          TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'not_started',
    progress_pct            DOUBLE PRECISION NOT NULL DEFAULT 0,
    blocker                 TEXT,
    assigned_to             TEXT,
    target_completion_date  TIMESTAMP,
    abgeschlossen_am        TIMESTAMP,
    erstellt_am             TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_plans_unternehmen
    ON tenant_onboarding_plans(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_plans_status
    ON tenant_onboarding_plans(status);

CREATE TABLE IF NOT EXISTS tenant_onboarding_tasks (
    id              SERIAL PRIMARY KEY,
    plan_id         TEXT NOT NULL,
    aufgabe         TEXT NOT NULL,
    kategorie       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    owner           TEXT,
    due_date        TIMESTAMP,
    kommentar       TEXT,
    abgeschlossen_am TIMESTAMP,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_tasks_plan
    ON tenant_onboarding_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tenant_onboarding_tasks_kategorie
    ON tenant_onboarding_tasks(kategorie);

CREATE TABLE IF NOT EXISTS tenant_health_scores (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    score           INTEGER NOT NULL,
    setup_score     INTEGER,
    adoption_score  INTEGER,
    support_score   INTEGER,
    risk_flags      TEXT,
    snapshot_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_health_scores_unternehmen
    ON tenant_health_scores(unternehmen_id);

CREATE TABLE IF NOT EXISTS tenant_usage_snapshots (
    id                   SERIAL PRIMARY KEY,
    unternehmen_id       TEXT NOT NULL,
    active_users         INTEGER,
    total_users          INTEGER,
    modules_active       TEXT,
    workflows_completed  INTEGER,
    daily_work_submitted INTEGER,
    approvals_completed  INTEGER,
    snapshot_am          TIMESTAMP NOT NULL DEFAULT NOW(),
    erstellt_am          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_snapshots_unternehmen
    ON tenant_usage_snapshots(unternehmen_id);

-- =============================================================================
-- Migration 0045: PR-BILL-1 — Subscription Plan + Entitlement Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    code            TEXT NOT NULL UNIQUE,
    max_users       INTEGER,
    max_projects    INTEGER,
    storage_limit_mb INTEGER,
    ai_requests_per_month INTEGER,
    monthly_price_kes REAL,
    support_level   TEXT DEFAULT 'standard',
    ist_aktiv       INTEGER NOT NULL DEFAULT 1,
    beschreibung    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscription_plan_modules (
    id          TEXT PRIMARY KEY NOT NULL,
    plan_id     TEXT NOT NULL,
    module_key  TEXT NOT NULL,
    ist_aktiv   INTEGER NOT NULL DEFAULT 1,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_modules_plan
    ON subscription_plan_modules(plan_id);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    plan_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'trial',
    trial_ends_am   TEXT,
    current_period_start TEXT,
    current_period_end   TEXT,
    auto_renew      INTEGER NOT NULL DEFAULT 1,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_unternehmen
    ON tenant_subscriptions(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status
    ON tenant_subscriptions(status);

CREATE TABLE IF NOT EXISTS tenant_entitlements (
    id              TEXT PRIMARY KEY NOT NULL,
    subscription_id TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    module_key      TEXT NOT NULL,
    ist_aktiv       INTEGER NOT NULL DEFAULT 1,
    limit_type      TEXT,
    limit_value     INTEGER,
    start_date      TEXT,
    end_date        TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_sub
    ON tenant_entitlements(subscription_id);
CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_module
    ON tenant_entitlements(unternehmen_id, module_key);

CREATE TABLE IF NOT EXISTS tenant_usage_limits (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    limit_type      TEXT NOT NULL,
    current_value   INTEGER NOT NULL DEFAULT 0,
    max_value       INTEGER,
    snapshot_am     TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_limits_unternehmen
    ON tenant_usage_limits(unternehmen_id);

CREATE TABLE IF NOT EXISTS subscription_events (
    id              TEXT PRIMARY KEY NOT NULL,
    subscription_id TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    actor           TEXT,
    kommentar       TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_sub
    ON subscription_events(subscription_id);

-- =============================================================================
-- Seed Data
-- =============================================================================

INSERT OR IGNORE INTO subscription_plans (id, name, code, max_users, max_projects, storage_limit_mb, ai_requests_per_month, monthly_price_kes, support_level, beschreibung)
VALUES
    ('plan_starter', 'Starter', 'starter', 5, 2, 500, 100, 5000, 'standard', 'Small contractors — core modules'),
    ('plan_professional', 'Professional', 'professional', 20, 10, 5000, 1000, 15000, 'priority', 'Growing contractors — full suite'),
    ('plan_enterprise', 'Enterprise', 'enterprise', NULL, NULL, NULL, NULL, NULL, 'dedicated', 'Unlimited — custom contract'),
    ('plan_developer', 'Developer/Owner', 'developer', NULL, NULL, NULL, NULL, 0, 'standard', 'CHAMPE team — full access'),
    ('plan_ngo', 'NGO/Donor', 'ngo', 10, 3, 1000, 200, 3000, 'standard', 'Nonprofit and donor-funded projects');

INSERT OR IGNORE INTO subscription_plan_modules (id, plan_id, module_key) VALUES
    ('sm_st_dw', 'plan_starter', 'daily_work'),
    ('sm_st_wf', 'plan_starter', 'workforce'),
    ('sm_st_sk', 'plan_starter', 'storekeeper'),
    ('sm_st_ipc', 'plan_starter', 'ipc'),
    ('sm_st_dc', 'plan_starter', 'documents'),
    ('sm_st_om', 'plan_starter', 'offline_mobile'),
    ('sm_pro_dw', 'plan_professional', 'daily_work'),
    ('sm_pro_wf', 'plan_professional', 'workforce'),
    ('sm_pro_sk', 'plan_professional', 'storekeeper'),
    ('sm_pro_eq', 'plan_professional', 'equipment'),
    ('sm_pro_pr', 'plan_professional', 'procurement'),
    ('sm_pro_vn', 'plan_professional', 'vendor'),
    ('sm_pro_sc', 'plan_professional', 'subcontractor'),
    ('sm_pro_ipc', 'plan_professional', 'ipc'),
    ('sm_pro_fn', 'plan_professional', 'finance'),
    ('sm_pro_cl', 'plan_professional', 'claims'),
    ('sm_pro_dc', 'plan_professional', 'documents'),
    ('sm_pro_se', 'plan_professional', 'security'),
    ('sm_pro_ho', 'plan_professional', 'handover'),
    ('sm_pro_an', 'plan_professional', 'analytics'),
    ('sm_pro_om', 'plan_professional', 'offline_mobile'),
    ('sm_pro_ig', 'plan_professional', 'integrations'),
    ('sm_pro_ai', 'plan_professional', 'ai_agents'),
    ('sm_ent_all', 'plan_enterprise', 'all'),
    ('sm_dev_all', 'plan_developer', 'all'),
    ('sm_ngo_dw', 'plan_ngo', 'daily_work'),
    ('sm_ngo_wf', 'plan_ngo', 'workforce'),
    ('sm_ngo_sk', 'plan_ngo', 'storekeeper'),
    ('sm_ngo_ipc', 'plan_ngo', 'ipc'),
    ('sm_ngo_dc', 'plan_ngo', 'documents'),
    ('sm_ngo_om', 'plan_ngo', 'offline_mobile');

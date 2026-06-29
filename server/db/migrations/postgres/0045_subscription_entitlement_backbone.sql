-- =============================================================================
-- Migration 0045: PR-BILL-1 — Subscription Entitlement Backbone (PostgreSQL)
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    code            TEXT NOT NULL UNIQUE,
    max_users       INTEGER,
    max_projects    INTEGER,
    storage_limit_mb INTEGER,
    ai_requests_per_month INTEGER,
    monthly_price_kes DOUBLE PRECISION,
    support_level   TEXT DEFAULT 'standard',
    ist_aktiv       BOOLEAN NOT NULL DEFAULT TRUE,
    beschreibung    TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_plan_modules (
    id          SERIAL PRIMARY KEY,
    plan_id     TEXT NOT NULL,
    module_key  TEXT NOT NULL,
    ist_aktiv   BOOLEAN NOT NULL DEFAULT TRUE,
    erstellt_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_modules_plan
    ON subscription_plan_modules(plan_id);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    plan_id             TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'trial',
    trial_ends_am       TIMESTAMP,
    current_period_start TIMESTAMP,
    current_period_end   TIMESTAMP,
    auto_renew          BOOLEAN NOT NULL DEFAULT TRUE,
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_unternehmen
    ON tenant_subscriptions(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status
    ON tenant_subscriptions(status);

CREATE TABLE IF NOT EXISTS tenant_entitlements (
    id              SERIAL PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    module_key      TEXT NOT NULL,
    ist_aktiv       BOOLEAN NOT NULL DEFAULT TRUE,
    limit_type      TEXT,
    limit_value     INTEGER,
    start_date      TIMESTAMP,
    end_date        TIMESTAMP,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_sub
    ON tenant_entitlements(subscription_id);
CREATE INDEX IF NOT EXISTS idx_tenant_entitlements_module
    ON tenant_entitlements(unternehmen_id, module_key);

CREATE TABLE IF NOT EXISTS tenant_usage_limits (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    limit_type      TEXT NOT NULL,
    current_value   INTEGER NOT NULL DEFAULT 0,
    max_value       INTEGER,
    snapshot_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_limits_unternehmen
    ON tenant_usage_limits(unternehmen_id);

CREATE TABLE IF NOT EXISTS subscription_events (
    id              SERIAL PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    actor           TEXT,
    kommentar       TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_sub
    ON subscription_events(subscription_id);

-- Seed Data
INSERT INTO subscription_plans (id, name, code, max_users, max_projects, storage_limit_mb, ai_requests_per_month, monthly_price_kes, support_level, beschreibung)
VALUES
    (1, 'Starter', 'starter', 5, 2, 500, 100, 5000, 'standard', 'Small contractors'),
    (2, 'Professional', 'professional', 20, 10, 5000, 1000, 15000, 'priority', 'Growing contractors'),
    (3, 'Enterprise', 'enterprise', NULL, NULL, NULL, NULL, NULL, 'dedicated', 'Unlimited — custom contract'),
    (4, 'Developer/Owner', 'developer', NULL, NULL, NULL, NULL, 0, 'standard', 'CHAMPE team'),
    (5, 'NGO/Donor', 'ngo', 10, 3, 1000, 200, 3000, 'standard', 'Nonprofit projects')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscription_plan_modules (id, plan_id, module_key) VALUES
    (1, 1, 'daily_work'), (2, 1, 'workforce'), (3, 1, 'storekeeper'), (4, 1, 'ipc'),
    (5, 1, 'documents'), (6, 1, 'offline_mobile'),
    (7, 2, 'daily_work'), (8, 2, 'workforce'), (9, 2, 'storekeeper'), (10, 2, 'equipment'),
    (11, 2, 'procurement'), (12, 2, 'vendor'), (13, 2, 'subcontractor'), (14, 2, 'ipc'),
    (15, 2, 'finance'), (16, 2, 'claims'), (17, 2, 'documents'), (18, 2, 'security'),
    (19, 2, 'handover'), (20, 2, 'analytics'), (21, 2, 'offline_mobile'),
    (22, 2, 'integrations'), (23, 2, 'ai_agents'),
    (24, 3, 'all'), (25, 4, 'all'),
    (26, 5, 'daily_work'), (27, 5, 'workforce'), (28, 5, 'storekeeper'), (29, 5, 'ipc'),
    (30, 5, 'documents'), (31, 5, 'offline_mobile')
ON CONFLICT (id) DO NOTHING;

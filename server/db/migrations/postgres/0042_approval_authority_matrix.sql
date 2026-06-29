-- =============================================================================
-- Migration 0042: PR-IAM-2 — Approval Authority Matrix (PostgreSQL)
-- =============================================================================

CREATE TABLE IF NOT EXISTS approval_thresholds (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    role_id         TEXT NOT NULL,
    module          TEXT NOT NULL,
    action          TEXT NOT NULL,
    max_amount      DOUBLE PRECISION,
    currency        TEXT NOT NULL DEFAULT 'KES',
    beschreibung    TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_thresholds_unternehmen
    ON approval_thresholds(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_approval_thresholds_role_module
    ON approval_thresholds(role_id, module);

CREATE TABLE IF NOT EXISTS approval_workflows (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    name            TEXT NOT NULL,
    module          TEXT NOT NULL,
    beschreibung    TEXT,
    ist_aktiv       BOOLEAN NOT NULL DEFAULT TRUE,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_workflows_unternehmen
    ON approval_workflows(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_module
    ON approval_workflows(module);

CREATE TABLE IF NOT EXISTS approval_workflow_steps (
    id                  SERIAL PRIMARY KEY,
    workflow_id         TEXT NOT NULL,
    step_order          INTEGER NOT NULL,
    role_id             TEXT NOT NULL,
    max_amount          DOUBLE PRECISION,
    auto_escalate_hours INTEGER,
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (workflow_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_approval_workflow_steps_role
    ON approval_workflow_steps(role_id);

CREATE TABLE IF NOT EXISTS approval_requests (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    workflow_id         TEXT NOT NULL,
    source_module       TEXT NOT NULL,
    source_record_id    TEXT NOT NULL,
    source_record_type  TEXT NOT NULL,
    amount              DOUBLE PRECISION,
    currency            TEXT NOT NULL DEFAULT 'KES',
    current_step        INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'in_progress',
    requested_by        TEXT NOT NULL,
    requested_am        TIMESTAMP NOT NULL DEFAULT NOW(),
    abgeschlossen_am    TIMESTAMP,
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
    ON approval_requests(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_source
    ON approval_requests(unternehmen_id, source_module, source_record_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by
    ON approval_requests(requested_by);

CREATE TABLE IF NOT EXISTS approval_step_results (
    id          SERIAL PRIMARY KEY,
    request_id  TEXT NOT NULL,
    step_order  INTEGER NOT NULL,
    role_id     TEXT NOT NULL,
    reviewer_id TEXT,
    decision    TEXT NOT NULL,
    kommentar   TEXT,
    decided_am  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_approval_step_results_reviewer
    ON approval_step_results(reviewer_id);

-- Seed Data
INSERT INTO approval_thresholds (id, unternehmen_id, role_id, module, action, max_amount)
VALUES
    (1, 'default', 'r_project_manager', 'finance', 'approve', 500000),
    (2, 'default', 'r_project_manager', 'ipc', 'approve', 1000000),
    (3, 'default', 'r_project_manager', 'procurement', 'approve', 250000),
    (4, 'default', 'r_project_manager', 'variations', 'approve', 500000),
    (5, 'default', 'r_director', 'finance', 'approve', 5000000),
    (6, 'default', 'r_director', 'ipc', 'approve', 10000000),
    (7, 'default', 'r_director', 'procurement', 'approve', 2500000),
    (8, 'default', 'r_director', 'variations', 'approve', 5000000),
    (9, 'default', 'r_tenant_admin', 'finance', 'approve', NULL),
    (10, 'default', 'r_tenant_admin', 'ipc', 'approve', NULL),
    (11, 'default', 'r_tenant_admin', 'procurement', 'approve', NULL),
    (12, 'default', 'r_tenant_admin', 'variations', 'approve', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO approval_workflows (id, unternehmen_id, name, module, beschreibung)
VALUES
    (1, 'default', 'payment_approval', 'finance', 'Standard payment approval chain'),
    (2, 'default', 'ipc_certification', 'ipc', 'IPC valuation certification chain'),
    (3, 'default', 'variation_approval', 'variations', 'Variation and claim approval chain'),
    (4, 'default', 'procurement_approval', 'procurement', 'Purchase order and procurement approval chain')
ON CONFLICT (id) DO NOTHING;

INSERT INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours)
VALUES
    (1,  1, 1, 'r_project_manager', 500000, 24),
    (2,  1, 2, 'r_director', 5000000, 48),
    (3,  1, 3, 'r_tenant_admin', NULL, 72),
    (4,  2, 1, 'r_qs', 500000, 24),
    (5,  2, 2, 'r_project_manager', 2000000, 48),
    (6,  2, 3, 'r_director', 10000000, 72),
    (7,  2, 4, 'r_tenant_admin', NULL, 96),
    (8,  3, 1, 'r_project_manager', 500000, 48),
    (9,  3, 2, 'r_director', 5000000, 72),
    (10, 3, 3, 'r_tenant_admin', NULL, 96),
    (11, 4, 1, 'r_project_manager', 250000, 24),
    (12, 4, 2, 'r_director', 2500000, 48),
    (13, 4, 3, 'r_tenant_admin', NULL, 72)
ON CONFLICT (id) DO NOTHING;

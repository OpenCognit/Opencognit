-- =============================================================================
-- Migration 0042: PR-IAM-2 — Approval Authority Matrix
-- =============================================================================
-- 5 tables: approval_thresholds, approval_workflows, approval_workflow_steps,
--            approval_requests, approval_step_results
--
-- Dependencies: roles table (PR-IAM-1 / 0041).
--   SQLite validates FKs at row-level (INSERT), not at DDL time.
--   Tables create safely even if roles table doesn't exist yet.
--   Seed data uses INSERT OR IGNORE — safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. approval_thresholds — monetary limits per role per module
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_thresholds (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    role_id         TEXT NOT NULL,
    module          TEXT NOT NULL,
    action          TEXT NOT NULL,
    max_amount      REAL,
    currency        TEXT NOT NULL DEFAULT 'KES',
    beschreibung    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_thresholds_unternehmen
    ON approval_thresholds(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_approval_thresholds_role_module
    ON approval_thresholds(role_id, module);

-- ---------------------------------------------------------------------------
-- 2. approval_workflows — named multi-step approval chain definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_workflows (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    name            TEXT NOT NULL,
    module          TEXT NOT NULL,
    beschreibung    TEXT,
    ist_aktiv       INTEGER NOT NULL DEFAULT 1,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_workflows_unternehmen
    ON approval_workflows(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_module
    ON approval_workflows(module);

-- ---------------------------------------------------------------------------
-- 3. approval_workflow_steps — ordered steps within a workflow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_workflow_steps (
    id                  TEXT PRIMARY KEY NOT NULL,
    workflow_id         TEXT NOT NULL,
    step_order          INTEGER NOT NULL,
    role_id             TEXT NOT NULL,
    max_amount          REAL,
    auto_escalate_hours INTEGER,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_workflow_steps_wf_order
    ON approval_workflow_steps(workflow_id, step_order);
CREATE INDEX IF NOT EXISTS idx_approval_workflow_steps_role
    ON approval_workflow_steps(role_id);

-- ---------------------------------------------------------------------------
-- 4. approval_requests — instances requiring approval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_requests (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    workflow_id         TEXT NOT NULL,
    source_module       TEXT NOT NULL,
    source_record_id    TEXT NOT NULL,
    source_record_type  TEXT NOT NULL,
    amount              REAL,
    currency            TEXT NOT NULL DEFAULT 'KES',
    current_step        INTEGER NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'in_progress',
    requested_by        TEXT NOT NULL,
    requested_am        TEXT NOT NULL DEFAULT (datetime('now')),
    abgeschlossen_am    TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
    ON approval_requests(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_source
    ON approval_requests(unternehmen_id, source_module, source_record_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by
    ON approval_requests(requested_by);

-- ---------------------------------------------------------------------------
-- 5. approval_step_results — individual step outcomes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_step_results (
    id          TEXT PRIMARY KEY NOT NULL,
    request_id  TEXT NOT NULL,
    step_order  INTEGER NOT NULL,
    role_id     TEXT NOT NULL,
    reviewer_id TEXT,
    decision    TEXT NOT NULL,
    kommentar   TEXT,
    decided_am  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_step_results_req_step
    ON approval_step_results(request_id, step_order);
CREATE INDEX IF NOT EXISTS idx_approval_step_results_reviewer
    ON approval_step_results(reviewer_id);

-- =============================================================================
-- Seed Data — safe to re-run (INSERT OR IGNORE)
-- =============================================================================

-- Thresholds
INSERT OR IGNORE INTO approval_thresholds (id, unternehmen_id, role_id, module, action, max_amount)
VALUES
    ('t_pm_finance', 'default', 'r_project_manager', 'finance', 'approve', 500000),
    ('t_pm_ipc', 'default', 'r_project_manager', 'ipc', 'approve', 1000000),
    ('t_pm_procurement', 'default', 'r_project_manager', 'procurement', 'approve', 250000),
    ('t_pm_variations', 'default', 'r_project_manager', 'variations', 'approve', 500000),
    ('t_dir_finance', 'default', 'r_director', 'finance', 'approve', 5000000),
    ('t_dir_ipc', 'default', 'r_director', 'ipc', 'approve', 10000000),
    ('t_dir_procurement', 'default', 'r_director', 'procurement', 'approve', 2500000),
    ('t_dir_variations', 'default', 'r_director', 'variations', 'approve', 5000000),
    ('t_admin_finance', 'default', 'r_tenant_admin', 'finance', 'approve', NULL),
    ('t_admin_ipc', 'default', 'r_tenant_admin', 'ipc', 'approve', NULL),
    ('t_admin_procurement', 'default', 'r_tenant_admin', 'procurement', 'approve', NULL),
    ('t_admin_variations', 'default', 'r_tenant_admin', 'variations', 'approve', NULL);

-- Workflows
INSERT OR IGNORE INTO approval_workflows (id, unternehmen_id, name, module, beschreibung)
VALUES
    ('wf_payment', 'default', 'payment_approval', 'finance', 'Standard payment approval chain'),
    ('wf_ipc', 'default', 'ipc_certification', 'ipc', 'IPC valuation certification chain'),
    ('wf_variation', 'default', 'variation_approval', 'variations', 'Variation and claim approval chain'),
    ('wf_procurement', 'default', 'procurement_approval', 'procurement', 'Purchase order and procurement approval chain');

-- Workflow Steps: Payment
INSERT OR IGNORE INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours)
VALUES
    ('ws_pay_1', 'wf_payment', 1, 'r_project_manager', 500000, 24),
    ('ws_pay_2', 'wf_payment', 2, 'r_director', 5000000, 48),
    ('ws_pay_3', 'wf_payment', 3, 'r_tenant_admin', NULL, 72);

-- Workflow Steps: IPC
INSERT OR IGNORE INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours)
VALUES
    ('ws_ipc_1', 'wf_ipc', 1, 'r_qs', 500000, 24),
    ('ws_ipc_2', 'wf_ipc', 2, 'r_project_manager', 2000000, 48),
    ('ws_ipc_3', 'wf_ipc', 3, 'r_director', 10000000, 72),
    ('ws_ipc_4', 'wf_ipc', 4, 'r_tenant_admin', NULL, 96);

-- Workflow Steps: Variation
INSERT OR IGNORE INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours)
VALUES
    ('ws_var_1', 'wf_variation', 1, 'r_project_manager', 500000, 48),
    ('ws_var_2', 'wf_variation', 2, 'r_director', 5000000, 72),
    ('ws_var_3', 'wf_variation', 3, 'r_tenant_admin', NULL, 96);

-- Workflow Steps: Procurement
INSERT OR IGNORE INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours)
VALUES
    ('ws_pro_1', 'wf_procurement', 1, 'r_project_manager', 250000, 24),
    ('ws_pro_2', 'wf_procurement', 2, 'r_director', 2500000, 48),
    ('ws_pro_3', 'wf_procurement', 3, 'r_tenant_admin', NULL, 72);

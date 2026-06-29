-- =============================================================================
-- Migration 0069: PR-PAY-2+3+4+5 — Overtime, Payroll Batch, Variance + Agent
-- =============================================================================

CREATE TABLE IF NOT EXISTS overtime_requests (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    datum           TEXT NOT NULL,
    hours_requested DOUBLE PRECISION NOT NULL,
    reason          TEXT NOT NULL,
    activity_id     TEXT,
    work_pack_id    TEXT,
    requested_by    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'submitted',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_overtime_requests_worker
    ON overtime_requests(worker_id);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_status
    ON overtime_requests(status);

CREATE TABLE IF NOT EXISTS overtime_approvals (
    id              SERIAL PRIMARY KEY,
    overtime_request_id TEXT NOT NULL,
    approved_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'foreman',
    decision        TEXT NOT NULL DEFAULT 'approved',
    hours_approved  DOUBLE PRECISION NOT NULL,
    comments        TEXT,
    approved_am     TEXT NOT NULL DEFAULT (NOW()),
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_overtime_approvals_request
    ON overtime_approvals(overtime_request_id);

CREATE TABLE IF NOT EXISTS labour_allowances (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    worker_id       TEXT,
    timesheet_id    TEXT,
    allowance_type  TEXT NOT NULL,
    description     TEXT,
    amount          DOUBLE PRECISION NOT NULL,
    datum           TEXT NOT NULL,
    approved_by     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_labour_allowances_timesheet
    ON labour_allowances(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_labour_allowances_worker
    ON labour_allowances(worker_id);

CREATE TABLE IF NOT EXISTS payroll_batches (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    period_start    TEXT NOT NULL,
    period_end      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    total_workers   INTEGER NOT NULL DEFAULT 0,
    total_normal_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_overtime_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_allowances DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_gross     DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_deductions DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_net       DOUBLE PRECISION NOT NULL DEFAULT 0,
    prepared_by     TEXT,
    finance_reviewed_by TEXT,
    finance_reviewed_am TEXT,
    approved_by     TEXT,
    approved_am     TEXT,
    locked_am       TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_payroll_batches_company
    ON payroll_batches(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_payroll_batches_period
    ON payroll_batches(period_start, period_end);

CREATE TABLE IF NOT EXISTS payroll_batch_lines (
    id              SERIAL PRIMARY KEY,
    payroll_batch_id TEXT NOT NULL,
    timesheet_id    TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    normal_hours    DOUBLE PRECISION NOT NULL DEFAULT 0,
    overtime_hours  DOUBLE PRECISION NOT NULL DEFAULT 0,
    rate_amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
    gross_pay       DOUBLE PRECISION NOT NULL DEFAULT 0,
    allowances      DOUBLE PRECISION NOT NULL DEFAULT 0,
    deductions      DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_pay         DOUBLE PRECISION NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'included',
    exception_id    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_payroll_batch_lines_batch
    ON payroll_batch_lines(payroll_batch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_batch_lines_worker
    ON payroll_batch_lines(worker_id);

CREATE TABLE IF NOT EXISTS payroll_exceptions (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    payroll_batch_id TEXT,
    timesheet_id    TEXT,
    worker_id       TEXT,
    exception_type  TEXT NOT NULL,
    description     TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'medium',
    resolved_by     TEXT,
    resolved_am     TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_payroll_exceptions_batch
    ON payroll_exceptions(payroll_batch_id);
CREATE INDEX IF NOT EXISTS idx_payroll_exceptions_type
    ON payroll_exceptions(exception_type);

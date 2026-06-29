-- =============================================================================
-- Migration 0068: PR-PAY-1 — Timesheet + Labour Allocation Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS attendance_records (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    datum           TEXT NOT NULL,
    check_in        TEXT,
    check_out       TEXT,
    source          TEXT NOT NULL DEFAULT 'manual',
    status          TEXT NOT NULL DEFAULT 'present',
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_worker
    ON attendance_records(worker_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date
    ON attendance_records(datum);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_unique
    ON attendance_records(worker_id, datum);

CREATE TABLE IF NOT EXISTS timesheets (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    crew_id         TEXT,
    foreman_id      TEXT,
    datum           TEXT NOT NULL,
    total_normal_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_overtime_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
    rate_type       TEXT NOT NULL DEFAULT 'hourly',
    allowances_total DOUBLE PRECISION DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'draft',
    approved_by     TEXT,
    approved_am     TEXT,
    rejection_reason TEXT,
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_timesheets_worker
    ON timesheets(worker_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_project
    ON timesheets(projekt_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status
    ON timesheets(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheets_unique
    ON timesheets(worker_id, datum);

CREATE TABLE IF NOT EXISTS timesheet_lines (
    id              SERIAL PRIMARY KEY,
    timesheet_id    TEXT NOT NULL,
    activity_id     TEXT,
    work_pack_id    TEXT,
    cost_code_id    TEXT,
    boq_item_id     TEXT,
    normal_hours    DOUBLE PRECISION NOT NULL DEFAULT 0,
    overtime_hours  DOUBLE PRECISION NOT NULL DEFAULT 0,
    rate_amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_timesheet_lines_timesheet
    ON timesheet_lines(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_lines_activity
    ON timesheet_lines(activity_id);

CREATE TABLE IF NOT EXISTS labour_cost_allocations (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    timesheet_line_id TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    activity_id     TEXT,
    cost_code_id    TEXT,
    boq_item_id     TEXT,
    labour_cost     DOUBLE PRECISION NOT NULL DEFAULT 0,
    datum           TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_labour_cost_allocations_project
    ON labour_cost_allocations(projekt_id);
CREATE INDEX IF NOT EXISTS idx_labour_cost_allocations_boq
    ON labour_cost_allocations(boq_item_id);

CREATE TABLE IF NOT EXISTS payroll_agent_recommendations (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'medium',
    worker_id           TEXT,
    timesheet_id        TEXT,
    overtime_request_id TEXT,
    projekt_id          TEXT,
    evidence            TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_payroll_agent_recs_company
    ON payroll_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_payroll_agent_recs_status
    ON payroll_agent_recommendations(status);

CREATE TABLE IF NOT EXISTS payroll_reviews (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    recommendation_id TEXT,
    timesheet_id    TEXT,
    payroll_batch_line_id TEXT,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'foreman',
    decision        TEXT NOT NULL DEFAULT 'pending',
    comments        TEXT,
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_payroll_reviews_company
    ON payroll_reviews(unternehmen_id);

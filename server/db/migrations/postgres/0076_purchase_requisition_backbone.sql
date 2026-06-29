-- =============================================================================
-- Migration 0076: PR-PRO-1 — Purchase Requisition + Budget Check Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_requisitions (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    project_id          TEXT NOT NULL,
    pr_number           TEXT,
    requester_id        TEXT NOT NULL,
    required_date       TEXT NOT NULL,
    procurement_type    TEXT NOT NULL DEFAULT 'material',
    priority            TEXT NOT NULL DEFAULT 'normal',
    status              TEXT NOT NULL DEFAULT 'draft',
    estimated_total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost_code_id        TEXT,
    daily_work_pack_id  TEXT,
    reason              TEXT NOT NULL,
    stock_check_result  TEXT,
    budget_check_result TEXT,
    approved_by         TEXT,
    approved_am         TEXT,
    rejected_by         TEXT,
    rejected_am         TEXT,
    rejection_reason    TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_project
    ON purchase_requisitions(project_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_status
    ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_requester
    ON purchase_requisitions(requester_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_work_pack
    ON purchase_requisitions(daily_work_pack_id);

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
    id                  SERIAL PRIMARY KEY,
    pr_id               TEXT NOT NULL,
    item_name           TEXT NOT NULL,
    item_type           TEXT NOT NULL DEFAULT 'material',
    boq_item_id         TEXT,
    activity_id         TEXT,
    quantity            DOUBLE PRECISION NOT NULL,
    unit                TEXT NOT NULL DEFAULT 'No.',
    estimated_unit_cost DOUBLE PRECISION,
    estimated_total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    specification       TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_purchase_requisition_items_pr
    ON purchase_requisition_items(pr_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requisition_items_boq
    ON purchase_requisition_items(boq_item_id);

CREATE TABLE IF NOT EXISTS procurement_agent_recommendations (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    pr_id               TEXT,
    po_id               TEXT,
    vendor_id           TEXT,
    issue               TEXT NOT NULL,
    evidence            TEXT,
    risk_level          TEXT NOT NULL DEFAULT 'medium',
    recommended_action  TEXT NOT NULL,
    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_procurement_agent_recs_pr
    ON procurement_agent_recommendations(pr_id);
CREATE INDEX IF NOT EXISTS idx_procurement_agent_recs_status
    ON procurement_agent_recommendations(status);

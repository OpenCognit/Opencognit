-- =============================================================================
-- Migration 0078: PR-PRO-3+4+5 — Quotation Comparison, PO + Commitment, Expediting
-- =============================================================================

-- ===== Quotation Comparison =====
CREATE TABLE IF NOT EXISTS vendor_quotations (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    rfq_id              TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    quotation_ref       TEXT,
    submitted_by        TEXT,
    submitted_am        TEXT NOT NULL DEFAULT (datetime('now')),
    total_amount        REAL NOT NULL DEFAULT 0,
    tax_amount          REAL DEFAULT 0,
    delivery_days       INTEGER,
    payment_terms       TEXT,
    warranty            TEXT,
    validity_days       INTEGER,
    transport_included  INTEGER NOT NULL DEFAULT 0,
    compliance_score    INTEGER,
    status              TEXT NOT NULL DEFAULT 'received',
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_quotations_rfq
    ON vendor_quotations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_vendor_quotations_vendor
    ON vendor_quotations(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_quotation_items (
    id                  TEXT PRIMARY KEY NOT NULL,
    quotation_id        TEXT NOT NULL,
    rfq_item_id         TEXT,
    item_name           TEXT NOT NULL,
    quantity            REAL NOT NULL,
    unit                TEXT NOT NULL DEFAULT 'No.',
    unit_rate           REAL NOT NULL,
    total_amount        REAL NOT NULL DEFAULT 0,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_quotation_items_quotation
    ON vendor_quotation_items(quotation_id);

CREATE TABLE IF NOT EXISTS quotation_comparisons (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    rfq_id              TEXT NOT NULL,
    pr_id               TEXT,
    prepared_by         TEXT NOT NULL,
    prepared_am         TEXT NOT NULL DEFAULT (datetime('now')),
    evaluation_criteria TEXT,
    recommendation      TEXT,
    recommended_vendor_id TEXT,
    recommended_reason  TEXT,
    status              TEXT NOT NULL DEFAULT 'draft',
    approved_by         TEXT,
    approved_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quotation_comparisons_rfq
    ON quotation_comparisons(rfq_id);

-- ===== Purchase Order + Commitment =====
CREATE TABLE IF NOT EXISTS purchase_orders (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    project_id          TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    pr_id               TEXT NOT NULL,
    quotation_id        TEXT,
    po_number           TEXT,
    delivery_location   TEXT NOT NULL,
    delivery_date       TEXT NOT NULL,
    payment_terms       TEXT,
    subtotal            REAL NOT NULL DEFAULT 0,
    tax_amount          REAL NOT NULL DEFAULT 0,
    total_amount        REAL NOT NULL DEFAULT 0,
    currency            TEXT DEFAULT 'KES',
    status              TEXT NOT NULL DEFAULT 'draft',
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_project
    ON purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor
    ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status
    ON purchase_orders(status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                  TEXT PRIMARY KEY NOT NULL,
    po_id               TEXT NOT NULL,
    pr_item_id          TEXT,
    rfq_item_id         TEXT,
    quotation_item_id   TEXT,
    item_name           TEXT NOT NULL,
    item_type           TEXT NOT NULL DEFAULT 'material',
    quantity            REAL NOT NULL,
    unit                TEXT NOT NULL DEFAULT 'No.',
    unit_rate           REAL NOT NULL,
    total_amount        REAL NOT NULL DEFAULT 0,
    tax_rate            REAL DEFAULT 0,
    boq_item_id         TEXT,
    activity_id         TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po
    ON purchase_order_items(po_id);

CREATE TABLE IF NOT EXISTS po_approvals (
    id                  TEXT PRIMARY KEY NOT NULL,
    po_id               TEXT NOT NULL,
    approved_by         TEXT NOT NULL,
    rolle               TEXT NOT NULL DEFAULT 'procurement_manager',
    decision            TEXT NOT NULL DEFAULT 'pending',
    comments            TEXT,
    approved_am         TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_po_approvals_po ON po_approvals(po_id);

CREATE TABLE IF NOT EXISTS po_delivery_schedules (
    id                  TEXT PRIMARY KEY NOT NULL,
    po_id               TEXT NOT NULL,
    po_item_id          TEXT,
    promised_date       TEXT NOT NULL,
    confirmed_date      TEXT,
    quantity_scheduled  REAL NOT NULL,
    quantity_delivered  REAL NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'pending',
    delay_reason        TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_po_delivery_schedules_po
    ON po_delivery_schedules(po_id);
CREATE INDEX IF NOT EXISTS idx_po_delivery_schedules_status
    ON po_delivery_schedules(status);

CREATE TABLE IF NOT EXISTS procurement_commitments (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    project_id          TEXT NOT NULL,
    po_id               TEXT NOT NULL,
    committed_amount    REAL NOT NULL,
    currency            TEXT DEFAULT 'KES',
    cost_code_id        TEXT,
    commitment_date     TEXT NOT NULL DEFAULT (datetime('now')),
    status              TEXT NOT NULL DEFAULT 'open',
    released_amount     REAL NOT NULL DEFAULT 0,
    released_date       TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procurement_commitments_project
    ON procurement_commitments(project_id);
CREATE INDEX IF NOT EXISTS idx_procurement_commitments_po
    ON procurement_commitments(po_id);

-- ===== Expediting + Reviews =====
CREATE TABLE IF NOT EXISTS procurement_expedites (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    po_id               TEXT NOT NULL,
    delivery_schedule_id TEXT,
    activity_id         TEXT,
    escalation_level    TEXT NOT NULL DEFAULT 'vendor_only',
    issue               TEXT NOT NULL,
    critical_path_impact INTEGER NOT NULL DEFAULT 0,
    action_taken        TEXT,
    next_followup       TEXT,
    status              TEXT NOT NULL DEFAULT 'open',
    resolved_by         TEXT,
    resolved_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procurement_expedites_po
    ON procurement_expedites(po_id);
CREATE INDEX IF NOT EXISTS idx_procurement_expedites_status
    ON procurement_expedites(status);

CREATE TABLE IF NOT EXISTS procurement_reviews (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    po_id               TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    reviewed_by         TEXT NOT NULL,
    rolle               TEXT NOT NULL DEFAULT 'procurement',
    rating_score        INTEGER,
    on_time_delivery    INTEGER,
    quality_compliance  INTEGER,
    documentation_score INTEGER,
    comments            TEXT,
    reviewed_am         TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procurement_reviews_po
    ON procurement_reviews(po_id);
CREATE INDEX IF NOT EXISTS idx_procurement_reviews_vendor
    ON procurement_reviews(vendor_id);

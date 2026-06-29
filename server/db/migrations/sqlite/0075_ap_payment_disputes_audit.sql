-- =============================================================================
-- Migration 0075: PR-AP-2+3+4+5 — Payment Workflow, Disputes, Audit
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_confirmations (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    po_id           TEXT NOT NULL,
    vendor_id       TEXT NOT NULL,
    service_type    TEXT NOT NULL,
    description     TEXT,
    period_start    TEXT,
    period_end      TEXT,
    confirmed_days  REAL NOT NULL DEFAULT 0,
    confirmed_units REAL,
    confirmed_by    TEXT NOT NULL,
    confirmed_am    TEXT NOT NULL DEFAULT (datetime('now')),
    status          TEXT NOT NULL DEFAULT 'confirmed',
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_confirmations_po
    ON service_confirmations(po_id);

CREATE TABLE IF NOT EXISTS service_confirmation_items (
    id              TEXT PRIMARY KEY NOT NULL,
    confirmation_id TEXT NOT NULL,
    po_item_id      TEXT NOT NULL,
    description     TEXT NOT NULL,
    ordered_qty     REAL NOT NULL,
    confirmed_qty   REAL NOT NULL,
    unit            TEXT NOT NULL DEFAULT 'days',
    unit_rate       REAL,
    rejection_reason TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_service_confirmation_items_confirmation
    ON service_confirmation_items(confirmation_id);

CREATE TABLE IF NOT EXISTS invoice_match_exceptions (
    id              TEXT PRIMARY KEY NOT NULL,
    invoice_id      TEXT NOT NULL,
    match_result_id TEXT,
    exception_type  TEXT NOT NULL,
    description     TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'medium',
    resolved_by     TEXT,
    resolved_am     TEXT,
    resolution      TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_match_exceptions_invoice
    ON invoice_match_exceptions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_match_exceptions_status
    ON invoice_match_exceptions(status);

CREATE TABLE IF NOT EXISTS accounts_payable_reviews (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    invoice_id      TEXT NOT NULL,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'finance',
    decision        TEXT NOT NULL DEFAULT 'pending',
    payable_amount  REAL DEFAULT 0,
    comments        TEXT,
    reviewed_am     TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ap_reviews_invoice
    ON accounts_payable_reviews(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ap_reviews_company
    ON accounts_payable_reviews(unternehmen_id);

CREATE TABLE IF NOT EXISTS payment_approval_requests (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    invoice_id      TEXT NOT NULL,
    requested_by    TEXT NOT NULL,
    amount          REAL NOT NULL,
    approval_level  TEXT NOT NULL DEFAULT 'finance_manager',
    status          TEXT NOT NULL DEFAULT 'pending',
    approved_by     TEXT,
    approved_am     TEXT,
    rejection_reason TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_approval_requests_invoice
    ON payment_approval_requests(invoice_id);

CREATE TABLE IF NOT EXISTS vendor_payment_records (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    invoice_id      TEXT NOT NULL,
    vendor_id       TEXT NOT NULL,
    amount_paid     REAL NOT NULL,
    payment_date    TEXT NOT NULL,
    payment_method  TEXT NOT NULL DEFAULT 'bank_transfer',
    payment_ref     TEXT,
    paid_by         TEXT NOT NULL,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_records_invoice
    ON vendor_payment_records(invoice_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_records_vendor
    ON vendor_payment_records(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_disputes (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    invoice_id      TEXT,
    grn_id          TEXT,
    vendor_id       TEXT NOT NULL,
    dispute_type    TEXT NOT NULL,
    description     TEXT NOT NULL,
    amount_disputed REAL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'open',
    resolution      TEXT,
    resolved_by     TEXT,
    resolved_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_disputes_invoice
    ON vendor_disputes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_vendor_disputes_vendor
    ON vendor_disputes(vendor_id);

CREATE TABLE IF NOT EXISTS ap_audit_events (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    invoice_id      TEXT,
    payment_id      TEXT,
    event_type      TEXT NOT NULL,
    actor           TEXT NOT NULL,
    old_value        TEXT,
    new_value        TEXT,
    event_am        TEXT NOT NULL DEFAULT (datetime('now')),
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ap_audit_events_invoice
    ON ap_audit_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ap_audit_events_type
    ON ap_audit_events(event_type);

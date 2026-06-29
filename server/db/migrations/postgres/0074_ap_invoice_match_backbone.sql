-- =============================================================================
-- Migration 0074: PR-AP-1 — Vendor Invoice Register + Match Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS delivery_notes (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    po_id           TEXT NOT NULL,
    vendor_id       TEXT NOT NULL,
    delivery_note_number TEXT,
    delivery_date   TEXT NOT NULL,
    delivery_type   TEXT NOT NULL DEFAULT 'materials',
    transport_ref   TEXT,
    driver_name     TEXT,
    vehicle_number  TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_po
    ON delivery_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_vendor
    ON delivery_notes(vendor_id);

CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    delivery_note_id TEXT NOT NULL,
    po_id           TEXT NOT NULL,
    vendor_id       TEXT NOT NULL,
    grn_number      TEXT,
    received_date   TEXT NOT NULL,
    received_by     TEXT NOT NULL,
    qa_status       TEXT DEFAULT 'pending',
    qa_reviewed_by  TEXT,
    qa_reviewed_am  TEXT,
    status          TEXT NOT NULL DEFAULT 'received',
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_po
    ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_notes_delivery
    ON goods_receipt_notes(delivery_note_id);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id              SERIAL PRIMARY KEY,
    grn_id          TEXT NOT NULL,
    po_item_id      TEXT NOT NULL,
    item_name       TEXT NOT NULL,
    quantity_ordered DOUBLE PRECISION NOT NULL,
    quantity_delivered DOUBLE PRECISION NOT NULL,
    quantity_accepted DOUBLE PRECISION NOT NULL DEFAULT 0,
    quantity_rejected DOUBLE PRECISION NOT NULL DEFAULT 0,
    rejection_reason TEXT,
    unit            TEXT NOT NULL DEFAULT 'No.',
    unit_price_po   DOUBLE PRECISION,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_grn
    ON goods_receipt_items(grn_id);

CREATE TABLE IF NOT EXISTS vendor_invoices (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    vendor_id       TEXT NOT NULL,
    po_id           TEXT,
    grn_id          TEXT,
    invoice_number  TEXT NOT NULL,
    invoice_date    TEXT NOT NULL,
    payment_due_date TEXT,
    subtotal        DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax_amount      DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency        TEXT DEFAULT 'KES',
    payment_terms   TEXT,
    status          TEXT NOT NULL DEFAULT 'received',
    hold_reason     TEXT,
    duplicate_check INTEGER DEFAULT 0,
    matched_am      TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_po
    ON vendor_invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_vendor
    ON vendor_invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_invoice_number
    ON vendor_invoices(invoice_number);

CREATE TABLE IF NOT EXISTS vendor_invoice_items (
    id              SERIAL PRIMARY KEY,
    invoice_id      TEXT NOT NULL,
    po_item_id      TEXT,
    grn_item_id     TEXT,
    item_name       TEXT NOT NULL,
    quantity        DOUBLE PRECISION NOT NULL,
    unit_price      DOUBLE PRECISION NOT NULL,
    line_total      DOUBLE PRECISION NOT NULL DEFAULT 0,
    tax_rate        DOUBLE PRECISION DEFAULT 0,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoice_items_invoice
    ON vendor_invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_match_results (
    id              SERIAL PRIMARY KEY,
    invoice_id      TEXT NOT NULL,
    invoice_item_id TEXT,
    po_quantity     DOUBLE PRECISION,
    grn_accepted    DOUBLE PRECISION,
    invoice_quantity DOUBLE PRECISION,
    po_rate         DOUBLE PRECISION,
    invoice_rate    DOUBLE PRECISION,
    match_status    TEXT NOT NULL DEFAULT 'pending',
    variance_type   TEXT,
    payable_amount  DOUBLE PRECISION DEFAULT 0,
    notes           TEXT,
    matched_by      TEXT,
    matched_am      TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_invoice_match_results_invoice
    ON invoice_match_results(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_match_results_status
    ON invoice_match_results(match_status);

CREATE TABLE IF NOT EXISTS ap_agent_recommendations (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    agent_id        TEXT,
    invoice_id      TEXT,
    po_id           TEXT,
    vendor_id       TEXT,
    issue           TEXT NOT NULL,
    risk_level      TEXT NOT NULL DEFAULT 'medium',
    evidence        TEXT,
    recommended_action TEXT NOT NULL,
    owner           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending_review',
    detected_am     TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_ap_agent_recs_company
    ON ap_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_ap_agent_recs_invoice
    ON ap_agent_recommendations(invoice_id);

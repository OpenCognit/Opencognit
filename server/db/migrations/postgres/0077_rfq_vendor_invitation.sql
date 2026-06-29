-- =============================================================================
-- Migration 0077: PR-PRO-2 — RFQ + Vendor Invitation
-- =============================================================================

CREATE TABLE IF NOT EXISTS rfqs (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    pr_id               TEXT NOT NULL,
    rfq_number          TEXT,
    title               TEXT NOT NULL,
    description         TEXT,
    delivery_location   TEXT NOT NULL,
    required_date       TEXT NOT NULL,
    quotation_deadline  TEXT NOT NULL,
    payment_terms       TEXT,
    specification       TEXT,
    status              TEXT NOT NULL DEFAULT 'draft',
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_rfqs_pr ON rfqs(pr_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(status);

CREATE TABLE IF NOT EXISTS rfq_items (
    id                  SERIAL PRIMARY KEY,
    rfq_id              TEXT NOT NULL,
    pr_item_id          TEXT,
    item_name           TEXT NOT NULL,
    item_type           TEXT NOT NULL DEFAULT 'material',
    quantity            DOUBLE PRECISION NOT NULL,
    unit                TEXT NOT NULL DEFAULT 'No.',
    specification       TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON rfq_items(rfq_id);

CREATE TABLE IF NOT EXISTS rfq_vendor_invites (
    id                  SERIAL PRIMARY KEY,
    rfq_id              TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    invited_by          TEXT NOT NULL,
    invited_am          TEXT NOT NULL DEFAULT (NOW()),
    response_status     TEXT NOT NULL DEFAULT 'pending',
    declined_reason     TEXT,
    responded_am        TEXT,
    bid_intent          TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_rfq
    ON rfq_vendor_invites(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendor_invites_vendor
    ON rfq_vendor_invites(vendor_id);

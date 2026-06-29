-- =============================================================================
-- Migration 0052: PR-EST-3 — Quote Linkage
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimate_quote_links (
    id              SERIAL PRIMARY KEY,
    estimate_id     TEXT NOT NULL,
    boq_item_id     TEXT,
    quote_type      TEXT NOT NULL DEFAULT 'vendor',
    vendor_id       TEXT,
    subcontractor_id TEXT,
    quote_ref       TEXT NOT NULL,
    quote_date      TEXT,
    expiry_date     TEXT,
    amount          DOUBLE PRECISION,
    currency        TEXT DEFAULT 'KES',
    covers_vat      INTEGER NOT NULL DEFAULT 0,
    covers_transport INTEGER NOT NULL DEFAULT 0,
    scope_match     TEXT DEFAULT 'full',
    exclusions      TEXT,
    risk_flag       TEXT,
    status          TEXT NOT NULL DEFAULT 'valid',
    linked_by       TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_estimate_quote_links_estimate
    ON estimate_quote_links(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_quote_links_item
    ON estimate_quote_links(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_estimate_quote_links_status
    ON estimate_quote_links(status);

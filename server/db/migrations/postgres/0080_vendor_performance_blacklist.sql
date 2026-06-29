-- =============================================================================
-- Migration 0080: PR-VND-2 — Vendor Performance, Compliance, Blacklist
-- =============================================================================

CREATE TABLE IF NOT EXISTS vendor_bank_details (
    id                  SERIAL PRIMARY KEY,
    vendor_id           TEXT NOT NULL,
    bank_name           TEXT NOT NULL,
    account_number      TEXT NOT NULL,
    account_name        TEXT,
    branch              TEXT,
    swift_code          TEXT,
    currency            TEXT DEFAULT 'KES',
    is_active           INTEGER NOT NULL DEFAULT 1,
    changed_by          TEXT,
    change_reason       TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_details_vendor
    ON vendor_bank_details(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_performance_reviews (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    review_period_start TEXT NOT NULL,
    review_period_end   TEXT NOT NULL,
    reviewed_by         TEXT NOT NULL,
    rolle               TEXT NOT NULL DEFAULT 'procurement',
    delivery_score      INTEGER DEFAULT 0,
    quality_score       INTEGER DEFAULT 0,
    pricing_score       INTEGER DEFAULT 0,
    responsiveness_score INTEGER DEFAULT 0,
    compliance_score    INTEGER DEFAULT 0,
    overall_score       DOUBLE PRECISION DEFAULT 0,
    total_pos_issued    INTEGER DEFAULT 0,
    total_pos_on_time   INTEGER DEFAULT 0,
    total_value_awarded DOUBLE PRECISION DEFAULT 0,
    dispute_count       INTEGER DEFAULT 0,
    comments            TEXT,
    status              TEXT NOT NULL DEFAULT 'draft',
    next_review_date    TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_performance_reviews_vendor
    ON vendor_performance_reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_performance_reviews_company
    ON vendor_performance_reviews(unternehmen_id);

CREATE TABLE IF NOT EXISTS vendor_blacklist_events (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    blacklisted_by      TEXT NOT NULL,
    reason              TEXT NOT NULL,
    evidence            TEXT,
    blacklisted_am      TEXT NOT NULL DEFAULT (NOW()),
    effective_from      TEXT NOT NULL,
    effective_until     TEXT,
    lifted_by           TEXT,
    lifted_am           TEXT,
    lift_reason         TEXT,
    status              TEXT NOT NULL DEFAULT 'active',
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_blacklist_vendor
    ON vendor_blacklist_events(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_blacklist_status
    ON vendor_blacklist_events(status);

CREATE TABLE IF NOT EXISTS vendor_reviews (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    vendor_id           TEXT NOT NULL,
    po_id               TEXT,
    reviewed_by         TEXT NOT NULL,
    rolle               TEXT NOT NULL DEFAULT 'procurement_officer',
    decision            TEXT NOT NULL DEFAULT 'no_action',
    rating              INTEGER,
    comments            TEXT,
    reviewed_am         TEXT NOT NULL DEFAULT (NOW()),
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_reviews_vendor
    ON vendor_reviews(vendor_id);

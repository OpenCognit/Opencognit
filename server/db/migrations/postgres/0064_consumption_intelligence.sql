-- =============================================================================
-- Migration 0064: PR-STO-5 — Consumption Intelligence Agent
-- =============================================================================

CREATE TABLE IF NOT EXISTS stock_agent_recommendations (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    projekt_id          TEXT,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'medium',
    stock_item_id       TEXT,
    work_pack_id        TEXT,
    boq_item_id         TEXT,
    evidence            TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stock_agent_recs_company
    ON stock_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_stock_agent_recs_status
    ON stock_agent_recommendations(status);

CREATE TABLE IF NOT EXISTS stock_reviews (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    recommendation_id TEXT,
    adjustment_id   TEXT,
    wastage_id      TEXT,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'storekeeper',
    decision        TEXT NOT NULL DEFAULT 'pending',
    comments        TEXT,
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stock_reviews_company
    ON stock_reviews(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_stock_reviews_recommendation
    ON stock_reviews(recommendation_id);

CREATE TABLE IF NOT EXISTS stock_transfer_requests (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    from_location_id TEXT NOT NULL,
    to_location_id  TEXT NOT NULL,
    stock_item_id   TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    einheit          TEXT NOT NULL,
    menge            DOUBLE PRECISION NOT NULL,
    reason          TEXT NOT NULL,
    requested_by    TEXT NOT NULL,
    approved_by     TEXT,
    approved_am     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_requests_company
    ON stock_transfer_requests(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_requests_status
    ON stock_transfer_requests(status);

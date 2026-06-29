-- =============================================================================
-- Migration 0054: PR-EST-5 — Bid Review + Lock
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimate_assumptions (
    id                  TEXT PRIMARY KEY NOT NULL,
    estimate_id         TEXT NOT NULL,
    version_id          TEXT,
    category            TEXT NOT NULL DEFAULT 'general',
    beschreibung        TEXT NOT NULL,
    risk_level          TEXT NOT NULL DEFAULT 'low',
    commercial_impact   REAL,
    approved_by         TEXT,
    approved_am         TEXT,
    status              TEXT NOT NULL DEFAULT 'draft',
    erstellt_von        TEXT NOT NULL,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estimate_assumptions_estimate
    ON estimate_assumptions(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_assumptions_category
    ON estimate_assumptions(category);

CREATE TABLE IF NOT EXISTS estimate_reviews (
    id                  TEXT PRIMARY KEY NOT NULL,
    estimate_id         TEXT NOT NULL,
    version_id          TEXT NOT NULL,
    reviewed_by         TEXT NOT NULL,
    rolle               TEXT NOT NULL DEFAULT 'estimator',
    level               INTEGER NOT NULL DEFAULT 1,
    decision            TEXT NOT NULL DEFAULT 'pending',
    comments            TEXT,
    material_ok         INTEGER,
    labour_ok           INTEGER,
    equipment_ok        INTEGER,
    subcontract_ok      INTEGER,
    overhead_ok         INTEGER,
    margin_ok           INTEGER,
    risk_ok             INTEGER,
    assumptions_ok      INTEGER,
    quotes_ok           INTEGER,
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estimate_reviews_estimate
    ON estimate_reviews(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_reviews_decision
    ON estimate_reviews(decision);

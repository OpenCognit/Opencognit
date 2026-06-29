-- =============================================================================
-- Migration 0050: PR-EST-1 — Estimate Register + BOQ Import
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimates (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    name            TEXT NOT NULL,
    reference_code  TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    currency        TEXT NOT NULL DEFAULT 'KES',
    total_amount    REAL DEFAULT 0,
    margin_pct      REAL,
    overhead_pct    REAL,
    erstellt_von    TEXT NOT NULL,
    genehmigt_von   TEXT,
    genehmigt_am    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estimates_company
    ON estimates(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status
    ON estimates(status);

CREATE TABLE IF NOT EXISTS estimate_versions (
    id              TEXT PRIMARY KEY NOT NULL,
    estimate_id     TEXT NOT NULL,
    version_number  INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'working',
    total_amount    REAL DEFAULT 0,
    beschreibung    TEXT,
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estimate_versions_estimate
    ON estimate_versions(estimate_id);

CREATE TABLE IF NOT EXISTS estimate_boq_items (
    id                  TEXT PRIMARY KEY NOT NULL,
    estimate_id         TEXT NOT NULL,
    version_id          TEXT NOT NULL,
    item_code           TEXT,
    beschreibung        TEXT NOT NULL,
    einheit             TEXT NOT NULL,
    menge               REAL NOT NULL DEFAULT 0,
    rate                REAL NOT NULL DEFAULT 0,
    amount              REAL NOT NULL DEFAULT 0,
    quantity_source     TEXT,
    rate_source         TEXT,
    assumption_notes    TEXT,
    status              TEXT NOT NULL DEFAULT 'unpriced',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estimate_boq_items_estimate
    ON estimate_boq_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_boq_items_version
    ON estimate_boq_items(version_id);
CREATE INDEX IF NOT EXISTS idx_estimate_boq_items_status
    ON estimate_boq_items(status);

CREATE TABLE IF NOT EXISTS estimate_agent_recommendations (
    id                  TEXT PRIMARY KEY NOT NULL,
    estimate_id         TEXT NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'P2',
    affected_item_id    TEXT,
    evidence            TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    link_incident_id    TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_estimate_agent_recs_estimate
    ON estimate_agent_recommendations(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_agent_recs_status
    ON estimate_agent_recommendations(status);

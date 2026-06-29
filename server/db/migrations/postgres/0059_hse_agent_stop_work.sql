-- =============================================================================
-- Migration 0059: PR-HSE-5 — HSE Agent + Stop-Work
-- =============================================================================

CREATE TABLE IF NOT EXISTS hse_stop_work_orders (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    work_pack_id    TEXT,
    aktivitaet_id   TEXT,
    reason          TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'high',
    issued_by       TEXT NOT NULL,
    issued_am       TEXT NOT NULL DEFAULT (NOW()),
    resolved_am     TEXT,
    resolved_by     TEXT,
    resolution      TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_stop_work_company
    ON hse_stop_work_orders(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_stop_work_pack
    ON hse_stop_work_orders(work_pack_id);
CREATE INDEX IF NOT EXISTS idx_hse_stop_work_status
    ON hse_stop_work_orders(status);

CREATE TABLE IF NOT EXISTS hse_inspections (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    inspection_type TEXT NOT NULL DEFAULT 'routine',
    location        TEXT NOT NULL,
    aktivitaet_id   TEXT,
    work_pack_id    TEXT,
    inspector       TEXT NOT NULL,
    datum           TEXT NOT NULL,
    findings        TEXT,
    rating          TEXT DEFAULT 'satisfactory',
    status          TEXT NOT NULL DEFAULT 'completed',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_inspections_company
    ON hse_inspections(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_inspections_date
    ON hse_inspections(datum);

CREATE TABLE IF NOT EXISTS hse_reviews (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    incident_id     TEXT,
    permit_id       TEXT,
    stop_work_id    TEXT,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'hse_officer',
    decision        TEXT NOT NULL DEFAULT 'pending',
    comments        TEXT,
    recommended_actions TEXT,
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_reviews_company
    ON hse_reviews(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_reviews_incident
    ON hse_reviews(incident_id);

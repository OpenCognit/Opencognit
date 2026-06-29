-- =============================================================================
-- Migration 0056: PR-HSE-2 — Permit-to-Work
-- =============================================================================

CREATE TABLE IF NOT EXISTS hse_permits (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    permit_type     TEXT NOT NULL,
    aktivitaet_id   TEXT,
    work_pack_id    TEXT,
    location        TEXT NOT NULL,
    risk_level      TEXT NOT NULL DEFAULT 'medium',
    description     TEXT,
    valid_from       TEXT NOT NULL,
    valid_to         TEXT NOT NULL,
    requested_by    TEXT NOT NULL,
    approved_by     TEXT,
    approved_am     TEXT,
    issued_am       TEXT,
    expiry_am       TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hse_permits_company
    ON hse_permits(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_permits_status
    ON hse_permits(status);
CREATE INDEX IF NOT EXISTS idx_hse_permits_type
    ON hse_permits(permit_type);
CREATE INDEX IF NOT EXISTS idx_hse_permits_work_pack
    ON hse_permits(work_pack_id);

CREATE TABLE IF NOT EXISTS hse_permit_controls (
    id              TEXT PRIMARY KEY NOT NULL,
    permit_id       TEXT NOT NULL,
    control_name    TEXT NOT NULL,
    control_type    TEXT NOT NULL DEFAULT 'check',
    required        INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'pending',
    evidence        TEXT,
    checked_by       TEXT,
    checked_am       TEXT,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hse_permit_controls_permit
    ON hse_permit_controls(permit_id);

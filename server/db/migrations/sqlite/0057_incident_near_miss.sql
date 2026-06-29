-- =============================================================================
-- Migration 0057: PR-HSE-3 — Incident + Near-Miss Register
-- =============================================================================

CREATE TABLE IF NOT EXISTS hse_incidents (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    incident_type   TEXT NOT NULL DEFAULT 'near_miss',
    severity        TEXT NOT NULL DEFAULT 'low',
    titel           TEXT NOT NULL,
    beschreibung    TEXT,
    location        TEXT NOT NULL,
    aktivitaet_id   TEXT,
    work_pack_id    TEXT,
    datum           TEXT NOT NULL,
    uhrzeit         TEXT,
    reported_by     TEXT NOT NULL,
    immediate_action TEXT,
    investigation_status TEXT NOT NULL DEFAULT 'not_started',
    photos          TEXT,
    status          TEXT NOT NULL DEFAULT 'reported',
    closed_am       TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hse_incidents_company
    ON hse_incidents(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_incidents_type
    ON hse_incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_hse_incidents_severity
    ON hse_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_hse_incidents_status
    ON hse_incidents(status);

CREATE TABLE IF NOT EXISTS hse_incident_investigations (
    id              TEXT PRIMARY KEY NOT NULL,
    incident_id     TEXT NOT NULL,
    assigned_to     TEXT NOT NULL,
    root_cause      TEXT,
    contributing_factors TEXT,
    findings        TEXT,
    recommendations TEXT,
    status          TEXT NOT NULL DEFAULT 'in_progress',
    started_am      TEXT,
    completed_am    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hse_incident_investigations_incident
    ON hse_incident_investigations(incident_id);

CREATE TABLE IF NOT EXISTS hse_observations (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    observation_type TEXT NOT NULL DEFAULT 'unsafe_condition',
    severity        TEXT NOT NULL DEFAULT 'low',
    beschreibung    TEXT NOT NULL,
    location        TEXT NOT NULL,
    aktivitaet_id   TEXT,
    work_pack_id    TEXT,
    reported_by     TEXT,
    datum           TEXT NOT NULL,
    photo_evidence  TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    resolved_am     TEXT,
    resolved_by     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hse_observations_company
    ON hse_observations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_observations_type
    ON hse_observations(observation_type);

-- =============================================================================
-- Migration 0058: PR-HSE-4 — Corrective Action Workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS hse_corrective_actions (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    incident_id     TEXT,
    observation_id  TEXT,
    inspection_id   TEXT,
    description     TEXT NOT NULL,
    responsible_id  TEXT NOT NULL,
    due_date        TEXT NOT NULL,
    closure_evidence TEXT,
    verified_by     TEXT,
    verified_am      TEXT,
    status          TEXT NOT NULL DEFAULT 'open',
    priority        TEXT NOT NULL DEFAULT 'medium',
    closed_am       TEXT,
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hse_corrective_actions_company
    ON hse_corrective_actions(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_corrective_actions_status
    ON hse_corrective_actions(status);
CREATE INDEX IF NOT EXISTS idx_hse_corrective_actions_due
    ON hse_corrective_actions(due_date);
CREATE INDEX IF NOT EXISTS idx_hse_corrective_actions_incident
    ON hse_corrective_actions(incident_id);

-- =============================================================================
-- Migration 0055: PR-HSE-1 — HSE Readiness + Toolbox Talk Register
-- =============================================================================

CREATE TABLE IF NOT EXISTS hse_toolbox_talks (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    topic           TEXT NOT NULL,
    aktivitaet_id   TEXT,
    work_pack_id    TEXT,
    crew_id         TEXT,
    datum           TEXT NOT NULL,
    uhrzeit         TEXT,
    vorarbeiter_id  TEXT NOT NULL,
    hazards_discussed TEXT,
    controls_agreed TEXT,
    status          TEXT NOT NULL DEFAULT 'planned',
    photo_evidence  TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_toolbox_talks_company
    ON hse_toolbox_talks(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_toolbox_talks_status
    ON hse_toolbox_talks(status);
CREATE INDEX IF NOT EXISTS idx_hse_toolbox_talks_date
    ON hse_toolbox_talks(datum);

CREATE TABLE IF NOT EXISTS hse_toolbox_attendance (
    id              SERIAL PRIMARY KEY,
    toolbox_id      TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    worker_name     TEXT NOT NULL,
    present         INTEGER NOT NULL DEFAULT 1,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_toolbox_attendance_toolbox
    ON hse_toolbox_attendance(toolbox_id);
CREATE INDEX IF NOT EXISTS idx_hse_toolbox_attendance_worker
    ON hse_toolbox_attendance(worker_id);

CREATE TABLE IF NOT EXISTS hse_worker_inductions (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    induktion_typ   TEXT NOT NULL DEFAULT 'general',
    induktion_am    TEXT NOT NULL,
    expiry_am       TEXT,
    completed_by    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_worker_inductions_worker
    ON hse_worker_inductions(worker_id);
CREATE INDEX IF NOT EXISTS idx_hse_worker_inductions_company
    ON hse_worker_inductions(unternehmen_id);

CREATE TABLE IF NOT EXISTS hse_ppe_checks (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    worker_id       TEXT NOT NULL,
    datum           TEXT NOT NULL,
    helmet          INTEGER DEFAULT 1,
    boots           INTEGER DEFAULT 1,
    vest            INTEGER DEFAULT 1,
    gloves          INTEGER,
    goggles         INTEGER,
    harness         INTEGER,
    respiratory     INTEGER,
    status          TEXT NOT NULL DEFAULT 'ok',
    checked_by      TEXT NOT NULL,
    comments        TEXT,
    work_pack_id    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_ppe_checks_worker
    ON hse_ppe_checks(worker_id);
CREATE INDEX IF NOT EXISTS idx_hse_ppe_checks_date
    ON hse_ppe_checks(datum);

CREATE TABLE IF NOT EXISTS hse_agent_recommendations (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    projekt_id          TEXT,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'medium',
    affected_work_pack  TEXT,
    affected_worker_id  TEXT,
    evidence            TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_hse_agent_recs_company
    ON hse_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_hse_agent_recs_status
    ON hse_agent_recommendations(status);

-- =============================================================================
-- Migration 0043: PR-OPS-1 — Platform Health + Incident Register
-- =============================================================================
-- 6 tables: platform_health_checks, platform_incidents,
--   platform_incident_events, platform_error_logs,
--   platform_release_health, platform_observability_alerts
--
-- Core rule: No production failure shall remain invisible, unexplained,
--            unassigned, or unrecoverable.
--
-- Greenfield — zero dependencies on other migrations.
-- All CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE — safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. platform_health_checks — periodic health snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_health_checks (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    check_type      TEXT NOT NULL,
    status          TEXT NOT NULL,
    target          TEXT,
    latency_ms      INTEGER,
    message         TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_health_checks_type_status
    ON platform_health_checks(check_type, status);
CREATE INDEX IF NOT EXISTS idx_platform_health_checks_unternehmen
    ON platform_health_checks(unternehmen_id);

-- ---------------------------------------------------------------------------
-- 2. platform_incidents — incident register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_incidents (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    title               TEXT NOT NULL,
    severity            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open',
    affected_module     TEXT,
    affected_tenant_id  TEXT,
    affected_project_id TEXT,
    release_id          TEXT,
    owner               TEXT,
    detected_by         TEXT,
    detected_am         TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_incidents_status
    ON platform_incidents(status);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_severity
    ON platform_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_module
    ON platform_incidents(affected_module);

-- ---------------------------------------------------------------------------
-- 3. platform_incident_events — timeline within an incident
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_incident_events (
    id              TEXT PRIMARY KEY NOT NULL,
    incident_id     TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    actor           TEXT,
    kommentar       TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_incident_events_incident
    ON platform_incident_events(incident_id);

-- ---------------------------------------------------------------------------
-- 4. platform_error_logs — structured error capture with deduplication
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_error_logs (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    module              TEXT NOT NULL,
    route               TEXT,
    error_type          TEXT NOT NULL,
    error_message       TEXT NOT NULL,
    stack_trace         TEXT,
    status_code         INTEGER,
    release_id          TEXT,
    affected_tenant_id  TEXT,
    affected_user_id    TEXT,
    occurrence_count    INTEGER NOT NULL DEFAULT 1,
    first_seen_am       TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_am        TEXT NOT NULL DEFAULT (datetime('now')),
    status              TEXT NOT NULL DEFAULT 'unresolved',
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_error_logs_dedup
    ON platform_error_logs(unternehmen_id, module, route, error_type);
CREATE INDEX IF NOT EXISTS idx_platform_error_logs_status
    ON platform_error_logs(status);

-- ---------------------------------------------------------------------------
-- 5. platform_release_health — deployment health tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_release_health (
    id                      TEXT PRIMARY KEY NOT NULL,
    unternehmen_id          TEXT NOT NULL,
    version                 TEXT NOT NULL,
    commit_sha              TEXT NOT NULL,
    deployed_am             TEXT NOT NULL DEFAULT (datetime('now')),
    status                  TEXT NOT NULL DEFAULT 'healthy',
    error_spike_detected    INTEGER NOT NULL DEFAULT 0,
    regression_count        INTEGER NOT NULL DEFAULT 0,
    rollback_recommended    INTEGER NOT NULL DEFAULT 0,
    beschreibung            TEXT,
    erstellt_am             TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_release_health_status
    ON platform_release_health(status);

-- ---------------------------------------------------------------------------
-- 6. platform_observability_alerts — agent-detected alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_observability_alerts (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL,
    affected_module     TEXT,
    affected_tenant_id  TEXT,
    affected_project_id TEXT,
    evidence            TEXT,
    suspected_cause     TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    link_incident_id    TEXT,
    detected_am         TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_am     TEXT,
    resolved_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_platform_observability_alerts_severity
    ON platform_observability_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_platform_observability_alerts_agent
    ON platform_observability_alerts(agent_id);

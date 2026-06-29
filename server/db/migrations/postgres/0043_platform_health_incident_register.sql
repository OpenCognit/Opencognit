-- =============================================================================
-- Migration 0043: PR-OPS-1 — Platform Health + Incident Register (PostgreSQL)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_health_checks (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    check_type      TEXT NOT NULL,
    status          TEXT NOT NULL,
    target          TEXT,
    latency_ms      INTEGER,
    message         TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_health_checks_type_status
    ON platform_health_checks(check_type, status);
CREATE INDEX IF NOT EXISTS idx_platform_health_checks_unternehmen
    ON platform_health_checks(unternehmen_id);

CREATE TABLE IF NOT EXISTS platform_incidents (
    id                  SERIAL PRIMARY KEY,
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
    detected_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_am         TIMESTAMP,
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_incidents_status
    ON platform_incidents(status);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_severity
    ON platform_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_module
    ON platform_incidents(affected_module);

CREATE TABLE IF NOT EXISTS platform_incident_events (
    id              SERIAL PRIMARY KEY,
    incident_id     TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    actor           TEXT,
    kommentar       TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_incident_events_incident
    ON platform_incident_events(incident_id);

CREATE TABLE IF NOT EXISTS platform_error_logs (
    id                  SERIAL PRIMARY KEY,
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
    first_seen_am       TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_am        TIMESTAMP NOT NULL DEFAULT NOW(),
    status              TEXT NOT NULL DEFAULT 'unresolved',
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_error_logs_dedup
    ON platform_error_logs(unternehmen_id, module, route, error_type);
CREATE INDEX IF NOT EXISTS idx_platform_error_logs_status
    ON platform_error_logs(status);

CREATE TABLE IF NOT EXISTS platform_release_health (
    id                      SERIAL PRIMARY KEY,
    unternehmen_id          TEXT NOT NULL,
    version                 TEXT NOT NULL,
    commit_sha              TEXT NOT NULL,
    deployed_am             TIMESTAMP NOT NULL DEFAULT NOW(),
    status                  TEXT NOT NULL DEFAULT 'healthy',
    error_spike_detected    BOOLEAN NOT NULL DEFAULT FALSE,
    regression_count        INTEGER NOT NULL DEFAULT 0,
    rollback_recommended    BOOLEAN NOT NULL DEFAULT FALSE,
    beschreibung            TEXT,
    erstellt_am             TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_release_health_status
    ON platform_release_health(status);

CREATE TABLE IF NOT EXISTS platform_observability_alerts (
    id                  SERIAL PRIMARY KEY,
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
    detected_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    acknowledged_am     TIMESTAMP,
    resolved_am         TIMESTAMP,
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_observability_alerts_severity
    ON platform_observability_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_platform_observability_alerts_agent
    ON platform_observability_alerts(agent_id);

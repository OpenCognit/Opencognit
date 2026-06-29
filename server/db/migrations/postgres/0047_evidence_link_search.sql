-- =============================================================================
-- Migration 0047: PR-SRCH-2 — Evidence Link Search
-- =============================================================================

CREATE TABLE IF NOT EXISTS search_evidence_packs (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    name            TEXT NOT NULL,
    purpose         TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_search_evidence_packs_company
    ON search_evidence_packs(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_search_evidence_packs_project
    ON search_evidence_packs(projekt_id);

CREATE TABLE IF NOT EXISTS search_evidence_pack_items (
    id                  SERIAL PRIMARY KEY,
    pack_id             TEXT NOT NULL,
    source_module       TEXT NOT NULL,
    source_record_id    TEXT NOT NULL,
    record_type         TEXT NOT NULL,
    title               TEXT NOT NULL,
    evidence_type       TEXT NOT NULL,
    hinzugefuegt_von    TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    hinzugefuegt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_search_evidence_pack_items_pack
    ON search_evidence_pack_items(pack_id);
CREATE INDEX IF NOT EXISTS idx_search_evidence_pack_items_source
    ON search_evidence_pack_items(source_module, source_record_id);

CREATE TABLE IF NOT EXISTS search_result_clicks (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    query_text      TEXT NOT NULL,
    clicked_record_id TEXT NOT NULL,
    position        INTEGER NOT NULL,
    clicked_am      TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_search_result_clicks_user
    ON search_result_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_search_result_clicks_query
    ON search_result_clicks(unternehmen_id, query_text);

CREATE TABLE IF NOT EXISTS search_agent_recommendations (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'P3',
    affected_query      TEXT,
    evidence            TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    link_incident_id    TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_search_agent_recommendations_status
    ON search_agent_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_search_agent_recommendations_agent
    ON search_agent_recommendations(agent_id);

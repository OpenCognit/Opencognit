-- =============================================================================
-- Migration 0049: PR-SRCH-4+5 — Search Agent + Analytics
-- =============================================================================

CREATE TABLE IF NOT EXISTS search_query_intents (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    user_id         TEXT,
    query_text      TEXT NOT NULL,
    detected_intent TEXT NOT NULL,
    confidence      REAL NOT NULL DEFAULT 0,
    resolved_params TEXT,
    result_summary  TEXT,
    evidence_count  INTEGER NOT NULL DEFAULT 0,
    recommended_action TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_query_intents_company
    ON search_query_intents(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_search_query_intents_user
    ON search_query_intents(user_id);

CREATE TABLE IF NOT EXISTS search_analytics_events (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    query_text      TEXT,
    affected_module TEXT,
    affected_record_id TEXT,
    detail_json     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_analytics_events_type
    ON search_analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_search_analytics_events_company
    ON search_analytics_events(unternehmen_id);

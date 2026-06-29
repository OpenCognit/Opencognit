-- =============================================================================
-- Migration 0046: PR-SRCH-1 — Universal Search Index Foundation (PostgreSQL)
-- =============================================================================

CREATE TABLE IF NOT EXISTS search_index_records (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    projekt_id          TEXT,
    source_module       TEXT NOT NULL,
    source_record_id    TEXT NOT NULL,
    record_type         TEXT NOT NULL,
    title               TEXT NOT NULL,
    search_text         TEXT NOT NULL,
    status              TEXT,
    owner_user_id       TEXT,
    visibility_scope    TEXT NOT NULL DEFAULT 'tenant',
    linked_record_count INTEGER NOT NULL DEFAULT 0,
    evidence_count      INTEGER NOT NULL DEFAULT 0,
    last_indexed_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    erstellt_am         TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_index_records_tenant
    ON search_index_records(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_search_index_records_project
    ON search_index_records(projekt_id);
CREATE INDEX IF NOT EXISTS idx_search_index_records_source
    ON search_index_records(source_module, source_record_id);
CREATE INDEX IF NOT EXISTS idx_search_index_records_type
    ON search_index_records(record_type);
CREATE INDEX IF NOT EXISTS idx_search_index_records_status
    ON search_index_records(status);

CREATE TABLE IF NOT EXISTS search_index_terms (
    id          SERIAL PRIMARY KEY,
    record_id   TEXT NOT NULL,
    term        TEXT NOT NULL,
    frequency   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_search_index_terms_record
    ON search_index_terms(record_id);
CREATE INDEX IF NOT EXISTS idx_search_index_terms_term
    ON search_index_terms(term);

CREATE TABLE IF NOT EXISTS search_index_links (
    id              SERIAL PRIMARY KEY,
    record_id       TEXT NOT NULL,
    linked_record_id TEXT NOT NULL,
    link_type       TEXT NOT NULL,
    beschreibung    TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_index_links_record
    ON search_index_links(record_id);
CREATE INDEX IF NOT EXISTS idx_search_index_links_linked
    ON search_index_links(linked_record_id);

CREATE TABLE IF NOT EXISTS search_saved_queries (
    id              SERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    name            TEXT NOT NULL,
    query_text      TEXT NOT NULL,
    filters_json    TEXT,
    erstellt_am     TIMESTAMP NOT NULL DEFAULT NOW(),
    aktualisiert_am TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_saved_queries_user
    ON search_saved_queries(user_id);

CREATE TABLE IF NOT EXISTS search_recent_items (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    unternehmen_id   TEXT NOT NULL,
    source_module    TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    record_type      TEXT NOT NULL,
    title            TEXT NOT NULL,
    accessed_am      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_recent_items_user
    ON search_recent_items(user_id, unternehmen_id);

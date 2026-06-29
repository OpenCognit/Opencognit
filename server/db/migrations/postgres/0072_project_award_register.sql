-- =============================================================================
-- Migration 0072: PR-PAW-1 — Award Register + Contract Summary
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_awards (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    tender_id       TEXT NOT NULL,
    projekt_id      TEXT,
    client_id       TEXT,
    award_date      TEXT NOT NULL,
    contract_sum    DOUBLE PRECISION NOT NULL,
    contract_currency TEXT DEFAULT 'KES',
    commencement_date TEXT,
    completion_date TEXT,
    contract_duration_days INTEGER,
    award_status    TEXT NOT NULL DEFAULT 'pending_review',
    accepted_am     TEXT,
    accepted_by     TEXT,
    award_document_url TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_project_awards_company
    ON project_awards(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_project_awards_tender
    ON project_awards(tender_id);
CREATE INDEX IF NOT EXISTS idx_project_awards_status
    ON project_awards(award_status);

CREATE TABLE IF NOT EXISTS award_documents (
    id              SERIAL PRIMARY KEY,
    award_id        TEXT NOT NULL,
    document_type   TEXT NOT NULL,
    title           TEXT NOT NULL,
    file_url        TEXT,
    received_am     TEXT,
    reviewed        INTEGER NOT NULL DEFAULT 0,
    reviewed_by     TEXT,
    reviewed_am     TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_award_documents_award
    ON award_documents(award_id);

CREATE TABLE IF NOT EXISTS contract_condition_summaries (
    id              SERIAL PRIMARY KEY,
    award_id        TEXT NOT NULL,
    condition_type  TEXT NOT NULL,
    summary         TEXT NOT NULL,
    deviation_from_tender INTEGER DEFAULT 0,
    risk_level      TEXT DEFAULT 'low',
    notes           TEXT,
    captured_by     TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_contract_condition_summaries_award
    ON contract_condition_summaries(award_id);
CREATE INDEX IF NOT EXISTS idx_contract_condition_summaries_type
    ON contract_condition_summaries(condition_type);

CREATE TABLE IF NOT EXISTS post_award_reviews (
    id              SERIAL PRIMARY KEY,
    award_id        TEXT NOT NULL,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'project_manager',
    review_type     TEXT NOT NULL DEFAULT 'general',
    findings        TEXT,
    recommended_action TEXT,
    decision        TEXT NOT NULL DEFAULT 'pending',
    reviewed_am     TEXT NOT NULL DEFAULT (NOW()),
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_post_award_reviews_award
    ON post_award_reviews(award_id);

CREATE TABLE IF NOT EXISTS post_award_agent_recommendations (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    agent_id        TEXT,
    award_id        TEXT,
    issue           TEXT NOT NULL,
    risk_level      TEXT NOT NULL DEFAULT 'medium',
    evidence        TEXT,
    recommended_action TEXT NOT NULL,
    owner           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending_review',
    detected_am     TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_post_award_agent_recs_company
    ON post_award_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_post_award_agent_recs_award
    ON post_award_agent_recommendations(award_id);

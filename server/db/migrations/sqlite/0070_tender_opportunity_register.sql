-- =============================================================================
-- Migration 0070: PR-TDR-1 — Tender Opportunity Register
-- =============================================================================

CREATE TABLE IF NOT EXISTS tender_opportunities (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    title           TEXT NOT NULL,
    client_id       TEXT,
    client_name     TEXT,
    source          TEXT NOT NULL DEFAULT 'portal',
    source_url      TEXT,
    description     TEXT,
    project_location TEXT,
    estimated_value REAL,
    currency        TEXT DEFAULT 'KES',
    deadline_am     TEXT NOT NULL,
    prequalification_required INTEGER DEFAULT 0,
    bond_required   INTEGER DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'new',
    assigned_to     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tender_opportunities_company
    ON tender_opportunities(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_tender_opportunities_status
    ON tender_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_tender_opportunities_deadline
    ON tender_opportunities(deadline_am);

CREATE TABLE IF NOT EXISTS tender_records (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    opportunity_id  TEXT NOT NULL,
    tender_number   TEXT,
    employer_name   TEXT NOT NULL,
    employer_address TEXT,
    project_name    TEXT NOT NULL,
    project_location TEXT,
    deadline_am     TEXT NOT NULL,
    submission_type TEXT NOT NULL DEFAULT 'physical',
    bid_bond_amount REAL,
    bid_bond_required INTEGER DEFAULT 0,
    nca_classification TEXT,
    status          TEXT NOT NULL DEFAULT 'registered',
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tender_records_opportunity
    ON tender_records(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_tender_records_status
    ON tender_records(status);

CREATE TABLE IF NOT EXISTS tender_bid_no_bid_reviews (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    opportunity_id  TEXT,
    tender_id       TEXT,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'bid_manager',
    client_quality  TEXT,
    project_location_score TEXT,
    contract_size   REAL,
    margin_potential TEXT,
    cashflow_risk   TEXT,
    security_risk   TEXT,
    technical_capability TEXT,
    resource_availability TEXT,
    bond_requirement TEXT,
    payment_terms   TEXT,
    competition_level TEXT,
    strategic_value  TEXT,
    past_client_behaviour TEXT,
    overall_score   INTEGER,
    decision        TEXT NOT NULL DEFAULT 'pending',
    decision_reason TEXT,
    approved_by     TEXT,
    approved_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tender_bid_no_bid_opportunity
    ON tender_bid_no_bid_reviews(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_tender_bid_no_bid_tender
    ON tender_bid_no_bid_reviews(tender_id);

CREATE TABLE IF NOT EXISTS tender_team_assignments (
    id              TEXT PRIMARY KEY NOT NULL,
    tender_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    rolle           TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tender_team_assignments_tender
    ON tender_team_assignments(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_team_assignments_user
    ON tender_team_assignments(user_id);

CREATE TABLE IF NOT EXISTS tender_agent_recommendations (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    agent_id        TEXT,
    tender_id       TEXT,
    opportunity_id  TEXT,
    issue           TEXT NOT NULL,
    risk_level      TEXT NOT NULL DEFAULT 'medium',
    evidence        TEXT,
    recommended_action TEXT NOT NULL,
    owner           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending_review',
    detected_am     TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tender_agent_recs_company
    ON tender_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_tender_agent_recs_tender
    ON tender_agent_recommendations(tender_id);

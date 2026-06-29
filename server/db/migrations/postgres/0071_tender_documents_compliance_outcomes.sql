-- =============================================================================
-- Migration 0071: PR-TDR-2+3+4+5 — Documents, Compliance, Submission, Outcomes
-- =============================================================================

CREATE TABLE IF NOT EXISTS tender_documents (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    document_type   TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    file_url        TEXT,
    version         INTEGER DEFAULT 1,
    issued_am       TEXT,
    acknowledged    INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_am TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_documents_tender
    ON tender_documents(tender_id);

CREATE TABLE IF NOT EXISTS tender_addenda (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    addendum_number INTEGER NOT NULL,
    title           TEXT NOT NULL,
    issued_am       TEXT NOT NULL,
    description     TEXT,
    affected_documents TEXT,
    pricing_impact  INTEGER DEFAULT 0,
    programme_impact INTEGER DEFAULT 0,
    technical_impact INTEGER DEFAULT 0,
    acknowledged    INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_am TEXT,
    review_status   TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_addenda_tender
    ON tender_addenda(tender_id);

CREATE TABLE IF NOT EXISTS tender_clarifications (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    question        TEXT NOT NULL,
    asked_by        TEXT NOT NULL,
    asked_am        TEXT NOT NULL DEFAULT (NOW()),
    answer          TEXT,
    answered_by     TEXT,
    answered_am     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_clarifications_tender
    ON tender_clarifications(tender_id);

CREATE TABLE IF NOT EXISTS tender_compliance_requirements (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    requirement     TEXT NOT NULL,
    source_document TEXT,
    section_reference TEXT,
    mandatory       INTEGER NOT NULL DEFAULT 1,
    owner           TEXT NOT NULL,
    due_date        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    evidence_attached INTEGER DEFAULT 0,
    evidence_url    TEXT,
    reviewed_by     TEXT,
    reviewed_am     TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_compliance_reqs_tender
    ON tender_compliance_requirements(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_compliance_reqs_status
    ON tender_compliance_requirements(status);
CREATE INDEX IF NOT EXISTS idx_tender_compliance_reqs_mandatory
    ON tender_compliance_requirements(mandatory);

CREATE TABLE IF NOT EXISTS tender_submission_checklists (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    item            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general',
    checked         INTEGER NOT NULL DEFAULT 0,
    checked_by      TEXT,
    checked_am      TEXT,
    notes           TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_submission_checklists_tender
    ON tender_submission_checklists(tender_id);

CREATE TABLE IF NOT EXISTS tender_submission_evidence (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    evidence_type   TEXT NOT NULL,
    description     TEXT,
    file_url        TEXT,
    submitted_by    TEXT NOT NULL,
    submitted_am    TEXT NOT NULL DEFAULT (NOW()),
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_submission_evidence_tender
    ON tender_submission_evidence(tender_id);

CREATE TABLE IF NOT EXISTS tender_approval_reviews (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'executive',
    stage           TEXT NOT NULL DEFAULT 'final',
    decision        TEXT NOT NULL DEFAULT 'pending',
    comments        TEXT,
    reviewed_am     TEXT NOT NULL DEFAULT (NOW()),
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_approval_reviews_tender
    ON tender_approval_reviews(tender_id);

CREATE TABLE IF NOT EXISTS tender_outcomes (
    id              SERIAL PRIMARY KEY,
    tender_id       TEXT NOT NULL,
    result          TEXT NOT NULL DEFAULT 'pending',
    contract_value  DOUBLE PRECISION,
    announced_am    TEXT,
    lessons_learned TEXT,
    knowledge_vault_url TEXT,
    recorded_by     TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_tender_outcomes_tender
    ON tender_outcomes(tender_id);

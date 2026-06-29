-- =============================================================================
-- Migration 0079: PR-VND-1 — Vendor Register + Qualification Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS vendors (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    vendor_name         TEXT NOT NULL,
    vendor_type         TEXT NOT NULL DEFAULT 'material_supplier',
    registration_number TEXT,
    tax_id              TEXT,
    contact_person      TEXT,
    contact_phone       TEXT,
    contact_email       TEXT,
    physical_address    TEXT,
    postal_address      TEXT,
    website             TEXT,
    year_established    INTEGER,
    employee_count      INTEGER,
    annual_turnover     DOUBLE PRECISION,
    bank_name           TEXT,
    bank_account_number TEXT,
    bank_branch         TEXT,
    swift_code          TEXT,
    currency            TEXT DEFAULT 'KES',
    payment_terms       TEXT,
    credit_limit        DOUBLE PRECISION,
    insurance_expiry    TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    registered_by       TEXT,
    registered_am       TEXT NOT NULL DEFAULT (NOW()),
    approved_by         TEXT,
    approved_am         TEXT,
    rejection_reason    TEXT,
    blocked_reason      TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_type ON vendors(vendor_type);

CREATE TABLE IF NOT EXISTS vendor_contacts (
    id                  SERIAL PRIMARY KEY,
    vendor_id           TEXT NOT NULL,
    contact_name        TEXT NOT NULL,
    position            TEXT,
    department          TEXT,
    phone               TEXT,
    email               TEXT,
    is_primary          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor
    ON vendor_contacts(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_categories (
    id                  SERIAL PRIMARY KEY,
    vendor_id           TEXT NOT NULL,
    category            TEXT NOT NULL,
    subcategory         TEXT,
    trade_license       TEXT,
    trade_license_expiry TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_categories_vendor
    ON vendor_categories(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_compliance_documents (
    id                  SERIAL PRIMARY KEY,
    vendor_id           TEXT NOT NULL,
    document_type       TEXT NOT NULL,
    document_ref        TEXT,
    issued_by           TEXT,
    issued_date         TEXT,
    expiry_date         TEXT,
    file_path           TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified',
    verified_by         TEXT,
    verified_am         TEXT,
    notes               TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_compliance_docs_vendor
    ON vendor_compliance_documents(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_compliance_docs_expiry
    ON vendor_compliance_documents(expiry_date);

CREATE TABLE IF NOT EXISTS vendor_approvals (
    id                  SERIAL PRIMARY KEY,
    vendor_id           TEXT NOT NULL,
    approved_by         TEXT NOT NULL,
    rolle               TEXT NOT NULL DEFAULT 'procurement',
    decision            TEXT NOT NULL DEFAULT 'pending',
    comments            TEXT,
    approved_am         TEXT NOT NULL DEFAULT (NOW()),
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_approvals_vendor
    ON vendor_approvals(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_agent_recommendations (
    id                  SERIAL PRIMARY KEY,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    vendor_id           TEXT NOT NULL,
    issue               TEXT NOT NULL,
    evidence            TEXT,
    risk_level          TEXT NOT NULL DEFAULT 'medium',
    recommended_action  TEXT NOT NULL,
    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (NOW()),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_vendor_agent_recs_vendor
    ON vendor_agent_recommendations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_agent_recs_status
    ON vendor_agent_recommendations(status);

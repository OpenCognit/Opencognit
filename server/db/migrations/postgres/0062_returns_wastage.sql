-- =============================================================================
-- Migration 0062: PR-STO-3 — Returns, Wastage + Damage
-- =============================================================================

CREATE TABLE IF NOT EXISTS material_returns (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    issue_note_id   TEXT,
    work_pack_id    TEXT,
    stock_item_id   TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    menge           DOUBLE PRECISION NOT NULL,
    reason          TEXT NOT NULL DEFAULT 'excess',
    condition       TEXT DEFAULT 'good',
    returned_to      TEXT NOT NULL,
    returned_by      TEXT NOT NULL,
    datum            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'received',
    erstellt_am      TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am  TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_material_returns_company
    ON material_returns(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_material_returns_issue
    ON material_returns(issue_note_id);
CREATE INDEX IF NOT EXISTS idx_material_returns_stock_item
    ON material_returns(stock_item_id);

CREATE TABLE IF NOT EXISTS material_wastage_records (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    stock_item_id   TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    menge           DOUBLE PRECISION NOT NULL,
    wastage_type    TEXT NOT NULL DEFAULT 'normal_waste',
    reason          TEXT NOT NULL,
    value_kes       DOUBLE PRECISION DEFAULT 0,
    work_pack_id    TEXT,
    boq_item_id     TEXT,
    activity_id     TEXT,
    foreman_id      TEXT,
    reported_by     TEXT NOT NULL,
    evidence         TEXT,
    approved_by_foreman INTEGER NOT NULL DEFAULT 0,
    approved_by_pm  INTEGER NOT NULL DEFAULT 0,
    foreman_approved_am TEXT,
    pm_approved_am  TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_material_wastage_company
    ON material_wastage_records(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_material_wastage_type
    ON material_wastage_records(wastage_type);
CREATE INDEX IF NOT EXISTS idx_material_wastage_status
    ON material_wastage_records(status);

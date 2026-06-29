-- =============================================================================
-- Migration 0061: PR-STO-2 — Material Request + Issue Workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS material_requests (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    work_pack_id    TEXT,
    requested_by    TEXT NOT NULL,
    requested_for   TEXT,
    datum           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    approved_by     TEXT,
    approved_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_material_requests_company
    ON material_requests(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_work_pack
    ON material_requests(work_pack_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_status
    ON material_requests(status);

CREATE TABLE IF NOT EXISTS material_request_items (
    id              TEXT PRIMARY KEY NOT NULL,
    request_id      TEXT NOT NULL,
    material_id     TEXT,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    requested_qty   REAL NOT NULL,
    approved_qty    REAL,
    issued_qty      REAL NOT NULL DEFAULT 0,
    boq_item_id     TEXT,
    activity_id     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_material_request_items_request
    ON material_request_items(request_id);

CREATE TABLE IF NOT EXISTS material_issue_notes (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    request_id      TEXT,
    work_pack_id    TEXT,
    store_location_id TEXT NOT NULL,
    issued_to        TEXT NOT NULL,
    issued_by        TEXT NOT NULL,
    datum            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'issued',
    erstellt_am      TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_material_issue_notes_company
    ON material_issue_notes(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_material_issue_notes_request
    ON material_issue_notes(request_id);
CREATE INDEX IF NOT EXISTS idx_material_issue_notes_work_pack
    ON material_issue_notes(work_pack_id);

CREATE TABLE IF NOT EXISTS material_issue_items (
    id              TEXT PRIMARY KEY NOT NULL,
    issue_note_id   TEXT NOT NULL,
    request_item_id TEXT,
    stock_item_id   TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    menge           REAL NOT NULL,
    boq_item_id     TEXT,
    activity_id     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_material_issue_items_issue
    ON material_issue_items(issue_note_id);

CREATE TABLE IF NOT EXISTS stock_reservations (
    id              TEXT PRIMARY KEY NOT NULL,
    stock_item_id   TEXT NOT NULL,
    request_item_id TEXT,
    work_pack_id    TEXT,
    menge           REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    reserved_am     TEXT NOT NULL DEFAULT (datetime('now')),
    released_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_stock_item
    ON stock_reservations(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_work_pack
    ON stock_reservations(work_pack_id);

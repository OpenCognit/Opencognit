-- =============================================================================
-- Migration 0060: PR-STO-1 — Stock Ledger + Store Location Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS store_locations (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    name            TEXT NOT NULL,
    location_type   TEXT NOT NULL DEFAULT 'main_store',
    beschreibung    TEXT,
    ist_aktiv       INTEGER NOT NULL DEFAULT 1,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_store_locations_company
    ON store_locations(unternehmen_id);

CREATE TABLE IF NOT EXISTS stock_items (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    store_location_id TEXT NOT NULL,
    material_id     TEXT,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    menge           DOUBLE PRECISION NOT NULL DEFAULT 0,
    aufgeteilt      DOUBLE PRECISION NOT NULL DEFAULT 0,
    verfuegbar      DOUBLE PRECISION NOT NULL DEFAULT 0,
    min_level       DOUBLE PRECISION,
    reorder_level   DOUBLE PRECISION,
    batch_number     TEXT,
    expiry_date      TEXT,
    condition        TEXT DEFAULT 'good',
    last_stocktake_am TEXT,
    erstellt_am      TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am  TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stock_items_location
    ON stock_items(store_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_company
    ON stock_items(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_material
    ON stock_items(material_id);

CREATE TABLE IF NOT EXISTS stock_ledger_transactions (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    stock_item_id   TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    menge           DOUBLE PRECISION NOT NULL,
    balance_after   DOUBLE PRECISION NOT NULL,
    reference_id    TEXT,
    reference_type  TEXT,
    activity_id     TEXT,
    work_pack_id    TEXT,
    boq_item_id     TEXT,
    benutzer_id     TEXT,
    from_location   TEXT,
    to_location     TEXT,
    beschreibung    TEXT,
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_stock_item
    ON stock_ledger_transactions(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_type
    ON stock_ledger_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_work_pack
    ON stock_ledger_transactions(work_pack_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_reference
    ON stock_ledger_transactions(reference_id);

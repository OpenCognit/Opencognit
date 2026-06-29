-- =============================================================================
-- Migration 0063: PR-STO-4 — Stocktake + Adjustment Approval
-- =============================================================================

CREATE TABLE IF NOT EXISTS stocktake_batches (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    store_location_id TEXT NOT NULL,
    scheduled_date  TEXT NOT NULL,
    counted_by      TEXT NOT NULL,
    verified_by     TEXT,
    status          TEXT NOT NULL DEFAULT 'scheduled',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stocktake_batches_company
    ON stocktake_batches(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_batches_location
    ON stocktake_batches(store_location_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_batches_status
    ON stocktake_batches(status);

CREATE TABLE IF NOT EXISTS stocktake_lines (
    id              SERIAL PRIMARY KEY,
    batch_id        TEXT NOT NULL,
    stock_item_id   TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    system_qty      DOUBLE PRECISION NOT NULL,
    counted_qty     DOUBLE PRECISION NOT NULL,
    variance_qty    DOUBLE PRECISION NOT NULL,
    variance_reason TEXT,
    status          TEXT NOT NULL DEFAULT 'counted',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stocktake_lines_batch
    ON stocktake_lines(batch_id);

CREATE TABLE IF NOT EXISTS stock_adjustment_requests (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    stocktake_batch_id TEXT,
    stocktake_line_id TEXT,
    stock_item_id   TEXT NOT NULL,
    adjustment_qty  DOUBLE PRECISION NOT NULL,
    reason          TEXT NOT NULL,
    reason_category TEXT NOT NULL DEFAULT 'counting_error',
    requested_by    TEXT NOT NULL,
    approved_by     TEXT,
    approved_am     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_requests_company
    ON stock_adjustment_requests(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_requests_status
    ON stock_adjustment_requests(status);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_requests_stock_item
    ON stock_adjustment_requests(stock_item_id);

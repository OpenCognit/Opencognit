-- =============================================================================
-- Migration 0051: PR-EST-2 — Rate Build-Up Engine
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimate_material_components (
    id              SERIAL PRIMARY KEY,
    boq_item_id     TEXT NOT NULL,
    material_name   TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    menge_pro_einheit DOUBLE PRECISION NOT NULL DEFAULT 1,
    einheitspreis   DOUBLE PRECISION NOT NULL DEFAULT 0,
    zeilenpreis     DOUBLE PRECISION NOT NULL DEFAULT 0,
    wastage_pct     DOUBLE PRECISION NOT NULL DEFAULT 0,
    quote_ref        TEXT,
    quote_id         TEXT,
    vendor_id        TEXT,
    source           TEXT DEFAULT 'manual',
    sort_order       INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am  TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_estimate_mat_components_item
    ON estimate_material_components(boq_item_id);

CREATE TABLE IF NOT EXISTS estimate_labour_components (
    id              SERIAL PRIMARY KEY,
    boq_item_id     TEXT NOT NULL,
    trade_name      TEXT NOT NULL,
    einheit         TEXT NOT NULL DEFAULT 'day',
    menge_pro_einheit DOUBLE PRECISION NOT NULL DEFAULT 1,
    output_pro_tag  DOUBLE PRECISION,
    labour_days     DOUBLE PRECISION NOT NULL DEFAULT 1,
    tagessatz       DOUBLE PRECISION NOT NULL DEFAULT 0,
    zeilenpreis     DOUBLE PRECISION NOT NULL DEFAULT 0,
    crew_size       INTEGER DEFAULT 1,
    productivity_benchmark_id TEXT,
    source          TEXT DEFAULT 'manual',
    sort_order       INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am  TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_estimate_labour_components_item
    ON estimate_labour_components(boq_item_id);

CREATE TABLE IF NOT EXISTS estimate_equipment_components (
    id              SERIAL PRIMARY KEY,
    boq_item_id     TEXT NOT NULL,
    equipment_name  TEXT NOT NULL,
    einheit         TEXT NOT NULL DEFAULT 'day',
    menge_pro_einheit DOUBLE PRECISION NOT NULL DEFAULT 1,
    stundensatz     DOUBLE PRECISION NOT NULL DEFAULT 0,
    stunden_pro_tag DOUBLE PRECISION DEFAULT 8,
    equipment_days  DOUBLE PRECISION NOT NULL DEFAULT 1,
    zeilenpreis     DOUBLE PRECISION NOT NULL DEFAULT 0,
    source          TEXT DEFAULT 'manual',
    sort_order       INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am  TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_estimate_equip_components_item
    ON estimate_equipment_components(boq_item_id);

CREATE TABLE IF NOT EXISTS estimate_subcontract_components (
    id              SERIAL PRIMARY KEY,
    boq_item_id     TEXT NOT NULL,
    scope           TEXT NOT NULL,
    einheit         TEXT NOT NULL,
    menge_pro_einheit DOUBLE PRECISION NOT NULL DEFAULT 1,
    einheitspreis   DOUBLE PRECISION NOT NULL DEFAULT 0,
    zeilenpreis     DOUBLE PRECISION NOT NULL DEFAULT 0,
    subcontractor_id TEXT,
    quote_ref        TEXT,
    quote_id         TEXT,
    exclusions      TEXT,
    risk_flag       TEXT,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am  TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_estimate_sub_components_item
    ON estimate_subcontract_components(boq_item_id);

CREATE TABLE IF NOT EXISTS estimate_rate_summaries (
    id                  SERIAL PRIMARY KEY,
    boq_item_id         TEXT NOT NULL UNIQUE,
    material_total      DOUBLE PRECISION NOT NULL DEFAULT 0,
    labour_total        DOUBLE PRECISION NOT NULL DEFAULT 0,
    equipment_total     DOUBLE PRECISION NOT NULL DEFAULT 0,
    subcontract_total   DOUBLE PRECISION NOT NULL DEFAULT 0,
    subtotal            DOUBLE PRECISION NOT NULL DEFAULT 0,
    overhead_pct        DOUBLE PRECISION NOT NULL DEFAULT 0,
    overhead_amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
    profit_pct          DOUBLE PRECISION NOT NULL DEFAULT 0,
    profit_amount       DOUBLE PRECISION NOT NULL DEFAULT 0,
    risk_allowance_pct  DOUBLE PRECISION NOT NULL DEFAULT 0,
    risk_allowance_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    final_rate           DOUBLE PRECISION NOT NULL DEFAULT 0,
    final_amount         DOUBLE PRECISION NOT NULL DEFAULT 0,
    build_up_status      TEXT NOT NULL DEFAULT 'incomplete',
    assumption_notes     TEXT,
    erstellt_am          TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am      TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_estimate_rate_summaries_status
    ON estimate_rate_summaries(build_up_status);

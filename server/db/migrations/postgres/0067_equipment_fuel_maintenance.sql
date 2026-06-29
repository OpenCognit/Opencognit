-- =============================================================================
-- Migration 0067: PR-EQP-3+4+5 — Fuel, Maintenance + Intelligence Agent
-- =============================================================================

CREATE TABLE IF NOT EXISTS fuel_stores (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    projekt_id      TEXT,
    name            TEXT NOT NULL,
    location        TEXT NOT NULL,
    fuel_type       TEXT NOT NULL DEFAULT 'diesel',
    current_stock   DOUBLE PRECISION NOT NULL DEFAULT 0,
    capacity         DOUBLE PRECISION,
    min_level        DOUBLE PRECISION,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_fuel_stores_company
    ON fuel_stores(unternehmen_id);

CREATE TABLE IF NOT EXISTS fuel_issues (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    fuel_store_id   TEXT NOT NULL,
    equipment_id    TEXT NOT NULL,
    operator_id     TEXT,
    work_pack_id    TEXT,
    datum           TEXT NOT NULL,
    menge           DOUBLE PRECISION NOT NULL,
    meter_before    DOUBLE PRECISION,
    expected_consumption DOUBLE PRECISION,
    issued_by       TEXT NOT NULL,
    received_by     TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_fuel_issues_equipment
    ON fuel_issues(equipment_id);
CREATE INDEX IF NOT EXISTS idx_fuel_issues_date
    ON fuel_issues(datum);
CREATE INDEX IF NOT EXISTS idx_fuel_issues_store
    ON fuel_issues(fuel_store_id);

CREATE TABLE IF NOT EXISTS fuel_reconciliations (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    fuel_store_id   TEXT NOT NULL,
    datum           TEXT NOT NULL,
    opening_stock   DOUBLE PRECISION NOT NULL,
    received        DOUBLE PRECISION NOT NULL DEFAULT 0,
    issued          DOUBLE PRECISION NOT NULL DEFAULT 0,
    expected_closing DOUBLE PRECISION NOT NULL,
    actual_closing  DOUBLE PRECISION NOT NULL,
    variance        DOUBLE PRECISION NOT NULL,
    explanation     TEXT,
    reconciled_by   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_fuel_reconciliations_store
    ON fuel_reconciliations(fuel_store_id);
CREATE INDEX IF NOT EXISTS idx_fuel_reconciliations_date
    ON fuel_reconciliations(datum);

CREATE TABLE IF NOT EXISTS equipment_maintenance_schedules (
    id              SERIAL PRIMARY KEY,
    equipment_id    TEXT NOT NULL,
    service_type    TEXT NOT NULL DEFAULT 'routine',
    interval_hours  INTEGER,
    interval_days   INTEGER,
    last_service_am TEXT,
    next_service_am TEXT,
    last_service_meter DOUBLE PRECISION,
    next_service_meter DOUBLE PRECISION,
    status          TEXT NOT NULL DEFAULT 'active',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_schedules_equipment
    ON equipment_maintenance_schedules(equipment_id);

CREATE TABLE IF NOT EXISTS equipment_maintenance_records (
    id              SERIAL PRIMARY KEY,
    equipment_id    TEXT NOT NULL,
    schedule_id     TEXT,
    service_type    TEXT NOT NULL,
    datum           TEXT NOT NULL,
    meter_am        DOUBLE PRECISION,
    beschreibung    TEXT,
    parts_used      TEXT,
    cost_kes        DOUBLE PRECISION DEFAULT 0,
    serviced_by     TEXT NOT NULL,
    next_service_recommendation TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_records_equipment
    ON equipment_maintenance_records(equipment_id);

CREATE TABLE IF NOT EXISTS equipment_breakdowns (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    equipment_id    TEXT NOT NULL,
    projekt_id      TEXT,
    operator_id     TEXT,
    reported_by     TEXT NOT NULL,
    reported_am     TEXT NOT NULL DEFAULT (NOW()),
    fault_description TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'medium',
    equipment_stopped INTEGER NOT NULL DEFAULT 1,
    repair_action   TEXT,
    parts_used      TEXT,
    cost_kes        DOUBLE PRECISION DEFAULT 0,
    downtime_hours  DOUBLE PRECISION,
    returned_to_service_am TEXT,
    returned_by     TEXT,
    status          TEXT NOT NULL DEFAULT 'reported',
    erstellt_am     TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_equipment_breakdowns_equipment
    ON equipment_breakdowns(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_breakdowns_status
    ON equipment_breakdowns(status);

CREATE TABLE IF NOT EXISTS equipment_reviews (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    recommendation_id TEXT,
    breakdown_id    TEXT,
    reviewed_by     TEXT NOT NULL,
    rolle           TEXT NOT NULL DEFAULT 'plant_manager',
    decision        TEXT NOT NULL DEFAULT 'pending',
    comments        TEXT,
    reviewed_am     TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_equipment_reviews_company
    ON equipment_reviews(unternehmen_id);

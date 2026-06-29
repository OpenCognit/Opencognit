-- =============================================================================
-- Migration 0066: PR-EQP-2 — Daily Usage + Utilization Logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS equipment_usage_logs (
    id              SERIAL PRIMARY KEY,
    unternehmen_id  TEXT NOT NULL,
    equipment_id    TEXT NOT NULL,
    projekt_id      TEXT,
    work_pack_id    TEXT,
    activity_id     TEXT,
    operator_id     TEXT,
    datum           TEXT NOT NULL,
    start_meter     DOUBLE PRECISION,
    end_meter       DOUBLE PRECISION,
    hours_used      DOUBLE PRECISION NOT NULL DEFAULT 0,
    idle_hours      DOUBLE PRECISION NOT NULL DEFAULT 0,
    fuel_used       DOUBLE PRECISION,
    output_quantity DOUBLE PRECISION,
    output_unit     TEXT,
    location        TEXT,
    status          TEXT NOT NULL DEFAULT 'recorded',
    notes           TEXT,
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_equipment_usage_logs_equipment
    ON equipment_usage_logs(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_usage_logs_date
    ON equipment_usage_logs(datum);
CREATE INDEX IF NOT EXISTS idx_equipment_usage_logs_project
    ON equipment_usage_logs(projekt_id);
CREATE INDEX IF NOT EXISTS idx_equipment_usage_logs_work_pack
    ON equipment_usage_logs(work_pack_id);

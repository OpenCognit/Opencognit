-- =============================================================================
-- Migration 0065: PR-EQP-1 — Equipment Register + Allocation Backbone
-- =============================================================================

CREATE TABLE IF NOT EXISTS equipment_categories (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    class           TEXT NOT NULL DEFAULT 'light_equipment',
    typical_rate_per_day REAL,
    required_safety_check INTEGER NOT NULL DEFAULT 0,
    fuel_required    INTEGER NOT NULL DEFAULT 0,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_categories_class
    ON equipment_categories(class);

INSERT OR IGNORE INTO equipment_categories (id, name, class, required_safety_check, fuel_required) VALUES
    ('cat_excavator', 'Excavator', 'heavy_plant', 1, 1),
    ('cat_roller', 'Roller', 'heavy_plant', 1, 1),
    ('cat_grader', 'Grader', 'heavy_plant', 1, 1),
    ('cat_bulldozer', 'Bulldozer', 'heavy_plant', 1, 1),
    ('cat_loader', 'Front Loader', 'heavy_plant', 1, 1),
    ('cat_tipper', 'Tipper Truck', 'vehicles', 1, 1),
    ('cat_pickup', 'Pickup', 'vehicles', 1, 1),
    ('cat_truck', 'Truck', 'vehicles', 1, 1),
    ('cat_mixer', 'Concrete Mixer', 'light_equipment', 0, 1),
    ('cat_vibrator', 'Poker Vibrator', 'light_equipment', 0, 1),
    ('cat_generator', 'Generator', 'light_equipment', 0, 1),
    ('cat_pump', 'Water Pump', 'light_equipment', 0, 1),
    ('cat_crane', 'Crane', 'lifting_equipment', 1, 1),
    ('cat_compactor', 'Plate Compactor', 'light_equipment', 0, 1),
    ('cat_scaffold', 'Scaffold', 'temporary_works', 1, 0),
    ('cat_total_station', 'Total Station', 'survey_equipment', 0, 0),
    ('cat_welding', 'Welding Machine', 'workshop_equipment', 0, 1),
    ('cat_drill', 'Drill Machine', 'small_tools', 0, 1),
    ('cat_grinder', 'Angle Grinder', 'small_tools', 0, 1),
    ('cat_water_bowser', 'Water Bowser', 'vehicles', 1, 1);

CREATE TABLE IF NOT EXISTS equipment_assets (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    category_id     TEXT NOT NULL,
    asset_code      TEXT NOT NULL,
    make            TEXT,
    model           TEXT,
    year            INTEGER,
    serial_number   TEXT,
    ownership       TEXT NOT NULL DEFAULT 'owned',
    status          TEXT NOT NULL DEFAULT 'available',
    last_maintenance_am TEXT,
    next_maintenance_am TEXT,
    meter_reading   REAL DEFAULT 0,
    meter_unit      TEXT DEFAULT 'hours',
    hire_rate_per_day REAL,
    base_location    TEXT,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_assets_company
    ON equipment_assets(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assets_category
    ON equipment_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_assets_status
    ON equipment_assets(status);

CREATE TABLE IF NOT EXISTS equipment_allocations (
    id              TEXT PRIMARY KEY NOT NULL,
    unternehmen_id  TEXT NOT NULL,
    equipment_id    TEXT NOT NULL,
    projekt_id      TEXT NOT NULL,
    work_pack_id    TEXT,
    allocated_am    TEXT NOT NULL DEFAULT (datetime('now')),
    released_am     TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_allocations_equipment
    ON equipment_allocations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_allocations_project
    ON equipment_allocations(projekt_id);
CREATE INDEX IF NOT EXISTS idx_equipment_allocations_status
    ON equipment_allocations(status);

CREATE TABLE IF NOT EXISTS equipment_operator_assignments (
    id              TEXT PRIMARY KEY NOT NULL,
    equipment_id    TEXT NOT NULL,
    operator_id     TEXT NOT NULL,
    assigned_am     TEXT NOT NULL DEFAULT (datetime('now')),
    released_am     TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    erstellt_von    TEXT NOT NULL,
    erstellt_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_operator_assignments_equipment
    ON equipment_operator_assignments(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_operator_assignments_operator
    ON equipment_operator_assignments(operator_id);

CREATE TABLE IF NOT EXISTS equipment_agent_recommendations (
    id                  TEXT PRIMARY KEY NOT NULL,
    unternehmen_id      TEXT NOT NULL,
    agent_id            TEXT,
    issue               TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'medium',
    equipment_id        TEXT,
    projekt_id          TEXT,
    evidence            TEXT,
    recommended_action  TEXT,
    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_review',
    detected_am         TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_am         TEXT,
    erstellt_am         TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_agent_recs_company
    ON equipment_agent_recommendations(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_equipment_agent_recs_status
    ON equipment_agent_recommendations(status);

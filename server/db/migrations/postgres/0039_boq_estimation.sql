-- Migration 0039: G-003 BOQ / Estimation Schema Foundation (PostgreSQL)
-- Domain: Construction costing — bill of quantities, estimation, rates, measurements, price data
-- Classification: Greenfield schema introduction (not migration consolidation)
-- ADR: ADR-0039-BOQ-ESTIMATION-SCHEMA
-- IC: IC-0039-BOQ-ESTIMATION-SCHEMA
-- Baseline: 27d5d27 (origin/main)

-- ─── 1. boq_projects ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boq_projects (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  projekt_id TEXT REFERENCES projekte(id),
  name TEXT NOT NULL,
  revision TEXT NOT NULL DEFAULT 'A',
  status TEXT NOT NULL DEFAULT 'draft',
  beschreibung TEXT,
  gesamt_betrag_cent INTEGER NOT NULL DEFAULT 0,
  waehrung TEXT NOT NULL DEFAULT 'KES',
  erstellt_von TEXT,
  genehmigt_von TEXT,
  genehmigt_am TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boq_projects_company ON boq_projects(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_boq_projects_project ON boq_projects(projekt_id);
CREATE INDEX IF NOT EXISTS idx_boq_projects_status ON boq_projects(unternehmen_id, status);

-- ─── 2. boq_sections ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boq_sections (
  id TEXT PRIMARY KEY,
  boq_project_id TEXT NOT NULL REFERENCES boq_projects(id),
  parent_section_id TEXT REFERENCES boq_sections(id),
  code TEXT NOT NULL,
  titel TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boq_sections_project ON boq_sections(boq_project_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_parent ON boq_sections(parent_section_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_sort ON boq_sections(boq_project_id, sort_order);

-- ─── 3. boq_items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boq_items (
  id TEXT PRIMARY KEY,
  boq_section_id TEXT NOT NULL REFERENCES boq_sections(id),
  item_code TEXT,
  beschreibung TEXT NOT NULL,
  einheit TEXT NOT NULL,
  menge REAL NOT NULL DEFAULT 0,
  rate_cent INTEGER NOT NULL DEFAULT 0,
  betrag_cent INTEGER NOT NULL DEFAULT 0,
  waste_factor_pct REAL NOT NULL DEFAULT 10.0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  estimation_rate_id TEXT REFERENCES estimation_rates(id),
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boq_items_section ON boq_items(boq_section_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_sort ON boq_items(boq_section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_boq_items_rate ON boq_items(estimation_rate_id);

-- ─── 4. estimation_rates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimation_rates (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  beschreibung TEXT NOT NULL,
  einheit TEXT NOT NULL,
  material_cost_cent INTEGER NOT NULL DEFAULT 0,
  labour_cost_cent INTEGER NOT NULL DEFAULT 0,
  plant_cost_cent INTEGER NOT NULL DEFAULT 0,
  subcon_cost_cent INTEGER NOT NULL DEFAULT 0,
  overhead_pct REAL NOT NULL DEFAULT 15.0,
  profit_pct REAL NOT NULL DEFAULT 10.0,
  gesamt_rate_cent INTEGER NOT NULL DEFAULT 0,
  waehrung TEXT NOT NULL DEFAULT 'KES',
  quelle TEXT DEFAULT 'manual',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_estimation_rates_company ON estimation_rates(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_estimation_rates_effective ON estimation_rates(unternehmen_id, effective_from);

-- ─── 5. estimation_rate_breakdowns ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimation_rate_breakdowns (
  id TEXT PRIMARY KEY,
  estimation_rate_id TEXT NOT NULL REFERENCES estimation_rates(id),
  cost_type TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_unit TEXT NOT NULL,
  unit_cost_cent INTEGER NOT NULL DEFAULT 0,
  quantity_per_unit REAL NOT NULL DEFAULT 1.0,
  total_cent INTEGER NOT NULL DEFAULT 0,
  waste_pct REAL NOT NULL DEFAULT 5.0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_breakdowns_rate ON estimation_rate_breakdowns(estimation_rate_id);

-- ─── 6. measurement_sheets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS measurement_sheets (
  id TEXT PRIMARY KEY,
  boq_item_id TEXT NOT NULL REFERENCES boq_items(id),
  location_ref TEXT,
  dimension_l REAL,
  dimension_w REAL,
  dimension_h REAL,
  quantity REAL NOT NULL DEFAULT 0,
  formula TEXT,
  einheit TEXT NOT NULL,
  erfasst_von TEXT,
  erfasst_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_measurement_item ON measurement_sheets(boq_item_id);

-- ─── 7. price_data_sources ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_data_sources (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  region TEXT,
  waehrung TEXT NOT NULL DEFAULT 'KES',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  beschreibung TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_sources_company ON price_data_sources(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_price_sources_effective ON price_data_sources(unternehmen_id, effective_from);

-- ─── 8. price_data_entries ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_data_entries (
  id TEXT PRIMARY KEY,
  price_data_source_id TEXT NOT NULL REFERENCES price_data_sources(id),
  item_description TEXT NOT NULL,
  einheit TEXT NOT NULL,
  unit_price_cent INTEGER NOT NULL,
  supplier TEXT,
  date_observed TEXT NOT NULL,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_entries_source ON price_data_entries(price_data_source_id);

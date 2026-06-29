-- =============================================================================
-- Migration 0053: PR-EST-4 — Productivity + Historical Benchmark Comparison
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimate_productivity_assumptions (
    id                      TEXT PRIMARY KEY NOT NULL,
    boq_item_id             TEXT NOT NULL,
    activity_type           TEXT NOT NULL,
    einheit                 TEXT NOT NULL DEFAULT 'm²',
    assumed_output_per_day  REAL NOT NULL,
    crew_size               INTEGER NOT NULL DEFAULT 1,
    crew_composition        TEXT,
    benchmark_source        TEXT,
    benchmark_output        REAL,
    variance_pct            REAL,
    conditions_factor       REAL NOT NULL DEFAULT 1.0,
    conditions_notes        TEXT,
    erstellt_am             TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_est_productivity_assumptions_item
    ON estimate_productivity_assumptions(boq_item_id);

CREATE TABLE IF NOT EXISTS estimate_historical_comparisons (
    id                      TEXT PRIMARY KEY NOT NULL,
    estimate_id             TEXT NOT NULL,
    boq_item_id             TEXT,
    activity_type           TEXT NOT NULL,
    current_rate            REAL NOT NULL,
    historical_avg_rate     REAL NOT NULL,
    historical_min_rate     REAL,
    historical_max_rate     REAL,
    variance_pct            REAL NOT NULL,
    sample_count            INTEGER NOT NULL DEFAULT 1,
    data_source             TEXT,
    risk_level              TEXT NOT NULL DEFAULT 'low',
    recommended_adjustment  TEXT,
    erstellt_am             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_est_historical_comparisons_estimate
    ON estimate_historical_comparisons(estimate_id);
CREATE INDEX IF NOT EXISTS idx_est_historical_comparisons_item
    ON estimate_historical_comparisons(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_est_historical_comparisons_risk
    ON estimate_historical_comparisons(risk_level);

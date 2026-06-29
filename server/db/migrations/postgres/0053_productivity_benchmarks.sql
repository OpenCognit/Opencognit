-- =============================================================================
-- Migration 0053: PR-EST-4 — Productivity + Historical Benchmark Comparison
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimate_productivity_assumptions (
    id                      SERIAL PRIMARY KEY,
    boq_item_id             TEXT NOT NULL,
    activity_type           TEXT NOT NULL,
    einheit                 TEXT NOT NULL DEFAULT 'm²',
    assumed_output_per_day  DOUBLE PRECISION NOT NULL,
    crew_size               INTEGER NOT NULL DEFAULT 1,
    crew_composition        TEXT,
    benchmark_source        TEXT,
    benchmark_output        DOUBLE PRECISION,
    variance_pct            DOUBLE PRECISION,
    conditions_factor       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    conditions_notes        TEXT,
    erstellt_am             TEXT NOT NULL DEFAULT (NOW()),
    aktualisiert_am         TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_est_productivity_assumptions_item
    ON estimate_productivity_assumptions(boq_item_id);

CREATE TABLE IF NOT EXISTS estimate_historical_comparisons (
    id                      SERIAL PRIMARY KEY,
    estimate_id             TEXT NOT NULL,
    boq_item_id             TEXT,
    activity_type           TEXT NOT NULL,
    current_rate            DOUBLE PRECISION NOT NULL,
    historical_avg_rate     DOUBLE PRECISION NOT NULL,
    historical_min_rate     DOUBLE PRECISION,
    historical_max_rate     DOUBLE PRECISION,
    variance_pct            DOUBLE PRECISION NOT NULL,
    sample_count            INTEGER NOT NULL DEFAULT 1,
    data_source             TEXT,
    risk_level              TEXT NOT NULL DEFAULT 'low',
    recommended_adjustment  TEXT,
    erstellt_am             TEXT NOT NULL DEFAULT (NOW())
);

CREATE INDEX IF NOT EXISTS idx_est_historical_comparisons_estimate
    ON estimate_historical_comparisons(estimate_id);
CREATE INDEX IF NOT EXISTS idx_est_historical_comparisons_item
    ON estimate_historical_comparisons(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_est_historical_comparisons_risk
    ON estimate_historical_comparisons(risk_level);

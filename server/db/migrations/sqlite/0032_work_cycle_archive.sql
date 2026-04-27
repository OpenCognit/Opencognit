-- Migration 0032: Work Cycle Archive (aggregated stats before deletion)
-- Prevents data loss from cleanup while keeping the main table lean.

CREATE TABLE IF NOT EXISTS arbeitszyklen_archiv (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  archiv_datum TEXT NOT NULL,                    -- YYYY-MM-DD aggregation date
  zyklus_anzahl INTEGER NOT NULL DEFAULT 0,      -- how many cycles this day
  erfolgreich_anzahl INTEGER NOT NULL DEFAULT 0, -- succeeded count
  fehlgeschlagen_anzahl INTEGER NOT NULL DEFAULT 0,
  abgebrochen_anzahl INTEGER NOT NULL DEFAULT 0,
  durchschnitt_dauer_ms INTEGER NOT NULL DEFAULT 0,
  gesamt_input_tokens INTEGER NOT NULL DEFAULT 0,
  gesamt_output_tokens INTEGER NOT NULL DEFAULT 0,
  gesamt_kosten_cent INTEGER NOT NULL DEFAULT 0,
  modelle_json TEXT,                             -- JSON: { "claude-3-5": 12, "gpt-4": 3 }
  erstellt_am TEXT NOT NULL,
  UNIQUE(unternehmen_id, expert_id, archiv_datum)
);

CREATE INDEX IF NOT EXISTS archiv_unternehmen_datum_idx ON arbeitszyklen_archiv(unternehmen_id, archiv_datum);
CREATE INDEX IF NOT EXISTS archiv_expert_idx ON arbeitszyklen_archiv(expert_id, archiv_datum);

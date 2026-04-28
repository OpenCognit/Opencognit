-- Migration 0032: Work Cycle Archive (PostgreSQL)

CREATE TABLE IF NOT EXISTS arbeitszyklen_archiv (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  archiv_datum TEXT NOT NULL,
  zyklus_anzahl INTEGER NOT NULL DEFAULT 0,
  erfolgreich_anzahl INTEGER NOT NULL DEFAULT 0,
  fehlgeschlagen_anzahl INTEGER NOT NULL DEFAULT 0,
  abgebrochen_anzahl INTEGER NOT NULL DEFAULT 0,
  durchschnitt_dauer_ms INTEGER NOT NULL DEFAULT 0,
  gesamt_input_tokens INTEGER NOT NULL DEFAULT 0,
  gesamt_output_tokens INTEGER NOT NULL DEFAULT 0,
  gesamt_kosten_cent INTEGER NOT NULL DEFAULT 0,
  modelle_json TEXT,
  erstellt_am TEXT NOT NULL,
  UNIQUE(unternehmen_id, expert_id, archiv_datum)
);

CREATE INDEX IF NOT EXISTS archiv_unternehmen_datum_idx ON arbeitszyklen_archiv(unternehmen_id, archiv_datum);
CREATE INDEX IF NOT EXISTS archiv_expert_idx ON arbeitszyklen_archiv(expert_id, archiv_datum);

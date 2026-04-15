-- Migration 0019: Fix einstellungen table to use composite PRIMARY KEY (schluessel, unternehmen_id)
-- The schema.ts defines this composite PK but the original migration only created
-- a single-column PK on schluessel, causing ON CONFLICT upsert failures for
-- per-company settings. SQLite does not support ALTER TABLE ADD PRIMARY KEY,
-- so we recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE einstellungen_new (
  schluessel TEXT NOT NULL,
  unternehmen_id TEXT NOT NULL DEFAULT '',
  wert TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL,
  PRIMARY KEY (schluessel, unternehmen_id)
);

INSERT OR IGNORE INTO einstellungen_new (schluessel, unternehmen_id, wert, aktualisiert_am)
SELECT schluessel, unternehmen_id, wert, aktualisiert_am FROM einstellungen;

DROP TABLE einstellungen;
ALTER TABLE einstellungen_new RENAME TO einstellungen;

PRAGMA foreign_keys = ON;

-- Nativer Memory: Ersetzt den Python MCP-Server durch SQLite-Tabellen
-- Wings, Drawers, Diary (AAAK) und Knowledge Graph

CREATE TABLE IF NOT EXISTS palace_wings (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  expert_id TEXT NOT NULL REFERENCES experten(id),
  name TEXT NOT NULL,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_palace_wings_expert ON palace_wings(expert_id);

CREATE TABLE IF NOT EXISTS palace_drawers (
  id TEXT PRIMARY KEY,
  wing_id TEXT NOT NULL REFERENCES palace_wings(id),
  room TEXT NOT NULL,
  inhalt TEXT NOT NULL,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_palace_drawers_wing ON palace_drawers(wing_id);
CREATE INDEX IF NOT EXISTS idx_palace_drawers_room ON palace_drawers(wing_id, room);

CREATE TABLE IF NOT EXISTS palace_diary (
  id TEXT PRIMARY KEY,
  wing_id TEXT NOT NULL REFERENCES palace_wings(id),
  datum TEXT NOT NULL,
  thought TEXT,
  action TEXT,
  knowledge TEXT,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_palace_diary_wing ON palace_diary(wing_id);

CREATE TABLE IF NOT EXISTS palace_kg (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  erstellt_von TEXT,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_palace_kg_subject ON palace_kg(subject);
CREATE INDEX IF NOT EXISTS idx_palace_kg_company ON palace_kg(unternehmen_id);

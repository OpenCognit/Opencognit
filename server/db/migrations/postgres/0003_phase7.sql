-- Migration 0003 — Phase 7: Projects-Ebene + Agent Permissions

-- ===== Projekte =====
CREATE TABLE IF NOT EXISTS projekte (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  name TEXT NOT NULL,
  beschreibung TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',
  prioritaet TEXT NOT NULL DEFAULT 'medium',
  ziel_id TEXT REFERENCES ziele(id),
  eigentuemer_id TEXT REFERENCES experten(id),
  farbe TEXT NOT NULL DEFAULT '#23CDCB',
  deadline TEXT,
  fortschritt INTEGER NOT NULL DEFAULT 0,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projekte_unternehmen ON projekte(unternehmen_id, status);

-- ===== Agent Permissions =====
CREATE TABLE IF NOT EXISTS agent_permissions (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  darf_aufgaben_erstellen BOOLEAN NOT NULL DEFAULT TRUE,
  darf_aufgaben_zuweisen BOOLEAN NOT NULL DEFAULT FALSE,
  darf_genehmigungen_anfordern BOOLEAN NOT NULL DEFAULT TRUE,
  darf_genehmigungen_entscheiden BOOLEAN NOT NULL DEFAULT FALSE,
  darf_experten_anwerben BOOLEAN NOT NULL DEFAULT FALSE,
  budget_limit_cent INTEGER,
  erlaubte_pfade TEXT,
  erlaubte_domains TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL,
  UNIQUE(expert_id)
);

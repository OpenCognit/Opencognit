-- Migration 0003 — Phase 7: Projects-Ebene + Agent Permissions

-- ===== Projekte =====
-- Hierarchie: Unternehmen → Projekt → Aufgaben
CREATE TABLE IF NOT EXISTS projekte (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  name TEXT NOT NULL,
  beschreibung TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',     -- aktiv, pausiert, abgeschlossen, archiviert
  prioritaet TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  ziel_id TEXT REFERENCES ziele(id),         -- verknüpftes Unternehmensziel
  eigentuemer_id TEXT REFERENCES experten(id),
  farbe TEXT NOT NULL DEFAULT '#23CDCB',     -- für UI-Badges
  deadline TEXT,
  fortschritt INTEGER NOT NULL DEFAULT 0,   -- 0-100 Prozent
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projekte_unternehmen ON projekte(unternehmen_id, status);

-- ===== Agent Permissions =====
-- Feingranulare Steuerung was jeder Agent darf
CREATE TABLE IF NOT EXISTS agent_permissions (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  -- Aufgaben
  darf_aufgaben_erstellen INTEGER NOT NULL DEFAULT 1,
  darf_aufgaben_zuweisen INTEGER NOT NULL DEFAULT 0,
  -- Genehmigungen
  darf_genehmigungen_anfordern INTEGER NOT NULL DEFAULT 1,
  darf_genehmigungen_entscheiden INTEGER NOT NULL DEFAULT 0,
  -- Experten
  darf_experten_anwerben INTEGER NOT NULL DEFAULT 0,    -- Neueinstellungen beantragen
  -- Kosten
  budget_limit_cent INTEGER,                            -- NULL = kein eigenes Limit
  -- Dateisystem
  erlaubte_pfade TEXT,                                  -- JSON array, NULL = kein Dateizugriff
  -- Netzwerk
  erlaubte_domains TEXT,                                -- JSON array, NULL = kein HTTP
  -- Erstellt
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL,
  UNIQUE(expert_id)
);

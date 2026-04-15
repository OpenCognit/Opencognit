-- Migration 0005: Agent-Gedächtnis (PARA-Methode) + Verbindungstyp-Erweiterung
-- Fügt persistentes Langzeit-Gedächtnis für Agenten hinzu

-- Agent Gedächtnis Tabelle (PARA: Projects, Bereiche/Areas, Ressourcen, Archiv)
CREATE TABLE IF NOT EXISTS agent_gedaechtnis (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experten(id),
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  -- PARA-Struktur
  projekte TEXT,      -- Markdown: Aktuelle laufende Projekte und Initiativen
  bereiche TEXT,      -- Markdown: Dauerhafte Verantwortungsbereiche
  ressourcen TEXT,    -- Markdown: Nützliches Wissen, APIs, Konventionen
  archiv TEXT,        -- Markdown: Abgeschlossenes für Referenz
  -- Meta
  letzte_aktualisierung TEXT NOT NULL,
  erstellt_am TEXT NOT NULL
);

-- Index für schnellen Zugriff per Agent
CREATE INDEX IF NOT EXISTS idx_agent_gedaechtnis_expert
  ON agent_gedaechtnis(expert_id);

-- verbindungs_typ Enum erweitern: codex-cli und gemini-cli
-- SQLite unterstützt kein ALTER COLUMN für Enums — die Werte werden direkt als TEXT
-- gespeichert, der Enum-Check ist nur auf Drizzle-Ebene. Daher kein SQL nötig.
-- Die neuen Werte 'codex-cli' und 'gemini-cli' sind jetzt im Schema erlaubt.

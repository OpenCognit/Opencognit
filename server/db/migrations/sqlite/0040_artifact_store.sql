-- Migration 0040: PR2B-4 Artifact Store Implementation
-- Domain: Artifact storage — content-addressed file persistence with tenant isolation
-- Classification: Greenfield schema introduction
-- ADR: ADR-0040-ARTIFACT-STORE
-- IC: IC-0040-ARTIFACT-STORE
-- Baseline: 05c147e

CREATE TABLE IF NOT EXISTS artifact_store (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  projekt_id TEXT REFERENCES projekte(id),
  aufgabe_id TEXT REFERENCES aufgaben(id),
  expert_id TEXT REFERENCES experten(id),
  run_id TEXT REFERENCES arbeitszyklen(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  manifest_ref TEXT,
  manifest_version TEXT,
  source_ref TEXT,
  source_hash TEXT,
  retention_policy TEXT NOT NULL DEFAULT 'permanent',
  retention_ttl_days INTEGER,
  retain_until TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_store_company ON artifact_store(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_artifact_store_project ON artifact_store(projekt_id);
CREATE INDEX IF NOT EXISTS idx_artifact_store_task ON artifact_store(aufgabe_id);
CREATE INDEX IF NOT EXISTS idx_artifact_store_agent ON artifact_store(expert_id);
CREATE INDEX IF NOT EXISTS idx_artifact_store_status ON artifact_store(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS idx_artifact_store_checksum ON artifact_store(checksum_sha256);

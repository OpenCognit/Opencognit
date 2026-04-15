-- Migration 0016: Add unternehmen_id to einstellungen for per-company settings
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS unternehmen_id TEXT NOT NULL DEFAULT '';

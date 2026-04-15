-- Add unternehmen_id column to einstellungen table
-- Allows per-company settings (empty string = global setting)
ALTER TABLE einstellungen ADD COLUMN unternehmen_id TEXT NOT NULL DEFAULT '';

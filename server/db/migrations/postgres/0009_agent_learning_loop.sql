-- Migration 0009: Agent Learning Loop — confidence-based skill tracking
ALTER TABLE skills_library ADD COLUMN IF NOT EXISTS konfidenz INTEGER NOT NULL DEFAULT 50;
ALTER TABLE skills_library ADD COLUMN IF NOT EXISTS nutzungen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills_library ADD COLUMN IF NOT EXISTS erfolge INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills_library ADD COLUMN IF NOT EXISTS quelle TEXT NOT NULL DEFAULT 'manuell';
ALTER TABLE skills_library ADD COLUMN IF NOT EXISTS remote_ref TEXT;

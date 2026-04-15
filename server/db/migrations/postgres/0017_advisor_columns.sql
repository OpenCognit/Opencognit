-- Migration 0017: Advisor/Supervisor columns on experten
ALTER TABLE experten ADD COLUMN IF NOT EXISTS advisor_id TEXT REFERENCES experten(id);
ALTER TABLE experten ADD COLUMN IF NOT EXISTS advisor_strategy TEXT NOT NULL DEFAULT 'none';
ALTER TABLE experten ADD COLUMN IF NOT EXISTS advisor_config TEXT;
ALTER TABLE experten ADD COLUMN IF NOT EXISTS nachrichten_count INTEGER NOT NULL DEFAULT 0;

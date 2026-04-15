-- Migration 0018: Advisor columns + nachrichten_count for experten table
-- These columns exist in schema.ts but were never added via migration,
-- causing "no such column: advisor_id" errors on fresh installs.

ALTER TABLE experten ADD COLUMN advisor_id TEXT REFERENCES experten(id);
ALTER TABLE experten ADD COLUMN advisor_strategy TEXT NOT NULL DEFAULT 'none';
ALTER TABLE experten ADD COLUMN advisor_config TEXT;
ALTER TABLE experten ADD COLUMN nachrichten_count INTEGER NOT NULL DEFAULT 0;

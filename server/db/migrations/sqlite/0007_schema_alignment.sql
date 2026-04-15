-- Migration 0007: Schema Alignment (Fix 500 Error)
-- Adds missing column 'is_orchestrator' to 'experten'

ALTER TABLE experten ADD COLUMN is_orchestrator INTEGER NOT NULL DEFAULT 0;

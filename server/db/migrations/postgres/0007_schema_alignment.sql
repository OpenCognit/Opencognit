-- Migration 0007: Schema Alignment — adds is_orchestrator to experten
ALTER TABLE experten ADD COLUMN IF NOT EXISTS is_orchestrator BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration 0006: Add workDir to unternehmen
ALTER TABLE unternehmen ADD COLUMN IF NOT EXISTS work_dir TEXT;

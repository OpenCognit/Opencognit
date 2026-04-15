-- Migration 0006: Add workDir to unternehmen + erlaubtePfade to experten verbindungs_config support
-- workDir is stored directly on unternehmen table (company-level project workspace)

ALTER TABLE unternehmen ADD COLUMN work_dir TEXT;

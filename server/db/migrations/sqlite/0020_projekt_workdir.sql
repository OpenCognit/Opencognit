-- 0020: Per-project workDir
-- Each project can now have its own workspace folder.
-- Agents inherit: task.workspacePath → projekt.workDir → unternehmen.workDir → isolated fallback

ALTER TABLE projekte ADD COLUMN work_dir TEXT;

-- Migration 0008: Maximizer Mode flag on tasks
ALTER TABLE aufgaben ADD COLUMN IF NOT EXISTS is_maximizer_mode BOOLEAN DEFAULT FALSE;

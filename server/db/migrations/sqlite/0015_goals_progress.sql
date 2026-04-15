-- Goals: Add progress tracking (0-100 integer)
ALTER TABLE ziele ADD COLUMN fortschritt INTEGER NOT NULL DEFAULT 0;

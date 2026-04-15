-- Agent Learning Loop: Konfidenz-basiertes Skill-System
-- Skills bekommen einen Score der mit Erfolg/Misserfolg steigt/sinkt

ALTER TABLE skills_library ADD COLUMN konfidenz INTEGER NOT NULL DEFAULT 50;
ALTER TABLE skills_library ADD COLUMN nutzungen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills_library ADD COLUMN erfolge INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills_library ADD COLUMN quelle TEXT NOT NULL DEFAULT 'manuell';
ALTER TABLE skills_library ADD COLUMN remote_ref TEXT;

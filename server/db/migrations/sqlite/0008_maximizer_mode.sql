-- Maximizer Mode: Erlaubt es, Budget-Limits für einzelne Aufgaben zu ignorieren
-- Der Agent darf im Maximizer Mode autonom eskalieren (Hiring, Budget Override)

ALTER TABLE aufgaben ADD COLUMN is_maximizer_mode INTEGER DEFAULT 0;

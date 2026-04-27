-- Migration 0031: Full-Text Search for Semantic Memory (PostgreSQL)
-- Uses tsvector/tsquery instead of SQLite FTS5.

-- Add tsvector column for full-text search
ALTER TABLE memory_embeddings ADD COLUMN IF NOT EXISTS chunk_text_tsv tsvector;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS memory_embeddings_fts_idx ON memory_embeddings USING GIN(chunk_text_tsv);

-- Create function to auto-update tsvector
CREATE OR REPLACE FUNCTION update_memory_embeddings_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.chunk_text_tsv := to_tsvector('german', NEW.chunk_text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-update
DROP TRIGGER IF EXISTS memory_embeddings_tsv_update ON memory_embeddings;
CREATE TRIGGER memory_embeddings_tsv_update
BEFORE INSERT OR UPDATE OF chunk_text ON memory_embeddings
FOR EACH ROW
EXECUTE FUNCTION update_memory_embeddings_tsv();

-- Backfill existing rows
UPDATE memory_embeddings SET chunk_text_tsv = to_tsvector('german', chunk_text)
WHERE chunk_text_tsv IS NULL;

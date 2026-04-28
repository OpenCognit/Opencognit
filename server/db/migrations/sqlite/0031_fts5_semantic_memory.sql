-- Migration 0031: FTS5 Full-Text Search for Semantic Memory
-- Dramatically speeds up semantic search by using FTS5 as a pre-filter
-- before computing cosine similarity on embeddings.

-- Create FTS5 virtual table for memory_embeddings chunk_text
CREATE VIRTUAL TABLE IF NOT EXISTS memory_embeddings_fts USING fts5(
  chunk_text,
  content='memory_embeddings',
  content_rowid='rowid'
);

-- Trigger: auto-insert into FTS5 when a new embedding is stored
CREATE TRIGGER IF NOT EXISTS memory_embeddings_fts_insert
AFTER INSERT ON memory_embeddings
BEGIN
  INSERT INTO memory_embeddings_fts(rowid, chunk_text)
  VALUES (new.rowid, new.chunk_text);
END;

-- Trigger: auto-update FTS5 when chunk_text changes
CREATE TRIGGER IF NOT EXISTS memory_embeddings_fts_update
AFTER UPDATE OF chunk_text ON memory_embeddings
BEGIN
  UPDATE memory_embeddings_fts SET chunk_text = new.chunk_text WHERE rowid = new.rowid;
END;

-- Trigger: auto-delete from FTS5 when embedding is removed
CREATE TRIGGER IF NOT EXISTS memory_embeddings_fts_delete
AFTER DELETE ON memory_embeddings
BEGIN
  DELETE FROM memory_embeddings_fts WHERE rowid = old.rowid;
END;

-- Backfill existing embeddings into FTS5
INSERT INTO memory_embeddings_fts(rowid, chunk_text)
SELECT rowid, chunk_text FROM memory_embeddings
WHERE rowid NOT IN (SELECT rowid FROM memory_embeddings_fts);

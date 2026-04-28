-- Migration 0028: Semantic Memory Embeddings

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  expert_id TEXT REFERENCES experten(id),
  quelle TEXT NOT NULL DEFAULT 'manual',
  quelle_id TEXT,
  chunk_text TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  token_count INTEGER,
  char_count INTEGER,
  tags TEXT,
  erstellt_am TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_embeddings_unternehmen_idx ON memory_embeddings(unternehmen_id);
CREATE INDEX IF NOT EXISTS memory_embeddings_expert_idx ON memory_embeddings(expert_id);
CREATE INDEX IF NOT EXISTS memory_embeddings_quelle_idx ON memory_embeddings(quelle, quelle_id);

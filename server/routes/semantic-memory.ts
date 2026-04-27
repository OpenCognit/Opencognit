import { Router } from 'express';
import { db } from '../db/client.js';
import { memoryEmbeddings } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { storeSemanticMemory, searchSemanticMemory } from '../services/semantic-memory.js';
import { authMiddleware } from '../index.js';

const router = Router();

// POST /api/semantic-memory/store — Store text as embeddings
router.post('/store', authMiddleware, async (req, res) => {
  const unternehmenId = (req.headers['x-companies-id'] || req.headers['x-firma-id']) as string;
  const { text, source, sourceId, tags } = req.body;
  
  if (!unternehmenId || !text) {
    return res.status(400).json({ error: 'Missing unternehmenId or text' });
  }

  try {
    const ids = await storeSemanticMemory(unternehmenId, text, {
      source: source || 'manual',
      sourceId,
      tags,
    });
    res.json({ stored: ids.length, ids });
  } catch (err: any) {
    console.error('[SemanticMemory] Store error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/semantic-memory/search — Semantic search
router.post('/search', authMiddleware, async (req, res) => {
  const unternehmenId = (req.headers['x-companies-id'] || req.headers['x-firma-id']) as string;
  const { query, topK, tags } = req.body;
  
  if (!unternehmenId || !query) {
    return res.status(400).json({ error: 'Missing unternehmenId or query' });
  }

  try {
    const result = await searchSemanticMemory(unternehmenId, query, {
      topK: topK || 5,
      tags,
    });
    res.json(result);
  } catch (err: any) {
    console.error('[SemanticMemory] Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/semantic-memory/list — List stored chunks
router.get('/list', authMiddleware, (req, res) => {
  const unternehmenId = (req.headers['x-companies-id'] || req.headers['x-firma-id']) as string;
  if (!unternehmenId) return res.status(400).json({ error: 'Missing unternehmenId' });

  const rows = db.select()
    .from(memoryEmbeddings)
    .where(eq(memoryEmbeddings.companyId, unternehmenId))
    .orderBy(sql`${memoryEmbeddings.createdAt} DESC`)
    .limit(100)
    .all();

  res.json({ count: rows.length, rows });
});

// DELETE /api/semantic-memory/:id — Delete a chunk
router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.id, id as string)).run();
  res.json({ deleted: id });
});

export default router;

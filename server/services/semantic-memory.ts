// Semantic Memory — Embeddings + Vector Search for Agent Knowledge
//
// Agents store facts as embedding vectors. Other agents find relevant knowledge
// via cosine similarity — even if they use different words.
//
// Example:
//   Research-Agent: "Competitor X lowered prices by 20% in Q3"
//   CEO-Agent asks: "What do we know about market pricing?"
//   → Semantic search finds the Q3 pricing fact, even though keywords differ.

import crypto from 'crypto';
import { db, sqlite } from '../db/client.js';
import { memoryEmbeddings, agents, comments } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

// ─── FTS5 Availability Check ────────────────────────────────────────────────
let fts5Available: boolean | null = null;
function checkFts5(): boolean {
  if (fts5Available !== null) return fts5Available;
  if (!sqlite) { fts5Available = false; return false; }
  try {
    sqlite.prepare("SELECT 1 FROM memory_embeddings_fts LIMIT 1").get();
    fts5Available = true;
  } catch {
    fts5Available = false;
  }
  return fts5Available;
}

// Pure functions live in a DB-free module so tests can import them without
// triggering the DB client initialisation.
export { chunkText, hashEmbedding, cosineSimilarity } from './semantic-memory-pure.js';
import { chunkText, hashEmbedding, cosineSimilarity } from './semantic-memory-pure.js';

export interface MemoryChunk {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  sourceId?: string;
  similarity: number;
}

export interface SemanticSearchResult {
  query: string;
  results: MemoryChunk[];
  durationMs: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const TOP_K = 5;

// ─── 2. Embedding Generation ────────────────────────────────────────────────

export async function generateEmbeddings(
  texts: string[],
  apiKey?: string,
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
  if (!apiKey) {
    return texts.map(t => hashEmbedding(t));
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://opencognit.local',
        'X-Title': 'OpenCognit Semantic Memory',
      },
      body: JSON.stringify({ model, input: texts }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.warn(`[SemanticMemory] Embedding API error: ${error}. Falling back to hash embeddings.`);
      return texts.map(t => hashEmbedding(t));
    }

    const data = await response.json();
    return (data as any).data.map((d: any) => d.embedding as number[]);
  } catch (e: any) {
    console.warn(`[SemanticMemory] Embedding failed: ${e.message}. Falling back to hash embeddings.`);
    return texts.map(t => hashEmbedding(t));
  }
}

// ─── 3. Store Memory ────────────────────────────────────────────────────────

export async function storeSemanticMemory(
  companyId: string,
  text: string,
  options: {
    agentId?: string;
    source?: 'task_comment' | 'chat_message' | 'soul_md' | 'agents_md' | 'skill' | 'kg_fact' | 'decision' | 'manual';
    sourceId?: string;
    apiKey?: string;
    model?: string;
    tags?: string[];
  } = {}
): Promise<string[]> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return [];

  const embeddings = await generateEmbeddings(chunks, options.apiKey, options.model);
  const now = new Date().toISOString();
  const ids: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const id = crypto.randomUUID();
    db.insert(memoryEmbeddings).values({
      id,
      companyId,
      agentId: options.agentId || null,
      source: options.source || 'manual',
      quelleId: options.sourceId || null,
      chunkText: chunks[i],
      embeddingJson: JSON.stringify(embeddings[i]),
      model: options.model || DEFAULT_EMBEDDING_MODEL,
      tokenCount: Math.ceil(chunks[i].length / 4),
      charCount: chunks[i].length,
      tags: options.tags?.join(',') || null,
      createdAt: now,
    }).run();
    ids.push(id);
  }

  console.log(`[SemanticMemory] Stored ${chunks.length} chunks for ${companyId}`);
  return ids;
}

// ─── 4. Semantic Search ─────────────────────────────────────────────────────

export async function searchSemanticMemory(
  companyId: string,
  query: string,
  options: {
    agentId?: string;
    apiKey?: string;
    model?: string;
    topK?: number;
    minSimilarity?: number;
    tags?: string[];
    preFilterLimit?: number; // max candidates from FTS5 before embedding comparison
  } = {}
): Promise<SemanticSearchResult> {
  const startTime = Date.now();
  const topK = options.topK || TOP_K;
  const preFilterLimit = options.preFilterLimit || 50;

  const [queryEmbedding] = await generateEmbeddings([query], options.apiKey, options.model);

  let candidates: { id: string; chunkText: string; embeddingJson: string; source: string; sourceId: string | null; tags: string | null }[] = [];
  let usedFts5 = false;

  // ── Stage 1: FTS5 pre-filter (SQLite only, O(log n)) ──────────────────────
  if (sqlite && checkFts5() && query.trim().length > 2) {
    try {
      // Build FTS5 query: split words, quote each, join with OR
      const words = query.trim().replace(/"/g, '""').split(/\s+/).filter(w => w.length > 1);
      if (words.length > 0) {
        const ftsQuery = words.map(w => `"${w}"`).join(' OR ');
        const stmt = sqlite.prepare(`
          SELECT e.id, e.chunk_text, e.embedding_json, e.quelle, e.quelle_id, e.tags
          FROM memory_embeddings_fts f
          JOIN memory_embeddings e ON f.rowid = e.rowid
          WHERE f.chunk_text MATCH ? AND e.unternehmen_id = ?
          ORDER BY f.rank
          LIMIT ?
        `);
        const rows = stmt.all(ftsQuery, companyId, preFilterLimit) as any[];
        if (rows.length > 0) {
          candidates = rows;
          usedFts5 = true;
        }
      }
    } catch (e: any) {
      console.warn('[SemanticMemory] FTS5 pre-filter failed:', e.message);
    }
  }

  // ── Stage 2: Fallback full scan (O(n)) ────────────────────────────────────
  if (candidates.length === 0) {
    candidates = db.select({
      id: memoryEmbeddings.id,
      chunkText: memoryEmbeddings.chunkText,
      embeddingJson: memoryEmbeddings.embeddingJson,
      source: memoryEmbeddings.source,
      sourceId: memoryEmbeddings.quelleId,
      tags: memoryEmbeddings.tags,
    })
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.companyId, companyId))
      .all();
  }

  // ── Stage 3: Tag filter ───────────────────────────────────────────────────
  const filtered = options.tags
    ? candidates.filter(c => {
        if (!c.tags) return false;
        const chunkTags = c.tags.split(',').map(t => t.trim());
        return options.tags!.some(t => chunkTags.includes(t));
      })
    : candidates;

  // ── Stage 4: Cosine similarity on filtered candidates ─────────────────────
  const scored = filtered.map(c => {
    const embedding = JSON.parse(c.embeddingJson) as number[];
    return {
      id: c.id,
      text: c.chunkText,
      embedding,
      source: c.source,
      sourceId: c.sourceId || undefined,
      similarity: cosineSimilarity(queryEmbedding, embedding),
    };
  });

  const results = scored
    .filter(r => r.similarity >= (options.minSimilarity || 0.3))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  const durationMs = Date.now() - startTime;
  if (usedFts5) {
    console.log(`[SemanticMemory] FTS5+Hybrid search: ${candidates.length} candidates → ${results.length} results in ${durationMs}ms`);
  } else {
    console.log(`[SemanticMemory] Full scan: ${candidates.length} candidates → ${results.length} results in ${durationMs}ms`);
  }

  return {
    query,
    results,
    durationMs,
  };
}

// ─── 5. Integration: Auto-Index Agent Memory ────────────────────────────────

export async function indexAgentMemory(
  agentId: string,
  companyId: string,
  apiKey?: string
): Promise<number> {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) return 0;

  let indexedCount = 0;

  const recentComments = db.select()
    .from(comments)
    .where(and(
      eq(comments.authorAgentId, agentId),
      eq(comments.authorType, 'agent')
    ))
    .orderBy(sql`${comments.createdAt} DESC`)
    .limit(20)
    .all();

  for (const comment of recentComments) {
    if (comment.content.length > 100) {
      await storeSemanticMemory(companyId, comment.content, {
        agentId,
        source: 'task_comment',
        sourceId: comment.taskId || undefined,
        apiKey,
        tags: ['agent_output', agent.role],
      });
      indexedCount++;
    }
  }

  if (agent.soulPath) {
    try {
      const fs = await import('fs');
      if (fs.existsSync(agent.soulPath)) {
        const soulContent = fs.readFileSync(agent.soulPath, 'utf-8');
        await storeSemanticMemory(companyId, soulContent, {
          agentId,
          source: 'soul_md',
          apiKey,
          tags: ['identity', 'soul'],
        });
        indexedCount++;
      }
    } catch { /* ignore */ }
  }

  return indexedCount;
}

// ─── 6. Format Results for Prompt Injection ─────────────────────────────────

export function formatSemanticContext(result: SemanticSearchResult): string {
  if (result.results.length === 0) return '';

  const parts = [
    '--- SEMANTIC MEMORY RETRIEVAL ---',
    `Query: "${result.query}"`,
    `Found ${result.results.length} relevant memories (${result.durationMs}ms):`,
    '',
  ];

  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i];
    parts.push(`${i + 1}. [${(r.similarity * 100).toFixed(1)}% match] ${r.text.slice(0, 300)}${r.text.length > 300 ? '...' : ''}`);
    parts.push(`   Source: ${r.source}${r.sourceId ? ` (${r.sourceId.slice(0, 8)})` : ''}`);
    parts.push('');
  }

  parts.push('--- END SEMANTIC MEMORY ---');
  return parts.join('\n');
}

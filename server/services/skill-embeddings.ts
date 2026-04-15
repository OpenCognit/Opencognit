/**
 * Semantic skill matching via local embeddings (Xenova/all-MiniLM-L6-v2).
 *
 * To enable full semantic search, install the dependency:
 *   npm install @xenova/transformers
 *
 * Without the package the module falls back gracefully — the BM25 path in
 * scheduler.ts takes over automatically via the exported `embeddingsAvailable`
 * flag.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmbeddingPipeline = (text: string, options?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** True once the pipeline was loaded successfully at least once. */
export let embeddingsAvailable = false;

let pipeline: EmbeddingPipeline | null = null;
let pipelineLoading: Promise<void> | null = null;

/** In-memory cache: skillId → embedding vector (avoids recompute every tick). */
const embeddingCache = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// Pipeline bootstrap
// ---------------------------------------------------------------------------

async function initPipeline(): Promise<void> {
  if (pipeline) return;

  // Attempt to import @xenova/transformers — may not be installed.
  let transformers: any;
  try {
    transformers = await import('@xenova/transformers');
  } catch {
    // Package not installed — embeddings remain unavailable.
    return;
  }

  try {
    const { pipeline: buildPipeline, env } = transformers;

    // Store models locally so they are only downloaded once.
    env.cacheDir = './.xenova-cache';
    // Suppress progress output in production logs.
    env.allowLocalModels = true;

    pipeline = await buildPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true, // smaller / faster
    });

    embeddingsAvailable = true;
    console.log('[skill-embeddings] MiniLM-L6-v2 pipeline ready');
  } catch (err) {
    console.warn('[skill-embeddings] Failed to load MiniLM pipeline, BM25 fallback active:', (err as Error).message);
  }
}

/** Ensure the pipeline is initialised exactly once (lazy singleton). */
function ensurePipeline(): Promise<void> {
  if (!pipelineLoading) {
    pipelineLoading = initPipeline();
  }
  return pipelineLoading;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Generate a normalised embedding vector for the given text.
 * Throws if the pipeline is unavailable (caller must handle).
 */
export async function embedText(text: string): Promise<number[]> {
  await ensurePipeline();

  if (!pipeline) {
    throw new Error('Embedding pipeline not available');
  }

  const result = await pipeline(text, { pooling: 'mean', normalize: true });

  // result.data may be a Float32Array or a plain number[]
  return Array.from(result.data as Float32Array);
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns a value in [0, 1] (since MiniLM produces normalised vectors,
 * the dot product equals cosine similarity directly — but we compute it
 * explicitly to be safe).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Return (and cache) the embedding for a skill.
 * Uses skillId as cache key so repeated calls are free.
 */
export async function getOrCacheSkillEmbedding(skillId: string, skillText: string): Promise<number[]> {
  if (embeddingCache.has(skillId)) {
    return embeddingCache.get(skillId)!;
  }

  const vec = await embedText(skillText);
  embeddingCache.set(skillId, vec);
  return vec;
}

/**
 * Rank `skills` by semantic similarity to `queryText` and return the top-K.
 *
 * Each element of `skills` must have at least:
 *   { id: string, name: string, beschreibung?: string, inhalt: string }
 *
 * Returns the skills sorted best-first (highest cosine similarity first).
 * Entries with score 0 are still included — caller decides the cut-off.
 */
export async function findRelevantSkills(
  queryText: string,
  skills: any[],
  topK = 5,
): Promise<any[]> {
  if (skills.length === 0) return [];

  await ensurePipeline();

  if (!embeddingsAvailable || !pipeline) {
    throw new Error('Embedding pipeline not available');
  }

  const queryVec = await embedText(queryText);

  // Embed all skills (cache hits are instant)
  const scored = await Promise.all(
    skills.map(async (skill: any) => {
      const skillText = `${skill.name} ${skill.beschreibung ?? ''} ${skill.inhalt}`;
      const skillId   = skill.id as string;
      const skillVec  = await getOrCacheSkillEmbedding(skillId, skillText);
      const score     = cosineSimilarity(queryVec, skillVec);
      return { skill, score };
    }),
  );

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.skill);
}

// Kick off pipeline loading in the background so it is ready by the time the
// first heartbeat runs (warm-up, best-effort).
ensurePipeline().catch(() => { /* silent — BM25 fallback handles it */ });

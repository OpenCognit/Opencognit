import { describe, it, expect } from 'vitest';
import { chunkText, cosineSimilarity, hashEmbedding } from './semantic-memory-pure.js';

describe('Semantic Memory — chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hello world', 100, 10);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('Hello world');
  });

  it('splits long text into multiple chunks', () => {
    const text = 'A'.repeat(1000);
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('filters out very short chunks', () => {
    const chunks = chunkText('Hi', 100, 10);
    expect(chunks.length).toBe(0);
  });

  it('respects sentence boundaries', () => {
    const text = 'First sentence here. Second sentence here. Third one.';
    const chunks = chunkText(text, 30, 5);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Semantic Memory — cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const vec = [1, 2, 3];
    expect(Math.abs(cosineSimilarity(vec, vec) - 1)).toBeLessThan(1e-5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0]))).toBeLessThan(1e-5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(Math.abs(cosineSimilarity([1, 0, 0], [-1, 0, 0]) + 1)).toBeLessThan(1e-5);
  });

  it('handles zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('Semantic Memory — hashEmbedding', () => {
  it('returns normalized vector', () => {
    const vec = hashEmbedding('test text', 128);
    expect(vec.length).toBe(128);
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(Math.abs(mag - 1)).toBeLessThan(0.1);
  });

  it('returns different vectors for different texts', () => {
    const a = hashEmbedding('hello world', 128);
    const b = hashEmbedding('goodbye world', 128);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeLessThan(1);
    expect(sim).toBeGreaterThan(-1);
  });
});

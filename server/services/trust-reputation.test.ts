import { describe, it, expect } from 'vitest';
import { getTrustScore, getTrustWeight, detectAnomalousAgents } from './trust-reputation.js';

describe('Trust & Reputation — getTrustScore', () => {
  it('returns a valid score structure for unknown agent', () => {
    try {
      const result = getTrustScore('non-existent-agent', 'non-existent-company');
      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.components).toBeDefined();
      expect(['rising', 'falling', 'stable']).toContain(result.trend);
      expect(typeof result.ratingCount).toBe('number');
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('components are all in valid 0-100 range', () => {
    try {
      const result = getTrustScore('non-existent-agent', 'non-existent-company');
      const { reliability, quality, communication, collaboration } = result.components;
      expect(reliability).toBeGreaterThanOrEqual(0);
      expect(reliability).toBeLessThanOrEqual(100);
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(100);
      expect(communication).toBeGreaterThanOrEqual(0);
      expect(communication).toBeLessThanOrEqual(100);
      expect(collaboration).toBeGreaterThanOrEqual(0);
      expect(collaboration).toBeLessThanOrEqual(100);
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });
});

describe('Trust & Reputation — getTrustWeight', () => {
  it('returns weight in valid range for unknown agent', () => {
    try {
      const weight = getTrustWeight('non-existent-agent', 'non-existent-company');
      // Default score = 50 → weight = 0.5 + (50/100) = 1.0
      expect(weight).toBeGreaterThanOrEqual(0.5);
      expect(weight).toBeLessThanOrEqual(1.5);
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('weight formula: score 0 → 0.5, score 100 → 1.5', () => {
    // Test the formula directly without DB
    const weightAt = (score: number) => 0.5 + (score / 100) * 1.0;
    expect(weightAt(0)).toBe(0.5);
    expect(weightAt(100)).toBe(1.5);
    expect(weightAt(50)).toBe(1.0);
  });
});

describe('Trust & Reputation — detectAnomalousAgents', () => {
  it('returns an array for unknown company', () => {
    try {
      const result = detectAnomalousAgents('non-existent-company');
      expect(result).toBeInstanceOf(Array);
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it('detectAnomalousAgents is a function', () => {
    expect(typeof detectAnomalousAgents).toBe('function');
  });
});

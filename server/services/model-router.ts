// Auto Model Router
//
// Heuristic: score task complexity, map to a model tier. Ops route simple tasks
// to cheap models (Haiku / Ollama local), complex ones to strong models (Sonnet / Opus).
//
// Enabled per-company via setting `model_routing_enabled = 'true'`.
// Model tiers configurable via setting `model_routing_tiers` (JSON) — falls back to
// reasonable defaults per adapter family.

import { db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export type Tier = 'cheap' | 'balanced' | 'strong';

interface TiersByFamily {
  openrouter: Record<Tier, string>;
  ollama: Record<Tier, string>;
  anthropic: Record<Tier, string>;
  openai: Record<Tier, string>;
}

const DEFAULT_TIERS: TiersByFamily = {
  openrouter: {
    cheap:    'anthropic/claude-haiku-4-5',
    balanced: 'anthropic/claude-sonnet-4-6',
    strong:   'anthropic/claude-opus-4-7',
  },
  ollama: {
    cheap:    'llama3.2:3b',
    balanced: 'llama3.1:8b',
    strong:   'qwen2.5:14b',
  },
  anthropic: {
    cheap:    'claude-haiku-4-5',
    balanced: 'claude-sonnet-4-6',
    strong:   'claude-opus-4-7',
  },
  openai: {
    cheap:    'gpt-4o-mini',
    balanced: 'gpt-4o',
    strong:   'gpt-4o',
  },
};

function getSetting(companyId: string, key: string): string | null {
  const row = db.select({ value: settings.value }).from(settings)
    .where(and(eq(settings.key, key), eq(settings.companyId, companyId))).get()
    ?? db.select({ value: settings.value }).from(settings)
    .where(and(eq(settings.key, key), eq(settings.companyId, ''))).get();
  return row?.value ?? null;
}

export function isRoutingEnabled(companyId: string): boolean {
  return getSetting(companyId, 'model_routing_enabled') === 'true';
}

/**
 * Score a task's complexity 0-100. Higher = needs stronger model.
 * Pure function — easy to unit-test.
 */
export function scoreComplexity(task: { title?: string | null; description?: string | null; priority?: string | null }): number {
  const text = `${task.title || ''}\n${task.description || ''}`.toLowerCase();
  let score = 20; // baseline

  // Length signal
  if (text.length > 2000) score += 25;
  else if (text.length > 500) score += 10;

  // Priority signal
  if (task.priority === 'critical') score += 20;
  else if (task.priority === 'high') score += 10;

  // Keyword signals — strong model needed
  const strongKw = [
    'architect', 'refactor', 'design', 'analyze', 'debug', 'complex', 'strategy',
    'review', 'plan', 'optimize', 'algorithm', 'security', 'audit', 'research',
    'architektur', 'refaktor', 'analyse', 'komplex', 'strategie', 'überprüfe', 'optimier',
  ];
  for (const kw of strongKw) if (text.includes(kw)) { score += 8; break; }

  // Keyword signals — simple/mechanical task
  const cheapKw = [
    'rename', 'typo', 'fix format', 'lint', 'translate', 'copy', 'move', 'delete',
    'umbenennen', 'tippfehler', 'formatier', 'kopier', 'verschieb', 'lösch',
  ];
  for (const kw of cheapKw) if (text.includes(kw)) { score -= 15; break; }

  return Math.max(0, Math.min(100, score));
}

export function scoreToTier(score: number): Tier {
  if (score >= 60) return 'strong';
  if (score >= 35) return 'balanced';
  return 'cheap';
}

function detectFamily(currentModel: string, connectionType: string): keyof TiersByFamily {
  if (connectionType === 'ollama') return 'ollama';
  if (currentModel.startsWith('anthropic/') || connectionType === 'openrouter') return 'openrouter';
  if (currentModel.startsWith('claude')) return 'anthropic';
  if (currentModel.startsWith('gpt') || currentModel.startsWith('o1') || currentModel.startsWith('o3')) return 'openai';
  return 'openrouter';
}

function loadTiers(companyId: string): TiersByFamily {
  const raw = getSetting(companyId, 'model_routing_tiers');
  if (!raw) return DEFAULT_TIERS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TIERS, ...parsed };
  } catch {
    return DEFAULT_TIERS;
  }
}

export interface RouteDecision {
  model: string;
  tier: Tier;
  score: number;
  reason: string;
  routed: boolean;
  originalModel: string;
}

export function routeModel(
  companyId: string,
  connectionType: string,
  currentModel: string,
  task: { title?: string | null; description?: string | null; priority?: string | null } | null,
): RouteDecision {
  const originalModel = currentModel;
  if (!task) {
    return { model: currentModel, tier: 'balanced', score: 0, reason: 'no task context', routed: false, originalModel };
  }
  if (!isRoutingEnabled(companyId)) {
    return { model: currentModel, tier: 'balanced', score: 0, reason: 'routing disabled', routed: false, originalModel };
  }
  if (!['openrouter', 'ollama'].includes(connectionType)) {
    return { model: currentModel, tier: 'balanced', score: 0, reason: `routing not supported for ${connectionType}`, routed: false, originalModel };
  }

  const score = scoreComplexity(task);
  const tier = scoreToTier(score);
  const family = detectFamily(currentModel, connectionType);
  const tiers = loadTiers(companyId);
  const picked = tiers[family]?.[tier];
  if (!picked) {
    return { model: currentModel, tier, score, reason: `no model for ${family}/${tier}`, routed: false, originalModel };
  }
  if (picked === currentModel) {
    return { model: currentModel, tier, score, reason: `already at ${tier}`, routed: false, originalModel };
  }

  return {
    model: picked,
    tier,
    score,
    reason: `score=${score} → ${tier} tier (${family})`,
    routed: true,
    originalModel,
  };
}

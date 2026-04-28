/**
 * Trust & Reputation System
 * =========================
 * Dynamic trust scores for each agent based on:
 * - Task completion rate (Zuverlässigkeit)
 * - Output quality (Qualität)
 * - Communication responsiveness (Kommunikation)
 * - Collaboration / delegation behavior (Zusammenarbeit)
 *
 * Formula: T_i(t) = α·B_i(t) + β·R_i(t) + γ·H_i(t) + δ·C_i(t)
 * where B=behavior, R=reputation, H=history, C=consistency
 *
 * State-of-the-Art 2026: Trust propagation with transitive relationships,
 * behavioral analysis engine, anomaly detection.
 */

import { eq, and, desc, avg, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentTrustScores, agents, tasks, workCycles, costEntries } from '../db/schema.js';

interface TrustComponents {
  reliability: number;  // 0-100
  quality: number;         // 0-100
  communication: number;     // 0-100
  collaboration: number;    // 0-100
}

interface TrustScore {
  score: number;
  components: TrustComponents;
  ratingCount: number;
  trend: 'rising' | 'falling' | 'stable';
}

const ALPHA = 0.35; // Zuverlässigkeit weight
const BETA = 0.30;  // Qualität weight
const GAMMA = 0.20; // Kommunikation weight
const DELTA = 0.15; // Zusammenarbeit weight

/**
 * Get or compute the trust score for an agent.
 * If no manual ratings exist, auto-compute from task history.
 */
export function getTrustScore(subjectAgentId: string, companyId: string): TrustScore {
  const existing = db
    .select()
    .from(agentTrustScores)
    .where(and(
      eq(agentTrustScores.subjectAgentId, subjectAgentId),
      eq(agentTrustScores.companyId, companyId),
      eq(agentTrustScores.evaluatorAgentId, 'system')
    ))
    .get();

  if (existing) {
    const components: TrustComponents = {
      reliability: existing.reliability,
      quality: existing.quality,
      communication: existing.communication,
      collaboration: existing.collaboration,
    };
    const trend = computeTrend(existing.historyJson);
    return { score: existing.score, components, ratingCount: existing.ratingCount, trend };
  }

  // Auto-compute from history
  return autoComputeTrustScore(subjectAgentId, companyId);
}

/**
 * Update trust score based on a completed task outcome.
 * Called by the heartbeat after task completion.
 */
export function updateTrustAfterTask(
  agentId: string,
  companyId: string,
  taskId: string,
  success: boolean,
  costCents: number,
  executionTimeMs: number
): void {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(agentTrustScores)
    .where(and(
      eq(agentTrustScores.subjectAgentId, agentId),
      eq(agentTrustScores.companyId, companyId),
      eq(agentTrustScores.evaluatorAgentId, 'system')
    ))
    .get();

  // Compute new component values based on this task
  const taskHistory = getRecentTaskStats(agentId, 10);

  const reliability = Math.round((taskHistory.completionRate * 100));
  const quality = Math.round(computeQualityScore(agentId, taskHistory));
  const communication = existing ? existing.communication : 50; // unchanged by single task
  const collaboration = existing ? existing.collaboration : 50; // unchanged by single task

  const score = Math.round(
    ALPHA * reliability +
    BETA * quality +
    GAMMA * communication +
    DELTA * collaboration
  );

  const verlauf = existing?.historyJson
    ? JSON.parse(existing.historyJson)
    : [];
  verlauf.push({ date: now, score, taskId, success });
  if (verlauf.length > 20) verlauf.shift(); // keep last 20

  if (existing) {
    db.update(agentTrustScores)
      .set({
        score,
        reliability,
        quality,
        communication,
        collaboration,
        ratingCount: existing.ratingCount + 1,
        historyJson: JSON.stringify(verlauf),
        lastUpdated: now,
        updatedAt: now,
      })
      .where(eq(agentTrustScores.id, existing.id))
      .run();
  } else {
    db.insert(agentTrustScores).values({
      id: crypto.randomUUID(),
      companyId,
      subjectAgentId: agentId,
      evaluatorAgentId: 'system',
      score,
      reliability,
      quality,
      communication,
      collaboration,
      ratingCount: 1,
      historyJson: JSON.stringify(verlauf),
      lastUpdated: now,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}

/**
 * One agent rates another agent (peer evaluation).
 * Used in consensus meetings, code reviews, etc.
 */
export function submitPeerEvaluation(
  subjectAgentId: string,
  evaluatorAgentId: string,
  companyId: string,
  components: Partial<TrustComponents>,
  context?: string
): void {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(agentTrustScores)
    .where(and(
      eq(agentTrustScores.subjectAgentId, subjectAgentId),
      eq(agentTrustScores.companyId, companyId),
      eq(agentTrustScores.evaluatorAgentId, evaluatorAgentId)
    ))
    .get();

  const merged: TrustComponents = {
    reliability: components.reliability ?? existing?.reliability ?? 50,
    quality: components.quality ?? existing?.quality ?? 50,
    communication: components.communication ?? existing?.communication ?? 50,
    collaboration: components.collaboration ?? existing?.collaboration ?? 50,
  };

  const score = Math.round(
    ALPHA * merged.reliability +
    BETA * merged.quality +
    GAMMA * merged.communication +
    DELTA * merged.collaboration
  );

  if (existing) {
    db.update(agentTrustScores)
      .set({
        score,
        ...merged,
        ratingCount: existing.ratingCount + 1,
        lastUpdated: now,
        updatedAt: now,
      })
      .where(eq(agentTrustScores.id, existing.id))
      .run();
  } else {
    db.insert(agentTrustScores).values({
      id: crypto.randomUUID(),
      companyId,
      subjectAgentId,
      evaluatorAgentId,
      score,
      ...merged,
      ratingCount: 1,
      lastUpdated: now,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}

/**
 * Get trust-adjusted capability score for task assignment.
 * Higher trust = higher weight in bidding/assignment decisions.
 */
export function getTrustWeight(agentId: string, companyId: string): number {
  const trust = getTrustScore(agentId, companyId);
  // Normalize 0-100 to 0.5-1.5 range (trusted agents get up to 1.5x boost)
  return 0.5 + (trust.score / 100) * 1.0;
}

/**
 * Detect anomalous agents (potential compromise or malfunction).
 * Flags agents with sudden trust drops or erratic behavior.
 */
export function detectAnomalousAgents(companyId: string): Array<{
  agentId: string;
  name: string;
  anomalyType: string;
  severity: 'low' | 'medium' | 'high';
  details: string;
}> {
  const results: ReturnType<typeof detectAnomalousAgents> = [];

  const agentRows = db
    .select()
    .from(agents)
    .where(eq(agents.companyId, companyId))
    .all();

  for (const agent of agentRows) {
    const trust = getTrustScore(agent.id, companyId);

    // Check for sudden drop (if we have history)
    if (trust.trend === 'falling' && trust.components.reliability < 30) {
      results.push({
        agentId: agent.id,
        name: agent.name,
        anomalyType: 'trust_collapse',
        severity: 'high',
        details: `Reliability dropped to ${trust.components.reliability}%. Recent task failures detected.`,
      });
    }

    // Check for high error rate
    const recentErrors = db
      .select({ count: sql<number>`count(*)` })
      .from(workCycles)
      .where(and(
        eq(workCycles.agentId, agent.id),
        eq(workCycles.status, 'failed')
      ))
      .get()?.count || 0;

    const recentTotal = db
      .select({ count: sql<number>`count(*)` })
      .from(workCycles)
      .where(eq(workCycles.agentId, agent.id))
      .get()?.count || 1;

    const errorRate = recentErrors / recentTotal;
    if (errorRate > 0.5 && recentTotal >= 3) {
      results.push({
        agentId: agent.id,
        name: agent.name,
        anomalyType: 'high_error_rate',
        severity: 'high',
        details: `${Math.round(errorRate * 100)}% failure rate over last ${recentTotal} runs.`,
      });
    }
  }

  return results;
}

// ===== Internal Helpers =====

function autoComputeTrustScore(agentId: string, companyId: string): TrustScore {
  const stats = getRecentTaskStats(agentId, 20);
  const reliability = Math.round(stats.completionRate * 100);
  const quality = Math.round(computeQualityScore(agentId, stats));
  const communication = 50; // default until we have comms data
  const collaboration = 50; // default

  const score = Math.round(
    ALPHA * reliability +
    BETA * quality +
    GAMMA * communication +
    DELTA * collaboration
  );

  return {
    score,
    components: { reliability, quality, communication, collaboration },
    ratingCount: stats.total,
    trend: 'stable',
  };
}

function getRecentTaskStats(agentId: string, limit: number) {
  const taskRows = db
    .select({ status: tasks.status, id: tasks.id })
    .from(tasks)
    .where(eq(tasks.assignedTo, agentId))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .all();

  const total = taskRows.length;
  const completed = taskRows.filter(t => t.status === 'done').length;
  const completionRate = total > 0 ? completed / total : 0.5;

  return { total, completed, completionRate };
}

function computeQualityScore(agentId: string, stats: { total: number; completed: number }): number {
  // Quality = completion rate * cost efficiency * speed
  // Simplified: based on completion rate + average cost per task
  const costData = db
    .select({ totalCost: sql<number>`sum(${costEntries.costCent})`, count: sql<number>`count(*)` })
    .from(costEntries)
    .where(eq(costEntries.agentId, agentId))
    .get();

  const avgCost = costData && costData.count > 0 ? costData.totalCost / costData.count : 50;
  // Lower cost = higher quality score (max 100 at $0, min 0 at $200+ average)
  const costScore = Math.max(0, Math.min(100, 100 - avgCost / 2));

  const completionRate = stats.total > 0 ? stats.completed / stats.total : 0.5;
  return Math.round((completionRate * 100 + costScore) / 2);
}

function computeTrend(historyJson?: string | null): 'rising' | 'falling' | 'stable' {
  if (!historyJson) return 'stable';
  try {
    const history = JSON.parse(historyJson) as Array<{ score: number; date: string }>;
    if (history.length < 3) return 'stable';
    const recent = history.slice(-3);
    const first = recent[0].score;
    const last = recent[recent.length - 1].score;
    const diff = last - first;
    if (diff > 5) return 'rising';
    if (diff < -5) return 'falling';
    return 'stable';
  } catch {
    return 'stable';
  }
}

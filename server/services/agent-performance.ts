// Agent Performance — Self-Evolving Agents Metrics
//
// Computes rolling agent metrics over a time window and compares to the
// previous period. Powers "Sarah is 34% faster on code reviews than 3 weeks
// ago" style insights. Also exposes a lightweight learning-loop recorder that
// writes critic outcomes into Palace Diary for future self-reflection.

import crypto from 'crypto';
import { db } from '../db/client.js';
import {
  arbeitszyklen, aufgaben, experten, kostenbuchungen, palaceWings, palaceDiary,
} from '../db/schema.js';
import { eq, and, gte, lt, sql, desc } from 'drizzle-orm';

export interface AgentMetrics {
  expertId: string;
  name: string;
  window: { from: string; to: string; days: number };
  tasksCompleted: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  successRate: number;          // 0-1
  avgDurationSec: number;
  avgTokensPerRun: number;
  avgCostCentPerRun: number;
  avgCostCentPerTask: number;
}

export interface MetricsDelta {
  current: AgentMetrics;
  previous: AgentMetrics;
  changes: {
    tasksCompletedPct: number | null;
    successRatePct: number | null;
    avgDurationPct: number | null;      // negative = faster
    avgTokensPct: number | null;
    avgCostPerTaskPct: number | null;   // negative = cheaper
  };
  verdict: string;                      // human-readable summary
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

function windowStart(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function computeMetrics(expertId: string, name: string, from: string, to: string): AgentMetrics {
  const days = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / (86400 * 1000));

  const runs = db.select().from(arbeitszyklen)
    .where(and(
      eq(arbeitszyklen.expertId, expertId),
      gte(arbeitszyklen.erstelltAm, from),
      lt(arbeitszyklen.erstelltAm, to),
    )).all();

  const runsTotal = runs.length;
  const runsSucceeded = runs.filter(r => r.status === 'succeeded').length;
  const runsFailed = runs.filter(r => r.status === 'failed' || r.status === 'timed_out').length;

  let totalDurationMs = 0;
  let durationSamples = 0;
  let totalTokens = 0;
  let totalCostCent = 0;
  for (const r of runs) {
    if (r.gestartetAm && r.beendetAm) {
      const ms = new Date(r.beendetAm).getTime() - new Date(r.gestartetAm).getTime();
      if (ms > 0 && ms < 30 * 60 * 1000) { totalDurationMs += ms; durationSamples++; }
    }
    if (r.usageJson) {
      try {
        const u = JSON.parse(r.usageJson);
        totalTokens += (u.inputTokens || 0) + (u.outputTokens || 0);
        totalCostCent += u.costCents || 0;
      } catch {}
    }
  }

  const completed = db.select({ c: sql<number>`count(*)` }).from(aufgaben)
    .where(and(
      eq(aufgaben.zugewiesenAn, expertId),
      eq(aufgaben.status, 'done'),
      gte(aufgaben.abgeschlossenAm, from),
      lt(aufgaben.abgeschlossenAm, to),
    )).get()?.c ?? 0;

  return {
    expertId, name,
    window: { from, to, days: Math.round(days * 10) / 10 },
    tasksCompleted: completed as number,
    runsTotal, runsSucceeded, runsFailed,
    successRate: runsTotal > 0 ? runsSucceeded / runsTotal : 0,
    avgDurationSec: durationSamples > 0 ? Math.round(totalDurationMs / durationSamples / 1000) : 0,
    avgTokensPerRun: runsTotal > 0 ? Math.round(totalTokens / runsTotal) : 0,
    avgCostCentPerRun: runsTotal > 0 ? Math.round(totalCostCent / runsTotal) : 0,
    avgCostCentPerTask: (completed as number) > 0 ? Math.round(totalCostCent / (completed as number)) : 0,
  };
}

function makeVerdict(d: MetricsDelta['changes'], name: string): string {
  const parts: string[] = [];
  if (d.avgDurationPct !== null && Math.abs(d.avgDurationPct) >= 10) {
    parts.push(d.avgDurationPct < 0
      ? `${Math.abs(d.avgDurationPct).toFixed(0)}% faster`
      : `${d.avgDurationPct.toFixed(0)}% slower`);
  }
  if (d.successRatePct !== null && Math.abs(d.successRatePct) >= 5) {
    parts.push(d.successRatePct > 0
      ? `${d.successRatePct.toFixed(0)}% higher success rate`
      : `${Math.abs(d.successRatePct).toFixed(0)}% lower success rate`);
  }
  if (d.avgCostPerTaskPct !== null && Math.abs(d.avgCostPerTaskPct) >= 10) {
    parts.push(d.avgCostPerTaskPct < 0
      ? `${Math.abs(d.avgCostPerTaskPct).toFixed(0)}% cheaper per task`
      : `${d.avgCostPerTaskPct.toFixed(0)}% more expensive per task`);
  }
  if (parts.length === 0) return `${name}: performance stable.`;
  return `${name} is ${parts.join(', ')} vs previous period.`;
}

export function getAgentPerformance(expertId: string, days = 30): MetricsDelta | null {
  const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
  if (!expert) return null;

  const currFrom = windowStart(days);
  const currTo = new Date().toISOString();
  const prevFrom = windowStart(days * 2);
  const prevTo = currFrom;

  const current = computeMetrics(expertId, expert.name, currFrom, currTo);
  const previous = computeMetrics(expertId, expert.name, prevFrom, prevTo);

  const changes = {
    tasksCompletedPct:   pctChange(current.tasksCompleted, previous.tasksCompleted),
    successRatePct:      pctChange(current.successRate * 100, previous.successRate * 100),
    avgDurationPct:      pctChange(current.avgDurationSec, previous.avgDurationSec),
    avgTokensPct:        pctChange(current.avgTokensPerRun, previous.avgTokensPerRun),
    avgCostPerTaskPct:   pctChange(current.avgCostCentPerTask, previous.avgCostCentPerTask),
  };

  return { current, previous, changes, verdict: makeVerdict(changes, expert.name) };
}

export function getCompanyLeaderboard(unternehmenId: string, days = 30): MetricsDelta[] {
  const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
  return agents
    .map(a => getAgentPerformance(a.id, days))
    .filter((x): x is MetricsDelta => x !== null && x.current.runsTotal > 0);
}

// ─── Learning Loop ───────────────────────────────────────────────────────────
// Stores critic outcomes as Palace Diary entries so agents can self-reflect on
// past work quality. Lazy-creates the Wing if none exists.

function ensureWingForExpert(expertId: string): string | null {
  const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
  if (!expert) return null;

  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_');
  const existing = db.select().from(palaceWings)
    .where(and(eq(palaceWings.expertId, expertId), eq(palaceWings.name, wingName))).get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(palaceWings).values({
    id, unternehmenId: expert.unternehmenId, expertId, name: wingName,
    erstelltAm: now, aktualisiertAm: now,
  }).run();
  return id;
}

export function recordLearning(
  expertId: string,
  taskTitel: string,
  outcome: 'approved' | 'needs_revision' | 'escalated',
  insight: string,
): void {
  try {
    const wingId = ensureWingForExpert(expertId);
    if (!wingId) return;

    const now = new Date();
    const datum = now.toISOString().slice(0, 10);
    const existing = db.select().from(palaceDiary)
      .where(and(eq(palaceDiary.wingId, wingId), eq(palaceDiary.datum, datum)))
      .orderBy(desc(palaceDiary.erstelltAm)).limit(1).get();

    const line = `[${outcome}] ${taskTitel}: ${insight.slice(0, 240)}`;

    if (existing) {
      const merged = (existing.knowledge ? existing.knowledge + '\n' : '') + line;
      db.update(palaceDiary)
        .set({ knowledge: merged.slice(-8000) })
        .where(eq(palaceDiary.id, existing.id)).run();
    } else {
      db.insert(palaceDiary).values({
        id: crypto.randomUUID(), wingId, datum,
        thought: null, action: null, knowledge: line,
        erstelltAm: now.toISOString(),
      }).run();
    }
  } catch (e: any) {
    console.warn(`[Learning] failed to record: ${e.message}`);
  }
}

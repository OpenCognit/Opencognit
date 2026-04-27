// Budget Forecasting
//
// Answers: "At the current burn rate, when does this policy hit its limit?"
// Pure read side — no side effects, safe to call from any route.

import { db } from '../db/client.js';
import { budgetPolicies, costEntries, agents } from '../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';

export interface PolicyForecast {
  policyId: string;
  scope: 'company' | 'project' | 'agent';
  scopeId: string;
  scopeLabel: string;
  limitCent: number;
  spentCent: number;
  percentUsed: number;
  fenster: 'monatlich' | 'lifetime';
  burnRateCentPerDay: number;
  daysObserved: number;
  /** ISO date when limit is projected to be hit — null if never at current rate or already over. */
  projectedHitAt: string | null;
  /** Days until projected hit (for monthly windows, capped at window end). */
  daysToHit: number | null;
  /** For monthly windows: will the limit be exceeded before month-end at current burn? */
  willExceedThisWindow: boolean;
  warnProzent: number;
  triggered: 'none' | 'warn' | 'hard';
}

function startOfMonthIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfMonthIso(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(1, ms / (1000 * 60 * 60 * 24));
}

export function getForecasts(unternehmenId: string): PolicyForecast[] {
  const policies = db.select().from(budgetPolicies)
    .where(and(eq(budgetPolicies.companyId, unternehmenId), eq(budgetPolicies.active, true)))
    .all();

  if (policies.length === 0) return [];

  const sinceIso = startOfMonthIso();
  const monthEndMs = new Date(endOfMonthIso()).getTime();

  const expertMap = new Map<string, string>();
  db.select({ id: agents.id, name: agents.name })
    .from(agents).where(eq(agents.companyId, unternehmenId)).all()
    .forEach(e => expertMap.set(e.id, e.name));

  return policies.map(policy => {
    const spendRow = db.select({ total: sql<number>`COALESCE(SUM(${costEntries.costCent}), 0)` })
      .from(costEntries)
      .where(and(
        eq(costEntries.companyId, unternehmenId),
        ...(policy.scope === 'agent' ? [eq(costEntries.agentId, policy.scopeId)] : []),
        ...(policy.fenster === 'monatlich' ? [gte(costEntries.timestamp, sinceIso)] : []),
      )).all();
    const spent = (spendRow[0]?.total ?? 0) as number;

    const daysObserved = policy.fenster === 'monatlich' ? daysSince(sinceIso) : daysSince(policy.createdAt);
    const burnRate = spent / daysObserved;

    const remaining = policy.limitCent - spent;
    let projectedHitAt: string | null = null;
    let daysToHit: number | null = null;
    let willExceedThisWindow = false;

    if (remaining <= 0) {
      projectedHitAt = new Date().toISOString();
      daysToHit = 0;
      willExceedThisWindow = true;
    } else if (burnRate > 0) {
      daysToHit = remaining / burnRate;
      const hitMs = Date.now() + daysToHit * 24 * 60 * 60 * 1000;
      projectedHitAt = new Date(hitMs).toISOString();
      willExceedThisWindow = policy.fenster === 'monatlich' ? hitMs < monthEndMs : true;
    }

    const percentUsed = policy.limitCent > 0 ? (spent / policy.limitCent) * 100 : 0;
    const warnThreshold = policy.limitCent * ((policy.warnProzent ?? 80) / 100);
    const triggered: PolicyForecast['triggered'] =
      spent >= policy.limitCent ? 'hard' : spent >= warnThreshold ? 'warn' : 'none';

    let scopeLabel = policy.scopeId;
    if (policy.scope === 'agent') scopeLabel = expertMap.get(policy.scopeId) || policy.scopeId;
    if (policy.scope === 'company') scopeLabel = 'Company';

    return {
      policyId: policy.id,
      scope: policy.scope as any,
      scopeId: policy.scopeId,
      scopeLabel,
      limitCent: policy.limitCent,
      spentCent: spent,
      percentUsed,
      fenster: policy.fenster as any,
      burnRateCentPerDay: Math.round(burnRate),
      daysObserved: Math.round(daysObserved * 10) / 10,
      projectedHitAt,
      daysToHit: daysToHit === null ? null : Math.round(daysToHit * 10) / 10,
      willExceedThisWindow,
      warnProzent: policy.warnProzent ?? 80,
      triggered,
    };
  });
}

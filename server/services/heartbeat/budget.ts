// Heartbeat Budget — policy enforcement and usage recording

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { budgetPolicies, budgetIncidents, costEntries, agents, workCycles } from '../../db/schema.js';
import { eq, and, sql, gte } from 'drizzle-orm';

/**
 * Check budget policies before executing a task.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export async function checkBudgetAndEnforce(
  agentId: string,
  companyId: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const activePolicies = db.select().from(budgetPolicies)
      .where(and(
        eq(budgetPolicies.companyId, companyId),
        eq(budgetPolicies.active, true)
      )).all();

    if (activePolicies.length === 0) return { allowed: true };

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfMonthIso = startOfMonth.toISOString();

    for (const policy of activePolicies) {
      // Apply scope filter
      if (policy.scope === 'agent' && policy.scopeId !== agentId) continue;
      if (policy.scope === 'company' && policy.scopeId !== companyId) continue;
      if (policy.scope === 'project') continue; // needs task context, skip for now

      // Calculate current spend
      const spendRows = db.select({ total: sql<number>`COALESCE(SUM(${costEntries.costCent}), 0)` })
        .from(costEntries)
        .where(and(
          eq(costEntries.companyId, companyId),
          ...(policy.scope === 'agent' ? [eq(costEntries.agentId, agentId)] : []),
          ...(policy.window === 'monatlich' ? [gte(costEntries.timestamp, startOfMonthIso)] : [])
        )).all();

      const spent = (spendRows[0]?.total ?? 0) as number;

      // Warning threshold
      const warnThreshold = Math.floor(policy.limitCent * ((policy.warnPercent ?? 80) / 100));
      if (spent >= warnThreshold && spent < policy.limitCent) {
        // Check if we already have an open warning incident
        const existingWarn = db.select().from(budgetIncidents)
          .where(and(
            eq(budgetIncidents.policyId, policy.id),
            eq(budgetIncidents.type, 'warnung'),
            eq(budgetIncidents.status, 'offen')
          )).all();

        if (existingWarn.length === 0) {
          db.insert(budgetIncidents).values({
            id: crypto.randomUUID(),
            policyId: policy.id,
            companyId,
            type: 'warnung',
            beobachteterBetrag: spent,
            limitBetrag: policy.limitCent,
            status: 'offen',
            createdAt: new Date().toISOString(),
          }).run();
          console.log(`  ⚠️ Budget-Warnung: ${(spent / 100).toFixed(2)}€ von ${(policy.limitCent / 100).toFixed(2)}€ erreicht (Policy: ${policy.id})`);
        }
      }

      // Hard stop
      if (policy.hardStop && spent >= policy.limitCent) {
        db.insert(budgetIncidents).values({
          id: crypto.randomUUID(),
          policyId: policy.id,
          companyId,
          type: 'hard_stop',
          beobachteterBetrag: spent,
          limitBetrag: policy.limitCent,
          status: 'offen',
          createdAt: new Date().toISOString(),
        }).run();

        const reason = `Budget-Limit erreicht: ${(spent / 100).toFixed(2)}€ von ${(policy.limitCent / 100).toFixed(2)}€ (${policy.window})`;
        console.log(`  🛑 ${reason} — Task-Ausführung blockiert`);
        return { allowed: false, reason };
      }
    }

    return { allowed: true };
  } catch (e) {
    console.error('Budget-Check Fehler (fail-open):', e);
    return { allowed: true }; // fail-open: don't block on check errors
  }
}

/**
 * Record usage/costs for a run
 */
export async function recordUsage(
  runId: string,
  getRun: (runId: string) => Promise<{ agentId: string; companyId: string; contextSnapshot?: any } | null>,
  usage: { inputTokens: number; outputTokens: number; costCents: number }
): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;

  // Update heartbeat run with usage
  await db.update(workCycles)
    .set({
      usageJson: JSON.stringify(usage),
    })
    .where(eq(workCycles.id, runId));

  // Update expert's monthly spending
  await db.update(agents)
    .set({
      monthlySpendCent: sql`${agents.monthlySpendCent} + ${usage.costCents}`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(agents.id, run.agentId));

  // Create cost event record
  await db.insert(costEntries).values({
    id: crypto.randomUUID(),
    companyId: run.companyId,
    agentId: run.agentId,
    taskId: run.contextSnapshot?.issueId || null,
    provider: 'heartbeat',
    model: 'system',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costCent: usage.costCents,
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
}

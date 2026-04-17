// Heartbeat Budget — policy enforcement and usage recording

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { budgetPolicies, budgetIncidents, kostenbuchungen, experten, arbeitszyklen } from '../../db/schema.js';
import { eq, and, sql, gte } from 'drizzle-orm';

/**
 * Check budget policies before executing a task.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export async function checkBudgetAndEnforce(
  expertId: string,
  unternehmenId: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const activePolicies = db.select().from(budgetPolicies)
      .where(and(
        eq(budgetPolicies.unternehmenId, unternehmenId),
        eq(budgetPolicies.aktiv, 1)
      )).all();

    if (activePolicies.length === 0) return { allowed: true };

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfMonthIso = startOfMonth.toISOString();

    for (const policy of activePolicies) {
      // Apply scope filter
      if (policy.scope === 'agent' && policy.scopeId !== expertId) continue;
      if (policy.scope === 'company' && policy.scopeId !== unternehmenId) continue;
      if (policy.scope === 'project') continue; // needs task context, skip for now

      // Calculate current spend
      const spendRows = db.select({ total: sql<number>`COALESCE(SUM(${kostenbuchungen.kostenCent}), 0)` })
        .from(kostenbuchungen)
        .where(and(
          eq(kostenbuchungen.unternehmenId, unternehmenId),
          ...(policy.scope === 'agent' ? [eq(kostenbuchungen.expertId, expertId)] : []),
          ...(policy.fenster === 'monatlich' ? [gte(kostenbuchungen.zeitpunkt, startOfMonthIso)] : [])
        )).all();

      const spent = (spendRows[0]?.total ?? 0) as number;

      // Warning threshold
      const warnThreshold = Math.floor(policy.limitCent * ((policy.warnProzent ?? 80) / 100));
      if (spent >= warnThreshold && spent < policy.limitCent) {
        // Check if we already have an open warning incident
        const existingWarn = db.select().from(budgetIncidents)
          .where(and(
            eq(budgetIncidents.policyId, policy.id),
            eq(budgetIncidents.typ, 'warnung'),
            eq(budgetIncidents.status, 'offen')
          )).all();

        if (existingWarn.length === 0) {
          db.insert(budgetIncidents).values({
            id: crypto.randomUUID(),
            policyId: policy.id,
            unternehmenId,
            typ: 'warnung',
            beobachteterBetrag: spent,
            limitBetrag: policy.limitCent,
            status: 'offen',
            erstelltAm: new Date().toISOString(),
          }).run();
          console.log(`  ⚠️ Budget-Warnung: ${(spent / 100).toFixed(2)}€ von ${(policy.limitCent / 100).toFixed(2)}€ erreicht (Policy: ${policy.id})`);
        }
      }

      // Hard stop
      if (policy.hardStop && spent >= policy.limitCent) {
        db.insert(budgetIncidents).values({
          id: crypto.randomUUID(),
          policyId: policy.id,
          unternehmenId,
          typ: 'hard_stop',
          beobachteterBetrag: spent,
          limitBetrag: policy.limitCent,
          status: 'offen',
          erstelltAm: new Date().toISOString(),
        }).run();

        const reason = `Budget-Limit erreicht: ${(spent / 100).toFixed(2)}€ von ${(policy.limitCent / 100).toFixed(2)}€ (${policy.fenster})`;
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
  getRun: (runId: string) => Promise<{ expertId: string; unternehmenId: string; contextSnapshot?: any } | null>,
  usage: { inputTokens: number; outputTokens: number; costCents: number }
): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;

  // Update heartbeat run with usage
  await db.update(arbeitszyklen)
    .set({
      usageJson: JSON.stringify(usage),
    })
    .where(eq(arbeitszyklen.id, runId));

  // Update expert's monthly spending
  await db.update(experten)
    .set({
      verbrauchtMonatCent: sql`${experten.verbrauchtMonatCent} + ${usage.costCents}`,
      aktualisiertAm: new Date().toISOString(),
    })
    .where(eq(experten.id, run.expertId));

  // Create cost event record
  await db.insert(kostenbuchungen).values({
    id: crypto.randomUUID(),
    unternehmenId: run.unternehmenId,
    expertId: run.expertId,
    aufgabeId: run.contextSnapshot?.issueId || null,
    anbieter: 'heartbeat',
    modell: 'system',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    kostenCent: usage.costCents,
    zeitpunkt: new Date().toISOString(),
    erstelltAm: new Date().toISOString(),
  });
}

// Budget Policy Service — Scope-Hierarchie + Incidents
// Ersetzt das einfache budgetMonatCent pro Agent durch ein echtes Policy-System.

import { db } from '../db/client.js';
import { budgetPolicies, budgetIncidents, costEntries, agents } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export interface BudgetStatus {
  policyId: string;
  scope: string;
  scopeId: string;
  limitCent: number;
  verbrauchtCent: number;
  prozent: number;
  status: 'ok' | 'warnung' | 'hard_stop';
  warnProzent: number;
  hardStop: boolean;
}

/**
 * Berechnet den aktuellen Budget-Status für eine Policy.
 */
export function berechneBudgetStatus(policyId: string): BudgetStatus | null {
  const policy = db.select().from(budgetPolicies).where(eq(budgetPolicies.id, policyId)).get();
  if (!policy || !policy.active) return null;

  // Verbrauch berechnen (abhängig vom Scope)
  let verbrauchtCent = 0;

  if (policy.fenster === 'monatlich') {
    const monatsStart = new Date();
    monatsStart.setDate(1);
    monatsStart.setHours(0, 0, 0, 0);
    const startISO = monatsStart.toISOString();

    const buchungen = db.select().from(costEntries)
      .where(eq(costEntries.companyId, policy.companyId))
      .all()
      .filter(b => b.timestamp >= startISO);

    if (policy.scope === 'agent') {
      verbrauchtCent = buchungen.filter(b => b.agentId === policy.scopeId).reduce((s, b) => s + b.costCent, 0);
    } else if (policy.scope === 'company') {
      verbrauchtCent = buchungen.reduce((s, b) => s + b.costCent, 0);
    } else if (policy.scope === 'project') {
      // Project-Scope: Alle Buchungen deren Task zum Projekt gehört
      verbrauchtCent = buchungen.reduce((s, b) => s + b.costCent, 0); // Vereinfacht
    }
  } else {
    // Lifetime: Alle Buchungen
    const buchungen = db.select().from(costEntries)
      .where(eq(costEntries.companyId, policy.companyId))
      .all();

    if (policy.scope === 'agent') {
      verbrauchtCent = buchungen.filter(b => b.agentId === policy.scopeId).reduce((s, b) => s + b.costCent, 0);
    } else {
      verbrauchtCent = buchungen.reduce((s, b) => s + b.costCent, 0);
    }
  }

  const prozent = policy.limitCent > 0 ? Math.round((verbrauchtCent / policy.limitCent) * 100) : 0;

  let status: 'ok' | 'warnung' | 'hard_stop' = 'ok';
  if (prozent >= 100 && policy.hardStop) status = 'hard_stop';
  else if (prozent >= policy.warnProzent) status = 'warnung';

  return {
    policyId: policy.id,
    scope: policy.scope,
    scopeId: policy.scopeId,
    limitCent: policy.limitCent,
    verbrauchtCent,
    prozent,
    status,
    warnProzent: policy.warnProzent,
    hardStop: policy.hardStop,
  };
}

/**
 * Prüft alle aktiven Policies und erstellt Incidents bei Überschreitungen.
 * Gibt die Anzahl neuer Incidents zurück.
 */
export function pruefeBudgets(unternehmenId: string): number {
  const policies = db.select().from(budgetPolicies)
    .where(and(eq(budgetPolicies.companyId, unternehmenId), eq(budgetPolicies.active, true)))
    .all();

  let neueIncidents = 0;
  const now = new Date().toISOString();

  for (const policy of policies) {
    const status = berechneBudgetStatus(policy.id);
    if (!status) continue;

    if (status.status === 'warnung' || status.status === 'hard_stop') {
      // Prüfe ob es schon einen offenen Incident gibt
      const existierend = db.select().from(budgetIncidents)
        .where(and(
          eq(budgetIncidents.policyId, policy.id),
          eq(budgetIncidents.status, 'offen')
        ))
        .get();

      if (!existierend) {
        db.insert(budgetIncidents).values({
          id: uuid(),
          policyId: policy.id,
          unternehmenId,
          type: status.status === 'hard_stop' ? 'hard_stop' : 'warnung',
          beobachteterBetrag: status.verbrauchtCent,
          limitBetrag: status.limitCent,
          status: 'offen',
          createdAt: now,
        }).run();
        neueIncidents++;

        // Bei Hard Stop: Agent pausieren
        if (status.status === 'hard_stop' && policy.scope === 'agent') {
          db.update(agents).set({ status: 'paused', updatedAt: now })
            .where(eq(agents.id, policy.scopeId)).run();
          console.log(`⛔ Budget Hard Stop: Agent ${policy.scopeId} pausiert (${status.prozent}%)`);
        }
      }
    }
  }

  return neueIncidents;
}

/**
 * Erstellt eine neue Budget-Policy.
 */
export function erstellePolicy(params: {
  unternehmenId: string;
  scope: 'company' | 'project' | 'agent';
  scopeId: string;
  limitCent: number;
  fenster?: 'monatlich' | 'lifetime';
  warnProzent?: number;
  hardStop?: boolean;
}): string {
  const id = uuid();
  const now = new Date().toISOString();

  db.insert(budgetPolicies).values({
    id,
    companyId: params.unternehmenId,
    scope: params.scope,
    scopeId: params.scopeId,
    limitCent: params.limitCent,
    fenster: params.fenster || 'monatlich',
    warnProzent: params.warnProzent || 80,
    hardStop: params.hardStop !== false,
    active: true,
    createdAt: now,
    updatedAt: now,
  }).run();

  return id;
}

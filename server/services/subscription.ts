// =============================================================================
// Subscription Service — PR-BILL-1 Subscription Plan + Entitlement Backbone
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  subscriptionPlans,
  subscriptionPlanModules,
  tenantSubscriptions,
  tenantEntitlements,
  tenantUsageLimits,
  subscriptionEvents,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ActivateSubscriptionParams {
  companyId: string;
  planCode: string;  // 'starter' | 'professional' | 'enterprise' | 'developer' | 'ngo'
  trialDays?: number;
}

export interface UpdateEntitlementParams {
  isActive?: boolean;
  limitType?: string;
  limitValue?: number;
}

export interface UsageLimitParams {
  companyId: string;
  limitType: string;  // 'users', 'projects', 'storage', 'ai_requests'
  currentValue: number;
  maxValue?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const subscriptionService = {
  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------
  getPlanByCode(code: string) {
    return db.select().from(subscriptionPlans)
      .where(eq(subscriptionPlans.code, code)).get() || null;
  },

  getPlanModules(planId: string) {
    return db.select().from(subscriptionPlanModules)
      .where(eq(subscriptionPlanModules.planId, planId)).all();
  },

  listActivePlans() {
    return db.select().from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, 1)).all();
  },

  // -------------------------------------------------------------------------
  // Tenant Subscription
  // -------------------------------------------------------------------------
  activateSubscription(params: ActivateSubscriptionParams) {
    const plan = this.getPlanByCode(params.planCode);
    if (!plan) throw new Error(`Plan "${params.planCode}" not found.`);

    const subId = uuid();
    const now = new Date().toISOString();
    const trialEnd = params.trialDays
      ? new Date(Date.now() + params.trialDays * 86400000).toISOString()
      : null;

    // Deactivate any existing subscription
    db.update(tenantSubscriptions)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(
        eq(tenantSubscriptions.companyId, params.companyId),
        eq(tenantSubscriptions.status, 'active'),
      ))
      .run();

    // Create new subscription
    const sub = db.insert(tenantSubscriptions).values({
      id: subId,
      companyId: params.companyId,
      planId: plan.id,
      status: 'trial',
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
    }).returning().get();

    // Seed entitlements from plan modules
    const modules = this.getPlanModules(plan.id);
    for (const m of modules) {
      db.insert(tenantEntitlements).values({
        id: uuid(),
        subscriptionId: subId,
        companyId: params.companyId,
        moduleKey: m.moduleKey,
      }).run();
    }

    // Record event
    this.recordEvent(subId, params.companyId, 'activated', null, params.planCode, 'system');

    return this.getSubscription(subId);
  },

  getSubscription(subscriptionId: string) {
    const sub = db.select().from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.id, subscriptionId)).get();
    if (!sub) return null;

    const entitlements = db.select().from(tenantEntitlements)
      .where(eq(tenantEntitlements.subscriptionId, subscriptionId)).all();

    const events = db.select().from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, subscriptionId))
      .orderBy(desc(subscriptionEvents.createdAt)).all();

    return { subscription: sub, entitlements, events };
  },

  getSubscriptionByCompany(companyId: string) {
    const sub = db.select().from(tenantSubscriptions)
      .where(and(
        eq(tenantSubscriptions.companyId, companyId),
        eq(tenantSubscriptions.status, 'active'),
      )).get() || db.select().from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.companyId, companyId))
      .orderBy(desc(tenantSubscriptions.createdAt))
      .limit(1)
      .get();
    if (!sub) return null;
    return this.getSubscription(sub.id);
  },

  updateSubscriptionStatus(subscriptionId: string, status: string, actor: string) {
    const sub = db.select().from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.id, subscriptionId)).get();
    if (!sub) throw new Error('Subscription not found.');

    const oldStatus = sub.status;
    const result = db.update(tenantSubscriptions)
      .set({ status: status as any, updatedAt: new Date().toISOString() })
      .where(eq(tenantSubscriptions.id, subscriptionId))
      .returning()
      .get();

    this.recordEvent(subscriptionId, sub.companyId, 'status_change', oldStatus, status, actor);

    return result;
  },

  // -------------------------------------------------------------------------
  // Entitlements
  // -------------------------------------------------------------------------
  isModuleEnabled(companyId: string, moduleKey: string): boolean {
    const ent = db.select().from(tenantEntitlements)
      .where(and(
        eq(tenantEntitlements.companyId, companyId),
        eq(tenantEntitlements.moduleKey, moduleKey),
        eq(tenantEntitlements.isActive, 1),
      )).get();

    // Check for 'all' entitlement
    if (!ent) {
      const allEnt = db.select().from(tenantEntitlements)
        .where(and(
          eq(tenantEntitlements.companyId, companyId),
          eq(tenantEntitlements.moduleKey, 'all'),
          eq(tenantEntitlements.isActive, 1),
        )).get();
      return !!allEnt;
    }

    return true;
  },

  updateEntitlement(entitlementId: string, params: UpdateEntitlementParams) {
    const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (params.isActive !== undefined) updates.isActive = params.isActive ? 1 : 0;
    if (params.limitType) updates.limitType = params.limitType;
    if (params.limitValue !== undefined) updates.limitValue = params.limitValue;

    return db.update(tenantEntitlements)
      .set(updates)
      .where(eq(tenantEntitlements.id, entitlementId))
      .returning()
      .get();
  },

  // -------------------------------------------------------------------------
  // Usage Limits
  // -------------------------------------------------------------------------
  recordUsageLimit(params: UsageLimitParams) {
    return db.insert(tenantUsageLimits).values({
      id: uuid(),
      companyId: params.companyId,
      limitType: params.limitType,
      currentValue: params.currentValue,
      maxValue: params.maxValue ?? null,
    }).returning().get();
  },

  getLatestUsageLimits(companyId: string) {
    return db.select().from(tenantUsageLimits)
      .where(eq(tenantUsageLimits.companyId, companyId))
      .orderBy(desc(tenantUsageLimits.snapshotAt))
      .limit(6)  // 4 core limits + buffer
      .all();
  },

  checkLimitBreach(companyId: string): { limitType: string; current: number; max: number | null }[] {
    const limits = this.getLatestUsageLimits(companyId);
    return limits
      .filter(l => l.maxValue !== null && l.currentValue > l.maxValue!)
      .map(l => ({ limitType: l.limitType, current: l.currentValue, max: l.maxValue! }));
  },

  // -------------------------------------------------------------------------
  // Events (audit trail)
  // -------------------------------------------------------------------------
  recordEvent(subscriptionId: string, companyId: string, eventType: string, oldValue: string | null, newValue: string | null, actor: string) {
    db.insert(subscriptionEvents).values({
      id: uuid(),
      subscriptionId,
      companyId,
      eventType,
      oldValue,
      newValue,
      actor,
    }).run();
  },
};

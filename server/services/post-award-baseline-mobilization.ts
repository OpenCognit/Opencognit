// =============================================================================
// Post-Award Baseline + Mobilization + Activation — PR-PAW-2+3+4+5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  projectBaselines, projectBudgetBaselines, projectScheduleBaselines,
  projectMobilizationPlans, projectMobilizationItems, projectAwards,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const baselineService = {
  createBaseline(params: {
    companyId: string; projectId: string; awardId: string;
    notes?: string;
  }) {
    return db.insert(projectBaselines).values({
      id: uuid(), companyId: params.companyId,
      projectId: params.projectId, awardId: params.awardId,
      notes: params.notes || null,
    }).returning().get();
  },

  setBudgetLine(params: {
    baselineId: string; approvedAmount: number;
    boqItemId?: string; costCodeId?: string; activityId?: string;
    tenderedAmount?: number;
  }) {
    const varianceAmount = params.tenderedAmount != null
      ? params.approvedAmount - params.tenderedAmount : null;
    return db.insert(projectBudgetBaselines).values({
      id: uuid(), baselineId: params.baselineId,
      approvedAmount: params.approvedAmount,
      boqItemId: params.boqItemId || null,
      costCodeId: params.costCodeId || null,
      activityId: params.activityId || null,
      tenderedAmount: params.tenderedAmount ?? null,
      varianceAmount,
    }).returning().get();
  },

  getBudgetVariances(baselineId: string) {
    return db.select().from(projectBudgetBaselines)
      .where(eq(projectBudgetBaselines.baselineId, baselineId)).all();
  },

  addScheduleLine(params: {
    baselineId: string; activityName: string; startDate: string;
    endDate: string; durationDays?: number; predecessor?: string;
    criticalPath?: boolean; notes?: string;
  }) {
    return db.insert(projectScheduleBaselines).values({
      id: uuid(), baselineId: params.baselineId,
      activityName: params.activityName,
      startDate: params.startDate, endDate: params.endDate,
      durationDays: params.durationDays ?? null,
      predecessor: params.predecessor || null,
      criticalPath: params.criticalPath ? 1 : 0,
      notes: params.notes || null,
    }).returning().get();
  },

  approveBaseline(baselineId: string, approvedBy: string) {
    return db.update(projectBaselines).set({
      status: 'approved', approvedBy, approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(projectBaselines.id, baselineId)).returning().get();
  },

  lockBaseline(baselineId: string, lockedBy: string) {
    return db.update(projectBaselines).set({
      status: 'locked', lockedBy, lockedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(projectBaselines.id, baselineId)).returning().get();
  },
};

export const mobilizationService = {
  createPlan(params: {
    awardId: string; projectId: string; targetStartDate?: string;
    notes?: string;
  }) {
    return db.insert(projectMobilizationPlans).values({
      id: uuid(), awardId: params.awardId,
      projectId: params.projectId,
      targetStartDate: params.targetStartDate || null,
      notes: params.notes || null,
    }).returning().get();
  },

  addMobilizationItem(params: {
    mobilizationPlanId: string; item: string; category?: string;
    owner?: string; dueDate?: string;
  }) {
    return db.insert(projectMobilizationItems).values({
      id: uuid(), mobilizationPlanId: params.mobilizationPlanId,
      item: params.item, category: params.category || 'general',
      owner: params.owner || null, dueDate: params.dueDate || null,
    }).returning().get();
  },

  completeMobilizationItem(itemId: string, completedBy: string) {
    return db.update(projectMobilizationItems).set({
      completed: 1, completedBy, completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(projectMobilizationItems.id, itemId)).returning().get();
  },

  markBlocker(itemId: string, reason: string) {
    return db.update(projectMobilizationItems).set({
      blocker: 1, blockerReason: reason, updatedAt: new Date().toISOString(),
    }).where(eq(projectMobilizationItems.id, itemId)).returning().get();
  },

  getBlockers(planId: string) {
    return db.select().from(projectMobilizationItems)
      .where(and(
        eq(projectMobilizationItems.mobilizationPlanId, planId),
        eq(projectMobilizationItems.blocker, 1),
      )).all();
  },

  mobilizationReadiness(planId: string) {
    const items = db.select().from(projectMobilizationItems)
      .where(eq(projectMobilizationItems.mobilizationPlanId, planId)).all();
    const total = items.length;
    const completed = items.filter(i => i.completed === 1).length;
    const blockers = items.filter(i => i.blocker === 1).length;
    return {
      planId, total, completed, pending: total - completed,
      blockers, ready: completed === total && blockers === 0,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  },

  approvePlan(planId: string, approvedBy: string) {
    return db.update(projectMobilizationPlans).set({
      status: 'approved', approvedBy, approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(projectMobilizationPlans.id, planId)).returning().get();
  },
};

export const activationService = {
  canActivate(awardId: string) {
    const award = db.select().from(projectAwards).where(eq(projectAwards.id, awardId)).get();
    if (!award || award.awardStatus !== 'accepted') return { canActivate: false, reason: 'Award not accepted' };

    const baseline = db.select().from(projectBaselines)
      .where(eq(projectBaselines.awardId, awardId)).get();
    if (!baseline || baseline.status !== 'approved') return { canActivate: false, reason: 'Baseline not approved' };

    const plan = db.select().from(projectMobilizationPlans)
      .where(eq(projectMobilizationPlans.awardId, awardId)).get();
    if (!plan) return { canActivate: false, reason: 'No mobilization plan' };

    const readiness = this.mobilizationReadiness?.(plan.id) || { ready: false };
    if (!readiness.ready) return { canActivate: false, reason: 'Mobilization not complete' };

    return { canActivate: true };
  },

  activateProject(awardId: string, activatedBy: string) {
    const check = this.canActivate(awardId);
    if (!check.canActivate) throw new Error(check.reason);

    return db.update(projectAwards).set({
      awardStatus: 'active_project',
      updatedAt: new Date().toISOString(),
    }).where(eq(projectAwards.id, awardId)).returning().get();
  },
};

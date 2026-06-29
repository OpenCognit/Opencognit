// =============================================================================
// Customer Success Service — PR-CS-1 Tenant Onboarding Plan
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  tenantOnboardingPlans,
  tenantOnboardingTasks,
  tenantHealthScores,
  tenantUsageSnapshots,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Default onboarding tasks
// ---------------------------------------------------------------------------
const DEFAULT_TASKS = [
  { task: 'Company profile configured', category: 'setup' },
  { task: 'Regions and currencies set', category: 'setup' },
  { task: 'Departments defined', category: 'setup' },
  { task: 'Roles assigned to users', category: 'configuration' },
  { task: 'Approval matrix configured', category: 'configuration' },
  { task: 'Vendor register populated', category: 'configuration' },
  { task: 'Materials catalogue set up', category: 'configuration' },
  { task: 'Cost codes defined', category: 'configuration' },
  { task: 'PM training completed', category: 'training' },
  { task: 'QS training completed', category: 'training' },
  { task: 'Storekeeper training completed', category: 'training' },
  { task: 'Foreman training completed', category: 'training' },
  { task: 'First project created', category: 'activation' },
  { task: 'Daily work module active', category: 'activation' },
  { task: 'IPC workflow active', category: 'activation' },
  { task: 'Executive cockpit viewed', category: 'activation' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CreatePlanParams {
  companyId: string;
  assignedTo?: string;
  targetCompletionDate?: string;
}

export interface UpdateTaskParams {
  status?: string;
  owner?: string;
  comment?: string;
}

export interface HealthScoreParams {
  companyId: string;
  score: number;
  setupScore?: number;
  adoptionScore?: number;
  supportScore?: number;
  riskFlags?: string[];
}

export interface UsageSnapshotParams {
  companyId: string;
  activeUsers?: number;
  totalUsers?: number;
  modulesActive?: string[];
  workflowsCompleted?: number;
  dailyWorkSubmitted?: number;
  approvalsCompleted?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const csService = {
  // -------------------------------------------------------------------------
  // Onboarding Plan
  // -------------------------------------------------------------------------
  createOnboardingPlan(params: CreatePlanParams) {
    const planId = uuid();

    const plan = db.insert(tenantOnboardingPlans).values({
      id: planId,
      companyId: params.companyId,
      assignedTo: params.assignedTo || null,
      targetCompletionDate: params.targetCompletionDate || null,
    }).returning().get();

    // Seed default tasks
    for (const t of DEFAULT_TASKS) {
      db.insert(tenantOnboardingTasks).values({
        id: uuid(),
        planId,
        task: t.task,
        category: t.category,
      }).run();
    }

    return this.getOnboardingPlan(planId);
  },

  getOnboardingPlan(planId: string) {
    const plan = db.select().from(tenantOnboardingPlans)
      .where(eq(tenantOnboardingPlans.id, planId)).get();
    if (!plan) return null;

    const tasks = db.select().from(tenantOnboardingTasks)
      .where(eq(tenantOnboardingTasks.planId, planId)).all();

    return { plan, tasks };
  },

  getPlanByCompany(companyId: string) {
    const plan = db.select().from(tenantOnboardingPlans)
      .where(eq(tenantOnboardingPlans.companyId, companyId)).get();
    if (!plan) return null;
    return this.getOnboardingPlan(plan.id);
  },

  updateTask(taskId: string, params: UpdateTaskParams) {
    const now = new Date().toISOString();
    const updates: Record<string, any> = { updatedAt: now };

    if (params.status) updates.status = params.status;
    if (params.owner) updates.owner = params.owner;
    if (params.comment) updates.comment = params.comment;

    if (params.status === 'completed') {
      updates.completedAt = now;
    }

    const task = db.update(tenantOnboardingTasks)
      .set(updates)
      .where(eq(tenantOnboardingTasks.id, taskId))
      .returning()
      .get();

    // Recalculate plan progress
    this.recalculateProgress(task.planId);

    return task;
  },

  recalculateProgress(planId: string) {
    const tasks = db.select().from(tenantOnboardingTasks)
      .where(eq(tenantOnboardingTasks.planId, planId)).all();

    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length;
    const blocked = tasks.some(t => t.status === 'blocked');
    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const status = completed === total ? 'completed'
      : completed > 0 ? 'in_progress'
      : blocked ? 'blocked'
      : 'not_started';

    db.update(tenantOnboardingPlans)
      .set({
        progressPct,
        status: status as any,
        completedAt: completed === total ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tenantOnboardingPlans.id, planId))
      .run();
  },

  // -------------------------------------------------------------------------
  // Health Scores
  // -------------------------------------------------------------------------
  recordHealthScore(params: HealthScoreParams) {
    return db.insert(tenantHealthScores).values({
      id: uuid(),
      companyId: params.companyId,
      score: params.score,
      setupScore: params.setupScore ?? null,
      adoptionScore: params.adoptionScore ?? null,
      supportScore: params.supportScore ?? null,
      riskFlags: params.riskFlags ? JSON.stringify(params.riskFlags) : null,
    }).returning().get();
  },

  getLatestHealthScore(companyId: string) {
    return db.select().from(tenantHealthScores)
      .where(eq(tenantHealthScores.companyId, companyId))
      .orderBy(desc(tenantHealthScores.snapshotAt))
      .limit(1)
      .get() || null;
  },

  // -------------------------------------------------------------------------
  // Usage Snapshots
  // -------------------------------------------------------------------------
  recordUsageSnapshot(params: UsageSnapshotParams) {
    return db.insert(tenantUsageSnapshots).values({
      id: uuid(),
      companyId: params.companyId,
      activeUsers: params.activeUsers ?? null,
      totalUsers: params.totalUsers ?? null,
      modulesActive: params.modulesActive ? JSON.stringify(params.modulesActive) : null,
      workflowsCompleted: params.workflowsCompleted ?? null,
      dailyWorkSubmitted: params.dailyWorkSubmitted ?? null,
      approvalsCompleted: params.approvalsCompleted ?? null,
    }).returning().get();
  },

  getLatestUsageSnapshot(companyId: string) {
    return db.select().from(tenantUsageSnapshots)
      .where(eq(tenantUsageSnapshots.companyId, companyId))
      .orderBy(desc(tenantUsageSnapshots.snapshotAt))
      .limit(1)
      .get() || null;
  },
};

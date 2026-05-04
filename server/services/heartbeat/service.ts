// Heartbeat Service — main HeartbeatServiceImpl orchestrator
// Delegates to focused sub-modules; keeps only the core execution flow.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { appEvents } from '../../events.js';
import { db } from '../../db/client.js';
import {
  workCycles, agentWakeupRequests, agents, tasks, companies, projects,
  costEntries, comments, workProducts, chatMessages, activityLog,
  goals, issueRelations, settings, budgetPolicies, budgetIncidents,
  agentMeetings, approvals, agentPermissions, agentSkills, skillsLibrary,
  routines, routineRuns, palaceKg, traceEvents, ceoDecisionLog,
} from '../../db/schema.js';
import { eq, and, sql, inArray, or, isNull, asc, desc, gte } from 'drizzle-orm';
import { unblockDependents } from '../issue-dependencies.js';
import { wakeupService } from '../wakeup.js';
import { adapterRegistry } from '../../adapters/registry.js';
import type { AdapterTask, AdapterContext, CompanyGoal } from '../../adapters/types.js';
import { createWorkspace, listWorkspaceFiles } from '../workspace.js';
import { ensureWorkspace } from '../execution-workspaces.js';
import { isSafeWorkdir } from '../../adapters/workspace-guard.js';
import { v4 as uuid } from 'uuid';
import { messagingService } from '../messaging.js';
import { loadRelevantMemory, autoSaveInsights } from '../memory-auto.js';
import { decryptSetting } from '../../utils/crypto.js';
import { routeModel } from '../model-router.js';
import { recordLearning } from '../agent-performance.js';

// ── Sub-module imports ─────────────────────────────────────────────────────────
import type { HeartbeatInvocationSource, HeartbeatOptions, HeartbeatRun, HeartbeatService } from './types.js';
import { loadSoul, trace, isFocusModeActive } from './utils.js';
import { checkBudgetAndEnforce } from './budget.js';
import { runCriticReview, getAdvisorPlan, getAdvisorCorrection } from './critic.js';
import { processOrchestratorActions } from './actions-orchestrator.js';
import { processWorkerActions } from './actions-worker.js';
import { recordWorkProducts, scanForBlockedTasks, unlockDependentTasks } from './dependencies.js';
import { notifyOrchestratorTaskDone, handleMeetingWakeup } from './notifications.js';
import { parseCheckpoint, saveCheckpoint } from './checkpoint.js';
// ──────────────────────────────────────────────────────────────────────────────

class HeartbeatServiceImpl implements HeartbeatService {
  /**
   * Create a new heartbeat run and execute it
   */
  async executeHeartbeat(
    agentId: string,
    companyId: string,
    options: HeartbeatOptions
  ): Promise<string> {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(workCycles).values({
      id: runId,
      companyId,
      agentId,
      source: options.invocationSource === 'timer' ? 'scheduler' :
              options.invocationSource === 'assignment' ? 'callback' : 'manual',
      status: 'queued',
      invocationSource: options.invocationSource,
      triggerDetail: options.triggerDetail,
      contextSnapshot: options.contextSnapshot ? JSON.stringify(options.contextSnapshot) : null,
      createdAt: now,
    });

    console.log(`🔄 Heartbeat run ${runId} created for expert ${agentId} (${options.invocationSource})`);
    await this.executeRun(runId, agentId, companyId, options);
    return runId;
  }

  /**
   * Process all pending wakeups for an agent
   */
  async processPendingWakeups(agentId: string): Promise<number> {
    const expert = await db.select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (expert.length === 0) {
      console.warn(`⚠️ Expert ${agentId} not found`);
      return 0;
    }

    const agent = expert[0];

    if (agent.status === 'paused' || agent.status === 'terminated') {
      console.log(`⏸️ Skipping heartbeat for paused/terminated agent ${agentId}`);
      return 0;
    }

    // ─── Agent-Level Mutex moved to executeRun for atomic lock ─────────────────
    // Atomic UPDATE ... WHERE status != 'running' is handled inside executeRun
    // ────────────────────────────────────────────────────────────────────────────

    // ─── Budget-Autothrottling (fresh read — not stale from initial load) ───────
    const freshBudget = db.select({
      monthlyBudgetCent: agents.monthlyBudgetCent,
      monthlySpendCent: agents.monthlySpendCent,
      name: agents.name,
      companyId: agents.companyId,
    })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();

    if (freshBudget && freshBudget.monthlyBudgetCent > 0) {
      const verbrauchPct = (freshBudget.monthlySpendCent / freshBudget.monthlyBudgetCent) * 100;

      if (verbrauchPct >= 100) {
        console.log(`💸 Budget erschöpft (${verbrauchPct.toFixed(0)}%) — pausiere Agent ${agentId}`);
        await db.update(agents)
          .set({ status: 'paused', updatedAt: new Date().toISOString() })
          .where(eq(agents.id, agentId));
        await db.insert(chatMessages).values({
          id: crypto.randomUUID(),
          companyId: freshBudget.companyId,
          agentId,
          senderType: 'system',
          message: `🚨 **Budget-Stop**: ${freshBudget.name} wurde automatisch pausiert. Monatsbudget (${(freshBudget.monthlyBudgetCent / 100).toFixed(2)}€) zu 100% verbraucht. Bitte Budget erhöhen oder Agent manuell reaktivieren.`,
          read: false,
          createdAt: new Date().toISOString(),
        });
        return 0;
      }

      if (verbrauchPct >= 80) {
        const recentWarning = await db.select()
          .from(chatMessages)
          .where(and(eq(chatMessages.agentId, agentId), eq(chatMessages.senderType, 'system')))
          .limit(20)
          .then((msgs: { message: string; createdAt: string }[]) => msgs.some((m) =>
            m.message.includes('Budget-Warnung') &&
            new Date(m.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
          ));

        if (!recentWarning) {
          console.log(`⚠️ Budget-Warnung (${verbrauchPct.toFixed(0)}%) für Agent ${agentId}`);
          await db.insert(chatMessages).values({
            id: crypto.randomUUID(),
            companyId: freshBudget.companyId,
            agentId,
            senderType: 'system',
            message: `⚠️ **Budget-Warnung**: ${freshBudget.name} hat ${verbrauchPct.toFixed(0)}% des Monatsbudgets verbraucht (${(freshBudget.monthlySpendCent / 100).toFixed(2)}€ von ${(freshBudget.monthlyBudgetCent / 100).toFixed(2)}€). Bei 100% wird der Agent automatisch pausiert.`,
            read: false,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const pendingWakeups = await wakeupService.getPendingWakeups(agentId, 5);
    if (pendingWakeups.length === 0) return 0;

    let processedCount = 0;

    for (const wakeup of pendingWakeups) {
      try {
        const runId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.insert(workCycles).values({
          id: runId,
          companyId: wakeup.contextSnapshot?.companyId || agent.companyId,
          agentId,
          source: wakeup.source === 'timer' ? 'scheduler' :
                  wakeup.source === 'assignment' ? 'callback' : 'manual',
          status: 'queued',
          invocationSource: wakeup.source,
          triggerDetail: wakeup.triggerDetail,
          contextSnapshot: JSON.stringify(wakeup.contextSnapshot || {}),
          createdAt: now,
        });

        const claimed = await wakeupService.claimWakeup(wakeup.id, runId);
        if (!claimed) {
          console.log(`⏳ Wakeup ${wakeup.id} already claimed by another process — skipping`);
          continue;
        }
        await this.executeRun(runId, agentId, agent.companyId, {
          invocationSource: wakeup.source,
          triggerDetail: wakeup.triggerDetail,
          contextSnapshot: wakeup.contextSnapshot,
          payload: wakeup.payload,
        });
        await wakeupService.completeWakeup(wakeup.id, true);
        processedCount++;
      } catch (error) {
        console.error(`❌ Error processing wakeup ${wakeup.id}:`, error);
        await wakeupService.completeWakeup(wakeup.id, false);
      }
    }

    return processedCount;
  }

  /**
   * Execute a single heartbeat run
   */
  private async executeRun(
    runId: string,
    agentId: string,
    companyId: string,
    options: HeartbeatOptions
  ): Promise<void> {
    const now = new Date().toISOString();

    try {
      const agentExists = db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).get();
      if (!agentExists) {
        console.warn(`⚠️ Heartbeat ${runId}: Agent ${agentId} wurde gelöscht — Ausführung übersprungen`);
        await this.updateRunStatus(runId, 'failed', { error: 'Agent wurde gelöscht' });
        return;
      }

      // ─── Atomarer Agent-Level Mutex ───────────────────────────────────────────
      const lockResult = await db.update(agents)
        .set({ status: 'running', lastCycle: now, updatedAt: now })
        .where(and(
          eq(agents.id, agentId),
          or(
            eq(agents.status, 'idle'),
            eq(agents.status, 'available'),
            eq(agents.status, 'error'),
            eq(agents.status, 'paused'),
            isNull(agents.status)
          )
        ))
        .returning();

      if (lockResult.length === 0) {
        const agentRow = await db.select({ lastCycle: agents.lastCycle })
          .from(agents).where(eq(agents.id, agentId)).get();
        const lastCycleTime = agentRow?.lastCycle ? new Date(agentRow.lastCycle).getTime() : 0;
        const elapsed = Date.now() - lastCycleTime;

        if (elapsed < 5 * 60 * 1000) {
          console.log(`⏳ Agent ${agentId} is already running (${Math.round(elapsed / 1000)}s ago) — skipping duplicate heartbeat`);
          await this.updateRunStatus(runId, 'skipped', { error: 'Agent already running' });
          return;
        }

        console.log(`⏰ Agent ${agentId} stuck running for ${Math.round(elapsed / 1000)}s — reclaiming`);

        const reclaimed = await db.update(agents)
          .set({ status: 'running', lastCycle: now, updatedAt: now })
          .where(and(eq(agents.id, agentId), eq(agents.status, 'running')))
          .returning();

        if (reclaimed.length === 0) {
          console.log(`⏳ Agent ${agentId} was reclaimed by another process — skipping`);
          await this.updateRunStatus(runId, 'skipped', { error: 'Agent reclaimed by another process' });
          return;
        }
      }
      // ────────────────────────────────────────────────────────────────────────────

      await this.updateRunStatus(runId, 'running');
      const inbox = await this.getAgentInbox(agentId, companyId);

      console.log(`▶️ Heartbeat ${runId}: Processing ${inbox.length} tasks for expert ${agentId}`);

      // ─── Routine Handler ─────────────────────────────────────────────────────
      if (options.payload?.routineId) {
        const routineId = options.payload.routineId as string;
        const executionId = options.payload.executionId as string | undefined;
        const routine = db.select({ id: routines.id, title: routines.title, description: routines.description, companyId: routines.companyId })
          .from(routines).where(eq(routines.id, routineId)).get() as any;

        if (routine) {
          const syntheticTask = {
            id: `routine-${routineId}-${runId}`,
            title: routine.title,
            description: routine.description || routine.title,
            status: 'todo',
            priority: 'medium',
            executionLockedAt: null,
          };

          console.log(`  📅 Routine-Trigger: "${routine.title}"`);
          trace(agentId, companyId, 'action', `Routine gestartet: ${routine.title}`, undefined, runId);
          await this.executeTaskViaAdapter(runId, agentId, companyId, syntheticTask, null);

          if (executionId) {
            db.update(routineRuns as any)
              .set({ status: 'completed', completedAt: new Date().toISOString() } as any)
              .where(eq((routineRuns as any).id, executionId)).run();
          }
          db.update(routines).set({ lastExecutedAt: new Date().toISOString() } as any)
            .where(eq(routines.id, routineId)).run();
        }

        await this.updateRunStatus(runId, 'succeeded', {
          output: routine ? `Routine ausgeführt: ${routine.title}` : `Routine ${routineId} nicht gefunden`,
          endedAt: new Date().toISOString(),
        });
        await db.update(agents).set({ status: 'idle', updatedAt: new Date().toISOString() }).where(eq(agents.id, agentId));
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────────

      // ─── Meeting Handler ──────────────────────────────────────────────────────
      const meetingPayload = options.payload?.meetingId ? options.payload : null;
      if (meetingPayload?.meetingId) {
        await handleMeetingWakeup(runId, agentId, companyId, meetingPayload.meetingId as string);
        await this.updateRunStatus(runId, 'succeeded', {
          output: `Meeting beantwortet: ${meetingPayload.thema || meetingPayload.meetingId}`,
          endedAt: new Date().toISOString(),
        });
        await db.update(agents).set({ status: 'idle', updatedAt: new Date().toISOString() }).where(eq(agents.id, agentId));
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────────

      // ─── Advisor Strategy Integration ──────────────────────────────────────────
      let advisorPlan: string | null = null;
      const agentWithAdvisor = db.select().from(agents).where(eq(agents.id, agentId)).get();

      if (agentWithAdvisor?.advisorId && agentWithAdvisor.advisorStrategy === 'planning') {
        console.log(`🧠 Consulting Advisor ${agentWithAdvisor.advisorId} for a plan...`);
        advisorPlan = await getAdvisorPlan(agentWithAdvisor.advisorId, agentId, companyId, inbox);

        await db.insert(activityLog).values({
          id: uuid(),
          companyId,
          actorType: 'agent',
          actorId: agentWithAdvisor.advisorId,
          action: 'advisor_plan_created',
          entityType: 'expert',
          entityId: agentId,
          details: JSON.stringify({ plan: advisorPlan?.slice(0, 500), runId }),
          createdAt: new Date().toISOString(),
        });
      }
      // ─────────────────────────────────────────────────────────────────────────────

      // ─── Orchestrator: Blocker-Scan ────────────────────────────────────────
      const agentMeta = db.select({ isOrchestrator: agents.isOrchestrator }).from(agents).where(eq(agents.id, agentId)).get() as any;
      if (agentMeta?.isOrchestrator) {
        await scanForBlockedTasks(companyId, agentId);
      }
      // ──────────────────────────────────────────────────────────────────────

      for (const task of inbox) {
        await this.processTask(runId, agentId, companyId, task, advisorPlan);
      }

      // ─── Orchestrator Planning Cycle ──────────────────────────────────────
      if (agentMeta?.isOrchestrator && inbox.length === 0) {
        console.log(`  🧭 Orchestrator ${agentId} has empty inbox — running planning cycle`);
        await this.runOrchestratorPlanning(runId, agentId, companyId, advisorPlan);
      }
      // ──────────────────────────────────────────────────────────────────────

      await this.updateRunStatus(runId, 'succeeded', {
        output: inbox.length > 0 ? `Abgeschlossen: ${inbox.map((t: any) => t.title).join(', ')}` : 'Planungszyklus abgeschlossen',
        endedAt: new Date().toISOString(),
      });

      await db.update(agents)
        .set({ status: 'idle', updatedAt: new Date().toISOString() })
        .where(eq(agents.id, agentId));

    } catch (error) {
      console.error(`❌ Heartbeat ${runId} failed:`, error);

      await this.updateRunStatus(runId, 'failed', {
        error: error instanceof Error ? error.message : String(error),
        endedAt: new Date().toISOString(),
      });

      await db.update(agents)
        .set({ status: 'error', updatedAt: new Date().toISOString() })
        .where(eq(agents.id, agentId));

      throw error;
    }
  }

  /**
   * Get agent's inbox (assigned tasks that are not done)
   */
  private async getAgentInbox(agentId: string, companyId: string): Promise<Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    executionLockedAt: string | null;
    targetId: string | null;
  }>> {
    const agent = await db.select({ isOrchestrator: agents.isOrchestrator })
      .from(agents)
      .where(eq(agents.id, agentId))
      .get();

    const isOrchestrator = agent?.isOrchestrator === true;

    const taskRows = await db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      executionLockedAt: tasks.executionLockedAt,
      executionRunId: tasks.executionRunId,
      targetId: tasks.goalId,
      isMaximizerMode: tasks.isMaximizerMode,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, companyId),
        inArray(tasks.status, ['backlog', 'todo', 'in_progress']),
        isOrchestrator
          ? or(eq(tasks.assignedTo, agentId), isNull(tasks.assignedTo))
          : eq(tasks.assignedTo, agentId)
      )
    );

    // Sort: MaximizerMode → goal-linked → priority weight
    const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    taskRows.sort((a, b) => {
      const aMax = (a as any).isMaximizerMode ? 1 : 0;
      const bMax = (b as any).isMaximizerMode ? 1 : 0;
      if (aMax !== bMax) return bMax - aMax;
      const aGoal = a.goalId ? 1 : 0;
      const bGoal = b.goalId ? 1 : 0;
      if (aGoal !== bGoal) return bGoal - aGoal;
      return (priorityWeight[b.priority] ?? 0) - (priorityWeight[a.priority] ?? 0);
    });

    return taskRows;
  }

  /**
   * Process a single task (checkout and execute)
   */
  private async processTask(
    runId: string,
    agentId: string,
    companyId: string,
    task: { id: string; title: string; status: string; priority: string; executionLockedAt: string | null },
    advisorPlan: string | null = null
  ): Promise<void> {
    console.log(`  📋 Processing task: ${task.title} (${task.id})`);

    const lockedByOtherRun = task.executionLockedAt &&
      (task as any).executionRunId &&
      (task as any).executionRunId !== runId;

    if (lockedByOtherRun) {
      const lockAge = Date.now() - new Date(task.executionLockedAt!).getTime();
      const lockTimeout = 30 * 60 * 1000;

      if (lockAge < lockTimeout) {
        console.log(`  ⏸️ Task ${task.id} is locked by run ${(task as any).executionRunId}, skipping`);
        return;
      }
      console.log(`  ⏰ Task ${task.id} lock expired (${Math.round(lockAge / 60000)}min), reclaiming`);
    }

    // Resolve workspace: projekt.workDir → companies.workDir → isolated fallback
    const company = db.select({ workDir: companies.workDir }).from(companies).where(eq(companies.id, companyId)).get() as any;
    const companyWorkDir = company?.workDir;

    const projektWorkDir = (task as any).projectId
      ? (db.select({ workDir: projects.workDir }).from(projects).where(eq(projects.id, (task as any).projectId)).get() as any)?.workDir
      : null;

    const effectiveWorkDir = (projektWorkDir && isSafeWorkdir(projektWorkDir))
      ? projektWorkDir
      : (companyWorkDir && isSafeWorkdir(companyWorkDir) ? companyWorkDir : null);

    let workspacePath: string;
    if (effectiveWorkDir) {
      if (!fs.existsSync(effectiveWorkDir)) fs.mkdirSync(effectiveWorkDir, { recursive: true });
      workspacePath = effectiveWorkDir;
      if (projektWorkDir && isSafeWorkdir(projektWorkDir)) {
        console.log(`  📁 Using project workDir: ${effectiveWorkDir}`);
      }

      // Opt-in: git-worktree isolation — parallele Tasks bekommen jeweils einen eigenen worktree.
      try {
        const worktreeSetting = db.select().from(settings)
          .where(and(eq(settings.key, 'worktree_isolation'), eq(settings.companyId, companyId)))
          .get();
        if (worktreeSetting?.value === 'true') {
          const ws = ensureWorkspace(companyId, task.id, agentId, effectiveWorkDir);
          workspacePath = ws.pfad;
          console.log(`  🌿 Worktree-Isolation aktiv → ${workspacePath}${ws.branchName ? ` (${ws.branchName})` : ''}`);
        }
      } catch (e: any) {
        console.warn(`[Heartbeat] Worktree-Setup fehlgeschlagen, nutze Basis-Workdir: ${e?.message}`);
      }
    } else {
      if (companyWorkDir && !isSafeWorkdir(companyWorkDir)) {
        console.warn(`[Heartbeat] ⛔ companyWorkDir '${companyWorkDir}' is inside the OpenCognit project root — using isolated workspace instead.`);
      }
      workspacePath = createWorkspace(task.id, agentId, runId);
    }

    const now = new Date().toISOString();
    const updated = await db.update(tasks)
      .set({
        executionRunId: runId,
        executionAgentNameKey: `expert-${agentId}`,
        executionLockedAt: now,
        workspacePath,
        status: task.status === 'backlog' ? 'todo' : task.status,
        startedAt: (task as any).startedAt || now,
      })
      .where(
        and(
          eq(tasks.id, task.id),
          or(eq(tasks.assignedTo, agentId), isNull(tasks.assignedTo)),
          or(
            isNull(tasks.executionRunId),
            sql`${tasks.executionLockedAt} < ${new Date(Date.now() - 30 * 60 * 1000).toISOString()}`
          )
        )
      )
      .returning();

    if (updated.length === 0) {
      console.log(`⏳ Task ${task.id} already checked out by another process — skipping`);
      return;
    }

    console.log(`  🔒 Task ${task.id} checked out → workspace: ${workspacePath}`);
    trace(agentId, companyId, 'action', `Task gestartet: ${task.title}`, `Workspace: ${workspacePath}`, runId);

    await this.executeTaskViaAdapter(runId, agentId, companyId, task, advisorPlan);
  }

  /**
   * Execute task via adapter (Bash, HTTP, Claude Code, OpenClaw, etc.)
   */
  private async executeTaskViaAdapter(
    runId: string,
    agentId: string,
    companyId: string,
    task: { id: string; title: string; status: string; priority: string; executionLockedAt: string | null },
    advisorPlan: string | null = null
  ): Promise<void> {
    try {
      // Get full task details (synthetic planning tasks won't be in DB — use the passed task object)
      const taskFull = await db.select()
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .limit(1)
        .then((rows: any[]) => rows[0]) ?? {
          ...task,
          description: (task as any).description || null,
          targetId: null,
          workspacePath: null,
          completedAt: null,
          startedAt: null,
          executionRunId: null,
        };

      const expert = await db.select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      const unternehmenData = await db.select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      const commentRows = await db.select()
        .from(comments)
        .where(eq(comments.taskId, task.id))
        .orderBy(comments.createdAt)
        .limit(50);

      // ─── Task-Output-as-Input: load outputs from blocker tasks ──────────────
      let blockerOutputs: string | null = null;
      try {
        const blockers = await db.select({ blockerId: issueRelations.sourceId })
          .from(issueRelations)
          .where(eq(issueRelations.targetId, task.id));

        if (blockers.length > 0) {
          const blockerIds = blockers.map(b => b.blockerId);
          const blockerResults: string[] = [];

          // Batch-load latest comments and task titles for all blockers
          const lastComments = await db.select({
            taskId: comments.taskId,
            content: comments.content,
            createdAt: comments.createdAt,
          })
            .from(comments)
            .where(inArray(comments.taskId, blockerIds))
            .orderBy(desc(comments.createdAt))
            .all();

          const blockerTasks = await db.select({ id: tasks.id, title: tasks.title })
            .from(tasks)
            .where(inArray(tasks.id, blockerIds))
            .all();

          const taskMap = new Map(blockerTasks.map(t => [t.id, t]));
          const commentMap = new Map<string, typeof lastComments[0]>();
          for (const c of lastComments) {
            if (!commentMap.has(c.taskId)) commentMap.set(c.taskId, c);
          }

          for (const blockerId of blockerIds) {
            const comment = commentMap.get(blockerId);
            const task = taskMap.get(blockerId);
            if (comment && task) {
              blockerResults.push(`### Ergebnis aus "${task.title}":\n${comment.content.slice(0, 1500)}`);
            }
          }

          if (blockerResults.length > 0) {
            blockerOutputs = `## Outputs vorheriger abhängiger Tasks\n\n${blockerResults.join('\n\n---\n\n')}`;
            console.log(`  🔗 Task ${task.id} hat ${blockerResults.length} Blocker-Output(s) als Kontext`);
          }
        }
      } catch (e: any) {
        console.warn(`  ⚠️ Blocker-Outputs konnten nicht geladen werden: ${e.message}`);
      }
      // ────────────────────────────────────────────────────────────────────────

      const adapterTask: AdapterTask = {
        id: taskFull.id,
        title: taskFull.title,
        description: taskFull.description,
        status: taskFull.status,
        priority: taskFull.priority,
      };

      // ─── Memory Kontext laden (nativ) ───────────────────────────────
      const taskKeywords = [taskFull.title, taskFull.description || '']
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 4);
      const memoryContext = loadRelevantMemory(agentId, taskKeywords) || null;
      // ────────────────────────────────────────────────────────────────────

      // ─── Letzte Chat-Nachrichten laden (Board ↔ Agent) ──────────────────
      let boardKommunikation: string | undefined;
      try {
        const recentChat = await db.select({
          senderType: chatMessages.senderType,
          message: chatMessages.message,
          createdAt: chatMessages.createdAt,
        })
          .from(chatMessages)
          .where(and(
            eq(chatMessages.companyId, companyId),
            eq(chatMessages.agentId, agentId),
          ))
          .orderBy(desc(chatMessages.createdAt))
          .limit(8)
          .then(rows => rows.reverse());
        if (recentChat.length > 0) {
          const lines = recentChat
            .filter(m => m.senderType !== 'system')
            .map(m => {
              const who = m.senderType === 'board' ? '👤 Board' : `🤖 ${expert?.name || 'Agent'}`;
              const ts = m.createdAt ? new Date(m.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
              return `[${ts}] ${who}: ${m.message}`;
            });
          if (lines.length > 0) boardKommunikation = lines.join('\n');
        }
      } catch { /* non-critical */ }
      // ────────────────────────────────────────────────────────────────────

      // ─── CEO Decision Log: letzten Planungs-Eintrag laden ───────────────
      let letzteEntscheidung: string | undefined;
      if (expert?.isOrchestrator) {
        try {
          const lastDecision = await db.select()
            .from(ceoDecisionLog as any)
            .where(and(
              eq((ceoDecisionLog as any).agentId, agentId),
              eq((ceoDecisionLog as any).companyId, companyId),
            ))
            .orderBy(desc((ceoDecisionLog as any).createdAt))
            .limit(1)
            .then((rows: any[]) => rows[0]);
          if (lastDecision) {
            const ts = new Date(lastDecision.createdAt).toLocaleString('de-DE', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            const actions: string[] = JSON.parse(lastDecision.actionsJson || '[]');
            const actionList = actions.length > 0
              ? '\nAusgeführte Aktionen:\n' + actions.map((a: string) => `  • ${a}`).join('\n')
              : '\n(Keine Aktionen ausgeführt)';
            letzteEntscheidung = [
              `[${ts}] Fokus: ${lastDecision.focusSummary}`,
              lastDecision.goalsSnapshot ? `Ziele: ${lastDecision.goalsSnapshot}` : null,
              `Offene Tasks zu dem Zeitpunkt: ${lastDecision.pendingTaskCount}`,
              lastDecision.teamSummary ? `Team: ${lastDecision.teamSummary}` : null,
              actionList,
            ].filter(Boolean).join('\n');
          }
        } catch { /* non-critical */ }
      }
      // ────────────────────────────────────────────────────────────────────

      // ─── Load active goals with live task progress ──────────────────────
      let activeGoals: CompanyGoal[] = [];
      try {
        const rawGoals = await db.select({
          id: goals.id,
          title: goals.title,
          description: goals.description,
          progress: goals.progress,
          status: goals.status,
        }).from(goals)
          .where(and(
            eq(goals.companyId, companyId),
            inArray(goals.status, ['active', 'planned']),
          ))
          .orderBy(asc(goals.createdAt))
          .limit(5);

        for (const g of rawGoals) {
          const linkedTasks = await db.select({ status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.goalId, g.id), eq(tasks.companyId, companyId)));
          const doneTasks = linkedTasks.filter(t => t.status === 'done').length;
          const openTasks = linkedTasks.filter(t => t.status !== 'done').length;
          const computedProgress = linkedTasks.length > 0
            ? Math.round((doneTasks / linkedTasks.length) * 100)
            : g.progress;
          activeGoals.push({
            id: g.id, title: g.title, description: g.description,
            progress: computedProgress, status: g.status, openTasks, doneTasks,
          });
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Goals konnten nicht geladen werden: ${err.message}`);
      }
      // ──────────────────────────────────────────────────────────────────

      const teamMembers = expert?.isOrchestrator
        ? await db.select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
            .from(agents)
            .where(and(eq(agents.companyId, companyId), eq(agents.isOrchestrator, false)))
        : [];

      const openTasksList = expert?.isOrchestrator
        ? await db.select({ id: tasks.id, title: tasks.title, status: tasks.status, assignedTo: tasks.assignedTo, priority: tasks.priority })
            .from(tasks)
            .where(and(
              eq(tasks.companyId, companyId),
              inArray(tasks.status, ['backlog', 'todo', 'in_progress', 'blocked']),
            ))
            .limit(20)
        : [];

      let projektContext: AdapterContext['projektContext'] | undefined;
      if (taskFull.projectId) {
        const proj = await db.select({ name: projects.name, description: projects.description, workDir: projects.workDir })
          .from(projects)
          .where(eq(projects.id, taskFull.projectId))
          .limit(1)
          .then((rows: any[]) => rows[0]);
        if (proj) {
          projektContext = { name: proj.name, description: proj.description, workDir: proj.workDir };
        }
      }

      const adapterContext: AdapterContext = {
        task: adapterTask,
        previousComments: commentRows.map((c: any) => ({
          id: c.id, content: c.content,
          senderType: c.authorType as 'agent' | 'board',
          createdAt: c.createdAt,
        })),
        companyContext: {
          name: unternehmenData?.name || 'Unknown',
          goal: unternehmenData?.goal || null,
          goals: activeGoals.length > 0 ? activeGoals : undefined,
        },
        ...(projektContext ? { projektContext } : {}),
        agentContext: {
          name: expert?.name || 'Unknown Agent',
          role: expert?.role || 'Agent',
          skills: expert?.skills || null,
          ...((taskFull as any).isMaximizerMode ? {
            maximizerMode: '⚡ MAXIMIZER MODE AKTIV: Arbeite schnellstmöglich. Erzeuge vollständigen, sofort nutzbaren Output. Keine Rückfragen, keine Platzhalter — liefere alles in einem Durchgang.',
          } : {}),
          ...(() => {
            const wp = (taskFull as any).workspacePath;
            if (!wp || !fs.existsSync(wp)) return {};
            try {
              const allFiles = fs.readdirSync(wp, { recursive: true } as any) as string[];
              const files = allFiles
                .filter((f: string) => !f.includes('node_modules') && !f.includes('.git'))
                .slice(0, 200)
                .join('\n');
              return files ? { workspaceFiles: `## Bereits vorhandene Dateien im Workspace\n\`\`\`\n${files}\n\`\`\`\nBitte konsistenten Code-Stil verwenden und bestehende Dateien beachten.` } : {};
            } catch { return {}; }
          })(),
          ...(memoryContext ? { memory: memoryContext } : {}),
          ...(letzteEntscheidung ? { letzteEntscheidung } : {}),
          ...(boardKommunikation ? { boardKommunikation } : {}),
          ...(blockerOutputs ? { vorgaengerOutputs: blockerOutputs } : {}),
          ...(advisorPlan ? { advisorPlan: `### 🧠 STRATEGISCHER PLAN DES ARCHITEKTEN/ADVISORS\n\n${advisorPlan}\n\n*Bitte befolge diesen Plan strikt bei der Ausführung der Aufgabe.*` } : {}),
          ...(expert?.isOrchestrator && teamMembers.length > 0 ? {
            team: teamMembers.map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status })),
            offeneTasks: openTasksList.map(t => ({ id: t.id, title: t.title, status: t.status, assignedTo: t.assignedTo, priority: t.priority })),
            aktionsFormat: `
## WICHTIG: Aktionen als JSON ausgeben

Wenn du Tasks erstellen, zuweisen oder Ziele aktualisieren willst, füge am ENDE deiner Antwort einen JSON-Block ein:

\`\`\`json
{
  "actions": [
    {"type": "create_task", "titel": "Task-Titel", "beschreibung": "Beschreibung...", "assignTo": "Agent Name", "priority": "high", "targetId": "GOAL_ID"},
    {"type": "assign_task", "taskId": "TASK_ID", "assignTo": "Agent Name"},
    {"type": "mark_done", "taskId": "TASK_ID"},
    {"type": "update_goal", "goalId": "GOAL_ID", "progress": 50},
    {"type": "hire_agent", "rolle": "QA Engineer", "faehigkeiten": "Testing, Python", "begruendung": "Wir brauchen mehr QA-Kapazität"}
  ]
}
\`\`\`

Verfügbare Prioritäten: critical, high, medium, low
Verfügbare Team-Mitglieder: ${teamMembers.map(m => m.name).join(', ')}
WICHTIG: Verknüpfe jeden neuen Task mit einem Ziel via "targetId". Aktualisiere Ziel-Fortschritt (update_goal) wenn Tasks abgeschlossen wurden.
`,
          } : {}),
        },
      };

      if (memoryContext) {
        console.log(`  🧠 Memory geladen für Agent ${agentId} (${memoryContext.length} Zeichen)`);
      }

      // ─── TOKEN BUDGET GUARD ────────────────────────────────────────────────
      const CONTEXT_CHAR_LIMIT = 320_000;
      let serializedContext = JSON.stringify(adapterContext);
      const estimatedSize = serializedContext.length;
      if (estimatedSize > CONTEXT_CHAR_LIMIT) {
        console.warn(`  ⚠️ Context too large (${Math.round(estimatedSize / 1000)}k chars) — trimming`);
        const agentCtx = adapterContext.agentContext as any;
        if (agentCtx.vorgaengerOutputs) agentCtx.vorgaengerOutputs = agentCtx.vorgaengerOutputs.slice(0, 20_000) + '\n[...gekürzt]';
        if (adapterContext.agentContext.memory) adapterContext.agentContext.memory = (adapterContext.agentContext.memory as string).slice(0, 10_000) + '\n[...gekürzt]';
        serializedContext = JSON.stringify(adapterContext);
        if (serializedContext.length > CONTEXT_CHAR_LIMIT) adapterContext.previousComments = adapterContext.previousComments.slice(-5);
        if (agentCtx.offeneTasks) agentCtx.offeneTasks = agentCtx.offeneTasks.slice(0, 20);
        const afterSize = JSON.stringify(adapterContext).length;
        console.log(`  ✂️ Context trimmed: ${Math.round(estimatedSize / 1000)}k → ${Math.round(afterSize / 1000)}k chars`);
      }
      // ──────────────────────────────────────────────────────────────────────

      console.log(`  🤖 Executing task via adapter: ${taskFull.title}`);

      // ── SOUL.md: load file-based identity if configured ──────────────────────
      const soulVars = {
        'company.name': unternehmenData?.name || 'Unknown',
        'company.goal': unternehmenData?.goal || '',
        'agent.name': expert?.name || '',
        'agent.role': expert?.role || '',
      };
      const resolvedSystemPrompt =
        loadSoul(expert as any, soulVars)
        ?? expert?.systemPrompt
        ?? undefined;
      // ──────────────────────────────────────────────────────────────────────────

      // ── Budget-Check vor Ausführung ────────────────────────────────────────────
      const isSyntheticTaskEarly = task.id.startsWith('planning-');
      const budgetCheck = await checkBudgetAndEnforce(agentId, companyId);
      if (!budgetCheck.allowed) {
        trace(agentId, companyId, 'error', `🛑 Task blockiert: ${budgetCheck.reason}`, undefined, runId);
        if (!isSyntheticTaskEarly) {
          try {
            await db.insert(comments).values({
              id: crypto.randomUUID(), companyId, taskId: task.id,
              authorAgentId: agentId, authorType: 'agent',
              content: `🛑 **Ausführung blockiert — Budget-Limit erreicht**\n\n${budgetCheck.reason}\n\nBitte erhöhe das Budget-Limit in den Einstellungen oder warte auf den nächsten Abrechnungszeitraum.`,
              createdAt: new Date().toISOString(),
            });
          } catch { /* agent may have been deleted mid-run */ }
          await db.update(tasks)
            .set({ executionLockedAt: null, executionRunId: null, status: 'blocked' })
            .where(eq(tasks.id, task.id));
        }
        await this.updateRunStatus(runId, 'failed', { error: budgetCheck.reason });
        return;
      }
      // ──────────────────────────────────────────────────────────────────────────

      // Resolve effective adapter type
      let effectiveVerbindungsTyp = expert?.connectionType || 'claude-code';
      let heartbeatParsedConfig: any = {};
      if (expert?.connectionConfig) {
        try {
          heartbeatParsedConfig = JSON.parse(expert.connectionConfig as string);
          if (effectiveVerbindungsTyp === 'claude-code' && heartbeatParsedConfig.model?.includes('/')) {
            effectiveVerbindungsTyp = 'openrouter';
          }
        } catch { /* keep as-is */ }
      }

      // Guard: Blockiere Free Models
      const heartbeatModel: string = heartbeatParsedConfig.model || '';
      if (heartbeatModel.endsWith(':free') || heartbeatModel === 'auto:free') {
        console.error(`[Heartbeat] Agent ${expert?.name} hat Free-Model (${heartbeatModel}). Ausführung blockiert.`);
        await this.updateRunStatus(runId, 'failed', { error: `Free-Model "${heartbeatModel}" blockiert. Bitte wechsle zu einem bezahlten Modell.` });
        return;
      }

      // Load global default model for OpenRouter/Ollama agents without a specific model
      let heartbeatGlobalDefaultModel: string | undefined;
      if (effectiveVerbindungsTyp === 'openrouter' || effectiveVerbindungsTyp === 'ollama') {
        const dmKey = effectiveVerbindungsTyp === 'ollama' ? 'ollama_default_model' : 'openrouter_default_model';
        try {
          const dmRow = db.select({ value: settings.value }).from(settings)
            .where(and(eq(settings.key, dmKey), eq(settings.companyId, companyId))).get()
            ?? db.select({ value: settings.value }).from(settings)
              .where(and(eq(settings.key, dmKey), eq(settings.companyId, ''))).get();
          if (dmRow?.value) heartbeatGlobalDefaultModel = decryptSetting(dmKey, dmRow.value);
        } catch { /* ignore */ }
      }

      // ─── OpenClaw Enrichment ───────────────────────────────────────────────
      if (effectiveVerbindungsTyp === 'openclaw') {
        try {
          const recentDone = await db
            .select({ taskTitel: tasks.title, output: comments.content, completedAt: comments.createdAt })
            .from(comments)
            .innerJoin(tasks, eq(comments.taskId, tasks.id))
            .where(and(
              eq(tasks.assignedTo, agentId),
              eq(tasks.status, 'done'),
              eq(comments.authorType, 'agent'),
            ))
            .orderBy(desc(comments.createdAt))
            .limit(3);

          const siblingTasks = taskFull.projectId
            ? await db
                .select({ id: tasks.id, title: tasks.title, status: tasks.status, assignedTo: tasks.assignedTo })
                .from(tasks)
                .where(and(
                  eq(tasks.projectId, taskFull.projectId),
                  eq(tasks.companyId, companyId),
                  inArray(tasks.status, ['backlog', 'todo', 'in_progress', 'blocked']),
                ))
                .limit(15)
            : [];

          const assigneeIds = [...new Set(siblingTasks.map((t: any) => t.assignedTo).filter(Boolean))];
          const assigneeNames: Record<string, string> = {};
          if (assigneeIds.length > 0) {
            const rows = await db.select({ id: agents.id, name: agents.name }).from(agents)
              .where(inArray(agents.id, assigneeIds as string[]));
            for (const r of rows) assigneeNames[r.id] = r.name;
          }

          const ocTaskKeywords = (taskFull.title + ' ' + (taskFull.description || ''))
            .toLowerCase().replace(/[^\wäöüß\s]/g, ' ').split(/\s+/)
            .filter(w => w.length >= 4).slice(0, 8);

          let kgFacts: Array<{ subject: string; predicate: string; object: string }> = [];
          if (ocTaskKeywords.length > 0) {
            const allFacts = await db.select({ subject: palaceKg.subject, predicate: palaceKg.predicate, object: palaceKg.object })
              .from(palaceKg)
              .where(and(eq(palaceKg.companyId, companyId), isNull(palaceKg.validUntil)))
              .limit(200);
            kgFacts = allFacts
              .filter((f: any) => ocTaskKeywords.some(kw =>
                f.subject.toLowerCase().includes(kw) ||
                f.object.toLowerCase().includes(kw) ||
                f.predicate.toLowerCase().includes(kw)
              ))
              .slice(0, 20);
          }

          const activeOthers = await db
            .select({ name: agents.name, role: agents.role, taskTitel: tasks.title })
            .from(agents)
            .innerJoin(tasks, and(eq(tasks.assignedTo, agents.id), eq(tasks.status, 'in_progress')))
            .where(and(eq(agents.companyId, companyId), sql`${agents.id} != ${agentId}`))
            .limit(5);

          adapterContext.openclawEnrichment = {
            recentOutputs: recentDone.map((r: any) => ({
              taskTitel: r.taskTitel,
              output: (r.output || '').slice(0, 800),
              completedAt: r.completedAt,
            })),
            projectSiblingTasks: siblingTasks.map((t: any) => ({
              id: t.id, title: t.title, status: t.status,
              assignedTo: t.assignedTo ? (assigneeNames[t.assignedTo] ?? t.assignedTo) : null,
            })),
            kgFacts,
            activeColleagues: activeOthers.map((r: any) => ({ name: r.name, role: r.role, currentTask: r.taskTitel })),
          };
          console.log(`  🔗 OpenClaw enrichment: ${recentDone.length} recent outputs, ${siblingTasks.length} sibling tasks, ${kgFacts.length} KG facts, ${activeOthers.length} active colleagues`);
        } catch (err: any) {
          console.warn(`  ⚠️ OpenClaw enrichment failed (non-critical): ${err.message}`);
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // ─── Auto Model Routing (Economic Control) ──────────────────────────
      // Only routes when `model_routing_enabled=true` and adapter supports it.
      // No-op otherwise; always safe.
      try {
        const currentModel = heartbeatParsedConfig.model || heartbeatGlobalDefaultModel || '';
        const decision = routeModel(companyId, effectiveVerbindungsTyp, currentModel, {
          title: task.title, description: (task as any).description, priority: task.priority,
        });
        if (decision.routed) {
          heartbeatParsedConfig = { ...heartbeatParsedConfig, model: decision.model };
          trace(agentId, companyId, 'info',
            `Auto-routed: ${decision.originalModel || '(default)'} → ${decision.model} (${decision.reason})`,
            JSON.stringify({ tier: decision.tier, score: decision.score }), runId);
        }
      } catch (err: any) {
        console.warn(`[ModelRouter] skipped: ${err.message}`);
      }
      // ────────────────────────────────────────────────────────────────────

      let result = await adapterRegistry.executeTask(adapterTask, adapterContext, {
        agentId,
        companyId,
        runId,
        timeoutMs: 10 * 60 * 1000,
        workspacePath: (taskFull as any).workspacePath || undefined,
        systemPrompt: resolvedSystemPrompt,
        connectionType: effectiveVerbindungsTyp,
        connectionConfig: Object.keys(heartbeatParsedConfig).length > 0 ? heartbeatParsedConfig : undefined,
        globalDefaultModel: heartbeatGlobalDefaultModel,
      });

      await this.updateRunStatus(runId, result.success ? 'succeeded' : 'failed', {
        output: result.output, error: result.error || null,
        exitCode: result.exitCode,
        sessionIdBefore: result.sessionIdBefore,
        sessionIdAfter: result.sessionIdAfter,
      });

      if (result.inputTokens > 0 || result.outputTokens > 0) {
        await this.recordUsage(runId, {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costCents: result.costCents,
        });
      }

      // ─── Checkpoint parsing & persistence ───────────────────────────────
      if (!isSyntheticTaskEarly && result.output) {
        try {
          const checkpoint = parseCheckpoint(result.output);
          if (checkpoint) {
            await saveCheckpoint(checkpoint, {
              companyId,
              agentId,
              taskId: task.id,
              runId,
              model: heartbeatParsedConfig.model || heartbeatGlobalDefaultModel,
              tokens: (result.inputTokens || 0) + (result.outputTokens || 0),
              costCents: result.costCents,
              durationMs: result.durationMs,
            });
            console.log(`  📋 Checkpoint gespeichert: ${checkpoint.state} für Task ${task.id}`);
            trace(agentId, companyId, 'info',
              `Checkpoint ${checkpoint.state}: ${taskFull.title}`,
              JSON.stringify({ blocker: checkpoint.blocker, nextAction: checkpoint.nextAction }),
              runId,
            );
          } else {
            console.log(`  ⚠️ Kein Checkpoint-Block im Output von Task ${task.id}`);
          }
        } catch (cpErr: any) {
          console.warn(`  ⚠️ Checkpoint-Parsing fehlgeschlagen: ${cpErr.message}`);
        }
      }
      // ────────────────────────────────────────────────────────────────────

      // Transient errors (429, rate limit, network) → silently retry next cycle
      const isSyntheticTask = task.id.startsWith('planning-');
      const isRateLimit = !result.success && (
        result.output?.includes('429') || result.output?.includes('rate') ||
        result.output?.includes('Rate') || result.output?.includes('temporarily') ||
        result.output?.includes('overloaded') || result.error?.includes('429') ||
        result.error?.includes('rate')
      );
      const isTimeout = !result.success && (
        result.error?.includes('ECONNREFUSED') || result.error?.includes('ETIMEDOUT') ||
        result.error?.includes('aborted') || result.error?.includes('AbortError') ||
        result.output?.includes('aborted') || result.error?.includes('socket hang up') ||
        result.error?.includes('network')
      );
      const isTransient = isRateLimit || isTimeout;

      if (isTransient) {
        if (isRateLimit) {
          console.log(`  ⏳ Rate limit for task ${task.id} (${taskFull.title}) — will retry next cycle`);
          trace(agentId, companyId, 'info', `Rate limit — wird automatisch wiederholt: ${taskFull.title}`, undefined, runId);
          if (!isSyntheticTask) {
            await db.update(tasks)
              .set({ executionLockedAt: null, executionRunId: null })
              .where(eq(tasks.id, task.id));
          }
        } else {
          console.log(`  ⏳ Timeout/network for task ${task.id} (${taskFull.title}) — retry in 5min`);
          trace(agentId, companyId, 'info', `Timeout — Retry in 5 Minuten: ${taskFull.title}`, result.error, runId);
          if (!isSyntheticTask) {
            const backoffLock = new Date(Date.now() - (30 * 60 * 1000 - 5 * 60 * 1000)).toISOString();
            await db.update(tasks)
              .set({ executionLockedAt: backoffLock, executionRunId: null })
              .where(eq(tasks.id, task.id));
          }
        }
        return;
      }

      // Create comment with result
      if (!isSyntheticTask) {
        const errorSection = result.error ? `\nFehler: ${result.error}` : '';
        const resultComment = `**Ausführung abgeschlossen**\n\n` +
          `Status: ${result.success ? '✅ Erfolg' : '❌ Fehler'}${errorSection}\n` +
          `Dauer: ${result.durationMs}ms\n` +
          `Ausgabe:\n\`\`\`\n${result.output}\n\`\`\``;

        try {
          await db.insert(comments).values({
            id: crypto.randomUUID(), companyId, taskId: task.id,
            authorAgentId: agentId, authorType: 'agent',
            content: resultComment, createdAt: new Date().toISOString(),
          });
        } catch { /* agent may have been deleted mid-run */ }
      }

      // Hardening: empty output with success:true is treated as failure
      if (result.success && !result.output?.trim()) {
        console.log(`  ⚠️ Adapter returned success but empty output for task ${task.id}`);
        result = { ...result, success: false, error: result.error || 'Adapter returned empty output' };
      }

      console.log(`  ✅ Adapter execution completed for task ${task.id}`);
      trace(agentId, companyId, result.success ? 'result' : 'error',
        result.success ? `Task abgeschlossen: ${taskFull.title}` : `Task fehlgeschlagen: ${taskFull.title}`,
        result.success ? result.output?.slice(0, 500) : result.error, runId,
      );

      // ─── AGENTIC ACTION PARSING ─────────────────────────────────────
      const isOrchestrator = expert?.isOrchestrator === true;
      const cliAdapters = ['claude-code', 'bash', 'http', 'codex-cli', 'gemini-cli', 'kimi-cli'];
      const isCliAdapter = cliAdapters.includes(expert?.connectionType || '');
      let orchestratorMarkedCurrentTaskDone = false;
      if (result.success && result.output) {
        if (isOrchestrator) {
          const orchResult = await processOrchestratorActions(task.id, agentId, companyId, result.output);
          orchestratorMarkedCurrentTaskDone = orchResult.done;

          // ─── CEO Decision Log ───────────────────────────────────────────────
          // Persist what the CEO decided this cycle so the next cycle starts
          // with context instead of amnesia.
          try {
            const focusLine = result.output.split('\n').find(l => l.trim().length > 20)?.slice(0, 250)
              ?? task.title.slice(0, 250);
            const goalsForLog = (adapterContext.companyContext.goals ?? []).map(g => `${g.title} (${g.progress}%)`).join(', ');
            const teamForLog = teamMembers.map(m => m.name).join(', ');
            const pendingCount = openTasksList.length;

            await db.insert(ceoDecisionLog as any).values({
              id: crypto.randomUUID(),
              agentId,
              companyId,
              runId,
              createdAt: new Date().toISOString(),
              focusSummary: focusLine,
              actionsJson: JSON.stringify(orchResult.actionSummary),
              goalsSnapshot: goalsForLog || null,
              pendingTaskCount: pendingCount,
              teamSummary: teamForLog || null,
            }).run();
          } catch (e: any) {
            console.warn(`  ⚠️ CEO Decision Log konnte nicht gespeichert werden: ${e.message}`);
          }
          // ────────────────────────────────────────────────────────────────────
        } else if (isCliAdapter) {
          await processWorkerActions(task.id, agentId, companyId, runId, result.output, (taskFull as any).workspacePath);
        }
      }
      // ────────────────────────────────────────────────────────────────

      if (!isSyntheticTask) {
        if (result.success) {
          // ─── CRITIC/EVALUATOR LOOP ─────────────────────────────────────────
          if (!isOrchestrator && result.output) {
            const criticResult = await runCriticReview(
              task.id, taskFull.title, taskFull.description || '', result.output, agentId, companyId
            );

            recordLearning(
              agentId,
              taskFull.title,
              criticResult.approved ? 'approved' : (criticResult.escalate ? 'escalated' : 'needs_revision'),
              criticResult.approved
                ? `Task delivered successfully via ${effectiveVerbindungsTyp}.`
                : (criticResult.feedback || 'Critic requested revision.'),
            );
            if (!criticResult.approved) {
              if (criticResult.escalate) {
                console.log(`  🚨 Critic: escalating task ${task.id} to human review`);
                trace(agentId, companyId, 'warning', `Critic: Eskalation — ${taskFull.title}`, criticResult.feedback, runId);
                await db.insert(comments).values({
                  id: crypto.randomUUID(), companyId, taskId: task.id,
                  authorAgentId: agentId, authorType: 'agent',
                  content: `🚨 **Critic Review — Manuelle Prüfung erforderlich**\n\n${criticResult.feedback}\n\n*Der Agent hat die Aufgabe nach 2 Überarbeitungszyklen nicht erfolgreich abgeschlossen. Bitte prüfe manuell.*`,
                  createdAt: new Date().toISOString(),
                });
                await db.update(tasks)
                  .set({ executionLockedAt: null, executionRunId: null, status: 'blocked' })
                  .where(eq(tasks.id, task.id));
              } else {
                console.log(`  🔍 Critic rejected task ${task.id}: ${criticResult.feedback}`);
                trace(agentId, companyId, 'info', `Critic: Überarbeitung nötig — ${taskFull.title}`, criticResult.feedback, runId);
                await db.insert(comments).values({
                  id: crypto.randomUUID(), companyId, taskId: task.id,
                  authorAgentId: agentId, authorType: 'agent',
                  content: `🔍 **Critic Review — Überarbeitung erforderlich**\n\n${criticResult.feedback}\n\n*Bitte überarbeite die Aufgabe entsprechend diesem Feedback.*`,
                  createdAt: new Date().toISOString(),
                });
                await db.update(tasks)
                  .set({
                    executionLockedAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                    executionRunId: null,
                    status: 'in_progress',
                  })
                  .where(eq(tasks.id, task.id));
              }
              return;
            }
            console.log(`  ✅ Critic approved task ${task.id}`);
          }
          // ──────────────────────────────────────────────────────────────────

          const finalStatus = 'done';
          const finalAbgeschlossenAm = new Date().toISOString();
          await db.update(tasks)
            .set({ status: finalStatus, completedAt: finalAbgeschlossenAm, executionLockedAt: null, executionRunId: null })
            .where(eq(tasks.id, task.id));

          // Unblock dependent tasks
          const unblocked = unblockDependents(task.id);
          if (unblocked.length > 0) {
            trace(agentId, companyId, 'info', `🔓 ${unblocked.length} task(s) unblocked`, unblocked.join(', '), runId);
          }

          // Auto-update goal progress
          const completedTask = await db.select({ targetId: tasks.goalId })
            .from(tasks).where(eq(tasks.id, task.id)).get();
          const targetId = completedTask?.goalId;
          if (targetId) {
            const allGoalTasks = await db.select({ status: tasks.status })
              .from(tasks)
              .where(and(eq(tasks.goalId, targetId), eq(tasks.companyId, companyId)));
            const total = allGoalTasks.length;
            const done = allGoalTasks.filter(t => t.status === 'done').length;
            if (total > 0) {
              const progress = Math.round((done / total) * 100);
              await db.update(goals)
                .set({ progress, updatedAt: new Date().toISOString() })
                .where(and(eq(goals.id, targetId), eq(goals.companyId, companyId)))
                .run();
              console.log(`  📊 Ziel-Fortschritt auto-aktualisiert: ${progress}% (${done}/${total} Tasks erledigt)`);
              trace(agentId, companyId, 'result', `Ziel-Fortschritt aktualisiert: ${progress}%`, `${done}/${total} Tasks erledigt`, runId);
            }
          }

        } else {
          // ─── SELF-HEALING RETRY + ORCHESTRATOR ESCALATION ─────────────────
          const MAX_RETRIES = 3;
          const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

          const failureComments = await db.select({ id: comments.id })
            .from(comments)
            .where(and(eq(comments.taskId, task.id), sql`inhalt LIKE '%❌ Fehler%'`));
          const failureCount = failureComments.length;

          if (failureCount < MAX_RETRIES) {
            const backoffMinutes = [5, 15, 45][failureCount - 1] ?? 5;
            const syntheticLockTime = new Date(Date.now() - (LOCK_TIMEOUT_MS - backoffMinutes * 60 * 1000)).toISOString();

            console.log(`  🔄 Task ${task.id} failed (attempt ${failureCount}/${MAX_RETRIES}) — retry in ${backoffMinutes}min`);
            trace(agentId, companyId, 'info', `Automatischer Retry ${failureCount}/${MAX_RETRIES}: ${taskFull.title}`, `Nächster Versuch in ${backoffMinutes} Minuten`, runId);

            await db.insert(comments).values({
              id: crypto.randomUUID(), companyId, taskId: task.id,
              authorAgentId: agentId, authorType: 'agent',
              content: `🔄 **Automatischer Retry ${failureCount}/${MAX_RETRIES}**\n\nTask fehlgeschlagen. Nächster Versuch in **${backoffMinutes} Minuten**.\n\n*Das System versucht automatisch, die Aufgabe erneut auszuführen.*`,
              createdAt: new Date().toISOString(),
            });
            await db.update(tasks)
              .set({ status: 'todo', executionRunId: null, executionLockedAt: syntheticLockTime })
              .where(eq(tasks.id, task.id));

          } else {
            console.log(`  🚨 Task ${task.id} failed ${failureCount}× — escalating to orchestrator`);
            trace(agentId, companyId, 'error', `Eskalation nach ${failureCount} Fehlern: ${taskFull.title}`, result.error, runId);

            const now = new Date().toISOString();
            const orchestrator = await db.select()
              .from(agents)
              .where(and(eq(agents.companyId, companyId), eq(agents.isOrchestrator, true)))
              .get();

            if (orchestrator && orchestrator.id !== agentId) {
              const escalationId = uuid();
              await db.insert(tasks).values({
                id: escalationId, companyId,
                title: `🚨 Eskalation: "${taskFull.title}" ist ${failureCount}× fehlgeschlagen`,
                description:
                  `Der Task **"${taskFull.title}"** (ID: \`${task.id}\`) ist ${failureCount} Mal hintereinander fehlgeschlagen.\n\n` +
                  `**Letzter Fehler:** ${result.error || 'Keine Details verfügbar'}\n\n` +
                  `**Empfohlene Maßnahmen:**\n1. Task-Beschreibung überprüfen\n2. Task anders zuweisen\n3. In kleinere Teilaufgaben aufteilen\n\n*Automatisch erstellt.*`,
                status: 'todo', priority: 'high',
                assignedTo: orchestrator.id, createdBy: agentId,
                createdAt: now, updatedAt: now,
              });

              wakeupService.wakeup(orchestrator.id, companyId, {
                source: 'automation', triggerDetail: 'system',
                reason: `Eskalation: "${taskFull.title}" ${failureCount}× fehlgeschlagen`,
                payload: { taskId: task.id },
              }).catch(() => {});
            }

            await db.insert(comments).values({
              id: crypto.randomUUID(), companyId, taskId: task.id,
              authorAgentId: agentId, authorType: 'agent',
              content:
                `🚨 **Eskalation an ${orchestrator ? orchestrator.name : 'Orchestrator'}**\n\n` +
                `Nach ${failureCount} automatischen Versuchen konnte dieser Task nicht abgeschlossen werden.\n\n` +
                (orchestrator
                  ? `**${orchestrator.name}** wurde informiert und ein Eskalations-Task wurde erstellt.`
                  : 'Der Task wurde als blockiert markiert.') +
                `\n\n*Bitte überprüfe die Aufgabe manuell.*`,
              createdAt: new Date().toISOString(),
            });

            await db.update(tasks)
              .set({ status: 'blocked', executionLockedAt: null, executionRunId: null, updatedAt: new Date().toISOString() })
              .where(eq(tasks.id, task.id));

            messagingService.notify(
              companyId,
              `🚨 Eskalation: ${taskFull.title}`,
              `Task **"${taskFull.title}"** ist ${failureCount}× fehlgeschlagen. ` +
                (orchestrator ? `**${orchestrator.name}** wurde automatisch benachrichtigt.` : 'Manuelle Überprüfung erforderlich.'),
              'warning'
            ).catch(() => {});

            appEvents.emit('broadcast', {
              type: 'task_escalated',
              data: { companyId, taskId: task.id, taskTitel: taskFull.title, failureCount, orchestratorName: orchestrator?.name },
            });
          }
          // ──────────────────────────────────────────────────────────────────
        }
      }

      if (result.success && !isSyntheticTask) {
        await recordWorkProducts(task.id, agentId, companyId, runId, (taskFull as any).workspacePath);
        autoSaveInsights(agentId, companyId, result.output, taskFull.title).catch(() => {});

        if (!isOrchestrator) {
          await unlockDependentTasks(task.id, companyId).catch(() => {});
        }

        if (!expert?.isOrchestrator) {
          await notifyOrchestratorTaskDone(
            companyId, agentId, expert?.name || 'Agent',
            taskFull.title, taskFull.id, result.output,
          );
        }
      }

    } catch (error: any) {
      console.error(`  ❌ Adapter execution failed for task ${task.id}:`, error.message);
      trace(agentId, companyId, 'error', `Fehler bei Task: ${task.title || task.id}`, error.message, runId);

      await db.update(tasks)
        .set({ status: 'blocked', executionLockedAt: null, executionRunId: null })
        .where(eq(tasks.id, task.id));

      // ─── ACTIVE ESCALATION ───────────────────────────────────────────
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (agent?.reportsTo) {
        const boss = await db.select().from(agents).where(eq(agents.id, agent.reportsTo)).get();
        if (boss) {
          console.log(`🚨 Escalating problem from ${agent.name} to supervisor ${boss.name}...`);
          await messagingService.notify(
            companyId,
            `Eskalation: ${agent.name} braucht Hilfe`,
            `Agent **${agent.name}** meldet ein Problem bei Task **'${task.title}'**.\n\nFehler: _${error.message}_`,
            'warning'
          );
          await db.insert(traceEvents).values({
            id: uuid(), companyId, type: 'status_change',
            title: `🚨 Eskalation an ${boss.name}`,
            details: `Agent ${agent.name} hat ein Problem gemeldet. Vorgesetzter wurde benachrichtigt.`,
            createdAt: new Date().toISOString(),
          });
        }
      }
      // ──────────────────────────────────────────────────────────────────

      throw error;
    }
  }

  /**
   * Orchestrator Planning Cycle — runs when CEO has no tasks in inbox.
   */
  private async runOrchestratorPlanning(
    runId: string,
    agentId: string,
    companyId: string,
    advisorPlan: string | null,
  ): Promise<void> {
    try {
      const activeGoals = await db.select({ id: goals.id, title: goals.title, progress: goals.progress, status: goals.status })
        .from(goals)
        .where(and(eq(goals.companyId, companyId), inArray(goals.status, ['active', 'planned'])))
        .limit(5);

      const backlogTasks = await db.select({ id: tasks.id, title: tasks.title, priority: tasks.priority })
        .from(tasks)
        .where(and(eq(tasks.companyId, companyId), inArray(tasks.status, ['backlog', 'todo', 'in_progress'])))
        .limit(10);

      if (activeGoals.length === 0 && backlogTasks.length === 0) {
        console.log(`  ℹ️ No goals or open tasks — nothing to plan`);
        return;
      }

      const teamForPlanning = await db.select({ id: agents.id, name: agents.name, skills: agents.skills })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.isOrchestrator, false)));

      // Batch-load task counts and skills per agent (N+1 → 2 queries)
      const taskCounts = await db.select({
        agentId: tasks.assignedTo,
        n: sql<number>`COUNT(*)`,
      })
        .from(tasks)
        .where(and(
          eq(tasks.companyId, companyId),
          inArray(tasks.status, ['todo', 'in_progress', 'backlog']),
          inArray(tasks.assignedTo, teamForPlanning.map(m => m.id)),
        ))
        .groupBy(tasks.assignedTo);
      const taskCountMap = new Map(taskCounts.map(t => [t.agentId, t.n]));

      const structuredSkills = await db.select({
        agentId: agentSkills.agentId,
        skillName: skillsLibrary.name,
      })
        .from(agentSkills)
        .innerJoin(skillsLibrary, eq(agentSkills.skillId, skillsLibrary.id))
        .where(inArray(agentSkills.agentId, teamForPlanning.map(m => m.id)));
      const skillsMap = new Map<string, string[]>();
      for (const s of structuredSkills) {
        if (!skillsMap.has(s.agentId)) skillsMap.set(s.agentId, []);
        skillsMap.get(s.agentId)!.push(s.skillName);
      }

      const workloadPerAgent = teamForPlanning.map(m => {
        const count = taskCountMap.get(m.id) ?? 0;
        const agentSkills = skillsMap.get(m.id) ?? [];
        const allSkills = [
          ...agentSkills,
          ...(m.skills ? m.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        ];
        const skillStr = [...new Set(allSkills)].join(', ') || 'keine';
        return { name: m.name, skills: skillStr, openTasks: count };
      });

      const staleDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const staleTasks = await db.select({ title: tasks.title, priority: tasks.priority })
        .from(tasks)
        .where(and(
          eq(tasks.companyId, companyId),
          inArray(tasks.status, ['todo', 'in_progress', 'backlog']),
          sql`${tasks.createdAt} < ${staleDate}`,
        ))
        .limit(5);

      const workloadSummary = workloadPerAgent.map(m => `${m.name} (${m.openTasks} offene Tasks | Skills: ${m.skills})`).join('; ');
      const hiringHint = workloadPerAgent.some(m => m.openTasks >= 5)
        ? '\nHINWEIS: Mindestens ein Agent hat ≥5 offene Tasks — erwäge ob ein zusätzlicher Agent eingestellt werden sollte (hire_agent).'
        : staleTasks.length >= 3
          ? '\nHINWEIS: Mehrere Tasks sind seit >7 Tagen offen — erwäge ob das Team Verstärkung braucht (hire_agent).'
          : '';

      let planningContext: string;
      if (activeGoals.length > 0) {
        planningContext =
          `Aktive Ziele: ${activeGoals.map(g => `"${g.title}" (${g.progress}%)`).join(', ')}. ` +
          `Team-Auslastung: ${workloadSummary}.${hiringHint} ` +
          `Analysiere was als nächstes getan werden muss und weise Aufgaben den passenden Team-Mitgliedern zu.`;
      } else {
        planningContext =
          `Keine übergeordneten Ziele gesetzt. Offene Aufgaben im Backlog: ${backlogTasks.map(t => `"${t.title}" [${t.priority}]`).join(', ')}. ` +
          `Team-Auslastung: ${workloadSummary}.${hiringHint} ` +
          `Priorisiere und weise diese Aufgaben den passenden Team-Mitgliedern zu. Erstelle bei Bedarf Unter-Tasks.`;
      }

      const syntheticTask = {
        id: `planning-${runId}`,
        title: 'Strategische Planung & Task-Erstellung',
        description: `Überprüfe den aktuellen Status des Teams und koordiniere die Arbeit. ${planningContext}`,
        status: 'todo',
        priority: 'high',
        executionLockedAt: null,
      };

      const traceLabel = activeGoals.length > 0
        ? `Ziele: ${activeGoals.map(g => g.title).join(', ')}`
        : `Backlog: ${backlogTasks.length} offene Tasks`;
      trace(agentId, companyId, 'action', 'Planungszyklus gestartet', traceLabel, runId);

      await this.executeTaskViaAdapter(runId, agentId, companyId, syntheticTask, advisorPlan);
    } catch (err: any) {
      console.error(`  ❌ Orchestrator planning cycle failed: ${err.message}`);
    }
  }

  /**
   * Get heartbeat run by ID
   */
  async getRun(runId: string): Promise<HeartbeatRun | null> {
    const runs = await db.select()
      .from(workCycles)
      .where(eq(workCycles.id, runId))
      .limit(1);

    if (runs.length === 0) return null;
    const run = runs[0];
    return {
      id: run.id,
      companyId: run.companyId,
      agentId: run.agentId,
      status: run.status,
      invocationSource: run.invocationSource || 'manual',
      triggerDetail: run.triggerDetail || '',
      contextSnapshot: run.contextSnapshot ? JSON.parse(run.contextSnapshot) : null,
    };
  }

  /**
   * Update run status
   */
  async updateRunStatus(runId: string, status: string, extra?: Record<string, any>): Promise<void> {
    const updateData: Record<string, any> = { status };
    if (extra) {
      if (extra.output) updateData.output = extra.output;
      if (extra.error) updateData.error = extra.error;
      if (extra.endedAt) updateData.endedAt = extra.endedAt;
      if (extra.usageJson) updateData.usageJson = JSON.stringify(extra.usageJson);
      if (extra.resultJson) updateData.resultJson = JSON.stringify(extra.resultJson);
      if (extra.sessionIdBefore) updateData.sessionIdBefore = extra.sessionIdBefore;
      if (extra.sessionIdAfter) updateData.sessionIdAfter = extra.sessionIdAfter;
      if (extra.exitCode !== undefined) updateData.exitCode = extra.exitCode;
    }
    await db.update(workCycles).set(updateData).where(eq(workCycles.id, runId));
  }

  /**
   * Record usage/costs for a run
   */
  async recordUsage(runId: string, usage: { inputTokens: number; outputTokens: number; costCents: number }): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) return;

    await db.update(workCycles)
      .set({ usageJson: JSON.stringify(usage) })
      .where(eq(workCycles.id, runId));

    await db.update(agents)
      .set({ monthlySpendCent: sql`${agents.monthlySpendCent} + ${usage.costCents}`, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, run.agentId));

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

    // ─── Post-hoc budget guard: if this call pushed the agent over budget, pause them ───
    try {
      const agentRow = db.select({ monthlyBudgetCent: agents.monthlyBudgetCent, monthlySpendCent: agents.monthlySpendCent, name: agents.name, companyId: agents.companyId })
        .from(agents).where(eq(agents.id, run.agentId)).get() as any;
      if (agentRow && agentRow.monthlyBudgetCent > 0 && agentRow.monthlySpendCent >= agentRow.monthlyBudgetCent) {
        await db.update(agents).set({ status: 'paused', updatedAt: new Date().toISOString() }).where(eq(agents.id, run.agentId));
        console.log(`💸 Budget-Stop nach Ausführung: ${agentRow.name} pausiert (${agentRow.monthlySpendCent}¢ >= ${agentRow.monthlyBudgetCent}¢)`);
        await db.insert(chatMessages).values({
          id: crypto.randomUUID(),
          companyId: agentRow.companyId,
          agentId: run.agentId,
          senderType: 'system',
          message: `🚨 **Budget-Stop**: ${agentRow.name} wurde nach dieser Ausführung automatisch pausiert. Monatsbudget (${(agentRow.monthlyBudgetCent / 100).toFixed(2)}€) überschritten.`,
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      console.warn(`[recordUsage] Post-hoc budget check failed: ${e.message}`);
    }
    // ────────────────────────────────────────────────────────────────────────────────────
  }

  /**
   * Public runCriticReview — delegates to the critic module
   */
  async runCriticReview(
    taskId: string,
    taskTitel: string,
    taskBeschreibung: string,
    output: string,
    agentId: string,
    companyId: string
  ): Promise<{ approved: boolean; feedback: string; escalate?: boolean }> {
    return runCriticReview(taskId, taskTitel, taskBeschreibung, output, agentId, companyId);
  }
}

// ── Singleton + convenience exports ───────────────────────────────────────────
export const heartbeatService = new HeartbeatServiceImpl();
export const executeHeartbeat = heartbeatService.executeHeartbeat.bind(heartbeatService);
export const processPendingWakeups = heartbeatService.processPendingWakeups.bind(heartbeatService);
export const getHeartbeatRun = heartbeatService.getRun.bind(heartbeatService);
export const updateHeartbeatStatus = heartbeatService.updateRunStatus.bind(heartbeatService);
export const recordHeartbeatUsage = heartbeatService.recordUsage.bind(heartbeatService);

// Heartbeat Service — main HeartbeatServiceImpl orchestrator
// Delegates to focused sub-modules; keeps only the core execution flow.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { appEvents } from '../../events.js';
import { db } from '../../db/client.js';
import {
  arbeitszyklen, agentWakeupRequests, experten, aufgaben, unternehmen, projekte,
  kostenbuchungen, kommentare, workProducts, chatNachrichten, aktivitaetslog,
  ziele, issueRelations, einstellungen, budgetPolicies, budgetIncidents,
  agentMeetings, genehmigungen, agentPermissions, expertenSkills, skillsLibrary,
  routinen, routineAusfuehrung, palaceKg, traceEreignisse,
} from '../../db/schema.js';
import { eq, and, sql, inArray, or, isNull, asc, desc, gte } from 'drizzle-orm';
import { pruefeUndEntblocke } from '../issue-dependencies.js';
import { wakeupService } from '../wakeup.js';
import { adapterRegistry } from '../../adapters/registry.js';
import type { AdapterTask, AdapterContext, CompanyGoal } from '../../adapters/types.js';
import { createWorkspace, listWorkspaceFiles } from '../workspace.js';
import { isSafeWorkdir } from '../../adapters/workspace-guard.js';
import { v4 as uuid } from 'uuid';
import { messagingService } from '../messaging.js';
import { loadRelevantMemory, autoSaveInsights } from '../memory-auto.js';
import { decryptSetting } from '../../utils/crypto.js';

// ── Sub-module imports ─────────────────────────────────────────────────────────
import type { HeartbeatInvocationSource, HeartbeatOptions, HeartbeatRun, HeartbeatService } from './types.js';
import { loadSoul, trace, isFocusModeActive } from './utils.js';
import { checkBudgetAndEnforce } from './budget.js';
import { runCriticReview, getAdvisorPlan, getAdvisorCorrection } from './critic.js';
import { processOrchestratorActions } from './actions-orchestrator.js';
import { processWorkerActions } from './actions-worker.js';
import { recordWorkProducts, scanForBlockedTasks, unlockDependentTasks } from './dependencies.js';
import { notifyOrchestratorTaskDone, handleMeetingWakeup } from './notifications.js';
// ──────────────────────────────────────────────────────────────────────────────

class HeartbeatServiceImpl implements HeartbeatService {
  /**
   * Create a new heartbeat run and execute it
   */
  async executeHeartbeat(
    expertId: string,
    unternehmenId: string,
    options: HeartbeatOptions
  ): Promise<string> {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(arbeitszyklen).values({
      id: runId,
      unternehmenId,
      expertId,
      quelle: options.invocationSource === 'timer' ? 'scheduler' :
              options.invocationSource === 'assignment' ? 'callback' : 'manual',
      status: 'queued',
      invocationSource: options.invocationSource,
      triggerDetail: options.triggerDetail,
      contextSnapshot: options.contextSnapshot ? JSON.stringify(options.contextSnapshot) : null,
      erstelltAm: now,
    });

    console.log(`🔄 Heartbeat run ${runId} created for expert ${expertId} (${options.invocationSource})`);
    await this.executeRun(runId, expertId, unternehmenId, options);
    return runId;
  }

  /**
   * Process all pending wakeups for an agent
   */
  async processPendingWakeups(expertId: string): Promise<number> {
    const expert = await db.select()
      .from(experten)
      .where(eq(experten.id, expertId))
      .limit(1);

    if (expert.length === 0) {
      console.warn(`⚠️ Expert ${expertId} not found`);
      return 0;
    }

    const agent = expert[0];

    if (agent.status === 'paused' || agent.status === 'terminated') {
      console.log(`⏸️ Skipping heartbeat for paused/terminated agent ${expertId}`);
      return 0;
    }

    // ─── Budget-Autothrottling ────────────────────────────────────────────────────
    if (agent.budgetMonatCent > 0) {
      const verbrauchPct = (agent.verbrauchtMonatCent / agent.budgetMonatCent) * 100;

      if (verbrauchPct >= 100) {
        console.log(`💸 Budget erschöpft (${verbrauchPct.toFixed(0)}%) — pausiere Agent ${expertId}`);
        await db.update(experten)
          .set({ status: 'paused', aktualisiertAm: new Date().toISOString() })
          .where(eq(experten.id, expertId));
        await db.insert(chatNachrichten).values({
          id: crypto.randomUUID(),
          unternehmenId: agent.unternehmenId,
          expertId,
          absenderTyp: 'system',
          nachricht: `🚨 **Budget-Stop**: ${agent.name} wurde automatisch pausiert. Monatsbudget (${(agent.budgetMonatCent / 100).toFixed(2)}€) zu 100% verbraucht. Bitte Budget erhöhen oder Agent manuell reaktivieren.`,
          gelesen: false,
          erstelltAm: new Date().toISOString(),
        });
        return 0;
      }

      if (verbrauchPct >= 80) {
        const recentWarning = await db.select()
          .from(chatNachrichten)
          .where(and(eq(chatNachrichten.expertId, expertId), eq(chatNachrichten.absenderTyp, 'system')))
          .limit(20)
          .then((msgs: { nachricht: string; erstelltAm: string }[]) => msgs.some((m) =>
            m.nachricht.includes('Budget-Warnung') &&
            new Date(m.erstelltAm) > new Date(Date.now() - 24 * 60 * 60 * 1000)
          ));

        if (!recentWarning) {
          console.log(`⚠️ Budget-Warnung (${verbrauchPct.toFixed(0)}%) für Agent ${expertId}`);
          await db.insert(chatNachrichten).values({
            id: crypto.randomUUID(),
            unternehmenId: agent.unternehmenId,
            expertId,
            absenderTyp: 'system',
            nachricht: `⚠️ **Budget-Warnung**: ${agent.name} hat ${verbrauchPct.toFixed(0)}% des Monatsbudgets verbraucht (${(agent.verbrauchtMonatCent / 100).toFixed(2)}€ von ${(agent.budgetMonatCent / 100).toFixed(2)}€). Bei 100% wird der Agent automatisch pausiert.`,
            gelesen: false,
            erstelltAm: new Date().toISOString(),
          });
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const pendingWakeups = await wakeupService.getPendingWakeups(expertId, 5);
    if (pendingWakeups.length === 0) return 0;

    let processedCount = 0;

    for (const wakeup of pendingWakeups) {
      try {
        const runId = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.insert(arbeitszyklen).values({
          id: runId,
          unternehmenId: wakeup.contextSnapshot?.unternehmenId || agent.unternehmenId,
          expertId,
          quelle: wakeup.source === 'timer' ? 'scheduler' :
                  wakeup.source === 'assignment' ? 'callback' : 'manual',
          status: 'queued',
          invocationSource: wakeup.source,
          triggerDetail: wakeup.triggerDetail,
          contextSnapshot: JSON.stringify(wakeup.contextSnapshot || {}),
          erstelltAm: now,
        });

        await wakeupService.claimWakeup(wakeup.id, runId);
        await this.executeRun(runId, expertId, agent.unternehmenId, {
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
    expertId: string,
    unternehmenId: string,
    options: HeartbeatOptions
  ): Promise<void> {
    const now = new Date().toISOString();

    try {
      const agentExists = db.select({ id: experten.id }).from(experten).where(eq(experten.id, expertId)).get();
      if (!agentExists) {
        console.warn(`⚠️ Heartbeat ${runId}: Agent ${expertId} wurde gelöscht — Ausführung übersprungen`);
        await this.updateRunStatus(runId, 'failed', 'Agent wurde gelöscht');
        return;
      }

      await this.updateRunStatus(runId, 'running');
      const inbox = await this.getAgentInbox(expertId, unternehmenId);

      console.log(`▶️ Heartbeat ${runId}: Processing ${inbox.length} tasks for expert ${expertId}`);

      await db.update(experten)
        .set({ status: 'running', letzterZyklus: now, aktualisiertAm: now })
        .where(eq(experten.id, expertId));

      // ─── Routine Handler ─────────────────────────────────────────────────────
      if (options.payload?.routineId) {
        const routineId = options.payload.routineId as string;
        const executionId = options.payload.executionId as string | undefined;
        const routine = db.select({ id: routinen.id, titel: routinen.titel, beschreibung: routinen.beschreibung, unternehmenId: routinen.unternehmenId })
          .from(routinen).where(eq(routinen.id, routineId)).get() as any;

        if (routine) {
          const syntheticTask = {
            id: `routine-${routineId}-${runId}`,
            titel: routine.titel,
            beschreibung: routine.beschreibung || routine.titel,
            status: 'todo',
            prioritaet: 'medium',
            executionLockedAt: null,
          };

          console.log(`  📅 Routine-Trigger: "${routine.titel}"`);
          trace(expertId, unternehmenId, 'action', `Routine gestartet: ${routine.titel}`, undefined, runId);
          await this.executeTaskViaAdapter(runId, expertId, unternehmenId, syntheticTask, null);

          if (executionId) {
            db.update(routineAusfuehrung as any)
              .set({ status: 'completed', beendetAm: new Date().toISOString() } as any)
              .where(eq((routineAusfuehrung as any).id, executionId)).run();
          }
          db.update(routinen).set({ zuletztAusgefuehrtAm: new Date().toISOString() } as any)
            .where(eq(routinen.id, routineId)).run();
        }

        await this.updateRunStatus(runId, 'succeeded', {
          ausgabe: routine ? `Routine ausgeführt: ${routine.titel}` : `Routine ${routineId} nicht gefunden`,
          beendetAm: new Date().toISOString(),
        });
        await db.update(experten).set({ status: 'idle', aktualisiertAm: new Date().toISOString() }).where(eq(experten.id, expertId));
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────────

      // ─── Meeting Handler ──────────────────────────────────────────────────────
      const meetingPayload = options.payload?.meetingId ? options.payload : null;
      if (meetingPayload?.meetingId) {
        await handleMeetingWakeup(runId, expertId, unternehmenId, meetingPayload.meetingId as string);
        await this.updateRunStatus(runId, 'succeeded', {
          ausgabe: `Meeting beantwortet: ${meetingPayload.thema || meetingPayload.meetingId}`,
          beendetAm: new Date().toISOString(),
        });
        await db.update(experten).set({ status: 'idle', aktualisiertAm: new Date().toISOString() }).where(eq(experten.id, expertId));
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────────

      // ─── Advisor Strategy Integration ──────────────────────────────────────────
      let advisorPlan: string | null = null;
      const agentWithAdvisor = db.select().from(experten).where(eq(experten.id, expertId)).get();

      if (agentWithAdvisor?.advisorId && agentWithAdvisor.advisorStrategy === 'planning') {
        console.log(`🧠 Consulting Advisor ${agentWithAdvisor.advisorId} for a plan...`);
        advisorPlan = await getAdvisorPlan(agentWithAdvisor.advisorId, expertId, unternehmenId, inbox);

        await db.insert(aktivitaetslog).values({
          id: uuid(),
          unternehmenId,
          akteurTyp: 'agent',
          akteurId: agentWithAdvisor.advisorId,
          aktion: 'advisor_plan_created',
          entitaetTyp: 'expert',
          entitaetId: expertId,
          details: JSON.stringify({ plan: advisorPlan?.slice(0, 500), runId }),
          erstelltAm: new Date().toISOString(),
        });
      }
      // ─────────────────────────────────────────────────────────────────────────────

      // ─── Orchestrator: Blocker-Scan ────────────────────────────────────────
      const agentMeta = db.select({ isOrchestrator: experten.isOrchestrator }).from(experten).where(eq(experten.id, expertId)).get() as any;
      if (agentMeta?.isOrchestrator) {
        await scanForBlockedTasks(unternehmenId, expertId);
      }
      // ──────────────────────────────────────────────────────────────────────

      for (const task of inbox) {
        await this.processTask(runId, expertId, unternehmenId, task, advisorPlan);
      }

      // ─── Orchestrator Planning Cycle ──────────────────────────────────────
      if (agentMeta?.isOrchestrator && inbox.length === 0) {
        console.log(`  🧭 Orchestrator ${expertId} has empty inbox — running planning cycle`);
        await this.runOrchestratorPlanning(runId, expertId, unternehmenId, advisorPlan);
      }
      // ──────────────────────────────────────────────────────────────────────

      await this.updateRunStatus(runId, 'succeeded', {
        ausgabe: inbox.length > 0 ? `Abgeschlossen: ${inbox.map((t: any) => t.titel).join(', ')}` : 'Planungszyklus abgeschlossen',
        beendetAm: new Date().toISOString(),
      });

      await db.update(experten)
        .set({ status: 'idle', aktualisiertAm: new Date().toISOString() })
        .where(eq(experten.id, expertId));

    } catch (error) {
      console.error(`❌ Heartbeat ${runId} failed:`, error);

      await this.updateRunStatus(runId, 'failed', {
        fehler: error instanceof Error ? error.message : String(error),
        beendetAm: new Date().toISOString(),
      });

      await db.update(experten)
        .set({ status: 'error', aktualisiertAm: new Date().toISOString() })
        .where(eq(experten.id, expertId));

      throw error;
    }
  }

  /**
   * Get agent's inbox (assigned tasks that are not done)
   */
  private async getAgentInbox(expertId: string, unternehmenId: string): Promise<Array<{
    id: string;
    titel: string;
    status: string;
    prioritaet: string;
    executionLockedAt: string | null;
    zielId: string | null;
  }>> {
    const agent = await db.select({ isOrchestrator: experten.isOrchestrator })
      .from(experten)
      .where(eq(experten.id, expertId))
      .get();

    const isOrchestrator = agent?.isOrchestrator === true;

    const tasks = await db.select({
      id: aufgaben.id,
      titel: aufgaben.titel,
      status: aufgaben.status,
      prioritaet: aufgaben.prioritaet,
      executionLockedAt: aufgaben.executionLockedAt,
      executionRunId: aufgaben.executionRunId,
      zielId: aufgaben.zielId,
      isMaximizerMode: aufgaben.isMaximizerMode,
    })
    .from(aufgaben)
    .where(
      and(
        eq(aufgaben.unternehmenId, unternehmenId),
        inArray(aufgaben.status, ['backlog', 'todo', 'in_progress']),
        isOrchestrator
          ? or(eq(aufgaben.zugewiesenAn, expertId), isNull(aufgaben.zugewiesenAn))
          : eq(aufgaben.zugewiesenAn, expertId)
      )
    );

    // Sort: MaximizerMode → goal-linked → priority weight
    const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    tasks.sort((a, b) => {
      const aMax = (a as any).isMaximizerMode ? 1 : 0;
      const bMax = (b as any).isMaximizerMode ? 1 : 0;
      if (aMax !== bMax) return bMax - aMax;
      const aGoal = a.zielId ? 1 : 0;
      const bGoal = b.zielId ? 1 : 0;
      if (aGoal !== bGoal) return bGoal - aGoal;
      return (priorityWeight[b.prioritaet] ?? 0) - (priorityWeight[a.prioritaet] ?? 0);
    });

    return tasks;
  }

  /**
   * Process a single task (checkout and execute)
   */
  private async processTask(
    runId: string,
    expertId: string,
    unternehmenId: string,
    task: { id: string; titel: string; status: string; prioritaet: string; executionLockedAt: string | null },
    advisorPlan: string | null = null
  ): Promise<void> {
    console.log(`  📋 Processing task: ${task.titel} (${task.id})`);

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

    // Resolve workspace: projekt.workDir → unternehmen.workDir → isolated fallback
    const company = db.select({ workDir: unternehmen.workDir }).from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get() as any;
    const companyWorkDir = company?.workDir;

    const projektWorkDir = (task as any).projektId
      ? (db.select({ workDir: projekte.workDir }).from(projekte).where(eq(projekte.id, (task as any).projektId)).get() as any)?.workDir
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
    } else {
      if (companyWorkDir && !isSafeWorkdir(companyWorkDir)) {
        console.warn(`[Heartbeat] ⛔ companyWorkDir '${companyWorkDir}' is inside the OpenCognit project root — using isolated workspace instead.`);
      }
      workspacePath = createWorkspace(task.id, expertId, runId);
    }

    const now = new Date().toISOString();
    await db.update(aufgaben)
      .set({
        executionRunId: runId,
        executionAgentNameKey: `expert-${expertId}`,
        executionLockedAt: now,
        workspacePath,
        status: task.status === 'backlog' ? 'todo' : task.status,
        gestartetAm: (task as any).gestartetAm || now,
      })
      .where(
        and(
          eq(aufgaben.id, task.id),
          or(eq(aufgaben.zugewiesenAn, expertId), isNull(aufgaben.zugewiesenAn))
        )
      );

    console.log(`  🔒 Task ${task.id} checked out → workspace: ${workspacePath}`);
    trace(expertId, unternehmenId, 'action', `Task gestartet: ${task.titel}`, `Workspace: ${workspacePath}`, runId);

    await this.executeTaskViaAdapter(runId, expertId, unternehmenId, task, advisorPlan);
  }

  /**
   * Execute task via adapter (Bash, HTTP, Claude Code, OpenClaw, etc.)
   */
  private async executeTaskViaAdapter(
    runId: string,
    expertId: string,
    unternehmenId: string,
    task: { id: string; titel: string; status: string; prioritaet: string; executionLockedAt: string | null },
    advisorPlan: string | null = null
  ): Promise<void> {
    try {
      // Get full task details (synthetic planning tasks won't be in DB — use the passed task object)
      const taskFull = await db.select()
        .from(aufgaben)
        .where(eq(aufgaben.id, task.id))
        .limit(1)
        .then((rows: any[]) => rows[0]) ?? {
          ...task,
          beschreibung: (task as any).beschreibung || null,
          zielId: null,
          workspacePath: null,
          abgeschlossenAm: null,
          gestartetAm: null,
          executionRunId: null,
        };

      const expert = await db.select()
        .from(experten)
        .where(eq(experten.id, expertId))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      const unternehmenData = await db.select()
        .from(unternehmen)
        .where(eq(unternehmen.id, unternehmenId))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      const comments = await db.select()
        .from(kommentare)
        .where(eq(kommentare.aufgabeId, task.id))
        .orderBy(kommentare.erstelltAm);

      // ─── Task-Output-as-Input: load outputs from blocker tasks ──────────────
      let blockerOutputs: string | null = null;
      try {
        const blockers = await db.select({ blockerId: issueRelations.quellId })
          .from(issueRelations)
          .where(eq(issueRelations.zielId, task.id));

        if (blockers.length > 0) {
          const blockerResults: string[] = [];
          for (const { blockerId } of blockers) {
            const lastComment = await db.select({ inhalt: kommentare.inhalt, erstelltAm: kommentare.erstelltAm })
              .from(kommentare)
              .where(eq(kommentare.aufgabeId, blockerId))
              .orderBy(desc(kommentare.erstelltAm))
              .limit(1)
              .then((r: any[]) => r[0]);
            const blockerTask = await db.select({ titel: aufgaben.titel })
              .from(aufgaben).where(eq(aufgaben.id, blockerId)).limit(1).then((r: any[]) => r[0]);
            if (lastComment && blockerTask) {
              blockerResults.push(`### Ergebnis aus "${blockerTask.titel}":\n${lastComment.inhalt.slice(0, 1500)}`);
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
        titel: taskFull.titel,
        beschreibung: taskFull.beschreibung,
        status: taskFull.status,
        prioritaet: taskFull.prioritaet,
      };

      // ─── Memory Kontext laden (nativ) ───────────────────────────────
      const taskKeywords = [taskFull.titel, taskFull.beschreibung || '']
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 4);
      const memoryContext = loadRelevantMemory(expertId, taskKeywords) || null;
      // ────────────────────────────────────────────────────────────────────

      // ─── Load active goals with live task progress ──────────────────────
      let activeGoals: CompanyGoal[] = [];
      try {
        const rawGoals = await db.select({
          id: ziele.id,
          titel: ziele.titel,
          beschreibung: ziele.beschreibung,
          fortschritt: ziele.fortschritt,
          status: ziele.status,
        }).from(ziele)
          .where(and(
            eq(ziele.unternehmenId, unternehmenId),
            inArray(ziele.status, ['active', 'planned']),
          ))
          .orderBy(asc(ziele.erstelltAm))
          .limit(5);

        for (const g of rawGoals) {
          const linkedTasks = await db.select({ status: aufgaben.status })
            .from(aufgaben)
            .where(and(eq(aufgaben.zielId, g.id), eq(aufgaben.unternehmenId, unternehmenId)));
          const doneTasks = linkedTasks.filter(t => t.status === 'done').length;
          const openTasks = linkedTasks.filter(t => t.status !== 'done').length;
          const computedProgress = linkedTasks.length > 0
            ? Math.round((doneTasks / linkedTasks.length) * 100)
            : g.fortschritt;
          activeGoals.push({
            id: g.id, titel: g.titel, beschreibung: g.beschreibung,
            fortschritt: computedProgress, status: g.status, openTasks, doneTasks,
          });
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Goals konnten nicht geladen werden: ${err.message}`);
      }
      // ──────────────────────────────────────────────────────────────────

      const teamMembers = expert?.isOrchestrator
        ? await db.select({ id: experten.id, name: experten.name, rolle: experten.rolle, status: experten.status })
            .from(experten)
            .where(and(eq(experten.unternehmenId, unternehmenId), eq(experten.isOrchestrator, false)))
        : [];

      const openTasksList = expert?.isOrchestrator
        ? await db.select({ id: aufgaben.id, titel: aufgaben.titel, status: aufgaben.status, zugewiesenAn: aufgaben.zugewiesenAn, prioritaet: aufgaben.prioritaet })
            .from(aufgaben)
            .where(and(
              eq(aufgaben.unternehmenId, unternehmenId),
              inArray(aufgaben.status, ['backlog', 'todo', 'in_progress', 'blocked']),
            ))
            .limit(20)
        : [];

      let projektContext: AdapterContext['projektContext'] | undefined;
      if (taskFull.projektId) {
        const proj = await db.select({ name: projekte.name, beschreibung: projekte.beschreibung, workDir: projekte.workDir })
          .from(projekte)
          .where(eq(projekte.id, taskFull.projektId))
          .limit(1)
          .then((rows: any[]) => rows[0]);
        if (proj) {
          projektContext = { name: proj.name, beschreibung: proj.beschreibung, workDir: proj.workDir };
        }
      }

      const adapterContext: AdapterContext = {
        task: adapterTask,
        previousComments: comments.map((c: any) => ({
          id: c.id, inhalt: c.inhalt,
          autorTyp: c.autorTyp as 'agent' | 'board',
          erstelltAm: c.erstelltAm,
        })),
        companyContext: {
          name: unternehmenData?.name || 'Unknown',
          ziel: unternehmenData?.ziel || null,
          goals: activeGoals.length > 0 ? activeGoals : undefined,
        },
        ...(projektContext ? { projektContext } : {}),
        agentContext: {
          name: expert?.name || 'Unknown Agent',
          rolle: expert?.rolle || 'Agent',
          faehigkeiten: expert?.faehigkeiten || null,
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
                .slice(0, 60).join('\n');
              return files ? { workspaceFiles: `## Bereits vorhandene Dateien im Workspace\n\`\`\`\n${files}\n\`\`\`\nBitte konsistenten Code-Stil verwenden und bestehende Dateien beachten.` } : {};
            } catch { return {}; }
          })(),
          ...(memoryContext ? { gedaechtnis: memoryContext } : {}),
          ...(blockerOutputs ? { vorgaengerOutputs: blockerOutputs } : {}),
          ...(advisorPlan ? { advisorPlan: `### 🧠 STRATEGISCHER PLAN DES ARCHITEKTEN/ADVISORS\n\n${advisorPlan}\n\n*Bitte befolge diesen Plan strikt bei der Ausführung der Aufgabe.*` } : {}),
          ...(expert?.isOrchestrator && teamMembers.length > 0 ? {
            team: teamMembers.map(m => ({ id: m.id, name: m.name, rolle: m.rolle, status: m.status })),
            offeneTasks: openTasksList.map(t => ({ id: t.id, titel: t.titel, status: t.status, zugewiesenAn: t.zugewiesenAn, prioritaet: t.prioritaet })),
            aktionsFormat: `
## WICHTIG: Aktionen als JSON ausgeben

Wenn du Tasks erstellen, zuweisen oder Ziele aktualisieren willst, füge am ENDE deiner Antwort einen JSON-Block ein:

\`\`\`json
{
  "actions": [
    {"type": "create_task", "titel": "Task-Titel", "beschreibung": "Beschreibung...", "assignTo": "Agent Name", "prioritaet": "high", "zielId": "GOAL_ID"},
    {"type": "assign_task", "taskId": "TASK_ID", "assignTo": "Agent Name"},
    {"type": "mark_done", "taskId": "TASK_ID"},
    {"type": "update_goal", "goalId": "GOAL_ID", "fortschritt": 50},
    {"type": "hire_agent", "rolle": "QA Engineer", "faehigkeiten": "Testing, Python", "begruendung": "Wir brauchen mehr QA-Kapazität"}
  ]
}
\`\`\`

Verfügbare Prioritäten: critical, high, medium, low
Verfügbare Team-Mitglieder: ${teamMembers.map(m => m.name).join(', ')}
WICHTIG: Verknüpfe jeden neuen Task mit einem Ziel via "zielId". Aktualisiere Ziel-Fortschritt (update_goal) wenn Tasks abgeschlossen wurden.
`,
          } : {}),
        },
      };

      if (memoryContext) {
        console.log(`  🧠 Memory geladen für Agent ${expertId} (${memoryContext.length} Zeichen)`);
      }

      // ─── TOKEN BUDGET GUARD ────────────────────────────────────────────────
      const CONTEXT_CHAR_LIMIT = 320_000;
      const estimatedSize = JSON.stringify(adapterContext).length;
      if (estimatedSize > CONTEXT_CHAR_LIMIT) {
        console.warn(`  ⚠️ Context too large (${Math.round(estimatedSize / 1000)}k chars) — trimming`);
        const agentCtx = adapterContext.agentContext as any;
        if (agentCtx.vorgaengerOutputs) agentCtx.vorgaengerOutputs = agentCtx.vorgaengerOutputs.slice(0, 20_000) + '\n[...gekürzt]';
        if (adapterContext.agentContext.gedaechtnis) adapterContext.agentContext.gedaechtnis = (adapterContext.agentContext.gedaechtnis as string).slice(0, 10_000) + '\n[...gekürzt]';
        if (JSON.stringify(adapterContext).length > CONTEXT_CHAR_LIMIT) adapterContext.previousComments = adapterContext.previousComments.slice(-5);
        if (agentCtx.offeneTasks) agentCtx.offeneTasks = agentCtx.offeneTasks.slice(0, 20);
        const afterSize = JSON.stringify(adapterContext).length;
        console.log(`  ✂️ Context trimmed: ${Math.round(estimatedSize / 1000)}k → ${Math.round(afterSize / 1000)}k chars`);
      }
      // ──────────────────────────────────────────────────────────────────────

      console.log(`  🤖 Executing task via adapter: ${taskFull.titel}`);

      // ── SOUL.md: load file-based identity if configured ──────────────────────
      const soulVars = {
        'company.name': unternehmenData?.name || 'Unknown',
        'company.goal': unternehmenData?.ziel || '',
        'agent.name': expert?.name || '',
        'agent.role': expert?.rolle || '',
      };
      const resolvedSystemPrompt =
        loadSoul(expert as any, soulVars)
        ?? expert?.systemPrompt
        ?? undefined;
      // ──────────────────────────────────────────────────────────────────────────

      // ── Budget-Check vor Ausführung ────────────────────────────────────────────
      const isSyntheticTaskEarly = task.id.startsWith('planning-');
      const budgetCheck = await checkBudgetAndEnforce(expertId, unternehmenId);
      if (!budgetCheck.allowed) {
        trace(expertId, unternehmenId, 'error', `🛑 Task blockiert: ${budgetCheck.reason}`, undefined, runId);
        if (!isSyntheticTaskEarly) {
          try {
            await db.insert(kommentare).values({
              id: crypto.randomUUID(), unternehmenId, aufgabeId: task.id,
              autorExpertId: expertId, autorTyp: 'agent',
              inhalt: `🛑 **Ausführung blockiert — Budget-Limit erreicht**\n\n${budgetCheck.reason}\n\nBitte erhöhe das Budget-Limit in den Einstellungen oder warte auf den nächsten Abrechnungszeitraum.`,
              erstelltAm: new Date().toISOString(),
            });
          } catch { /* agent may have been deleted mid-run */ }
          await db.update(aufgaben)
            .set({ executionLockedAt: null, executionRunId: null, status: 'blocked' })
            .where(eq(aufgaben.id, task.id));
        }
        await this.updateRunStatus(runId, 'failed', { fehler: budgetCheck.reason });
        return;
      }
      // ──────────────────────────────────────────────────────────────────────────

      // Resolve effective adapter type
      let effectiveVerbindungsTyp = expert?.verbindungsTyp || 'claude-code';
      let heartbeatParsedConfig: any = {};
      if (expert?.verbindungsConfig) {
        try {
          heartbeatParsedConfig = JSON.parse(expert.verbindungsConfig as string);
          if (effectiveVerbindungsTyp === 'claude-code' && heartbeatParsedConfig.model?.includes('/')) {
            effectiveVerbindungsTyp = 'openrouter';
          }
        } catch { /* keep as-is */ }
      }

      // Guard: Blockiere Free Models
      const heartbeatModel: string = heartbeatParsedConfig.model || '';
      if (heartbeatModel.endsWith(':free') || heartbeatModel === 'auto:free') {
        console.error(`[Heartbeat] Agent ${expert?.name} hat Free-Model (${heartbeatModel}). Ausführung blockiert.`);
        await this.updateRunStatus(runId, 'failed', { fehler: `Free-Model "${heartbeatModel}" blockiert. Bitte wechsle zu einem bezahlten Modell.` });
        return;
      }

      // Load global default model for OpenRouter/Ollama agents without a specific model
      let heartbeatGlobalDefaultModel: string | undefined;
      if (effectiveVerbindungsTyp === 'openrouter' || effectiveVerbindungsTyp === 'ollama') {
        const dmKey = effectiveVerbindungsTyp === 'ollama' ? 'ollama_default_model' : 'openrouter_default_model';
        try {
          const dmRow = db.select({ wert: einstellungen.wert }).from(einstellungen)
            .where(and(eq(einstellungen.schluessel, dmKey), eq(einstellungen.unternehmenId, unternehmenId))).get()
            ?? db.select({ wert: einstellungen.wert }).from(einstellungen)
              .where(and(eq(einstellungen.schluessel, dmKey), eq(einstellungen.unternehmenId, ''))).get();
          if (dmRow?.wert) heartbeatGlobalDefaultModel = decryptSetting(dmKey, dmRow.wert);
        } catch { /* ignore */ }
      }

      // ─── OpenClaw Enrichment ───────────────────────────────────────────────
      if (effectiveVerbindungsTyp === 'openclaw') {
        try {
          const recentDone = await db
            .select({ taskTitel: aufgaben.titel, output: kommentare.inhalt, completedAt: kommentare.erstelltAm })
            .from(kommentare)
            .innerJoin(aufgaben, eq(kommentare.aufgabeId, aufgaben.id))
            .where(and(
              eq(aufgaben.zugewiesenAn, expertId),
              eq(aufgaben.status, 'done'),
              eq(kommentare.autorTyp, 'agent'),
            ))
            .orderBy(desc(kommentare.erstelltAm))
            .limit(3);

          const siblingTasks = taskFull.projektId
            ? await db
                .select({ id: aufgaben.id, titel: aufgaben.titel, status: aufgaben.status, zugewiesenAn: aufgaben.zugewiesenAn })
                .from(aufgaben)
                .where(and(
                  eq(aufgaben.projektId, taskFull.projektId),
                  eq(aufgaben.unternehmenId, unternehmenId),
                  inArray(aufgaben.status, ['backlog', 'todo', 'in_progress', 'blocked']),
                ))
                .limit(15)
            : [];

          const assigneeIds = [...new Set(siblingTasks.map((t: any) => t.zugewiesenAn).filter(Boolean))];
          const assigneeNames: Record<string, string> = {};
          if (assigneeIds.length > 0) {
            const rows = await db.select({ id: experten.id, name: experten.name }).from(experten)
              .where(inArray(experten.id, assigneeIds as string[]));
            for (const r of rows) assigneeNames[r.id] = r.name;
          }

          const ocTaskKeywords = (taskFull.titel + ' ' + (taskFull.beschreibung || ''))
            .toLowerCase().replace(/[^\wäöüß\s]/g, ' ').split(/\s+/)
            .filter(w => w.length >= 4).slice(0, 8);

          let kgFacts: Array<{ subject: string; predicate: string; object: string }> = [];
          if (ocTaskKeywords.length > 0) {
            const allFacts = await db.select({ subject: palaceKg.subject, predicate: palaceKg.predicate, object: palaceKg.object })
              .from(palaceKg)
              .where(and(eq(palaceKg.unternehmenId, unternehmenId), isNull(palaceKg.validUntil)))
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
            .select({ name: experten.name, rolle: experten.rolle, taskTitel: aufgaben.titel })
            .from(experten)
            .innerJoin(aufgaben, and(eq(aufgaben.zugewiesenAn, experten.id), eq(aufgaben.status, 'in_progress')))
            .where(and(eq(experten.unternehmenId, unternehmenId), sql`${experten.id} != ${expertId}`))
            .limit(5);

          adapterContext.openclawEnrichment = {
            recentOutputs: recentDone.map((r: any) => ({
              taskTitel: r.taskTitel,
              output: (r.output || '').slice(0, 800),
              completedAt: r.completedAt,
            })),
            projectSiblingTasks: siblingTasks.map((t: any) => ({
              id: t.id, titel: t.titel, status: t.status,
              assignedTo: t.zugewiesenAn ? (assigneeNames[t.zugewiesenAn] ?? t.zugewiesenAn) : null,
            })),
            kgFacts,
            activeColleagues: activeOthers.map((r: any) => ({ name: r.name, rolle: r.rolle, currentTask: r.taskTitel })),
          };
          console.log(`  🔗 OpenClaw enrichment: ${recentDone.length} recent outputs, ${siblingTasks.length} sibling tasks, ${kgFacts.length} KG facts, ${activeOthers.length} active colleagues`);
        } catch (err: any) {
          console.warn(`  ⚠️ OpenClaw enrichment failed (non-critical): ${err.message}`);
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      const result = await adapterRegistry.executeTask(adapterTask, adapterContext, {
        expertId,
        unternehmenId,
        runId,
        timeoutMs: 10 * 60 * 1000,
        workspacePath: (taskFull as any).workspacePath || undefined,
        systemPrompt: resolvedSystemPrompt,
        verbindungsTyp: effectiveVerbindungsTyp,
        verbindungsConfig: Object.keys(heartbeatParsedConfig).length > 0 ? heartbeatParsedConfig : undefined,
        globalDefaultModel: heartbeatGlobalDefaultModel,
      });

      await this.updateRunStatus(runId, result.success ? 'succeeded' : 'failed', {
        ausgabe: result.output, fehler: result.error || null,
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
          console.log(`  ⏳ Rate limit for task ${task.id} (${taskFull.titel}) — will retry next cycle`);
          trace(expertId, unternehmenId, 'info', `Rate limit — wird automatisch wiederholt: ${taskFull.titel}`, undefined, runId);
          if (!isSyntheticTask) {
            await db.update(aufgaben)
              .set({ executionLockedAt: null, executionRunId: null })
              .where(eq(aufgaben.id, task.id));
          }
        } else {
          console.log(`  ⏳ Timeout/network for task ${task.id} (${taskFull.titel}) — retry in 5min`);
          trace(expertId, unternehmenId, 'info', `Timeout — Retry in 5 Minuten: ${taskFull.titel}`, result.error, runId);
          if (!isSyntheticTask) {
            const backoffLock = new Date(Date.now() - (30 * 60 * 1000 - 5 * 60 * 1000)).toISOString();
            await db.update(aufgaben)
              .set({ executionLockedAt: backoffLock, executionRunId: null })
              .where(eq(aufgaben.id, task.id));
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
          await db.insert(kommentare).values({
            id: crypto.randomUUID(), unternehmenId, aufgabeId: task.id,
            autorExpertId: expertId, autorTyp: 'agent',
            inhalt: resultComment, erstelltAm: new Date().toISOString(),
          });
        } catch { /* agent may have been deleted mid-run */ }
      }

      console.log(`  ✅ Adapter execution completed for task ${task.id}`);
      trace(expertId, unternehmenId, result.success ? 'result' : 'error',
        result.success ? `Task abgeschlossen: ${taskFull.titel}` : `Task fehlgeschlagen: ${taskFull.titel}`,
        result.success ? result.output?.slice(0, 500) : result.error, runId,
      );

      // ─── AGENTIC ACTION PARSING ─────────────────────────────────────
      const isOrchestrator = expert?.isOrchestrator === true;
      const cliAdapters = ['claude-code', 'bash', 'http', 'codex-cli', 'gemini-cli'];
      const isCliAdapter = cliAdapters.includes(expert?.verbindungsTyp || '');
      let orchestratorMarkedCurrentTaskDone = false;
      if (result.success && result.output) {
        if (isOrchestrator) {
          orchestratorMarkedCurrentTaskDone = await processOrchestratorActions(task.id, expertId, unternehmenId, result.output);
        } else if (isCliAdapter) {
          await processWorkerActions(task.id, expertId, unternehmenId, runId, result.output, (taskFull as any).workspacePath);
        }
      }
      // ────────────────────────────────────────────────────────────────

      if (!isSyntheticTask) {
        if (result.success) {
          // ─── CRITIC/EVALUATOR LOOP ─────────────────────────────────────────
          if (!isOrchestrator && result.output) {
            const criticResult = await runCriticReview(
              task.id, taskFull.titel, taskFull.beschreibung || '', result.output, expertId, unternehmenId
            );

            if (!criticResult.approved) {
              if (criticResult.escalate) {
                console.log(`  🚨 Critic: escalating task ${task.id} to human review`);
                trace(expertId, unternehmenId, 'warning', `Critic: Eskalation — ${taskFull.titel}`, criticResult.feedback, runId);
                await db.insert(kommentare).values({
                  id: crypto.randomUUID(), unternehmenId, aufgabeId: task.id,
                  autorExpertId: expertId, autorTyp: 'agent',
                  inhalt: `🚨 **Critic Review — Manuelle Prüfung erforderlich**\n\n${criticResult.feedback}\n\n*Der Agent hat die Aufgabe nach 2 Überarbeitungszyklen nicht erfolgreich abgeschlossen. Bitte prüfe manuell.*`,
                  erstelltAm: new Date().toISOString(),
                });
                await db.update(aufgaben)
                  .set({ executionLockedAt: null, executionRunId: null, status: 'blocked' })
                  .where(eq(aufgaben.id, task.id));
              } else {
                console.log(`  🔍 Critic rejected task ${task.id}: ${criticResult.feedback}`);
                trace(expertId, unternehmenId, 'info', `Critic: Überarbeitung nötig — ${taskFull.titel}`, criticResult.feedback, runId);
                await db.insert(kommentare).values({
                  id: crypto.randomUUID(), unternehmenId, aufgabeId: task.id,
                  autorExpertId: expertId, autorTyp: 'agent',
                  inhalt: `🔍 **Critic Review — Überarbeitung erforderlich**\n\n${criticResult.feedback}\n\n*Bitte überarbeite die Aufgabe entsprechend diesem Feedback.*`,
                  erstelltAm: new Date().toISOString(),
                });
                await db.update(aufgaben)
                  .set({ executionLockedAt: null, executionRunId: null, status: 'in_progress' })
                  .where(eq(aufgaben.id, task.id));
              }
              return;
            }
            console.log(`  ✅ Critic approved task ${task.id}`);
          }
          // ──────────────────────────────────────────────────────────────────

          const finalStatus = 'done';
          const finalAbgeschlossenAm = new Date().toISOString();
          await db.update(aufgaben)
            .set({ status: finalStatus, abgeschlossenAm: finalAbgeschlossenAm, executionLockedAt: null, executionRunId: null })
            .where(eq(aufgaben.id, task.id));

          // Unblock dependent tasks
          const entblockt = pruefeUndEntblocke(task.id);
          if (entblockt.length > 0) {
            trace(expertId, unternehmenId, 'info', `🔓 ${entblockt.length} Task(s) entblockt`, entblockt.join(', '), runId);
          }

          // Auto-update goal progress
          const completedTask = await db.select({ zielId: aufgaben.zielId })
            .from(aufgaben).where(eq(aufgaben.id, task.id)).get();
          const zielId = completedTask?.zielId;
          if (zielId) {
            const allGoalTasks = await db.select({ status: aufgaben.status })
              .from(aufgaben)
              .where(and(eq(aufgaben.zielId, zielId), eq(aufgaben.unternehmenId, unternehmenId)));
            const total = allGoalTasks.length;
            const done = allGoalTasks.filter(t => t.status === 'done').length;
            if (total > 0) {
              const fortschritt = Math.round((done / total) * 100);
              await db.update(ziele)
                .set({ fortschritt, aktualisiertAm: new Date().toISOString() })
                .where(and(eq(ziele.id, zielId), eq(ziele.unternehmenId, unternehmenId)))
                .run();
              console.log(`  📊 Ziel-Fortschritt auto-aktualisiert: ${fortschritt}% (${done}/${total} Tasks erledigt)`);
              trace(expertId, unternehmenId, 'result', `Ziel-Fortschritt aktualisiert: ${fortschritt}%`, `${done}/${total} Tasks erledigt`, runId);
            }
          }

        } else {
          // ─── SELF-HEALING RETRY + ORCHESTRATOR ESCALATION ─────────────────
          const MAX_RETRIES = 3;
          const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

          const failureComments = await db.select({ id: kommentare.id })
            .from(kommentare)
            .where(and(eq(kommentare.aufgabeId, task.id), sql`inhalt LIKE '%❌ Fehler%'`));
          const failureCount = failureComments.length;

          if (failureCount < MAX_RETRIES) {
            const backoffMinutes = [5, 15, 45][failureCount - 1] ?? 5;
            const syntheticLockTime = new Date(Date.now() - (LOCK_TIMEOUT_MS - backoffMinutes * 60 * 1000)).toISOString();

            console.log(`  🔄 Task ${task.id} failed (attempt ${failureCount}/${MAX_RETRIES}) — retry in ${backoffMinutes}min`);
            trace(expertId, unternehmenId, 'info', `Automatischer Retry ${failureCount}/${MAX_RETRIES}: ${taskFull.titel}`, `Nächster Versuch in ${backoffMinutes} Minuten`, runId);

            await db.insert(kommentare).values({
              id: crypto.randomUUID(), unternehmenId, aufgabeId: task.id,
              autorExpertId: expertId, autorTyp: 'agent',
              inhalt: `🔄 **Automatischer Retry ${failureCount}/${MAX_RETRIES}**\n\nTask fehlgeschlagen. Nächster Versuch in **${backoffMinutes} Minuten**.\n\n*Das System versucht automatisch, die Aufgabe erneut auszuführen.*`,
              erstelltAm: new Date().toISOString(),
            });
            await db.update(aufgaben)
              .set({ status: 'todo', executionRunId: null, executionLockedAt: syntheticLockTime })
              .where(eq(aufgaben.id, task.id));

          } else {
            console.log(`  🚨 Task ${task.id} failed ${failureCount}× — escalating to orchestrator`);
            trace(expertId, unternehmenId, 'error', `Eskalation nach ${failureCount} Fehlern: ${taskFull.titel}`, result.error, runId);

            const now = new Date().toISOString();
            const orchestrator = await db.select()
              .from(experten)
              .where(and(eq(experten.unternehmenId, unternehmenId), eq(experten.isOrchestrator, true)))
              .get();

            if (orchestrator && orchestrator.id !== expertId) {
              const escalationId = uuid();
              await db.insert(aufgaben).values({
                id: escalationId, unternehmenId,
                titel: `🚨 Eskalation: "${taskFull.titel}" ist ${failureCount}× fehlgeschlagen`,
                beschreibung:
                  `Der Task **"${taskFull.titel}"** (ID: \`${task.id}\`) ist ${failureCount} Mal hintereinander fehlgeschlagen.\n\n` +
                  `**Letzter Fehler:** ${result.error || 'Keine Details verfügbar'}\n\n` +
                  `**Empfohlene Maßnahmen:**\n1. Task-Beschreibung überprüfen\n2. Task anders zuweisen\n3. In kleinere Teilaufgaben aufteilen\n\n*Automatisch erstellt.*`,
                status: 'todo', prioritaet: 'high',
                zugewiesenAn: orchestrator.id, erstelltVon: expertId,
                erstelltAm: now, aktualisiertAm: now,
              });

              wakeupService.wakeup(orchestrator.id, unternehmenId, {
                source: 'automation', triggerDetail: 'system',
                reason: `Eskalation: "${taskFull.titel}" ${failureCount}× fehlgeschlagen`,
                payload: { taskId: task.id },
              }).catch(() => {});
            }

            await db.insert(kommentare).values({
              id: crypto.randomUUID(), unternehmenId, aufgabeId: task.id,
              autorExpertId: expertId, autorTyp: 'agent',
              inhalt:
                `🚨 **Eskalation an ${orchestrator ? orchestrator.name : 'Orchestrator'}**\n\n` +
                `Nach ${failureCount} automatischen Versuchen konnte dieser Task nicht abgeschlossen werden.\n\n` +
                (orchestrator
                  ? `**${orchestrator.name}** wurde informiert und ein Eskalations-Task wurde erstellt.`
                  : 'Der Task wurde als blockiert markiert.') +
                `\n\n*Bitte überprüfe die Aufgabe manuell.*`,
              erstelltAm: new Date().toISOString(),
            });

            await db.update(aufgaben)
              .set({ status: 'blocked', executionLockedAt: null, executionRunId: null, aktualisiertAm: new Date().toISOString() })
              .where(eq(aufgaben.id, task.id));

            messagingService.notify(
              unternehmenId,
              `🚨 Eskalation: ${taskFull.titel}`,
              `Task **"${taskFull.titel}"** ist ${failureCount}× fehlgeschlagen. ` +
                (orchestrator ? `**${orchestrator.name}** wurde automatisch benachrichtigt.` : 'Manuelle Überprüfung erforderlich.'),
              'warning'
            ).catch(() => {});

            appEvents.emit('broadcast', {
              type: 'task_escalated',
              data: { unternehmenId, taskId: task.id, taskTitel: taskFull.titel, failureCount, orchestratorName: orchestrator?.name },
            });
          }
          // ──────────────────────────────────────────────────────────────────
        }
      }

      if (result.success && !isSyntheticTask) {
        await recordWorkProducts(task.id, expertId, unternehmenId, runId, (taskFull as any).workspacePath);
        autoSaveInsights(expertId, unternehmenId, result.output, taskFull.titel).catch(() => {});

        if (!isOrchestrator) {
          await unlockDependentTasks(task.id, unternehmenId).catch(() => {});
        }

        if (!expert?.isOrchestrator) {
          await notifyOrchestratorTaskDone(
            unternehmenId, expertId, expert?.name || 'Agent',
            taskFull.titel, taskFull.id, result.output,
          );
        }
      }

    } catch (error: any) {
      console.error(`  ❌ Adapter execution failed for task ${task.id}:`, error.message);
      trace(expertId, unternehmenId, 'error', `Fehler bei Task: ${task.titel || task.id}`, error.message, runId);

      await db.update(aufgaben)
        .set({ status: 'blocked', executionLockedAt: null, executionRunId: null })
        .where(eq(aufgaben.id, task.id));

      // ─── ACTIVE ESCALATION ───────────────────────────────────────────
      const agent = await db.select().from(experten).where(eq(experten.id, expertId)).get();
      if (agent?.reportsTo) {
        const boss = await db.select().from(experten).where(eq(experten.id, agent.reportsTo)).get();
        if (boss) {
          console.log(`🚨 Escalating problem from ${agent.name} to supervisor ${boss.name}...`);
          await messagingService.notify(
            unternehmenId,
            `Eskalation: ${agent.name} braucht Hilfe`,
            `Agent **${agent.name}** meldet ein Problem bei Task **'${task.titel}'**.\n\nFehler: _${error.message}_`,
            'warning'
          );
          await db.insert(traceEreignisse).values({
            id: uuid(), unternehmenId, typ: 'status_change',
            titel: `🚨 Eskalation an ${boss.name}`,
            details: `Agent ${agent.name} hat ein Problem gemeldet. Vorgesetzter wurde benachrichtigt.`,
            erstelltAm: new Date().toISOString(),
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
    expertId: string,
    unternehmenId: string,
    advisorPlan: string | null,
  ): Promise<void> {
    try {
      const activeGoals = await db.select({ id: ziele.id, titel: ziele.titel, fortschritt: ziele.fortschritt, status: ziele.status })
        .from(ziele)
        .where(and(eq(ziele.unternehmenId, unternehmenId), inArray(ziele.status, ['active', 'planned'])))
        .limit(5);

      const backlogTasks = await db.select({ id: aufgaben.id, titel: aufgaben.titel, prioritaet: aufgaben.prioritaet })
        .from(aufgaben)
        .where(and(eq(aufgaben.unternehmenId, unternehmenId), inArray(aufgaben.status, ['backlog', 'todo', 'open'])))
        .limit(10);

      if (activeGoals.length === 0 && backlogTasks.length === 0) {
        console.log(`  ℹ️ No goals or open tasks — nothing to plan`);
        return;
      }

      const teamForPlanning = await db.select({ id: experten.id, name: experten.name, faehigkeiten: experten.faehigkeiten })
        .from(experten)
        .where(and(eq(experten.unternehmenId, unternehmenId), eq(experten.isOrchestrator, false)));

      const workloadPerAgent = await Promise.all(teamForPlanning.map(async (m) => {
        const count = await db.select({ n: sql<number>`COUNT(*)` })
          .from(aufgaben)
          .where(and(eq(aufgaben.unternehmenId, unternehmenId), eq(aufgaben.zugewiesenAn, m.id), inArray(aufgaben.status, ['todo', 'in_progress', 'backlog'])))
          .then(r => (r[0]?.n ?? 0) as number);

        const structuredSkills = await db.select({ skillName: skillsLibrary.name })
          .from(expertenSkills)
          .innerJoin(skillsLibrary, eq(expertenSkills.skillId, skillsLibrary.id))
          .where(eq(expertenSkills.expertId, m.id));

        const allSkills = [
          ...structuredSkills.map(s => s.skillName),
          ...(m.faehigkeiten ? m.faehigkeiten.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
        ];
        const skillStr = [...new Set(allSkills)].join(', ') || 'keine';
        return { name: m.name, skills: skillStr, openTasks: count };
      }));

      const staleDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const staleTasks = await db.select({ titel: aufgaben.titel, prioritaet: aufgaben.prioritaet })
        .from(aufgaben)
        .where(and(
          eq(aufgaben.unternehmenId, unternehmenId),
          inArray(aufgaben.status, ['todo', 'in_progress', 'backlog']),
          sql`${aufgaben.erstelltAm} < ${staleDate}`,
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
          `Aktive Ziele: ${activeGoals.map(g => `"${g.titel}" (${g.fortschritt}%)`).join(', ')}. ` +
          `Team-Auslastung: ${workloadSummary}.${hiringHint} ` +
          `Analysiere was als nächstes getan werden muss und weise Aufgaben den passenden Team-Mitgliedern zu.`;
      } else {
        planningContext =
          `Keine übergeordneten Ziele gesetzt. Offene Aufgaben im Backlog: ${backlogTasks.map(t => `"${t.titel}" [${t.prioritaet}]`).join(', ')}. ` +
          `Team-Auslastung: ${workloadSummary}.${hiringHint} ` +
          `Priorisiere und weise diese Aufgaben den passenden Team-Mitgliedern zu. Erstelle bei Bedarf Unter-Tasks.`;
      }

      const syntheticTask = {
        id: `planning-${runId}`,
        titel: 'Strategische Planung & Task-Erstellung',
        beschreibung: `Überprüfe den aktuellen Status des Teams und koordiniere die Arbeit. ${planningContext}`,
        status: 'todo',
        prioritaet: 'high',
        executionLockedAt: null,
      };

      const traceLabel = activeGoals.length > 0
        ? `Ziele: ${activeGoals.map(g => g.titel).join(', ')}`
        : `Backlog: ${backlogTasks.length} offene Tasks`;
      trace(expertId, unternehmenId, 'action', 'Planungszyklus gestartet', traceLabel, runId);

      await this.executeTaskViaAdapter(runId, expertId, unternehmenId, syntheticTask, advisorPlan);
    } catch (err: any) {
      console.error(`  ❌ Orchestrator planning cycle failed: ${err.message}`);
    }
  }

  /**
   * Get heartbeat run by ID
   */
  async getRun(runId: string): Promise<HeartbeatRun | null> {
    const runs = await db.select()
      .from(arbeitszyklen)
      .where(eq(arbeitszyklen.id, runId))
      .limit(1);

    if (runs.length === 0) return null;
    const run = runs[0];
    return {
      id: run.id,
      unternehmenId: run.unternehmenId,
      expertId: run.expertId,
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
      if (extra.ausgabe) updateData.ausgabe = extra.ausgabe;
      if (extra.fehler) updateData.fehler = extra.fehler;
      if (extra.beendetAm) updateData.beendetAm = extra.beendetAm;
      if (extra.usageJson) updateData.usageJson = JSON.stringify(extra.usageJson);
      if (extra.resultJson) updateData.resultJson = JSON.stringify(extra.resultJson);
      if (extra.sessionIdBefore) updateData.sessionIdBefore = extra.sessionIdBefore;
      if (extra.sessionIdAfter) updateData.sessionIdAfter = extra.sessionIdAfter;
      if (extra.exitCode !== undefined) updateData.exitCode = extra.exitCode;
    }
    await db.update(arbeitszyklen).set(updateData).where(eq(arbeitszyklen.id, runId));
  }

  /**
   * Record usage/costs for a run
   */
  async recordUsage(runId: string, usage: { inputTokens: number; outputTokens: number; costCents: number }): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) return;

    await db.update(arbeitszyklen)
      .set({ usageJson: JSON.stringify(usage) })
      .where(eq(arbeitszyklen.id, runId));

    await db.update(experten)
      .set({ verbrauchtMonatCent: sql`${experten.verbrauchtMonatCent} + ${usage.costCents}`, aktualisiertAm: new Date().toISOString() })
      .where(eq(experten.id, run.expertId));

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

  /**
   * Public runCriticReview — delegates to the critic module
   */
  async runCriticReview(
    taskId: string,
    taskTitel: string,
    taskBeschreibung: string,
    output: string,
    expertId: string,
    unternehmenId: string
  ): Promise<{ approved: boolean; feedback: string; escalate?: boolean }> {
    return runCriticReview(taskId, taskTitel, taskBeschreibung, output, expertId, unternehmenId);
  }
}

// ── Singleton + convenience exports ───────────────────────────────────────────
export const heartbeatService = new HeartbeatServiceImpl();
export const executeHeartbeat = heartbeatService.executeHeartbeat.bind(heartbeatService);
export const processPendingWakeups = heartbeatService.processPendingWakeups.bind(heartbeatService);
export const getHeartbeatRun = heartbeatService.getRun.bind(heartbeatService);
export const updateHeartbeatStatus = heartbeatService.updateRunStatus.bind(heartbeatService);
export const recordHeartbeatUsage = heartbeatService.recordUsage.bind(heartbeatService);

// Heartbeat Runner Service - Executes agent wake-up requests

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { appEvents } from '../events.js';
import { db } from '../db/client.js';
import { arbeitszyklen, agentWakeupRequests, experten, aufgaben, unternehmen, projekte, kostenbuchungen, kommentare, workProducts, chatNachrichten, aktivitaetslog, ziele, issueRelations, einstellungen, budgetPolicies, budgetIncidents, agentMeetings } from '../db/schema.js';
import { eq, and, sql, inArray, or, isNull, asc, desc, gte } from 'drizzle-orm';
import { pruefeUndEntblocke } from './issue-dependencies.js';
import { wakeupService, type PendingWakeup } from './wakeup.js';
import { adapterRegistry } from '../adapters/registry.js';
import type { AdapterTask, AdapterContext, CompanyGoal } from '../adapters/types.js';
import { createWorkspace, listWorkspaceFiles } from './workspace.js';
import { isSafeWorkdir } from '../adapters/workspace-guard.js';
import { v4 as uuid } from 'uuid';
import { messagingService } from './messaging.js';
import { traceEreignisse } from '../db/schema.js';
import { loadRelevantMemory, autoSaveInsights } from './memory-auto.js';
import { decryptSetting } from '../utils/crypto.js';

// ── SOUL.md Loader ────────────────────────────────────────────────────────────
// In-memory cache: soulPath → { content, version }
// Invalidated when file mtime changes (via soulVersion comparison).
const soulCache = new Map<string, { content: string; version: string }>();

/**
 * Load a SOUL.md file and apply template variables.
 * Returns null if soulPath is not set or file doesn't exist.
 */
function loadSoul(expert: { soulPath?: string | null; soulVersion?: string | null }, vars: Record<string, string>): string | null {
  if (!expert.soulPath) return null;
  const filePath = expert.soulPath;
  if (!fs.existsSync(filePath)) return null;

  try {
    // Compute current file version (mtime-based hash — cheap, no read needed)
    const mtime = fs.statSync(filePath).mtimeMs.toString();
    const version = crypto.createHash('md5').update(filePath + mtime).digest('hex').slice(0, 12);

    // Cache hit: return without re-reading
    const cached = soulCache.get(filePath);
    if (cached && cached.version === version) return cached.content;

    // Cache miss or file changed: re-read and apply template vars
    let raw = fs.readFileSync(filePath, 'utf-8');

    // Apply {{variable}} substitutions
    for (const [key, value] of Object.entries(vars)) {
      raw = raw.replaceAll(`{{${key}}}`, value);
    }

    soulCache.set(filePath, { content: raw, version });

    // Persist new version hash to DB asynchronously (non-blocking)
    setImmediate(() => {
      db.update(experten)
        .set({ soulVersion: version })
        .where(eq(experten.soulPath, filePath))
        .run();
    });

    return raw;
  } catch (e: any) {
    console.warn(`⚠️ SOUL.md konnte nicht geladen werden (${filePath}): ${e.message}`);
    return null;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function trace(expertId: string, unternehmenId: string, typ: string, titel: string, details?: string, runId?: string) {
  appEvents.emit('trace', { expertId, unternehmenId, typ, titel, details, runId });
}

/**
 * Check if Focus Mode is currently active for a company.
 * Returns true if focus_mode_active = 'true' and not expired.
 */
function isFocusModeActive(unternehmenId: string): boolean {
  const activeRow = db.select().from(einstellungen)
    .where(and(eq(einstellungen.schluessel, 'focus_mode_active'), eq(einstellungen.unternehmenId, unternehmenId)))
    .get();
  if (activeRow?.wert !== 'true') return false;

  const untilRow = db.select().from(einstellungen)
    .where(and(eq(einstellungen.schluessel, 'focus_mode_until'), eq(einstellungen.unternehmenId, unternehmenId)))
    .get();
  if (untilRow?.wert && new Date(untilRow.wert) < new Date()) return false;

  return true;
}

export type HeartbeatInvocationSource = 'on_demand' | 'timer' | 'assignment' | 'automation';

export interface HeartbeatOptions {
  invocationSource: HeartbeatInvocationSource;
  triggerDetail: string;
  contextSnapshot?: {
    issueId?: string;
    wakeReason?: string;
    wakeCommentId?: string;
    [key: string]: unknown;
  };
}

export interface HeartbeatRun {
  id: string;
  unternehmenId: string;
  expertId: string;
  status: string;
  invocationSource: string;
  triggerDetail: string;
  contextSnapshot: any;
}

export interface HeartbeatService {
  /**
   * Create a new heartbeat run and execute it
   */
  executeHeartbeat(expertId: string, unternehmenId: string, options: HeartbeatOptions): Promise<string>;

  /**
   * Process all pending wakeups for an agent
   */
  processPendingWakeups(expertId: string): Promise<number>;

  /**
   * Get heartbeat run by ID
   */
  getRun(runId: string): Promise<HeartbeatRun | null>;

  /**
   * Update run status
   */
  updateRunStatus(runId: string, status: string, extra?: Record<string, any>): Promise<void>;

  /**
   * Run Critic/Evaluator review for a completed task output
   */
  runCriticReview(taskId: string, taskTitel: string, taskBeschreibung: string, output: string, expertId: string, unternehmenId: string): Promise<{ approved: boolean; feedback: string; escalate?: boolean }>;

  /**
   * Record usage/costs for a run
   */
  recordUsage(runId: string, usage: { inputTokens: number; outputTokens: number; costCents: number }): Promise<void>;
}

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

    // Create heartbeat run record
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

    // Execute the heartbeat
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

    // Check if agent is paused or terminated
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
        // Board-Alert
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
        // Warnung nur 1x pro 24h senden
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

    // Get pending wakeups
    const pendingWakeups = await wakeupService.getPendingWakeups(expertId, 5);

    if (pendingWakeups.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const wakeup of pendingWakeups) {
      try {
        // Create heartbeat run for this wakeup
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

        // Claim the wakeup
        await wakeupService.claimWakeup(wakeup.id, runId);

        // Execute the run
        await this.executeRun(runId, expertId, agent.unternehmenId, {
          invocationSource: wakeup.source,
          triggerDetail: wakeup.triggerDetail,
          contextSnapshot: wakeup.contextSnapshot,
        });

        // Mark wakeup as completed
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
      // Guard: verify agent still exists (may have been deleted while run was queued)
      const agentExists = db.select({ id: experten.id }).from(experten).where(eq(experten.id, expertId)).get();
      if (!agentExists) {
        console.warn(`⚠️ Heartbeat ${runId}: Agent ${expertId} wurde gelöscht — Ausführung übersprungen`);
        await this.updateRunStatus(runId, 'failed', 'Agent wurde gelöscht');
        return;
      }

      // Update status to running
      await this.updateRunStatus(runId, 'running');

      // Get agent inbox (assigned tasks)
      const inbox = await this.getAgentInbox(expertId, unternehmenId);

      console.log(`▶️ Heartbeat ${runId}: Processing ${inbox.length} tasks for expert ${expertId}`);

      // Update agent status to running
      await db.update(experten)
        .set({
          status: 'running',
          letzterZyklus: now,
          aktualisiertAm: now,
        })
        .where(eq(experten.id, expertId));

      // ─── Advisor Strategy Integration ──────────────────────────────────────────
      let advisorPlan: string | null = null;
      const agentWithAdvisor = db.select()
        .from(experten)
        .where(eq(experten.id, expertId))
        .get();

      if (agentWithAdvisor?.advisorId && agentWithAdvisor.advisorStrategy === 'planning') {
        console.log(`🧠 Consulting Advisor ${agentWithAdvisor.advisorId} for a plan...`);
        advisorPlan = await this.getAdvisorPlan(agentWithAdvisor.advisorId, expertId, unternehmenId, inbox);
        
        // Log Advisor Activity
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
        await this.scanForBlockedTasks(unternehmenId, expertId);
      }
      // ──────────────────────────────────────────────────────────────────────

      // Process each task in inbox
      for (const task of inbox) {
        await this.processTask(runId, expertId, unternehmenId, task, advisorPlan);
      }

      // ─── Orchestrator Planning Cycle ──────────────────────────────────────
      // If orchestrator has no inbox tasks, run a strategic planning cycle.
      // This allows the CEO to create new tasks even when everything is done.
      if (agentMeta?.isOrchestrator && inbox.length === 0) {
        console.log(`  🧭 Orchestrator ${expertId} has empty inbox — running planning cycle`);
        await this.runOrchestratorPlanning(runId, expertId, unternehmenId, advisorPlan);
      }
      // ──────────────────────────────────────────────────────────────────────

      // Record run summary
      await this.updateRunStatus(runId, 'succeeded', {
        ausgabe: inbox.length > 0 ? `Abgeschlossen: ${inbox.map(t => t.titel).join(', ')}` : 'Planungszyklus abgeschlossen',
        beendetAm: new Date().toISOString(),
      });

      // Update agent status back to idle
      await db.update(experten)
        .set({
          status: 'idle',
          aktualisiertAm: new Date().toISOString(),
        })
        .where(eq(experten.id, expertId));

    } catch (error) {
      console.error(`❌ Heartbeat ${runId} failed:`, error);

      await this.updateRunStatus(runId, 'failed', {
        fehler: error instanceof Error ? error.message : String(error),
        beendetAm: new Date().toISOString(),
      });

      // Update agent status to error
      await db.update(experten)
        .set({
          status: 'error',
          aktualisiertAm: new Date().toISOString(),
        })
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
    // Check if expert is an orchestrator
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
      zielId: aufgaben.zielId,
    })
    .from(aufgaben)
    .where(
      and(
        eq(aufgaben.unternehmenId, unternehmenId),
        inArray(aufgaben.status, ['backlog', 'todo', 'in_progress']), // 'blocked' excluded — won't be picked up
        isOrchestrator
          ? or(eq(aufgaben.zugewiesenAn, expertId), isNull(aufgaben.zugewiesenAn))
          : eq(aufgaben.zugewiesenAn, expertId)
      )
    );

    // Sort: goal-linked tasks first, then by priority weight
    const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    tasks.sort((a, b) => {
      const aGoal = a.zielId ? 1 : 0;
      const bGoal = b.zielId ? 1 : 0;
      if (aGoal !== bGoal) return bGoal - aGoal; // goal-linked first
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

    // Check if task is already locked by another run
    if (task.executionLockedAt && task.executionLockedAt !== runId) {
      const lockAge = Date.now() - new Date(task.executionLockedAt).getTime();
      const lockTimeout = 30 * 60 * 1000; // 30 minutes

      if (lockAge < lockTimeout) {
        console.log(`  ⏸️ Task ${task.id} is locked by another run, skipping`);
        return;
      }

      console.log(`  ⏰ Task ${task.id} lock expired, reclaiming`);
    }

    // Resolve workspace: projekt.workDir → unternehmen.workDir → isolated fallback
    const company = db.select({ workDir: unternehmen.workDir }).from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get() as any;
    const companyWorkDir = company?.workDir;

    // Check if task belongs to a project with its own workDir
    const projektWorkDir = task.projektId
      ? (db.select({ workDir: projekte.workDir }).from(projekte).where(eq(projekte.id, task.projektId)).get() as any)?.workDir
      : null;

    // Priority: projektWorkDir → companyWorkDir → isolated fallback
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

    // Checkout task (atomic lock)
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

    // Execute task via adapter
    await this.executeTaskViaAdapter(runId, expertId, unternehmenId, task, advisorPlan);
  }

  /**
   * Check budget policies before executing a task.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  private async checkBudgetAndEnforce(
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
   * Execute task via adapter (Bash, HTTP, Claude Code, etc.)
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

      // Get expert details
      const expert = await db.select()
        .from(experten)
        .where(eq(experten.id, expertId))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      // Get company details
      const unternehmenData = await db.select()
        .from(unternehmen)
        .where(eq(unternehmen.id, unternehmenId))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      // Get previous comments
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

      // Build adapter context
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
            id: g.id,
            titel: g.titel,
            beschreibung: g.beschreibung,
            fortschritt: computedProgress,
            status: g.status,
            openTasks,
            doneTasks,
          });
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Goals konnten nicht geladen werden: ${err.message}`);
      }
      // ──────────────────────────────────────────────────────────────────

      // Load team members for orchestrator context
      const teamMembers = expert?.isOrchestrator
        ? await db.select({ id: experten.id, name: experten.name, rolle: experten.rolle, status: experten.status })
            .from(experten)
            .where(and(eq(experten.unternehmenId, unternehmenId), eq(experten.isOrchestrator, false)))
        : [];

      // Load open/unassigned tasks summary for orchestrator
      const openTasks = expert?.isOrchestrator
        ? await db.select({ id: aufgaben.id, titel: aufgaben.titel, status: aufgaben.status, zugewiesenAn: aufgaben.zugewiesenAn, prioritaet: aufgaben.prioritaet })
            .from(aufgaben)
            .where(and(
              eq(aufgaben.unternehmenId, unternehmenId),
              inArray(aufgaben.status, ['backlog', 'todo', 'in_progress', 'blocked']),
            ))
            .limit(20)
        : [];

      // Load project context if task belongs to a project
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
          id: c.id,
          inhalt: c.inhalt,
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
          ...(memoryContext ? { gedaechtnis: memoryContext } : {}),
          ...(blockerOutputs ? { vorgaengerOutputs: blockerOutputs } : {}),
          ...(advisorPlan ? { advisorPlan: `### 🧠 STRATEGISCHER PLAN DES ARCHITEKTEN/ADVISORS\n\n${advisorPlan}\n\n*Bitte befolge diesen Plan strikt bei der Ausführung der Aufgabe.*` } : {}),
          // Orchestrator gets full team + task overview
          ...(expert?.isOrchestrator && teamMembers.length > 0 ? {
            team: teamMembers.map(m => ({ id: m.id, name: m.name, rolle: m.rolle, status: m.status })),
            offeneTasks: openTasks.map(t => ({ id: t.id, titel: t.titel, status: t.status, zugewiesenAn: t.zugewiesenAn, prioritaet: t.prioritaet })),
            aktionsFormat: `
## WICHTIG: Aktionen als JSON ausgeben

Wenn du Tasks erstellen, zuweisen oder Ziele aktualisieren willst, füge am ENDE deiner Antwort einen JSON-Block ein:

\`\`\`json
{
  "actions": [
    {"type": "create_task", "titel": "Task-Titel", "beschreibung": "Beschreibung...", "assignTo": "Agent Name", "prioritaet": "high"},
    {"type": "assign_task", "taskId": "TASK_ID", "assignTo": "Agent Name"},
    {"type": "mark_done", "taskId": "TASK_ID"},
    {"type": "update_goal", "goalId": "GOAL_ID", "fortschritt": 50}
  ]
}
\`\`\`

Verfügbare Prioritäten: critical, high, medium, low
Verfügbare Team-Mitglieder: ${teamMembers.map(m => m.name).join(', ')}
`,
          } : {}),
        },
      };

      if (memoryContext) {
        console.log(`  🧠 Memory geladen für Agent ${expertId} (${memoryContext.length} Zeichen)`);
      }

      // ─── TOKEN BUDGET GUARD ────────────────────────────────────────────────
      // Rough estimate: 1 token ≈ 4 chars. Hard ceiling: 80k tokens = 320k chars.
      // Trim least-important fields first to stay within context window.
      const CONTEXT_CHAR_LIMIT = 320_000;
      const estimatedSize = JSON.stringify(adapterContext).length;
      if (estimatedSize > CONTEXT_CHAR_LIMIT) {
        console.warn(`  ⚠️ Context too large (${Math.round(estimatedSize / 1000)}k chars) — trimming`);

        // 1. Trim blocker outputs (often very long code/docs)
        const agentCtx = adapterContext.agentContext as any;
        if (agentCtx.vorgaengerOutputs) {
          agentCtx.vorgaengerOutputs =
            agentCtx.vorgaengerOutputs.slice(0, 20_000) + '\n[...gekürzt]';
        }

        // 2. Trim memory context
        if (adapterContext.agentContext.gedaechtnis) {
          adapterContext.agentContext.gedaechtnis =
            (adapterContext.agentContext.gedaechtnis as string).slice(0, 10_000) + '\n[...gekürzt]';
        }

        // 3. Drop oldest comments if still too large
        if (JSON.stringify(adapterContext).length > CONTEXT_CHAR_LIMIT) {
          adapterContext.previousComments = adapterContext.previousComments.slice(-5);
        }

        // 4. Trim open tasks list for orchestrators
        if (agentCtx.offeneTasks) {
          agentCtx.offeneTasks = agentCtx.offeneTasks.slice(0, 20);
        }

        const afterSize = JSON.stringify(adapterContext).length;
        console.log(`  ✂️ Context trimmed: ${Math.round(estimatedSize / 1000)}k → ${Math.round(afterSize / 1000)}k chars`);
      }
      // ──────────────────────────────────────────────────────────────────────

      console.log(`  🤖 Executing task via adapter: ${taskFull.titel}`);

      // ── SOUL.md: load file-based identity if configured, else fall back to DB field ──
      const soulVars = {
        'company.name': unternehmenData?.name || 'Unknown',
        'company.goal': unternehmenData?.ziel || '',
        'agent.name': expert?.name || '',
        'agent.role': expert?.rolle || '',
      };
      const resolvedSystemPrompt =
        loadSoul(expert as any, soulVars)   // SOUL.md takes priority
        ?? expert?.systemPrompt             // fallback: DB field
        ?? undefined;
      // ──────────────────────────────────────────────────────────────────────────

      // ── Budget-Check vor Ausführung ────────────────────────────────────────────
      const isSyntheticTaskEarly = task.id.startsWith('planning-');
      const budgetCheck = await this.checkBudgetAndEnforce(expertId, unternehmenId);
      if (!budgetCheck.allowed) {
        trace(expertId, unternehmenId, 'error', `🛑 Task blockiert: ${budgetCheck.reason}`, undefined, runId);
        if (!isSyntheticTaskEarly) {
          try { await db.insert(kommentare).values({
            id: crypto.randomUUID(),
            unternehmenId,
            aufgabeId: task.id,
            autorExpertId: expertId,
            autorTyp: 'agent',
            inhalt: `🛑 **Ausführung blockiert — Budget-Limit erreicht**\n\n${budgetCheck.reason}\n\nBitte erhöhe das Budget-Limit in den Einstellungen oder warte auf den nächsten Abrechnungszeitraum.`,
            erstelltAm: new Date().toISOString(),
          }); } catch { /* agent may have been deleted mid-run */ }
          await db.update(aufgaben)
            .set({ executionLockedAt: null, executionRunId: null, status: 'blocked' })
            .where(eq(aufgaben.id, task.id));
        }
        await this.updateRunStatus(runId, 'failed', { fehler: budgetCheck.reason });
        return;
      }
      // ──────────────────────────────────────────────────────────────────────────

      // Resolve effective adapter type:
      // If verbindungsTyp is 'claude-code' but verbindungsConfig has an API model (e.g. openrouter format
      // "provider/model-name"), use 'openrouter' so the LLM wrapper is used instead of the CLI.
      // This prevents multiple agents from competing for the single Claude CLI lock.
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

      // Execute via adapter registry — pass workspace + system prompt + verbindungsTyp
      const result = await adapterRegistry.executeTask(adapterTask, adapterContext, {
        expertId,
        unternehmenId,
        runId,
        timeoutMs: 10 * 60 * 1000,
        workspacePath: (taskFull as any).workspacePath || undefined,
        systemPrompt: resolvedSystemPrompt,
        verbindungsTyp: effectiveVerbindungsTyp,
        globalDefaultModel: heartbeatGlobalDefaultModel,
      });

      // Record result
      await this.updateRunStatus(runId, result.success ? 'succeeded' : 'failed', {
        ausgabe: result.output,
        fehler: result.error || null,
        exitCode: result.exitCode,
        sessionIdBefore: result.sessionIdBefore,
        sessionIdAfter: result.sessionIdAfter,
      });

      // Record usage/costs
      if (result.inputTokens > 0 || result.outputTokens > 0) {
        await this.recordUsage(runId, {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costCents: result.costCents,
        });
      }

      // Transient errors (429, rate limit, network) → silently retry next cycle
      const isSyntheticTask = task.id.startsWith('planning-');
      const isTransient = !result.success && (
        result.output?.includes('429') ||
        result.output?.includes('rate') ||
        result.output?.includes('Rate') ||
        result.output?.includes('temporarily') ||
        result.output?.includes('overloaded') ||
        result.error?.includes('429') ||
        result.error?.includes('rate') ||
        result.error?.includes('ECONNREFUSED') ||
        result.error?.includes('ETIMEDOUT')
      );

      if (isTransient) {
        console.log(`  ⏳ Transient error for task ${task.id} (${taskFull.titel}) — will retry next cycle`);
        trace(expertId, unternehmenId, 'info', `Rate limit — wird automatisch wiederholt: ${taskFull.titel}`, undefined, runId);
        // Just release the lock, don't mark as failed, don't notify
        if (!isSyntheticTask) {
          await db.update(aufgaben)
            .set({ executionLockedAt: null, executionRunId: null })
            .where(eq(aufgaben.id, task.id));
        }
        return;
      }

      // Create comment with result (skip for synthetic planning tasks)
      if (!isSyntheticTask) {
        const errorSection = result.error ? `\nFehler: ${result.error}` : '';
        const resultComment = `**Ausführung abgeschlossen**\n\n` +
          `Status: ${result.success ? '✅ Erfolg' : '❌ Fehler'}${errorSection}\n` +
          `Dauer: ${result.durationMs}ms\n` +
          `Ausgabe:\n\`\`\`\n${result.output}\n\`\`\``;

        try { await db.insert(kommentare).values({
          id: crypto.randomUUID(),
          unternehmenId,
          aufgabeId: task.id,
          autorExpertId: expertId,
          autorTyp: 'agent',
          inhalt: resultComment,
          erstelltAm: new Date().toISOString(),
        }); } catch { /* agent may have been deleted mid-run */ }
      }

      console.log(`  ✅ Adapter execution completed for task ${task.id}`);
      trace(expertId, unternehmenId, result.success ? 'result' : 'error',
        result.success ? `Task abgeschlossen: ${taskFull.titel}` : `Task fehlgeschlagen: ${taskFull.titel}`,
        result.success ? result.output?.slice(0, 500) : result.error,
        runId,
      );
      
      // ─── AGENTIC ACTION PARSING ─────────────────────────────────────
      const isOrchestrator = expert?.isOrchestrator === true;
      const cliAdapters = ['claude-code', 'bash', 'http', 'codex-cli', 'gemini-cli'];
      const isCliAdapter = cliAdapters.includes(expert?.verbindungsTyp || '');
      let orchestratorMarkedCurrentTaskDone = false;
      if (result.success && result.output) {
        if (isOrchestrator) {
          // CEO: parse actions (create_task, assign_task, mark_done, update_goal)
          orchestratorMarkedCurrentTaskDone = await this.processOrchestratorActions(task.id, expertId, unternehmenId, result.output);
        } else if (isCliAdapter) {
          // Worker: parse bash blocks and status updates
          await this.processWorkerActions(task.id, expertId, unternehmenId, runId, result.output, (taskFull as any).workspacePath);
        }
      }
      // ────────────────────────────────────────────────────────────────

      // Update task status if completed (skip for synthetic planning tasks)
      if (!isSyntheticTask) {
        if (result.success) {

          // ─── CRITIC/EVALUATOR LOOP ─────────────────────────────────────────
          // Non-orchestrator agents get their output reviewed before marking done
          if (!isOrchestrator && result.output) {
            const criticResult = await this.runCriticReview(
              task.id, taskFull.titel, taskFull.beschreibung || '', result.output, expertId, unternehmenId
            );

            if (!criticResult.approved) {
              if (criticResult.escalate) {
                // Max retries reached — block task and require human review
                console.log(`  🚨 Critic: escalating task ${task.id} to human review`);
                trace(expertId, unternehmenId, 'warning', `Critic: Eskalation — ${taskFull.titel}`, criticResult.feedback, runId);

                await db.insert(kommentare).values({
                  id: crypto.randomUUID(),
                  unternehmenId,
                  aufgabeId: task.id,
                  autorExpertId: expertId,
                  autorTyp: 'agent',
                  inhalt: `🚨 **Critic Review — Manuelle Prüfung erforderlich**\n\n${criticResult.feedback}\n\n*Der Agent hat die Aufgabe nach 2 Überarbeitungszyklen nicht erfolgreich abgeschlossen. Bitte prüfe manuell.*`,
                  erstelltAm: new Date().toISOString(),
                });

                // Block the task so no agent picks it up again without human intervention
                await db.update(aufgaben)
                  .set({ executionLockedAt: null, executionRunId: null, status: 'blocked' })
                  .where(eq(aufgaben.id, task.id));
              } else {
                // Needs revision — add feedback comment, keep in_progress
                console.log(`  🔍 Critic rejected task ${task.id}: ${criticResult.feedback}`);
                trace(expertId, unternehmenId, 'info', `Critic: Überarbeitung nötig — ${taskFull.titel}`, criticResult.feedback, runId);

                await db.insert(kommentare).values({
                  id: crypto.randomUUID(),
                  unternehmenId,
                  aufgabeId: task.id,
                  autorExpertId: expertId,
                  autorTyp: 'agent',
                  inhalt: `🔍 **Critic Review — Überarbeitung erforderlich**\n\n${criticResult.feedback}\n\n*Bitte überarbeite die Aufgabe entsprechend diesem Feedback.*`,
                  erstelltAm: new Date().toISOString(),
                });

                // Release lock, keep in_progress so agent retries next cycle
                await db.update(aufgaben)
                  .set({ executionLockedAt: null, executionRunId: null, status: 'in_progress' })
                  .where(eq(aufgaben.id, task.id));
              }
              return; // Don't proceed to done
            }

            console.log(`  ✅ Critic approved task ${task.id}`);
          }
          // ──────────────────────────────────────────────────────────────────

          // For orchestrators: if mark_done was called for this task, use 'done'; otherwise preserve original status
          const finalStatus = isOrchestrator && !orchestratorMarkedCurrentTaskDone ? taskFull.status : 'done';
          const finalAbgeschlossenAm = finalStatus === 'done' ? new Date().toISOString() : taskFull.abgeschlossenAm;
          await db.update(aufgaben)
            .set({
              status: finalStatus,
              abgeschlossenAm: finalAbgeschlossenAm,
              executionLockedAt: null,
              executionRunId: null,
            })
            .where(eq(aufgaben.id, task.id));

          // Unblock dependent tasks when this task completes
          if (finalStatus === 'done') {
            const entblockt = pruefeUndEntblocke(task.id);
            if (entblockt.length > 0) {
              trace(expertId, unternehmenId, 'info', `🔓 ${entblockt.length} Task(s) entblockt`, entblockt.join(', '), runId);
            }
          }
        } else {
          // ─── SELF-HEALING RETRY + ORCHESTRATOR ESCALATION ─────────────────
          const MAX_RETRIES = 3;
          const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

          // Count how many times this task has already failed (current failure comment is already posted)
          const failureComments = await db.select({ id: kommentare.id })
            .from(kommentare)
            .where(
              and(
                eq(kommentare.aufgabeId, task.id),
                sql`inhalt LIKE '%❌ Fehler%'`
              )
            );
          const failureCount = failureComments.length;

          if (failureCount < MAX_RETRIES) {
            // Exponential backoff: 5 min, 15 min, 45 min
            const backoffMinutes = [5, 15, 45][failureCount - 1] ?? 5;
            // Set executionLockedAt to a synthetic past time so the lock expires in exactly backoffMinutes
            const syntheticLockTime = new Date(Date.now() - (LOCK_TIMEOUT_MS - backoffMinutes * 60 * 1000)).toISOString();

            console.log(`  🔄 Task ${task.id} failed (attempt ${failureCount}/${MAX_RETRIES}) — retry in ${backoffMinutes}min`);
            trace(expertId, unternehmenId, 'info', `Automatischer Retry ${failureCount}/${MAX_RETRIES}: ${taskFull.titel}`, `Nächster Versuch in ${backoffMinutes} Minuten`, runId);

            await db.insert(kommentare).values({
              id: crypto.randomUUID(),
              unternehmenId,
              aufgabeId: task.id,
              autorExpertId: expertId,
              autorTyp: 'agent',
              inhalt: `🔄 **Automatischer Retry ${failureCount}/${MAX_RETRIES}**\n\nTask fehlgeschlagen. Nächster Versuch in **${backoffMinutes} Minuten**.\n\n*Das System versucht automatisch, die Aufgabe erneut auszuführen.*`,
              erstelltAm: new Date().toISOString(),
            });

            await db.update(aufgaben)
              .set({
                status: 'todo',
                executionRunId: null,
                executionLockedAt: syntheticLockTime, // Backoff gate: expires in backoffMinutes
              })
              .where(eq(aufgaben.id, task.id));

          } else {
            // MAX_RETRIES exceeded — escalate to orchestrator
            console.log(`  🚨 Task ${task.id} failed ${failureCount}× — escalating to orchestrator`);
            trace(expertId, unternehmenId, 'error', `Eskalation nach ${failureCount} Fehlern: ${taskFull.titel}`, result.error, runId);

            const now = new Date().toISOString();

            // Find the orchestrator for this company
            const orchestrator = await db.select()
              .from(experten)
              .where(and(eq(experten.unternehmenId, unternehmenId), eq(experten.isOrchestrator, true)))
              .get();

            if (orchestrator && orchestrator.id !== expertId) {
              // Create escalation task for orchestrator
              const escalationId = uuid();
              await db.insert(aufgaben).values({
                id: escalationId,
                unternehmenId,
                titel: `🚨 Eskalation: "${taskFull.titel}" ist ${failureCount}× fehlgeschlagen`,
                beschreibung:
                  `Der Task **"${taskFull.titel}"** (ID: \`${task.id}\`) ist ${failureCount} Mal hintereinander fehlgeschlagen ` +
                  `und konnte nicht automatisch behoben werden.\n\n` +
                  `**Letzter Fehler:** ${result.error || 'Keine Details verfügbar'}\n\n` +
                  `**Empfohlene Maßnahmen:**\n` +
                  `1. Task-Beschreibung überprüfen und präzisieren\n` +
                  `2. Task einem anderen Agenten zuweisen\n` +
                  `3. Task in kleinere Teilaufgaben aufteilen\n\n` +
                  `*Dieser Eskalations-Task wurde automatisch erstellt.*`,
                status: 'todo',
                prioritaet: 'high',
                zugewiesenAn: orchestrator.id,
                erstelltVon: expertId,
                erstelltAm: now,
                aktualisiertAm: now,
              });

              // Wake up orchestrator immediately so it processes the escalation
              wakeupService.wakeup(orchestrator.id, unternehmenId, {
                source: 'automation',
                triggerDetail: 'system',
                reason: `Eskalation: "${taskFull.titel}" ${failureCount}× fehlgeschlagen`,
                payload: { taskId: task.id },
              }).catch(() => {});
            }

            // Post escalation comment on the failing task
            await db.insert(kommentare).values({
              id: crypto.randomUUID(),
              unternehmenId,
              aufgabeId: task.id,
              autorExpertId: expertId,
              autorTyp: 'agent',
              inhalt:
                `🚨 **Eskalation an ${orchestrator ? orchestrator.name : 'Orchestrator'}**\n\n` +
                `Nach ${failureCount} automatischen Versuchen konnte dieser Task nicht abgeschlossen werden.\n\n` +
                (orchestrator
                  ? `**${orchestrator.name}** wurde informiert und ein Eskalations-Task wurde erstellt.`
                  : 'Der Task wurde als blockiert markiert.') +
                `\n\n*Bitte überprüfe die Aufgabe manuell.*`,
              erstelltAm: new Date().toISOString(),
            });

            // Mark original task as blocked
            await db.update(aufgaben)
              .set({
                status: 'blocked',
                executionLockedAt: null,
                executionRunId: null,
                aktualisiertAm: new Date().toISOString(),
              })
              .where(eq(aufgaben.id, task.id));

            // Notify all channels
            messagingService.notify(
              unternehmenId,
              `🚨 Eskalation: ${taskFull.titel}`,
              `Task **"${taskFull.titel}"** ist ${failureCount}× fehlgeschlagen. ` +
                (orchestrator ? `**${orchestrator.name}** wurde automatisch benachrichtigt.` : 'Manuelle Überprüfung erforderlich.'),
              'warning'
            ).catch(() => {});

            // Broadcast to frontend via WebSocket
            appEvents.emit('broadcast', {
              type: 'task_escalated',
              data: {
                unternehmenId,
                taskId: task.id,
                taskTitel: taskFull.titel,
                failureCount,
                orchestratorName: orchestrator?.name,
              },
            });
          }
          // ──────────────────────────────────────────────────────────────────
        }
      }

      if (result.success && !isSyntheticTask) {
        // Record work products (files created in workspace)
        await this.recordWorkProducts(task.id, expertId, unternehmenId, runId, (taskFull as any).workspacePath);

        // ─── Memory: Ergebnis im Wing speichern (nativ) ────────────────
        autoSaveInsights(expertId, unternehmenId, result.output, taskFull.titel).catch(() => {});
        // ──────────────────────────────────────────────────────────────────

        // ─── AUTOMATIC TASK CHAINING ──────────────────────────────────────
        // When a task completes, check if any blocked tasks are now fully unblocked.
        // If so, move them to 'todo' and wake their assigned agents immediately.
        if (!isOrchestrator) {
          await this.unlockDependentTasks(task.id, unternehmenId).catch(() => {});
        }
        // ──────────────────────────────────────────────────────────────────

        // ─── CEO FEEDBACK LOOP ─────────────────────────────────────────────
        // When a worker completes a task, notify the orchestrator + trigger re-evaluation
        if (!expert?.isOrchestrator) {
          await this.notifyOrchestratorTaskDone(
            unternehmenId,
            expertId,
            expert?.name || 'Agent',
            taskFull.titel,
            taskFull.id,
            result.output,
          );
        }
        // ──────────────────────────────────────────────────────────────────
      }
    } catch (error: any) {
      console.error(`  ❌ Adapter execution failed for task ${task.id}:`, error.message);
      trace(expertId, unternehmenId, 'error', `Fehler bei Task: ${task.titel || task.id}`, error.message, runId);

      // Update task with error
      await db.update(aufgaben)
        .set({
          status: 'blocked',
          executionLockedAt: null,
          executionRunId: null,
        })
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
            `Agent **${agent.name}** meldet ein Problem bei Task **'${task.titel}'**.\n\n` +
            `Der Task wurde automatisch auf **BLOCKED** gesetzt.\n\n` +
            `Fehler: _${error.message}_`,
            'warning'
          );

          await db.insert(traceEreignisse).values({
            id: uuid(),
            unternehmenId,
            typ: 'status_change',
            titel: `🚨 Eskalation an ${boss.name}`,
            details: `Agent ${agent.name} hat ein Problem gemeldet. Vorgesetzter wurde benachrichtigt.`,
            erstelltAm: new Date().toISOString()
          });
        }
      }
      // ──────────────────────────────────────────────────────────────────

      throw error;
    }
  }

  /**
   * Orchestrator Planning Cycle — runs when CEO has no tasks in inbox.
   * Creates a synthetic "planning" task so the CEO can evaluate goals and
   * create new tasks for the team autonomously.
   */
  private async runOrchestratorPlanning(
    runId: string,
    expertId: string,
    unternehmenId: string,
    advisorPlan: string | null,
  ): Promise<void> {
    try {
      // Fetch active goals (optional — system works without them)
      const activeGoals = await db.select({ id: ziele.id, titel: ziele.titel, fortschritt: ziele.fortschritt, status: ziele.status })
        .from(ziele)
        .where(and(eq(ziele.unternehmenId, unternehmenId), inArray(ziele.status, ['active', 'planned'])))
        .limit(5);

      // Fetch open backlog tasks — used as fallback when no goals exist
      const backlogTasks = await db.select({ id: aufgaben.id, titel: aufgaben.titel, prioritaet: aufgaben.prioritaet })
        .from(aufgaben)
        .where(and(
          eq(aufgaben.unternehmenId, unternehmenId),
          inArray(aufgaben.status, ['backlog', 'todo', 'open']),
        ))
        .limit(10);

      // Skip only if truly nothing to work on
      if (activeGoals.length === 0 && backlogTasks.length === 0) {
        console.log(`  ℹ️ No goals or open tasks — nothing to plan`);
        return;
      }

      // Build planning context — goals take priority, tasks are the fallback
      let planningContext: string;
      if (activeGoals.length > 0) {
        planningContext =
          `Aktive Ziele: ${activeGoals.map(g => `"${g.titel}" (${g.fortschritt}%)`).join(', ')}. ` +
          `Analysiere was als nächstes getan werden muss und weise Aufgaben den passenden Team-Mitgliedern zu.`;
      } else {
        planningContext =
          `Keine übergeordneten Ziele gesetzt. Offene Aufgaben im Backlog: ${backlogTasks.map(t => `"${t.titel}" [${t.prioritaet}]`).join(', ')}. ` +
          `Priorisiere und weise diese Aufgaben den passenden Team-Mitgliedern zu. Erstelle bei Bedarf Unter-Tasks.`;
      }

      // Create a synthetic planning task (not persisted to DB)
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

      // Reuse executeTaskViaAdapter with the synthetic task
      await this.executeTaskViaAdapter(runId, expertId, unternehmenId, syntheticTask, advisorPlan);
    } catch (err: any) {
      console.error(`  ❌ Orchestrator planning cycle failed: ${err.message}`);
    }
  }

  /**
   * CEO Action Parser — liest den Output des Orchestrators und führt Aktionen aus:
   * create_task, assign_task, mark_done, update_goal
   */
  private async processOrchestratorActions(
    taskId: string,
    orchestratorId: string,
    unternehmenId: string,
    output: string,
  ): Promise<boolean> {
    // Extrahiere JSON-Block aus CEO Output (```json ... ``` oder roher JSON mit "actions")
    let actions: any[] = [];
    let currentTaskMarkedDone = false;

    const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
    const rawJsonMatch = output.match(/\{\s*"actions"\s*:\s*\[[\s\S]*?\]\s*\}/);

    for (const raw of [jsonBlockMatch?.[1], rawJsonMatch?.[0]]) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
          actions = parsed.actions;
          break;
        }
      } catch { /* kein valides JSON */ }
    }

    if (actions.length === 0) return currentTaskMarkedDone;

    console.log(`  🎯 CEO Action Parser: ${actions.length} Aktion(en) gefunden`);
    trace(orchestratorId, unternehmenId, 'action', `CEO führt ${actions.length} Aktion(en) aus`);

    // Lade Team für Name→ID Auflösung
    const team = await db.select({ id: experten.id, name: experten.name })
      .from(experten)
      .where(eq(experten.unternehmenId, unternehmenId));

    const findAgent = (name: string) =>
      team.find(a => a.name.toLowerCase().includes(name.toLowerCase()));

    const now = new Date().toISOString();

    for (const action of actions) {
      try {
        switch (action.type) {

          case 'create_task': {
            if (!action.titel) break;

            // ── Deduplication: skip if similar task exists in last 50 open tasks ──
            const normalizeTitle = (t: string) => t.toLowerCase().trim().slice(0, 60);
            const normalized = normalizeTitle(action.titel);
            const recentTasks = await db.select({ titel: aufgaben.titel })
              .from(aufgaben)
              .where(and(
                eq(aufgaben.unternehmenId, unternehmenId),
                inArray(aufgaben.status, ['backlog', 'todo', 'in_progress', 'blocked']),
              ))
              .orderBy(desc(aufgaben.erstelltAm))
              .limit(50);
            const isDuplicate = recentTasks.some(t => normalizeTitle(t.titel) === normalized);
            if (isDuplicate) {
              console.log(`  ⏭️ CEO: Task "${action.titel}" bereits vorhanden — übersprungen (Dedup)`);
              trace(orchestratorId, unternehmenId, 'info', `Duplikat-Task verhindert: ${action.titel}`);
              break;
            }
            // ────────────────────────────────────────────────────────────────────

            const agent = action.assignTo ? findAgent(action.assignTo) : null;
            const newTaskId = uuid();

            await db.insert(aufgaben).values({
              id: newTaskId,
              unternehmenId,
              titel: action.titel,
              beschreibung: action.beschreibung || null,
              status: 'todo',
              prioritaet: action.prioritaet || 'medium',
              zugewiesenAn: agent?.id || null,
              zielId: action.zielId || null,
              erstelltVon: orchestratorId,
              erstelltAm: now,
              aktualisiertAm: now,
            } as any).run();

            console.log(`  ✅ CEO erstellt Task: "${action.titel}" → ${agent?.name || 'offen'}`);
            trace(orchestratorId, unternehmenId, 'action',
              `CEO erstellt Task: ${action.titel}`,
              `Zugewiesen an: ${agent?.name || 'nicht zugewiesen'}`,
            );

            // Wecke den zugewiesenen Agent sofort
            if (agent) {
              await wakeupService.wakeup(agent.id, unternehmenId, {
                source: 'automation',
                triggerDetail: 'callback',
                reason: `Neuer Task vom CEO: ${action.titel}`,
              });
            }
            break;
          }

          case 'assign_task': {
            if (!action.taskId || !action.assignTo) break;
            const agent = findAgent(action.assignTo);
            if (!agent) { console.warn(`  ⚠️ Agent "${action.assignTo}" nicht gefunden`); break; }

            await db.update(aufgaben)
              .set({ zugewiesenAn: agent.id, aktualisiertAm: now })
              .where(and(eq(aufgaben.id, action.taskId), eq(aufgaben.unternehmenId, unternehmenId)))
              .run();

            console.log(`  ✅ CEO weist Task zu → ${agent.name}`);
            trace(orchestratorId, unternehmenId, 'action', `Task zugewiesen an ${agent.name}`);

            await wakeupService.wakeup(agent.id, unternehmenId, {
              source: 'automation',
              triggerDetail: 'issue_assigned',
              reason: 'Task wurde dir zugewiesen',
            });
            break;
          }

          case 'mark_done': {
            if (!action.taskId) break;
            await db.update(aufgaben)
              .set({ status: 'done', abgeschlossenAm: now, aktualisiertAm: now, executionLockedAt: null })
              .where(and(eq(aufgaben.id, action.taskId), eq(aufgaben.unternehmenId, unternehmenId)))
              .run();

            if (action.taskId === taskId) {
              currentTaskMarkedDone = true;
            }
            console.log(`  ✅ CEO markiert Task ${action.taskId} als erledigt`);
            trace(orchestratorId, unternehmenId, 'result', `Task als erledigt markiert`);
            break;
          }

          case 'update_goal': {
            if (!action.goalId) break;
            const goalUpdate: any = { aktualisiertAm: now };
            if (typeof action.fortschritt === 'number') goalUpdate.fortschritt = action.fortschritt;
            if (action.status) goalUpdate.status = action.status;

            await db.update(ziele)
              .set(goalUpdate)
              .where(and(eq(ziele.id, action.goalId), eq(ziele.unternehmenId, unternehmenId)))
              .run();

            console.log(`  ✅ CEO aktualisiert Ziel ${action.goalId}: ${action.fortschritt ?? ''}%`);
            trace(orchestratorId, unternehmenId, 'result',
              `Ziel aktualisiert${typeof action.fortschritt === 'number' ? `: ${action.fortschritt}%` : ''}`,
            );
            break;
          }

          case 'call_meeting': {
            // CEO kann ein Meeting einberufen: { type: 'call_meeting', thema: string, teilnehmerIds: string[], agenda?: string }
            if (!action.thema || !Array.isArray(action.teilnehmerIds) || action.teilnehmerIds.length === 0) break;

            const meetingId = crypto.randomUUID();
            await db.insert(agentMeetings).values({
              id: meetingId,
              unternehmenId,
              veranstalterExpertId: orchestratorId,
              titel: action.thema,
              teilnehmerIds: JSON.stringify(action.teilnehmerIds),
              antworten: JSON.stringify({}),
              status: 'running',
              erstelltAm: now,
            }).run();

            // Wake up all participants
            for (const participantId of action.teilnehmerIds) {
              await db.insert(agentWakeupRequests).values({
                id: crypto.randomUUID(),
                expertId: participantId,
                unternehmenId,
                reason: `Meeting einberufen: ${action.thema}`,
                source: 'automation',
                payload: JSON.stringify({ meetingId, thema: action.thema }),
                requestedAt: now,
              }).run();
            }

            console.log(`  📋 CEO ruft Meeting ein: "${action.thema}" mit ${action.teilnehmerIds.length} Teilnehmern`);
            trace(orchestratorId, unternehmenId, 'action',
              `Meeting einberufen: ${action.thema}`,
              `${action.teilnehmerIds.length} Teilnehmer`, undefined
            );
            break;
          }

          default:
            console.warn(`  ⚠️ Unbekannte CEO Action: ${action.type}`);
        }
      } catch (err: any) {
        console.error(`  ❌ CEO Action "${action.type}" fehlgeschlagen: ${err.message}`);
      }
    }
    return currentTaskMarkedDone;
  }

  /**
   * Parses agent output for actions like bash scripts or JSON requests
   * and executes them autonomously.
   */
  private async processWorkerActions(taskId: string, expertId: string, unternehmenId: string, runId: string, output: string, workspacePath?: string) {
    // 1. Check for bash blocks
    const bashMatch = output.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
    if (bashMatch) {
      const code = bashMatch[1].trim();
      console.log(`  ⚡ Executing autonomous bash action for ${expertId}...`);
      
      const bashAdapter = (await import('../adapters/bash.js')).createBashAdapter();
      const res = await bashAdapter.execute(
        { id: taskId, titel: 'Autonomous Action', beschreibung: code, status: 'in_progress', prioritaet: 'medium' },
        {} as any, 
        { expertId, unternehmenId, runId, workspacePath }
      );

      // Log the action result
      await db.insert(kommentare).values({
        id: uuid(),
        unternehmenId,
        aufgabeId: taskId,
        autorExpertId: expertId,
        autorTyp: 'agent',
        inhalt: `### 🛠️ AUTONOME AKTION AUSGEFÜHRT\n\n**Befehl:**\n\`\`\`bash\n${code}\n\`\`\`\n\n**Ergebnis:**\n\`\`\`\n${res.output || res.error}\n\`\`\``,
        erstelltAm: new Date().toISOString(),
      });
      
      // Record any newly created files
      await this.recordWorkProducts(taskId, expertId, unternehmenId, runId, workspacePath ?? null);
    }

    // 2. Check for JSON actions (e.g. create_task, hire_agent)
    // Here we leverage the CEO's parsing logic if needed, or implement worker-specific ones.
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/) || output.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        // Support status updates from workers
        if (parsed.action === 'update_task_status' || (parsed.actions && parsed.actions.some((a: any) => a.type === 'update_task_status'))) {
           // Logic to handle worker status decisions
           console.log(`  📝 Worker ${expertId} requested status update.`);
        }
      } catch (e) {
        // Ignore invalid JSON
      }
    }
  }

  /**
   * Scan workspace and record produced files as work products
   */
  private async recordWorkProducts(
    taskId: string,
    expertId: string,
    unternehmenId: string,
    runId: string,
    workspacePath: string | null
  ): Promise<void> {
    if (!workspacePath) return;

    try {
      const files = listWorkspaceFiles(taskId);
      if (files.length === 0) return;

      for (const file of files) {
        if (file.isDirectory) continue; // skip directories, only track files

        await db.insert(workProducts).values({
          id: crypto.randomUUID(),
          unternehmenId,
          aufgabeId: taskId,
          expertId,
          runId,
          typ: 'file',
          name: file.name,
          pfad: file.path,
          groeßeBytes: file.sizeBytes,
          mimeTyp: file.mimeTyp,
          erstelltAm: new Date().toISOString(),
        });
      }

      console.log(`  📦 ${files.length} Work Product(s) gespeichert für Task ${taskId}`);
    } catch (err) {
      console.warn(`  ⚠️ Work Products konnten nicht gespeichert werden:`, err);
    }
  }

  /**
   * PARA Memory: Extrahiert Tags aus Agent-Output und akkumuliert sie im Gedächtnis
   *
   * Agenten können in ihrer Ausgabe Memory-Tags verwenden:
   *   [MEMORY:PROJEKT] Wir bauen gerade Feature X [/MEMORY:PROJEKT]
   *   [MEMORY:BEREICH] Ich bin verantwortlich für Y [/MEMORY:BEREICH]
   *   [MEMORY:RESSOURCE] API-Endpoint: https://... [/MEMORY:RESSOURCE]
   *   [MEMORY:ARCHIV] Task "Z" wurde abgeschlossen am ... [/MEMORY:ARCHIV]
   *
   * Ohne explizite Tags: Letzte Aufgabe wird automatisch im Archiv vermerkt.
   */
  // PARA updateAgentMemory entfernt — Memory wird jetzt direkt in der Task-Loop gespeichert


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

    await db.update(arbeitszyklen)
      .set(updateData)
      .where(eq(arbeitszyklen.id, runId));
  }

  /**
   * Record usage/costs for a run
   */
  async recordUsage(runId: string, usage: { inputTokens: number; outputTokens: number; costCents: number }): Promise<void> {
    const run = await this.getRun(runId);
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

  /**
   * Consultant an advisor for a strategic plan
   */
  private async getAdvisorPlan(
    advisorId: string,
    executorId: string,
    unternehmenId: string,
    tasks: any[]
  ): Promise<string> {
    try {
      // Get advisor details
      const advisor = db.select().from(experten).where(eq(experten.id, advisorId)).get();
      const executor = db.select().from(experten).where(eq(experten.id, executorId)).get();

      if (!advisor || !executor) return "Gehe strukturiert vor.";

      const taskSummary = tasks.map(t => `- ${t.titel} (${t.prioritaet})`).join('\n');
      
      const prompt = `Du bist der ADVISOR (Architekt/Lead) für den Agenten ${executor.name} (${executor.rolle}).
Deine Aufgabe ist es, eine STRATEGIE für die folgenden anstehenden Aufgaben zu erstellen:

${taskSummary}

Erstelle einen präzisen, architektonisch klugen Plan, wie der Agent diese Aufgaben angehen soll. 
Identifiziere Fallstricke und setze Leitplanken.
Der Agent sieht diesen Plan als seine höchste Anweisung an.

Antworte ausschließlich mit dem Plan.`;

      // Simulierter LLM Call via Adapter (generic prompt flow)
      // In einer echten Implementierung rufen wir hier den llm-wrapper direkt auf
      // Für den Moment nutzen wir den standard adapter call mechanismus
      const result = await adapterRegistry.executeTask({
          id: 'advisor-call',
          titel: 'Strategic Planning',
          beschreibung: prompt,
          status: 'todo',
          prioritaet: 'high'
      }, {
          task: { id: 'advisor-call', titel: 'Strategic Planning', beschreibung: null, status: 'todo', prioritaet: 'high' },
          previousComments: [],
          companyContext: { name: 'Advisor Session', ziel: null },
          agentContext: { name: advisor.name, rolle: advisor.rolle, faehigkeiten: advisor.faehigkeiten }
      }, {
          expertId: advisorId,
          unternehmenId,
          runId: 'advisor-' + uuid(),
          verbindungsTyp: advisor.verbindungsTyp,
          systemPrompt: "Du bist ein Lead-Architekt. Erstelle Pläne, führe keine Aktionen aus."
      });

      return result.output || "Gehe mit Sorgfalt vor.";
    } catch (err) {
      console.error("❌ Fehler beim Abruf des Advisor-Plans:", err);
      return "Führe die Aufgaben nach bestem Wissen aus.";
    }
  }

  /**
   * Consult an advisor for error analysis and correction plan
   */
  private async getAdvisorCorrection(
    advisorId: string,
    executorId: string,
    unternehmenId: string,
    taskTitel: string,
    output: string,
    error?: string | null
  ): Promise<string> {
    try {
      const advisor = db.select().from(experten).where(eq(experten.id, advisorId)).get();
      const executor = db.select().from(experten).where(eq(experten.id, executorId)).get();

      if (!advisor || !executor) return "Versuche es erneut mit einem anderen Ansatz.";

      const prompt = `Du bist der ADVISOR für ${executor.name}.
Der Agent hat versucht, die Aufgabe "${taskTitel}" zu lösen, ist aber gescheitert.

FEHLER/AUSGABE:
${error || 'Kein expliziter Fehler'}
${output.slice(-1000)}

Analysiere, warum es nicht geklappt hat und gib einen KREATIVEN KORREKTUR-PLAN aus.
Was soll der Agent als nächstes versuchen?`;

      const result = await adapterRegistry.executeTask({
          id: 'advisor-correction',
          titel: 'Error Analysis',
          beschreibung: prompt,
          status: 'todo',
          prioritaet: 'high'
      }, {
          task: { id: 'advisor-correction', titel: 'Error Analysis', beschreibung: null, status: 'todo', prioritaet: 'high' },
          previousComments: [],
          companyContext: { name: 'Advisor Session', ziel: null },
          agentContext: { name: advisor.name, rolle: advisor.rolle, faehigkeiten: advisor.faehigkeiten }
      }, {
          expertId: advisorId,
          unternehmenId,
          runId: 'advisor-corr-' + uuid(),
          verbindungsTyp: advisor.verbindungsTyp,
          systemPrompt: "Du bist ein Problemlöser. Analysiere Fehler und gib präzise neue Anweisungen."
      });

      return result.output || "Versuche einen anderen Weg.";
    } catch (err) {
      return "Fehleranalyse fehlgeschlagen. Bitte manuell prüfen.";
    }
  }

  // ─── CEO FEEDBACK LOOP ──────────────────────────────────────────────────────

  /**
   * After a worker finishes a task:
   * 1. Post a CEO-style chat report instantly (no LLM needed)
   * 2. Trigger orchestrator wakeup for re-evaluation (new tasks, goal check)
   */
  // ─── CRITIC/EVALUATOR ─────────────────────────────────────────────────────
  async runCriticReview(
    taskId: string,
    taskTitel: string,
    taskBeschreibung: string,
    output: string,
    expertId: string,
    unternehmenId: string,
  ): Promise<{ approved: boolean; feedback: string; escalate?: boolean }> {
    // Check existing critic feedback count
    const existingCriticFeedback = await db.select({ inhalt: kommentare.inhalt })
      .from(kommentare)
      .where(eq(kommentare.aufgabeId, taskId));
    const criticCount = existingCriticFeedback.filter((c: any) =>
      c.inhalt?.includes('Critic Review')
    ).length;

    if (criticCount >= 2) {
      console.log(`  ⚠️ Critic: max retries reached for task ${taskId} — escalating to human review`);
      return { approved: false, escalate: true, feedback: 'Nach 2 Überarbeitungszyklen konnte der Agent die Aufgabe nicht zur Zufriedenheit abschließen. Manuelle Prüfung erforderlich.' };
    }

    const criticPrompt = `Du bist ein strenger aber fairer Code/Task-Reviewer.

Aufgabe: "${taskTitel}"
Beschreibung: ${taskBeschreibung || '(keine Beschreibung)'}

Ergebnis des Agenten:
${output.slice(0, 3000)}

Bewerte ob das Ergebnis die Aufgabe erfüllt. Antworte NUR mit diesem JSON:
{"verdict": "approved" | "needs_revision", "feedback": "konkretes Feedback wenn needs_revision, sonst leer"}

Kriterien:
- approved: Aufgabe klar erfüllt, Ergebnis macht Sinn
- needs_revision: Aufgabe nicht erfüllt, falsche Richtung, offensichtlich unvollständig, oder kritische Fehler

Sei nicht zu streng — wenn die Arbeit grundsätzlich passt, approve.`;

    // Use available API key — prefer claude-code CLI (free), then Anthropic haiku (cheap), then OpenRouter with a cheap model
    const agentConn = db.select({ verbindungsTyp: experten.verbindungsTyp })
      .from(experten).where(eq(experten.id, expertId)).get() as any;
    const orKey = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openrouter_api_key')).get();
    const anthropicKey = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'anthropic_api_key')).get();

    try {
      let responseText = '';

      // Option 1: agent uses claude-code CLI — run critic via CLI (free)
      if (!responseText && agentConn?.verbindungsTyp === 'claude-code') {
        try {
          const { runClaudeDirectChat } = await import('../adapters/claude-code.js');
          responseText = await runClaudeDirectChat(criticPrompt, expertId);
        } catch { responseText = ''; }
      }

      // Option 2: Anthropic Haiku (very cheap)
      if (!responseText && anthropicKey?.wert) {
        const key = decryptSetting('anthropic_api_key', anthropicKey.wert);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{ role: 'user', content: criticPrompt }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          responseText = data.content?.[0]?.text || '';
        }
      }

      // Option 3: OpenRouter with an explicit cheap model (never openrouter/auto — too expensive)
      if (!responseText && orKey?.wert) {
        const key = decryptSetting('openrouter_api_key', orKey.wert);
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'http://localhost:3200', 'X-Title': 'OpenCognit Critic' },
          body: JSON.stringify({
            model: 'mistralai/mistral-7b-instruct:free',
            max_tokens: 300,
            messages: [{ role: 'user', content: criticPrompt }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          responseText = data.choices?.[0]?.message?.content || '';
        }
      }

      if (!responseText) {
        console.log('  ℹ️ Critic: no LLM available — auto-approving');
        return { approved: true, feedback: '' };
      }

      // Parse JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { approved: true, feedback: '' };

      const parsed = JSON.parse(jsonMatch[0]);
      const approved = parsed.verdict === 'approved';
      return { approved, feedback: parsed.feedback || '' };

    } catch (e: any) {
      console.error('  ⚠️ Critic review failed:', e.message);
      return { approved: true, feedback: '' }; // fail open
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  private async notifyOrchestratorTaskDone(
    unternehmenId: string,
    workerExpertId: string,
    workerName: string,
    taskTitel: string,
    taskId: string,
    output: string,
  ): Promise<void> {
    try {
      // Find orchestrator for this company
      const orchestrator = await db.select()
        .from(experten)
        .where(and(
          eq(experten.unternehmenId, unternehmenId),
          eq(experten.isOrchestrator, true),
          eq(experten.status, 'active'),
        ))
        .limit(1)
        .then((r: any[]) => r[0]);

      if (!orchestrator) return;

      // Build a short summary from output (first meaningful line, max 300 chars)
      const summary = output
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 20 && !l.startsWith('```') && !l.startsWith('#'))
        .slice(0, 2)
        .join(' ')
        .slice(0, 300);

      // Check goal progress for this task
      const taskRow = await db.select({ zielId: aufgaben.zielId }).from(aufgaben).where(eq(aufgaben.id, taskId)).get() as any;
      let goalLine = '';
      if (taskRow?.zielId) {
        const goalTasks = await db.select({
          done: sql<number>`count(case when ${aufgaben.status} = 'done' then 1 end)`,
          total: sql<number>`count(*)`,
          titel: ziele.titel,
        })
          .from(aufgaben)
          .leftJoin(ziele, eq(ziele.id, aufgaben.zielId))
          .where(eq(aufgaben.zielId, taskRow.zielId))
          .get() as any;

        if (goalTasks?.total > 0) {
          const pct = Math.round((goalTasks.done / goalTasks.total) * 100);
          goalLine = `\n📊 Ziel **${goalTasks.titel}**: ${goalTasks.done}/${goalTasks.total} Tasks (${pct}%)`;
          if (pct === 100) goalLine += ' — **Ziel erreicht! 🎉**';
        }
      }

      const msg = `✅ **${workerName}** hat Task abgeschlossen: **${taskTitel}**\n` +
        (summary ? `\n_${summary}_` : '') +
        goalLine;

      // Save chat message from orchestrator (suppress during focus mode)
      if (!isFocusModeActive(unternehmenId)) {
        await db.insert(chatNachrichten).values({
          id: crypto.randomUUID(),
          unternehmenId,
          expertId: orchestrator.id,
          absenderTyp: 'agent',
          nachricht: msg,
          gelesen: false,
          erstelltAm: new Date().toISOString(),
        });
        console.log(`  📣 CEO Report gesendet: Task "${taskTitel}" abgeschlossen von ${workerName}`);
      } else {
        console.log(`  🔇 CEO Report unterdrückt (Focus Mode aktiv): Task "${taskTitel}" abgeschlossen von ${workerName}`);
      }
      trace(orchestrator.id, unternehmenId, 'info', `${workerName} hat Task abgeschlossen: ${taskTitel}`, msg);

      // Trigger orchestrator wakeup for re-evaluation (create new tasks, check goals)
      await wakeupService.wakeup(orchestrator.id, unternehmenId, {
        source: 'automation',
        triggerDetail: 'callback',
        reason: `Task "${taskTitel}" von ${workerName} abgeschlossen — bitte Fortschritt prüfen und neue Tasks erstellen falls nötig`,
        payload: { taskId, completedBy: workerExpertId },
      });

      console.log(`  🔔 Orchestrator ${orchestrator.name} für Re-Evaluation geweckt`);
    } catch (err: any) {
      console.warn(`  ⚠️ CEO Feedback Loop Fehler: ${err.message}`);
    }
  }

  /**
   * Scan for tasks that are blocked or stuck in-progress too long.
   * Called at the start of each orchestrator heartbeat cycle.
   */
  async scanForBlockedTasks(unternehmenId: string, orchestratorId: string): Promise<void> {
    try {
      const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

      const stuckTasks = await db.select({
        id: aufgaben.id,
        titel: aufgaben.titel,
        status: aufgaben.status,
        zugewiesenAn: aufgaben.zugewiesenAn,
        gestartetAm: aufgaben.gestartetAm,
      })
        .from(aufgaben)
        .where(and(
          eq(aufgaben.unternehmenId, unternehmenId),
          inArray(aufgaben.status, ['in_progress', 'blocked']),
        )) as any[];

      const now = Date.now();
      for (const task of stuckTasks) {
        if (!task.gestartetAm) continue;
        const age = now - new Date(task.gestartetAm).getTime();
        if (age < STUCK_THRESHOLD_MS) continue;

        // Find agent name
        let agentName = 'Unbekannt';
        if (task.zugewiesenAn) {
          const agent = await db.select({ name: experten.name }).from(experten).where(eq(experten.id, task.zugewiesenAn)).get() as any;
          agentName = agent?.name || agentName;
        }

        const hours = Math.round(age / (60 * 60 * 1000));

        // Check if we already sent a stuck-alert recently (last 4h)
        const recentAlert = await db.select()
          .from(chatNachrichten)
          .where(and(
            eq(chatNachrichten.unternehmenId, unternehmenId),
            eq(chatNachrichten.expertId, orchestratorId),
          ))
          .then((msgs: any[]) => msgs.some((m) =>
            m.nachricht.includes(`feststeckt`) &&
            m.nachricht.includes(task.titel.slice(0, 30)) &&
            new Date(m.erstelltAm) > new Date(Date.now() - 4 * 60 * 60 * 1000)
          ));

        if (recentAlert) continue;

        const alertMsg = `⚠️ **${agentName}** feststeckt seit ${hours}h bei Task: **${task.titel}**\n` +
          `Status: \`${task.status}\` — bitte manuell prüfen oder Task neu zuweisen.`;

        // Suppress non-critical alerts during focus mode
        if (!isFocusModeActive(unternehmenId)) {
          await db.insert(chatNachrichten).values({
            id: crypto.randomUUID(),
            unternehmenId,
            expertId: orchestratorId,
            absenderTyp: 'agent',
            nachricht: alertMsg,
            gelesen: false,
            erstelltAm: new Date().toISOString(),
          });
          console.log(`  🚨 Blocker-Alert: Task "${task.titel}" seit ${hours}h in ${task.status}`);
        } else {
          console.log(`  🔇 Blocker-Alert unterdrückt (Focus Mode aktiv): Task "${task.titel}"`);
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Blocker-Scan Fehler: ${err.message}`);
    }
  }

  /**
   * Automatic Task Chaining — called when a task is marked done.
   * Finds all tasks that were blocked by the completed task, checks if they
   * are now fully unblocked (all their blockers done), and if so:
   * - moves them from backlog → todo
   * - wakes up their assigned agents immediately
   */
  private async unlockDependentTasks(completedTaskId: string, unternehmenId: string): Promise<void> {
    // Find tasks that were waiting on this completed task
    const dependents = await db.select({ zielId: issueRelations.zielId })
      .from(issueRelations)
      .where(eq(issueRelations.quellId, completedTaskId));

    if (dependents.length === 0) return;

    const agentsToWake: Array<{ agentId: string; unternehmenId: string }> = [];

    for (const { zielId } of dependents) {
      // Get the dependent task
      const depTask = await db.select({
        id: aufgaben.id,
        titel: aufgaben.titel,
        status: aufgaben.status,
        zugewiesenAn: aufgaben.zugewiesenAn,
        unternehmenId: aufgaben.unternehmenId,
      }).from(aufgaben).where(eq(aufgaben.id, zielId)).get();

      if (!depTask || depTask.unternehmenId !== unternehmenId) continue;
      if (depTask.status !== 'backlog' && depTask.status !== 'blocked') continue;

      // Check if ALL blockers of this task are now done
      const allBlockers = await db.select({ quellId: issueRelations.quellId })
        .from(issueRelations)
        .where(eq(issueRelations.zielId, zielId));

      const blockerStatuses = await Promise.all(
        allBlockers.map(b => db.select({ status: aufgaben.status })
          .from(aufgaben).where(eq(aufgaben.id, b.quellId)).get()),
      );

      const allDone = blockerStatuses.every(b => b?.status === 'done');
      if (!allDone) continue;

      // All blockers done — unlock this task
      const now = new Date().toISOString();
      await db.update(aufgaben)
        .set({ status: 'todo', aktualisiertAm: now })
        .where(eq(aufgaben.id, zielId));

      console.log(`  🔗 Task Chaining: "${depTask.titel}" ist jetzt entsperrt`);

      // Notify assigned agent via chat message
      if (depTask.zugewiesenAn) {
        await db.insert(chatNachrichten).values({
          id: uuid(),
          unternehmenId,
          expertId: depTask.zugewiesenAn,
          absenderTyp: 'system',
          nachricht: `🔗 Dein Task "${depTask.titel}" ist jetzt bereit — alle Abhängigkeiten wurden abgeschlossen.`,
          gelesen: false,
          erstelltAm: now,
        }).run();

        agentsToWake.push({ agentId: depTask.zugewiesenAn, unternehmenId });
      }
    }

    // Wake all newly unblocked agents in parallel
    if (agentsToWake.length > 0) {
      console.log(`  🔗 Task Chaining: ${agentsToWake.length} Agent(en) werden geweckt`);
      const { scheduler } = await import('../scheduler.js');
      await Promise.all(agentsToWake.map(({ agentId, unternehmenId: uid }) =>
        scheduler.triggerZyklus(agentId, uid, 'callback').catch(() => {}),
      ));
    }
  }
}

// Singleton instance
export const heartbeatService = new HeartbeatServiceImpl();

// Convenience exports
export const executeHeartbeat = heartbeatService.executeHeartbeat.bind(heartbeatService);
export const processPendingWakeups = heartbeatService.processPendingWakeups.bind(heartbeatService);
export const getHeartbeatRun = heartbeatService.getRun.bind(heartbeatService);
export const updateHeartbeatStatus = heartbeatService.updateRunStatus.bind(heartbeatService);
export const recordHeartbeatUsage = heartbeatService.recordUsage.bind(heartbeatService);

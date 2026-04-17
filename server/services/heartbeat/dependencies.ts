// Heartbeat Dependencies — work products, blocker scan, task chaining

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { aufgaben, experten, chatNachrichten, workProducts, issueRelations } from '../../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { listWorkspaceFiles } from '../workspace.js';
import { isFocusModeActive } from './utils.js';
import { v4 as uuid } from 'uuid';

/**
 * Scan workspace and record produced files as work products
 */
export async function recordWorkProducts(
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
 * Scan for tasks that are blocked or stuck in-progress too long.
 * Called at the start of each orchestrator heartbeat cycle.
 */
export async function scanForBlockedTasks(unternehmenId: string, orchestratorId: string): Promise<void> {
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
export async function unlockDependentTasks(completedTaskId: string, unternehmenId: string): Promise<void> {
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
    const { scheduler } = await import('../../scheduler.js');
    await Promise.all(agentsToWake.map(({ agentId, unternehmenId: uid }) =>
      scheduler.triggerZyklus(agentId, uid, 'callback').catch(() => {}),
    ));
  }
}

// Heartbeat Dependencies — work products, blocker scan, task chaining

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { tasks, agents, chatMessages, workProducts, issueRelations } from '../../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { listWorkspaceFiles } from '../workspace.js';
import { isFocusModeActive } from './utils.js';
import { v4 as uuid } from 'uuid';

/**
 * Scan workspace and record produced files as work products
 */
export async function recordWorkProducts(
  taskId: string,
  agentId: string,
  companyId: string,
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
        companyId,
        taskId: taskId,
        agentId,
        runId,
        type: 'file',
        name: file.name,
        pfad: file.path,
        sizeBytes: file.sizeBytes,
        mimeTyp: file.mimeTyp,
        createdAt: new Date().toISOString(),
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
export async function scanForBlockedTasks(companyId: string, orchestratorId: string): Promise<void> {
  try {
    const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

    const stuckTasks = await db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      assignedTo: tasks.assignedTo,
      startedAt: tasks.startedAt,
    })
      .from(tasks)
      .where(and(
        eq(tasks.companyId, companyId),
        inArray(tasks.status, ['in_progress', 'blocked']),
      ));

    const now = Date.now();
    for (const task of stuckTasks) {
      if (!task.startedAt) continue;
      const age = now - new Date(task.startedAt).getTime();
      if (age < STUCK_THRESHOLD_MS) continue;

      // Find agent name
      let agentName = 'Unbekannt';
      if (task.assignedTo) {
        const agent = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, task.assignedTo)).get() as any;
        agentName = agent?.name || agentName;
      }

      const hours = Math.round(age / (60 * 60 * 1000));

      // Check if we already sent a stuck-alert recently (last 4h)
      const recentAlert = await db.select()
        .from(chatMessages)
        .where(and(
          eq(chatMessages.companyId, companyId),
          eq(chatMessages.agentId, orchestratorId),
        ))
        .then((msgs: any[]) => msgs.some((m) =>
          m.message.includes(`feststeckt`) &&
          m.message.includes(task.title.slice(0, 30)) &&
          new Date(m.createdAt) > new Date(Date.now() - 4 * 60 * 60 * 1000)
        ));

      if (recentAlert) continue;

      const alertMsg = `⚠️ **${agentName}** feststeckt seit ${hours}h bei Task: **${task.title}**\n` +
        `Status: \`${task.status}\` — bitte manuell prüfen oder Task neu zuweisen.`;

      // Suppress non-critical alerts during focus mode
      if (!isFocusModeActive(companyId)) {
        await db.insert(chatMessages).values({
          id: crypto.randomUUID(),
          companyId,
          agentId: orchestratorId,
          senderType: 'agent',
          message: alertMsg,
          read: false,
          createdAt: new Date().toISOString(),
        });
        console.log(`  🚨 Blocker-Alert: Task "${task.title}" seit ${hours}h in ${task.status}`);
      } else {
        console.log(`  🔇 Blocker-Alert unterdrückt (Focus Mode aktiv): Task "${task.title}"`);
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
export async function unlockDependentTasks(completedTaskId: string, companyId: string): Promise<void> {
  // Find tasks that were waiting on this completed task
  const dependents = await db.select({ targetId: issueRelations.targetId })
    .from(issueRelations)
    .where(eq(issueRelations.sourceId, completedTaskId));

  if (dependents.length === 0) return;

  const agentsToWake: Array<{ agentId: string; companyId: string }> = [];

  for (const { targetId } of dependents) {
    // Get the dependent task
    const depTask = await db.select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      assignedTo: tasks.assignedTo,
      companyId: tasks.companyId,
    }).from(tasks).where(eq(tasks.id, targetId)).get();

    if (!depTask || depTask.companyId !== companyId) continue;
    if (depTask.status !== 'backlog' && depTask.status !== 'blocked') continue;

    // Check if ALL blockers of this task are now done
    const allBlockers = await db.select({ sourceId: issueRelations.sourceId })
      .from(issueRelations)
      .where(eq(issueRelations.targetId, targetId));

    const blockerStatuses = await Promise.all(
      allBlockers.map(b => db.select({ status: tasks.status })
        .from(tasks).where(eq(tasks.id, b.sourceId)).get()),
    );

    const allDone = blockerStatuses.every(b => b?.status === 'done');
    if (!allDone) continue;

    // All blockers done — unlock this task
    const now = new Date().toISOString();
    await db.update(tasks)
      .set({ status: 'todo', updatedAt: now })
      .where(eq(tasks.id, targetId));

    console.log(`  🔗 Task Chaining: "${depTask.title}" ist jetzt entsperrt`);

    // Notify assigned agent via chat message
    if (depTask.assignedTo) {
      await db.insert(chatMessages).values({
        id: uuid(),
        companyId,
        agentId: depTask.assignedTo,
        senderType: 'system',
        message: `🔗 Dein Task "${depTask.title}" ist jetzt bereit — alle Abhängigkeiten wurden abgeschlossen.`,
        read: false,
        createdAt: now,
      }).run();

      agentsToWake.push({ agentId: depTask.assignedTo, companyId });
    }
  }

  // Wake all newly unblocked agents in parallel
  if (agentsToWake.length > 0) {
    console.log(`  🔗 Task Chaining: ${agentsToWake.length} Agent(en) werden geweckt`);
    const { scheduler } = await import('../../scheduler.js');
    await Promise.all(agentsToWake.map(({ agentId, companyId: uid }) =>
      scheduler.triggerZyklus(agentId, uid, 'callback').catch(() => {}),
    ));
  }
}

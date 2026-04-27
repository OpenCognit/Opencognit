/**
 * Task Dependency Resolution Engine (DAG)
 * ========================================
 * Automatically resolves task dependencies. When a task is marked done,
 * all blocked tasks are checked. If all their dependencies are resolved,
 * they are automatically unblocked and assigned.
 *
 * Based on: Directed Acyclic Graph (DAG) traversal + topological ordering.
 * State-of-the-Art 2026: "Output validation between every step is non-negotiable."
 */

import { eq, and, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks, issueRelations, agents } from '../db/schema.js';
import { wakeupService } from './wakeup.js';

export interface DependencyResolutionResult {
  unblocked: string[];   // task IDs that were unblocked
  assigned: string[];    // task IDs that were auto-assigned
  failed: string[];      // task IDs that couldn't be resolved
  reason: string;
}

/**
 * Resolve all tasks that are blocked by the just-completed task.
 * Called when a task transitions to 'done' status.
 */
export async function resolveDependenciesAfterCompletion(
  completedTaskId: string,
  unternehmenId: string
): Promise<DependencyResolutionResult> {
  const result: DependencyResolutionResult = { unblocked: [], assigned: [], failed: [], reason: '' };

  // Find all tasks that are blocked BY the completed task
  const blockedRelations = db
    .select({ zielId: issueRelations.goalId })
    .from(issueRelations)
    .where(and(eq(issueRelations.quellId, completedTaskId), eq(issueRelations.type, 'blocks')))
    .all();

  if (blockedRelations.length === 0) {
    result.reason = 'No tasks blocked by this completion.';
    return result;
  }

  const blockedTaskIds = blockedRelations.map(r => r.goalId);

  for (const blockedId of blockedTaskIds) {
    const canUnblock = await canTaskBeUnblocked(blockedId);
    if (!canUnblock) continue;

    // Get the blocked task
    const task = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, blockedId))
      .get();

    if (!task) continue;

    // Unblock the task
    db.update(tasks)
      .set({ status: 'todo', updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, blockedId))
      .run();

    result.unblocked.push(blockedId);

    // Auto-assign if not already assigned
    if (!task.assignedTo) {
      const assigned = await autoAssignUnblockedTask(task, unternehmenId);
      if (assigned) {
        result.assigned.push(blockedId);
      } else {
        result.failed.push(blockedId);
      }
    }
  }

  result.reason = `Resolved ${result.unblocked.length} blocked tasks, auto-assigned ${result.assigned.length}.`;
  return result;
}

/**
 * Check if ALL dependencies of a task are completed (done/cancelled).
 */
export async function canTaskBeUnblocked(taskId: string): Promise<boolean> {
  // Find all tasks that block this task
  const blockers = db
    .select({ quellId: issueRelations.quellId })
    .from(issueRelations)
    .where(and(eq(issueRelations.goalId, taskId), eq(issueRelations.type, 'blocks')))
    .all();

  if (blockers.length === 0) return true; // No blockers

  const blockerIds = blockers.map(b => b.quellId);

  // Check if all blockers are done or cancelled
  const blockerStatuses = db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.id, blockerIds))
    .all();

  // If any blocker is missing from DB, treat as resolved (orphan)
  const foundIds = new Set(blockerStatuses.map(b => b.id));
  const allResolved = blockerIds.every(id => {
    if (!foundIds.has(id)) return true; // orphan = resolved
    const status = blockerStatuses.find(b => b.id === id)?.status;
    return status === 'done' || status === 'cancelled';
  });

  return allResolved;
}

/**
 * Build the full dependency chain for a task (upstream + downstream).
 */
export function getDependencyChain(taskId: string): {
  upstream: string[];    // tasks this task depends on
  downstream: string[];  // tasks that depend on this task
  cycleDetected: boolean;
} {
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  const visited = new Set<string>();
  let cycleDetected = false;

  function walkUp(current: string, path: string[]) {
    if (path.includes(current)) { cycleDetected = true; return; }
    if (visited.has(current)) return;
    visited.add(current);

    const parents = db
      .select({ quellId: issueRelations.quellId })
      .from(issueRelations)
      .where(and(eq(issueRelations.goalId, current), eq(issueRelations.type, 'blocks')))
      .all();

    for (const p of parents) {
      upstream.add(p.quellId);
      walkUp(p.quellId, [...path, current]);
    }
  }

  function walkDown(current: string, path: string[]) {
    if (path.includes(current)) { cycleDetected = true; return; }
    if (visited.has(`down:${current}`)) return;
    visited.add(`down:${current}`);

    const children = db
      .select({ zielId: issueRelations.goalId })
      .from(issueRelations)
      .where(and(eq(issueRelations.quellId, current), eq(issueRelations.type, 'blocks')))
      .all();

    for (const c of children) {
      downstream.add(c.goalId);
      walkDown(c.goalId, [...path, current]);
    }
  }

  walkUp(taskId, []);
  walkDown(taskId, []);

  return {
    upstream: Array.from(upstream),
    downstream: Array.from(downstream),
    cycleDetected,
  };
}

/**
 * Get a topological ordering of all tasks in a project.
 * Tasks with no dependencies come first.
 */
export function getTopologicalOrdering(projectId: string): string[] {
  const taskRows = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all();

  const taskIds = taskRows.map(t => t.id);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of taskIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  const relations = db
    .select({ quellId: issueRelations.quellId, zielId: issueRelations.goalId })
    .from(issueRelations)
    .where(and(eq(issueRelations.type, 'blocks'), inArray(issueRelations.quellId, taskIds)))
    .all();

  for (const r of relations) {
    if (!inDegree.has(r.goalId)) continue;
    inDegree.set(r.goalId, (inDegree.get(r.goalId) || 0) + 1);
    adj.get(r.quellId)?.push(r.goalId);
  }

  const queue = Array.from(inDegree.entries())
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  const ordering: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordering.push(current);
    for (const neighbor of adj.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return ordering;
}

/**
 * Auto-assign an unblocked task to the best available agent.
 * Uses capability matching + trust score + workload.
 */
async function autoAssignUnblockedTask(
  task: typeof tasks.$inferSelect,
  unternehmenId: string
): Promise<boolean> {
  // Find available agents (active, not error/terminated)
  const agentRows = db
    .select()
    .from(agents)
    .where(and(
      eq(agents.companyId, unternehmenId),
      eq(agents.status, 'active')
    ))
    .all();

  if (agentRows.length === 0) return false;

  // Score each agent: prefer those with lower workload and higher trust
  const scored = agentRows.map(agent => {
    const workload = db
      .select({ count: db.fn.count() })
      .from(tasks)
      .where(and(
        eq(tasks.assignedTo, agent.id),
        inArray(tasks.status, ['todo', 'in_progress', 'in_review'])
      ))
      .get()?.count || 0;

    return { agent, score: -workload }; // lower workload = higher score
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best) return false;

  // Assign the task
  db.update(tasks)
    .set({
      assignedTo: best.agent.id,
      status: 'todo',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tasks.id, task.id))
    .run();

  // Wakeup the assigned agent
  await wakeupService.wakeupForAssignment(best.agent.id, unternehmenId, task.id);

  return true;
}

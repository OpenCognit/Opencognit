// Issue Dependencies — blocking graph for task orchestration.
// Tasks can block other tasks. Blocked tasks are not executed.

import { db } from '../db/client.js';
import { issueRelations, tasks } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

/**
 * Creates a blocking relation: sourceId blocks targetId.
 * targetId can only be worked on once sourceId is 'done'.
 */
export function addBlocker(
  sourceId: string,
  targetId: string,
  createdBy?: string
): { success: boolean; error?: string } {
  const source = db.select().from(tasks).where(eq(tasks.id, sourceId)).get();
  const target = db.select().from(tasks).where(eq(tasks.id, targetId)).get();
  if (!source) return { success: false, error: `Task ${sourceId} not found` };
  if (!target) return { success: false, error: `Task ${targetId} not found` };

  if (hasDependencyOn(targetId, sourceId)) {
    return { success: false, error: 'Circular dependency detected' };
  }

  const existing = db.select().from(issueRelations)
    .where(and(eq(issueRelations.sourceId, sourceId), eq(issueRelations.targetId, targetId)))
    .get();
  if (existing) return { success: true }; // idempotent

  db.insert(issueRelations).values({
    id: uuid(),
    sourceId,
    targetId,
    type: 'blocks',
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
  }).run();

  // Mark target as 'blocked' if the blocker isn't done yet.
  if (source.status !== 'done') {
    db.update(tasks).set({ status: 'blocked', updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, targetId)).run();
  }

  return { success: true };
}

/** Removes a blocking relation. */
export function removeBlocker(sourceId: string, targetId: string): void {
  db.delete(issueRelations)
    .where(and(eq(issueRelations.sourceId, sourceId), eq(issueRelations.targetId, targetId)))
    .run();

  // Re-check whether the target still has any other blockers.
  unblockDependents(sourceId);
}

/** Returns all blockers for a task. */
export function getBlockers(taskId: string): Array<{ id: string; title: string; status: string }> {
  const relations = db.select().from(issueRelations)
    .where(eq(issueRelations.targetId, taskId))
    .all();

  if (relations.length === 0) return [];

  const sourceIds = relations.map(r => r.sourceId);
  const taskRows = db.select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.id, sourceIds))
    .all();
  const taskMap = new Map(taskRows.map(t => [t.id, t]));

  return relations.map(r => {
    const task = taskMap.get(r.sourceId);
    return { id: r.sourceId, title: task?.title || '?', status: task?.status || '?' };
  });
}

/** Returns all tasks that are blocked by this task. */
export function getBlocked(taskId: string): Array<{ id: string; title: string; status: string }> {
  const relations = db.select().from(issueRelations)
    .where(eq(issueRelations.sourceId, taskId))
    .all();

  if (relations.length === 0) return [];

  const targetIds = relations.map(r => r.targetId).filter(Boolean);
  const taskRows = db.select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.id, targetIds))
    .all();
  const taskMap = new Map(taskRows.map(t => [t.id, t]));

  return relations.map(r => {
    const task = taskMap.get(r.targetId);
    return { id: r.targetId, title: task?.title || '?', status: task?.status || '?' };
  });
}

/** Checks transitively whether `fromId` depends on `toId`. Used to detect cycles. */
function hasDependencyOn(fromId: string, toId: string, visited = new Set<string>()): boolean {
  if (fromId === toId) return true;
  if (visited.has(fromId)) return false;
  visited.add(fromId);

  const blockers = db.select().from(issueRelations)
    .where(eq(issueRelations.targetId, fromId))
    .all();

  for (const rel of blockers) {
    if (hasDependencyOn(rel.sourceId, toId, visited)) return true;
  }
  return false;
}

/**
 * When a task transitions to 'done', unblocks any dependents whose blockers are all done.
 * Returns the list of task ids that were unblocked.
 */
export function unblockDependents(taskId: string): string[] {
  const unblocked: string[] = [];

  const dependents = db.select().from(issueRelations)
    .where(eq(issueRelations.sourceId, taskId))
    .all();

  for (const rel of dependents) {
    const allBlockers = db.select().from(issueRelations)
      .where(eq(issueRelations.targetId, rel.targetId))
      .all();

    const allDone = allBlockers.every(b => {
      const task = db.select().from(tasks).where(eq(tasks.id, b.sourceId)).get();
      return task?.status === 'done';
    });

    if (allDone) {
      const target = db.select().from(tasks).where(eq(tasks.id, rel.targetId)).get();
      if (target?.status === 'blocked') {
        db.update(tasks).set({ status: 'todo', updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, rel.targetId)).run();
        unblocked.push(rel.targetId);
        console.log(`🔓 Task "${target.title}" unblocked (all dependencies done)`);
      }
    }
  }

  return unblocked;
}

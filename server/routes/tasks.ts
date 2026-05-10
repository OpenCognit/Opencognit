// =============================================================================
// Tasks routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// In scope here: GET/POST list, GET/PATCH/DELETE single, atomic checkout +
// release, comments, work-products, timeline.
//
// Out of scope (future PRs): task workspace POST + workspaces.ts, blockers,
// tasks/graph, decompose. Those each have heavier dependencies.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  tasks,
  comments,
  agents,
  goals,
  workProducts,
  issueRelations,
  workCycles,
  costEntries,
  traceEvents,
  approvals,
  activityLog,
} from '../db/schema.js';
import { scheduler } from '../scheduler.js';
import { wakeupService } from '../services/wakeup.js';
import { logAktivitaet } from '../services/activity-log.js';
import { appEvents } from '../events.js';
import { validate } from '../utils/validate.js';
import { authMiddleware, requireCompanyAccess, requireResourceAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

const broadcast = (type: string, data: any) => appEvents.emit('broadcast', { type, data });

const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

const zTask = z.object({
  title: z.string().min(1).max(300).optional(),
  titel: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  beschreibung: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  prioritaet: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
}).passthrough();

// =============================================
// AUFGABEN — list + create
// =============================================
router.get('/api/companies/:unternehmenId/tasks', requireCompanyAccess(), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string | undefined;
  const zugewiesenAn = req.query.assignedTo as string | undefined;

  const result = db.select().from(tasks)
    .where(and(
      eq(tasks.companyId, req.params.unternehmenId),
      ...(status ? [eq(tasks.status, status as any)] : []),
      ...(zugewiesenAn ? [eq(tasks.assignedTo, zugewiesenAn)] : []),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  res.json(result);
});

router.post('/api/companies/:unternehmenId/tasks', requireCompanyAccess(), (req, res) => {
  const body = validate(zTask.refine(d => d.titel || d.title, { message: 'Title required', path: ['titel'] }), req, res);
  if (!body) return;
  const b = body as any;
  const titel = b.titel || b.title;
  const beschreibung = b.beschreibung || b.description;
  const prioritaet = b.prioritaet || b.priority;
  const zugewiesenAn = b.zugewiesenAn || b.assignedTo;
  const { erstelltVon, parentId, projektId, zielId } = b;

  const unternehmenId = req.params.unternehmenId;

  // Dedup: reject if an open task with the same title already exists
  const existing = db.select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.companyId, unternehmenId),
      sql`LOWER(TRIM(${tasks.title})) = LOWER(TRIM(${titel}))`,
      sql`${tasks.status} != 'done'`,
    ))
    .limit(1)
    .all();
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Duplicate: task with this title already exists', existingId: existing[0].id });
  }

  const id = uuid();

  db.insert(tasks).values({
    id, companyId: unternehmenId, title: titel, description: beschreibung,
    status: 'backlog',
    priority: prioritaet || 'medium',
    assignedTo: zugewiesenAn || null,
    createdBy: erstelltVon || 'board',
    parentId: parentId || null,
    projectId: projektId || null,
    goalId: zielId || null,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, id)).get();
  logAktivitaet(unternehmenId, 'board', 'board', 'Board', `hat Aufgabe „${titel}" erstellt`, 'aufgabe', id);
  // Wake CEO if task has no assignee yet
  if (!zugewiesenAn) scheduler.triggerCEOForCompany(unternehmenId);
  res.status(201).json(aufgabe);
});

// =============================================
// AUFGABEN — single read / update / delete
// =============================================
router.get('/api/tasks/:id', requireResourceAccess('task'), (req, res) => {
  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });
  res.json(aufgabe);
});

router.patch('/api/tasks/:id', requireResourceAccess('task'), (req, res) => {
  const existing = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const updates: any = { updatedAt: now() };
  // Accept both German (legacy) and English field names
  const aliases: Record<string, string> = {
    titel: 'title', title: 'title',
    beschreibung: 'description', description: 'description',
    prioritaet: 'priority', priority: 'priority',
    zugewiesenAn: 'assignedTo', assignedTo: 'assignedTo',
    projektId: 'projectId', projectId: 'projectId',
    zielId: 'goalId', goalId: 'goalId',
  };
  const passthrough = ['status', 'parentId', 'isMaximizerMode'];
  for (const [key, col] of Object.entries(aliases)) {
    if (req.body[key] !== undefined) updates[col] = req.body[key];
  }
  for (const key of passthrough) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  // Side effects for status transitions
  if (updates.status === 'in_progress' && !existing.startedAt) {
    updates.startedAt = now();
  }
  if (updates.status === 'done') {
    updates.completedAt = now();
  }
  if (updates.status === 'cancelled') {
    updates.cancelledAt = now();
  }

  db.update(tasks).set(updates).where(eq(tasks.id, req.params.id as string)).run();
  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();

  // When a task is assigned to an agent → trigger wakeup
  if (updates.assignedTo && updates.assignedTo !== existing.assignedTo) {
    wakeupService.wakeupForAssignment(updates.assignedTo, existing.companyId, req.params.id as string)
      .catch(err => console.error('Wakeup on assignment failed:', err));
  }

  // When a task is set to 'in_progress' → wake assigned agent immediately
  if (updates.status === 'in_progress' && existing.assignedTo && existing.status !== 'in_progress') {
    wakeupService.wakeupForAssignment(existing.assignedTo, existing.companyId, req.params.id as string)
      .catch(err => console.error('Wakeup on in_progress failed:', err));
  }

  // When task → 'done' → unblock dependents + notify
  if (updates.status === 'done' && existing.status !== 'done') {
    import('../services/issue-dependencies.js').then(({ unblockDependents }) => {
      const unblocked = unblockDependents(req.params.id as string);
      if (unblocked.length > 0) {
        broadcast('tasks_unblocked', { taskIds: unblocked, unternehmenId: existing.companyId });
      }
    }).catch(() => {});
    // Broadcast task_completed event for real-time notifications
    const agentName = existing.assignedTo
      ? (db.select({ name: agents.name }).from(agents).where(eq(agents.id, existing.assignedTo)).get()?.name ?? '')
      : '';
    broadcast('task_completed', {
      unternehmenId: existing.companyId,
      taskId: req.params.id,
      taskTitel: existing.title,
      agentName,
      agentId: existing.assignedTo ?? null,
    });

    // Auto-advance goal to 'achieved' when all linked tasks are done
    const zielId = updates.goalId ?? existing.goalId;
    if (zielId) {
      const ziel = db.select().from(goals).where(eq(goals.id, zielId)).get();
      if (ziel && ziel.status !== 'achieved' && ziel.status !== 'cancelled') {
        const allTasks = db.select({ status: tasks.status }).from(tasks)
          .where(eq(tasks.goalId, zielId)).all();
        if (allTasks.length > 0 && allTasks.every(t => t.status === 'done' || t.status === 'cancelled')) {
          db.update(goals).set({ status: 'achieved', updatedAt: now() }).where(eq(goals.id, zielId)).run();
          broadcast('goal_achieved', { unternehmenId: existing.companyId, zielId, zielTitel: ziel.title });
        }
      }
    }
  }

  // task_started notification
  if (updates.status === 'in_progress' && existing.status !== 'in_progress') {
    const agentName = (updates.assignedTo || existing.assignedTo)
      ? (db.select({ name: agents.name }).from(agents).where(eq(agents.id, updates.assignedTo || existing.assignedTo)).get()?.name ?? '')
      : '';
    const agentIdStarted = updates.assignedTo || existing.assignedTo;
    broadcast('task_started', {
      unternehmenId: existing.companyId,
      taskId: req.params.id,
      taskTitel: existing.title,
      agentName,
      agentId: agentIdStarted ?? null,
    });
  }

  res.json(aufgabe);
});

// Delete a task (removes comments + issue relations too)
router.delete('/api/tasks/:id', authMiddleware, requireResourceAccess('task'), (req, res) => {
  const existing = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  db.delete(comments).where(eq(comments.taskId, req.params.id as string)).run();
  db.delete(issueRelations).where(
    or(eq(issueRelations.sourceId, req.params.id as string), eq(issueRelations.targetId, req.params.id as string)),
  ).run();
  db.delete(tasks).where(eq(tasks.id, req.params.id as string)).run();

  broadcast('task_deleted', { unternehmenId: existing.companyId, taskId: req.params.id });
  res.json({ ok: true });
});

// =============================================
// CHECKOUT / RELEASE — atomic execution lock
// =============================================
router.post('/api/tasks/:id/checkout', requireResourceAccess('task'), (req, res) => {
  const { expertId, runId } = req.body;
  if (!expertId) return res.status(400).json({ error: 'expertId ist erforderlich' });

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  // Check if task is already assigned to different expert
  if (aufgabe.assignedTo && aufgabe.assignedTo !== expertId) {
    return res.status(409).json({ error: 'Task already assigned', aktuellZugewiesen: aufgabe.assignedTo });
  }

  // Check if task is locked by another run (atomic lock check)
  if (aufgabe.executionLockedAt && aufgabe.executionRunId && aufgabe.executionRunId !== runId) {
    const lockAge = Date.now() - new Date(aufgabe.executionLockedAt).getTime();
    const lockTimeout = 30 * 60 * 1000; // 30 minutes

    if (lockAge < lockTimeout) {
      return res.status(409).json({
        error: 'Task locked by another run',
        lockedBy: aufgabe.executionRunId,
        lockedAt: aufgabe.executionLockedAt,
      });
    }
    console.log(`⏰ Task ${aufgabe.id} lock expired, reclaiming`);
  }

  if (!['backlog', 'todo', 'blocked', 'in_progress'].includes(aufgabe.status)) {
    return res.status(409).json({ error: 'Task cannot be checked out in this status', status: aufgabe.status });
  }

  const nowStr = now();
  db.update(tasks).set({
    assignedTo: expertId,
    executionRunId: runId || null,
    executionAgentNameKey: `expert-${expertId}`,
    executionLockedAt: nowStr,
    status: aufgabe.status === 'backlog' ? 'todo' : 'in_progress',
    startedAt: aufgabe.startedAt || nowStr,
    updatedAt: nowStr,
  }).where(eq(tasks.id, req.params.id as string)).run();

  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  logAktivitaet(aufgabe.companyId, 'agent', expertId, expert?.name || expertId, `hat „${aufgabe.title}" ausgecheckt`, 'aufgabe', aufgabe.id);

  const updated = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  res.json(updated);
});

router.post('/api/tasks/:id/release', requireResourceAccess('task'), (req, res) => {
  const { expertId, runId, status, abgebrochenAm } = req.body;

  if (!expertId || !runId) {
    return res.status(400).json({ error: 'expertId und runId sind erforderlich' });
  }

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  if (aufgabe.executionRunId !== runId) {
    return res.status(409).json({ error: 'Task locked by another run' });
  }

  const updates: any = {
    executionLockedAt: null,
    executionRunId: null,
    updatedAt: now(),
  };

  if (status) updates.status = status;
  if (abgebrochenAm) updates.cancelledAt = abgebrochenAm;
  if (status === 'done') updates.completedAt = now();

  db.update(tasks).set(updates).where(eq(tasks.id, req.params.id as string)).run();

  const updated = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  res.json(updated);
});

// =============================================
// KOMMENTARE
// =============================================
router.get('/api/tasks/:id/comments', requireResourceAccess('task'), (req, res) => {
  const result = db.select().from(comments).where(eq(comments.taskId, req.params.id as string)).orderBy(comments.createdAt).all();
  res.json(result);
});

router.post('/api/tasks/:id/comments', requireResourceAccess('task'), (req, res) => {
  const inhalt = req.body.inhalt || req.body.content;
  const { authorAgentId, authorType } = req.body;
  if (!inhalt) return res.status(400).json({ error: 'Content required' });

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  const id = uuid();
  db.insert(comments).values({
    id,
    companyId: aufgabe.companyId,
    taskId: aufgabe.id,
    authorAgentId: authorAgentId || null,
    authorType: authorType || 'board',
    content: inhalt,
    createdAt: now(),
  }).run();

  const kommentar = db.select().from(comments).where(eq(comments.id, id)).get();
  res.status(201).json(kommentar);
});

// =============================================
// WORK PRODUCTS (per-task)
// =============================================
router.get('/api/tasks/:id/work-products', requireResourceAccess('task'), (req, res) => {
  const products = db.select().from(workProducts)
    .where(eq(workProducts.taskId, req.params.id as string))
    .orderBy(workProducts.createdAt)
    .all();
  res.json(products);
});

// =============================================
// TIMELINE — unified chronological timeline for a task
// =============================================
router.get('/api/tasks/:id/timeline', requireResourceAccess('task'), (req, res) => {
  const taskId = req.params.id;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  type TimelineEvent = {
    id: string;
    at: string;
    kind: string;
    title: string;
    actor?: string | null;
    runId?: string | null;
    data?: any;
  };
  const events: TimelineEvent[] = [];

  // Task lifecycle
  events.push({
    id: `task-created-${task.id}`,
    at: task.createdAt,
    kind: 'task_created',
    title: 'Task created',
    actor: task.createdBy || null,
    data: { titel: task.title, prioritaet: task.priority, typ: task.type },
  });
  if (task.startedAt) {
    events.push({ id: `task-started-${task.id}`, at: task.startedAt, kind: 'task_started', title: 'Task started', actor: task.assignedTo || null });
  }
  if (task.completedAt) {
    events.push({ id: `task-completed-${task.id}`, at: task.completedAt, kind: 'task_completed', title: 'Task completed', actor: task.assignedTo || null, data: { status: task.status } });
  }
  if (task.cancelledAt) {
    events.push({ id: `task-cancelled-${task.id}`, at: task.cancelledAt, kind: 'task_cancelled', title: 'Task cancelled' });
  }

  // Comments
  const commentRows = db.select().from(comments).where(eq(comments.taskId, taskId)).all();
  for (const c of commentRows) {
    events.push({
      id: `comment-${c.id}`,
      at: c.createdAt,
      kind: 'comment',
      title: c.authorType === 'agent' ? 'Agent output' : 'Comment',
      actor: c.authorAgentId || c.authorType,
      data: { inhalt: c.content, authorType: c.authorType },
    });
  }

  // Cost bookings (also source for runIds)
  const kb = db.select().from(costEntries).where(eq(costEntries.taskId, taskId)).all();
  for (const k of kb) {
    events.push({
      id: `cost-${k.id}`,
      at: k.timestamp || k.createdAt,
      kind: 'cost',
      title: `Cost: ${k.model}`,
      actor: k.agentId,
      data: { anbieter: k.provider, modell: k.model, inputTokens: k.inputTokens, outputTokens: k.outputTokens, kostenCent: k.costCent },
    });
  }

  // Work cycles for this task — match via context_snapshot (JSON) containing taskId/issueId
  const allRuns = db.select().from(workCycles)
    .where(eq(workCycles.companyId, task.companyId))
    .all();
  const runs = allRuns.filter(r => {
    if (!r.contextSnapshot) return false;
    try {
      const ctx = JSON.parse(r.contextSnapshot);
      return ctx.taskId === taskId || ctx.issueId === taskId;
    } catch { return false; }
  });
  const runIds = new Set<string>(runs.map(r => r.id));
  for (const r of runs) {
    if (r.startedAt) {
      events.push({
        id: `run-start-${r.id}`,
        at: r.startedAt,
        kind: 'run_started',
        title: 'Work cycle started',
        actor: r.agentId,
        runId: r.id,
        data: { quelle: r.source, invocationSource: r.invocationSource, triggerDetail: r.triggerDetail },
      });
    }
    if (r.endedAt) {
      let usage: any = null;
      try { usage = r.usageJson ? JSON.parse(r.usageJson) : null; } catch {}
      events.push({
        id: `run-end-${r.id}`,
        at: r.endedAt,
        kind: r.status === 'succeeded' ? 'run_succeeded' : 'run_failed',
        title: r.status === 'succeeded' ? 'Work cycle succeeded' : `Work cycle ${r.status}`,
        actor: r.agentId,
        runId: r.id,
        data: { status: r.status, exitCode: r.exitCode, fehler: r.error, usage, resultJson: r.resultJson },
      });
    }
  }

  // Trace events for these runs
  if (runIds.size > 0) {
    const traces = db.select().from(traceEvents)
      .where(inArray(traceEvents.runId, Array.from(runIds)))
      .all();
    for (const t of traces) {
      events.push({
        id: `trace-${t.id}`,
        at: t.createdAt,
        kind: `trace_${t.type}`,
        title: t.title,
        actor: t.agentId || null,
        runId: t.runId || null,
        data: t.details ? safeParse(t.details) : null,
      });
    }
  }

  // Approvals referencing this task
  const approvalRows = db.select().from(approvals)
    .where(eq(approvals.companyId, task.companyId))
    .all();
  for (const g of approvalRows) {
    let matches = false;
    try {
      if (g.payload) {
        const p = JSON.parse(g.payload);
        if (p.taskId === taskId || p.issueId === taskId) matches = true;
      }
    } catch {}
    if (!matches) continue;
    events.push({
      id: `approval-${g.id}`,
      at: g.createdAt,
      kind: 'approval_requested',
      title: `Approval requested: ${g.title}`,
      actor: g.requestedBy,
      data: { typ: g.type, status: g.status, beschreibung: g.description },
    });
    if (g.decidedAt) {
      events.push({
        id: `approval-decided-${g.id}`,
        at: g.decidedAt,
        kind: `approval_${g.status}`,
        title: `Approval ${g.status}`,
        data: { entscheidungsnotiz: g.decisionNote },
      });
    }
  }

  // Activity log for this task entity
  const logs = db.select().from(activityLog)
    .where(and(eq(activityLog.entityType, 'aufgabe'), eq(activityLog.entityId, taskId)))
    .all();
  for (const l of logs) {
    events.push({
      id: `log-${l.id}`,
      at: l.createdAt,
      kind: `log_${l.action}`,
      title: l.action,
      actor: l.actorName || l.actorId,
      data: l.details ? safeParse(l.details) : null,
    });
  }

  events.sort((a, b) => (a.at || '').localeCompare(b.at || ''));

  res.json({
    task: { id: task.id, titel: task.title, status: task.status, unternehmenId: task.companyId, zugewiesenAn: task.assignedTo },
    events,
    runs: runs.map(r => ({ id: r.id, status: r.status, gestartetAm: r.startedAt, beendetAm: r.endedAt })),
  });
});

export default router;

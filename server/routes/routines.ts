// =============================================================================
// Routines routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// Mounted at '/' (not at /api/routines) because endpoints span three URL
// prefixes: /api/companies/:id/routines, /api/routines/:id, /api/triggers/:id.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { eq, desc } from 'drizzle-orm';

import { db } from '../db/client.js';
import { routines, routineTrigger, routineRuns } from '../db/schema.js';
import { cronService } from '../services/cron.js';
import { wakeupService } from '../services/wakeup.js';
import { logAktivitaet } from '../services/activity-log.js';
import { requireCompanyAccess, requireResourceAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

// =============================================
// ROUTINEN (Autonomous Agents Phase 1)
// =============================================
router.get('/api/companies/:unternehmenId/routines', requireCompanyAccess(), (req, res) => {
  const result = db.select().from(routines)
    .where(eq(routines.companyId, req.params.unternehmenId))
    .all();
  res.json(result);
});

router.post('/api/companies/:unternehmenId/routines', requireCompanyAccess(), (req, res) => {
  const b = req.body as any;
  const titel = b.titel || b.title;
  const beschreibung = b.beschreibung || b.description;
  const { zugewiesenAn, prioritaet, variablen } = b;
  if (!titel) return res.status(400).json({ error: 'Title required' });

  const id = uuid();
  db.insert(routines).values({
    id,
    companyId: req.params.unternehmenId,
    title: titel,
    description: beschreibung,
    assignedTo: zugewiesenAn || null,
    priority: prioritaet || 'medium',
    status: 'active',
    variables: variablen ? JSON.stringify(variablen) : null,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const routine = db.select().from(routines).where(eq(routines.id, id)).get();
  logAktivitaet(req.params.unternehmenId, 'board', 'board', 'Board', `hat Routine „${titel}" erstellt`, 'routine', id);
  res.status(201).json(routine);
});

router.get('/api/routines/:id', requireResourceAccess('routine'), (req, res) => {
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  res.json(routine);
});

router.patch('/api/routines/:id', requireResourceAccess('routine'), (req, res) => {
  const updates: any = { updatedAt: now() };
  const allowed: [string, string][] = [
    ['titel', 'title'],
    ['beschreibung', 'description'],
    ['zugewiesenAn', 'assignedTo'],
    ['prioritaet', 'priority'],
    ['status', 'status'],
    ['variablen', 'variables'],
  ];
  for (const [bodyKey, dbKey] of allowed) {
    if (req.body[bodyKey] !== undefined) updates[dbKey] = req.body[bodyKey];
  }

  db.update(routines).set(updates).where(eq(routines.id, req.params.id as string)).run();
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  res.json(routine);
});

router.delete('/api/routines/:id', requireResourceAccess('routine'), (req, res) => {
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  db.delete(routines).where(eq(routines.id, req.params.id as string)).run();
  logAktivitaet(routine.companyId, 'board', 'board', 'Board', `hat Routine „${routine.title}" gelöscht`, 'routine', routine.id);
  res.json({ success: true });
});

// =============================================
// ROUTINE TRIGGER
// =============================================
router.get('/api/routines/:routineId/triggers', requireResourceAccess('routine', 'routineId'), (req, res) => {
  const result = db.select().from(routineTrigger)
    .where(eq(routineTrigger.routineId, req.params.routineId))
    .all();
  res.json(result);
});

router.post('/api/routines/:routineId/triggers', requireResourceAccess('routine', 'routineId'), (req, res) => {
  const { kind, cronExpression, timezone, aktiv } = req.body;
  if (!kind) return res.status(400).json({ error: 'Trigger type required' });
  if (kind === 'schedule' && !cronExpression) {
    return res.status(400).json({ error: 'Cron expression required' });
  }

  const routine = db.select().from(routines).where(eq(routines.id, req.params.routineId)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });

  const id = uuid();
  const publicId = kind === 'webhook' ? uuid() : null;
  const secretId = kind === 'webhook' ? uuid() : null;

  db.insert(routineTrigger).values({
    id,
    companyId: routine.companyId,
    routineId: req.params.routineId,
    kind,
    cronExpression: cronExpression || null,
    timezone: timezone || 'UTC',
    active: aktiv !== false,
    publicId,
    secretId,
    createdAt: now(),
  }).run();

  // Calculate next run time for schedule triggers
  if (kind === 'schedule' && cronExpression) {
    const nextRun = cronService.nextCronTick(cronExpression);
    if (nextRun) {
      db.update(routineTrigger).set({ nextExecutionAt: nextRun.toISOString() })
        .where(eq(routineTrigger.id, id)).run();
    }
  }

  const trigger = db.select().from(routineTrigger).where(eq(routineTrigger.id, id)).get();
  logAktivitaet(routine.companyId, 'board', 'board', 'Board', `hat Trigger für Routine „${routine.title}" erstellt`, 'routine_trigger', id);
  res.status(201).json(trigger);
});

router.patch('/api/triggers/:id', requireResourceAccess('trigger'), (req, res) => {
  const updates: any = { updatedAt: now() };
  const allowed: [string, string][] = [
    ['aktiv', 'active'],
    ['cronExpression', 'cronExpression'],
    ['timezone', 'timezone'],
  ];
  for (const [bodyKey, dbKey] of allowed) {
    if (req.body[bodyKey] !== undefined) updates[dbKey] = req.body[bodyKey];
  }

  const trigger = db.select().from(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).get();
  if (!trigger) return res.status(404).json({ error: 'Trigger not found' });

  // Recalculate next run time if cron expression changed
  if (updates.cronExpression && trigger.kind === 'schedule') {
    const nextRun = cronService.nextCronTick(updates.cronExpression);
    updates.nextExecutionAt = nextRun?.toISOString() || null;
  }

  db.update(routineTrigger).set(updates).where(eq(routineTrigger.id, req.params.id as string)).run();
  const updated = db.select().from(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).get();
  res.json(updated);
});

router.delete('/api/triggers/:id', requireResourceAccess('trigger'), (req, res) => {
  const trigger = db.select().from(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).get();
  if (!trigger) return res.status(404).json({ error: 'Trigger not found' });
  db.delete(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).run();
  res.json({ success: true });
});

// =============================================
// ROUTINE AUSFÜHRUNGEN
// =============================================
router.get('/api/routines/:routineId/ausfuehrungen', requireResourceAccess('routine', 'routineId'), (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const result = db.select().from(routineRuns)
    .where(eq(routineRuns.routineId, req.params.routineId))
    .orderBy(desc(routineRuns.createdAt))
    .limit(limit)
    .all();
  res.json(result);
});

router.post('/api/routines/:id/trigger', requireResourceAccess('routine'), (req, res) => {
  // Manual trigger for a routine
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });

  const executionId = uuid();
  db.insert(routineRuns).values({
    id: executionId,
    companyId: routine.companyId,
    routineId: req.params.id,
    source: 'manual',
    status: 'enqueued',
    payload: req.body.payload ? JSON.stringify(req.body.payload) : null,
    createdAt: now(),
  }).run();

  // Queue wakeup for assigned agent
  if (routine.assignedTo) {
    wakeupService.wakeup(routine.assignedTo, routine.companyId, {
      source: 'on_demand',
      triggerDetail: 'manual',
      reason: `Manuelle Ausführung: ${routine.title}`,
      payload: { routineId: req.params.id, executionId },
      contextSnapshot: { source: 'manual_routine_trigger', routineId: req.params.id, executionId },
    }).catch(console.error);
  }

  const execution = db.select().from(routineRuns).where(eq(routineRuns.id, executionId)).get();
  res.status(201).json(execution);
});

export default router;

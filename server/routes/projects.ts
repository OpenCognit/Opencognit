// =============================================================================
// Projects routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// Whiteboard endpoints (/api/projects/:id/whiteboard) stay in index.ts for
// now because they reach the WebSocket via the index-local broadcastUpdate.
// They'll move once that helper is converted to appEvents.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { eq, desc } from 'drizzle-orm';

import { db } from '../db/client.js';
import { projects, tasks } from '../db/schema.js';
import { logAktivitaet } from '../services/activity-log.js';
import { requireCompanyAccess, requireResourceAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

router.get('/api/companies/:unternehmenId/projects', requireCompanyAccess(), (req, res) => {
  const result = db.select().from(projects)
    .where(eq(projects.companyId, req.params.unternehmenId))
    .orderBy(desc(projects.createdAt))
    .all();
  res.json(result);
});

router.post('/api/companies/:unternehmenId/projects', requireCompanyAccess(), (req, res) => {
  const { name, beschreibung, prioritaet, zielId, eigentuemerId, farbe, deadline, workDir } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const unternehmenId = req.params.unternehmenId;
  const id = uuid();
  db.insert(projects).values({
    id, companyId: unternehmenId, name,
    description: beschreibung || null,
    priority: prioritaet || 'medium',
    goalId: zielId || null,
    ownerAgentId: eigentuemerId || null,
    color: farbe || '#23CDCB',
    deadline: deadline || null,
    workDir: workDir?.trim() || null,
    progress: 0,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const projekt = db.select().from(projects).where(eq(projects.id, id)).get();
  logAktivitaet(unternehmenId, 'board', 'board', 'Board', `hat Projekt „${name}" erstellt`, 'projekt', id);
  res.status(201).json(projekt);
});

router.get('/api/projects/:id', requireResourceAccess('project'), (req, res) => {
  const projekt = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });

  // Tasks for this project
  const projectTasks = db.select().from(tasks)
    .where(eq(tasks.projectId, req.params.id as string))
    .orderBy(desc(tasks.createdAt))
    .all();

  res.json({ ...projekt, tasks: projectTasks });
});

router.patch('/api/projects/:id', requireResourceAccess('project'), (req, res) => {
  const existing = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  const updates: any = { updatedAt: now() };
  const allowed = ['name', 'beschreibung', 'status', 'prioritaet', 'zielId', 'eigentuemerId', 'farbe', 'deadline', 'fortschritt', 'workDir'];
  const keyMap: Record<string, string> = {
    beschreibung: 'description', prioritaet: 'priority', zielId: 'goalId',
    eigentuemerId: 'ownerAgentId', farbe: 'color', fortschritt: 'progress',
  };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[keyMap[key] || key] = req.body[key];
    }
  }

  db.update(projects).set(updates).where(eq(projects.id, req.params.id as string)).run();
  res.json(db.select().from(projects).where(eq(projects.id, req.params.id as string)).get());
});

router.delete('/api/projects/:id', requireResourceAccess('project'), (req, res) => {
  const existing = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  // Tasks of this project: set projectId to null (don't delete tasks)
  db.update(tasks).set({ projectId: null, updatedAt: now() })
    .where(eq(tasks.projectId, req.params.id as string)).run();

  db.delete(projects).where(eq(projects.id, req.params.id as string)).run();
  logAktivitaet(existing.companyId, 'board', 'board', 'Board', `hat Projekt „${existing.name}" gelöscht`, 'projekt', req.params.id as string);
  res.json({ success: true });
});

// Recompute progress as % of done tasks
router.post('/api/projects/:id/fortschritt-aktualisieren', requireResourceAccess('project'), (req, res) => {
  const projekt = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });

  const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, req.params.id as string)).all();
  const total = projectTasks.length;
  const done = projectTasks.filter((t: any) => t.status === 'done').length;
  const fortschritt = total > 0 ? Math.round((done / total) * 100) : 0;

  db.update(projects).set({ progress: fortschritt, updatedAt: now() })
    .where(eq(projects.id, req.params.id as string)).run();

  res.json({ fortschritt, done, total });
});

export default router;

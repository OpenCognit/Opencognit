// =============================================================================
// Goals routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { eq, asc } from 'drizzle-orm';

import { db } from '../db/client.js';
import { goals } from '../db/schema.js';
import { logAktivitaet } from '../services/activity-log.js';
import { authMiddleware, requireCompanyAccess, requireResourceAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

router.get('/api/companies/:unternehmenId/goals', authMiddleware, requireCompanyAccess(), (req, res) => {
  const result = db.select().from(goals)
    .where(eq(goals.companyId, req.params.unternehmenId as string))
    .orderBy(asc(goals.createdAt))
    .all();
  res.json(result);
});

router.post('/api/companies/:unternehmenId/goals', authMiddleware, requireCompanyAccess(), (req, res) => {
  const uid = req.params.unternehmenId as string;
  const b = req.body as any;
  const titel = b.titel || b.title;
  const { ebene, parentId, status, fortschritt } = b;
  const beschreibung = b.beschreibung || b.description;
  if (!titel?.trim()) return res.status(400).json({ error: 'Title missing' });
  const id = uuid();
  const ts = now();
  db.insert(goals).values({
    id, companyId: uid,
    title: titel.trim(),
    description: beschreibung || null,
    level: (ebene || 'company') as any,
    parentId: parentId || null,
    status: (status || 'planned') as any,
    progress: Math.max(0, Math.min(100, Number(fortschritt ?? 0))),
    createdAt: ts, updatedAt: ts,
  }).run();
  logAktivitaet(uid, 'board', 'board', 'Board', `Ziel erstellt: "${titel.trim()}"`, 'companies', uid);
  res.status(201).json(db.select().from(goals).where(eq(goals.id, id)).get());
});

router.patch('/api/goals/:id', authMiddleware, requireResourceAccess('goal'), (req, res) => {
  const id = req.params.id as string;
  const goal = db.select().from(goals).where(eq(goals.id, id)).get() as any;
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { titel, beschreibung, status, ebene, fortschritt } = req.body;
  db.update(goals).set({
    ...(titel !== undefined ? { title: titel } : {}),
    ...(beschreibung !== undefined ? { description: beschreibung } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(ebene !== undefined ? { level: ebene } : {}),
    ...(fortschritt !== undefined ? { progress: Math.max(0, Math.min(100, Number(fortschritt))) } : {}),
    updatedAt: now(),
  }).where(eq(goals.id, id)).run();
  res.json(db.select().from(goals).where(eq(goals.id, id)).get());
});

router.delete('/api/goals/:id', authMiddleware, requireResourceAccess('goal'), (req, res) => {
  db.delete(goals).where(eq(goals.id, req.params.id as string)).run();
  res.json({ ok: true });
});

export default router;

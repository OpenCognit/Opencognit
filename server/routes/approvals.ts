// =============================================================================
// Approvals routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
// =============================================================================

import { Router } from 'express';
import { eq, desc } from 'drizzle-orm';

import { db } from '../db/client.js';
import { approvals } from '../db/schema.js';
import { scheduler } from '../scheduler.js';
import { logAktivitaet } from '../services/activity-log.js';
import { appEvents } from '../events.js';
import { requireCompanyAccess, requireResourceAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();
const broadcast = (type: string, data: any) => appEvents.emit('broadcast', { type, data });

router.get('/api/companies/:unternehmenId/approvals', requireCompanyAccess(), (req, res) => {
  const result = db.select().from(approvals).where(eq(approvals.companyId, req.params.unternehmenId)).orderBy(desc(approvals.createdAt)).all();
  // Parse payload JSON — tolerate malformed legacy rows so one bad row doesn't 500 the whole endpoint
  res.json(result.map((g: any) => {
    let parsedPayload: any = null;
    if (g.payload) {
      try { parsedPayload = JSON.parse(g.payload); }
      catch { parsedPayload = { _raw: g.payload, _parseError: true }; }
    }
    return { ...g, payload: parsedPayload };
  }));
});

router.post('/api/approvals/:id/approve', requireResourceAccess('approval'), async (req, res) => {
  const { notiz } = req.body;
  const genehm = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  if (!genehm) return res.status(404).json({ error: 'Approval not found' });
  if (genehm.status !== 'pending') return res.status(409).json({ error: 'Approval no longer pending' });

  // Special handling for agent action approvals: execute via scheduler
  if (genehm.type === 'agent_action' && genehm.payload) {
    try {
      const { action, params } = JSON.parse(genehm.payload);
      const expertId = genehm.requestedBy;
      if (expertId) {
        console.log(`🚀 Executing approved action: ${action} for agent ${expertId}`);
        // skipAutonomyCheck = true — user already approved
        await scheduler.executeAgentAction(genehm.companyId, expertId, action, params, true);
      }
    } catch (e) {
      console.error('Failed to execute approved agent action:', e);
      return res.status(500).json({ error: 'Action could not be executed' });
    }
  }

  db.update(approvals).set({
    status: 'approved',
    decisionNote: notiz || null,
    decidedAt: now(),
    updatedAt: now(),
  }).where(eq(approvals.id, req.params.id as string)).run();

  logAktivitaet(genehm.companyId, 'board', 'board', 'Board', `hat „${genehm.title}" genehmigt`, 'genehmigung', genehm.id);
  broadcast('approval_updated', { unternehmenId: genehm.companyId, id: genehm.id, status: 'approved' });
  const updated = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  res.json(updated);
});

router.post('/api/approvals/:id/reject', requireResourceAccess('approval'), (req, res) => {
  const { notiz } = req.body;
  const genehm = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  if (!genehm) return res.status(404).json({ error: 'Approval not found' });

  db.update(approvals).set({
    status: 'rejected',
    decisionNote: notiz || null,
    decidedAt: now(),
    updatedAt: now(),
  }).where(eq(approvals.id, req.params.id as string)).run();

  logAktivitaet(genehm.companyId, 'board', 'board', 'Board', `hat „${genehm.title}" abgelehnt`, 'genehmigung', genehm.id);
  broadcast('approval_updated', { unternehmenId: genehm.companyId, id: genehm.id, status: 'rejected' });
  const updated = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  res.json(updated);
});

export default router;

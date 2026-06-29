// =============================================================================
// Corrective Action Service — PR-HSE-4
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { hseCorrectiveActions } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const correctiveActionService = {
  createAction(params: {
    companyId: string; description: string; responsibleId: string;
    dueDate: string; priority?: string; createdBy: string;
    incidentId?: string; observationId?: string; inspectionId?: string;
  }) {
    return db.insert(hseCorrectiveActions).values({
      id: uuid(), companyId: params.companyId,
      description: params.description, responsibleId: params.responsibleId,
      dueDate: params.dueDate, priority: params.priority || 'medium',
      createdBy: params.createdBy,
      incidentId: params.incidentId || null,
      observationId: params.observationId || null,
      inspectionId: params.inspectionId || null,
    }).returning().get();
  },

  closeAction(actionId: string, evidence: string) {
    const now = new Date().toISOString();
    return db.update(hseCorrectiveActions)
      .set({ status: 'closed', closureEvidence: evidence, closedAt: now, updatedAt: now })
      .where(eq(hseCorrectiveActions.id, actionId)).returning().get();
  },

  verifyAction(actionId: string, verifiedBy: string) {
    const now = new Date().toISOString();
    return db.update(hseCorrectiveActions)
      .set({ status: 'verified', verifiedBy, verifiedAt: now, updatedAt: now })
      .where(eq(hseCorrectiveActions.id, actionId)).returning().get();
  },

  rejectAction(actionId: string) {
    return db.update(hseCorrectiveActions)
      .set({ status: 'open', closureEvidence: null, closedAt: null, verifiedBy: null,
        verifiedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(hseCorrectiveActions.id, actionId)).returning().get();
  },

  getIncidentActions(incidentId: string) {
    return db.select().from(hseCorrectiveActions)
      .where(eq(hseCorrectiveActions.incidentId, incidentId)).all();
  },

  getOpenActions(companyId: string) {
    return db.select().from(hseCorrectiveActions)
      .where(and(
        eq(hseCorrectiveActions.companyId, companyId),
        eq(hseCorrectiveActions.status, 'open'),
      )).orderBy(eq(hseCorrectiveActions.dueDate, '')).all();
  },

  findOverdueActions(companyId: string) {
    const now = new Date().toISOString();
    return db.select().from(hseCorrectiveActions)
      .where(eq(hseCorrectiveActions.companyId, companyId))
      .all()
      .filter(a => a.dueDate < now && a.status === 'open');
  },

  findUnverifiedActions(companyId: string) {
    return db.select().from(hseCorrectiveActions)
      .where(eq(hseCorrectiveActions.companyId, companyId))
      .all()
      .filter(a => a.status === 'closed');
  },
};

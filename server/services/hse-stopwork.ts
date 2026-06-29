// =============================================================================
// HSE Agent + Stop-Work Service — PR-HSE-5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { hseStopWorkOrders, hseInspections, hseReviews } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const stopWorkService = {
  issueStopWork(params: {
    companyId: string; reason: string; issuedBy: string;
    projectId?: string; workPackId?: string; activityId?: string; severity?: string;
  }) {
    return db.insert(hseStopWorkOrders).values({
      id: uuid(), companyId: params.companyId,
      reason: params.reason, issuedBy: params.issuedBy,
      projectId: params.projectId || null,
      workPackId: params.workPackId || null,
      activityId: params.activityId || null,
      severity: params.severity || 'high',
    }).returning().get();
  },

  resolveStopWork(stopWorkId: string, resolvedBy: string, resolution: string) {
    const now = new Date().toISOString();
    return db.update(hseStopWorkOrders)
      .set({ status: 'resolved', resolvedBy, resolution, resolvedAt: now, updatedAt: now })
      .where(eq(hseStopWorkOrders.id, stopWorkId)).returning().get();
  },

  getActiveStopWork(companyId: string) {
    return db.select().from(hseStopWorkOrders)
      .where(and(
        eq(hseStopWorkOrders.companyId, companyId),
        eq(hseStopWorkOrders.status, 'active'),
      )).all();
  },

  checkWorkPackStopWork(workPackId: string) {
    const orders = db.select().from(hseStopWorkOrders)
      .where(and(
        eq(hseStopWorkOrders.workPackId, workPackId),
        eq(hseStopWorkOrders.status, 'active'),
      )).all();
    return { blocked: orders.length > 0, orders };
  },
};

export const inspectionService = {
  recordInspection(params: {
    companyId: string; inspectionType: string; location: string;
    inspector: string; date: string; findings?: string;
    rating?: string; projectId?: string; workPackId?: string; activityId?: string;
  }) {
    return db.insert(hseInspections).values({
      id: uuid(), companyId: params.companyId,
      inspectionType: params.inspectionType, location: params.location,
      inspector: params.inspector, date: params.date,
      findings: params.findings || null, rating: params.rating || 'satisfactory',
      projectId: params.projectId || null,
      workPackId: params.workPackId || null,
      activityId: params.activityId || null,
    }).returning().get();
  },

  getRecentInspections(companyId: string, limit = 20) {
    return db.select().from(hseInspections)
      .where(eq(hseInspections.companyId, companyId))
      .orderBy(desc(hseInspections.date)).limit(limit).all();
  },
};

export const hseReviewService = {
  submitReview(params: {
    companyId: string; reviewedBy: string; decision: string;
    role?: string; comments?: string; recommendedActions?: string;
    incidentId?: string; permitId?: string; stopWorkId?: string;
  }) {
    return db.insert(hseReviews).values({
      id: uuid(), companyId: params.companyId,
      reviewedBy: params.reviewedBy, decision: params.decision,
      role: params.role || 'hse_officer',
      comments: params.comments || null,
      recommendedActions: params.recommendedActions || null,
      incidentId: params.incidentId || null,
      permitId: params.permitId || null,
      stopWorkId: params.stopWorkId || null,
      reviewedAt: new Date().toISOString(),
    }).returning().get();
  },

  getReviews(companyId: string) {
    return db.select().from(hseReviews)
      .where(eq(hseReviews.companyId, companyId))
      .orderBy(desc(hseReviews.createdAt)).all();
  },
};

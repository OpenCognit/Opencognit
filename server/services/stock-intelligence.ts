// =============================================================================
// Stock Intelligence Service — PR-STO-5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { stockAgentRecommendations, stockReviews, stockTransferRequests, stockItems } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export const stockIntelligenceService = {
  createRecommendation(params: {
    companyId: string; issue: string; severity?: string;
    stockItemId?: string; workPackId?: string; boqItemId?: string;
    evidence?: string; recommendedAction?: string; projectId?: string;
  }) {
    return db.insert(stockAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      issue: params.issue, severity: params.severity || 'medium',
      stockItemId: params.stockItemId || null,
      workPackId: params.workPackId || null,
      boqItemId: params.boqItemId || null,
      evidence: params.evidence || null,
      recommendedAction: params.recommendedAction || null,
      projectId: params.projectId || null,
    }).returning().get();
  },

  reviewRecommendation(recId: string, status: string) {
    const now = new Date().toISOString();
    return db.update(stockAgentRecommendations)
      .set({ status, reviewedAt: now, updatedAt: now })
      .where(eq(stockAgentRecommendations.id, recId)).returning().get();
  },

  getPendingRecommendations(companyId: string) {
    return db.select().from(stockAgentRecommendations)
      .where(eq(stockAgentRecommendations.companyId, companyId))
      .orderBy(desc(stockAgentRecommendations.detectedAt)).all();
  },

  // Reviews
  submitReview(params: {
    companyId: string; reviewedBy: string; decision: string;
    role?: string; comments?: string;
    recommendationId?: string; adjustmentId?: string; wastageId?: string;
  }) {
    return db.insert(stockReviews).values({
      id: uuid(), companyId: params.companyId,
      reviewedBy: params.reviewedBy, decision: params.decision,
      role: params.role || 'storekeeper',
      comments: params.comments || null,
      recommendationId: params.recommendationId || null,
      adjustmentId: params.adjustmentId || null,
      wastageId: params.wastageId || null,
      reviewedAt: new Date().toISOString(),
    }).returning().get();
  },

  // Transfers
  requestTransfer(params: {
    companyId: string; fromLocationId: string; toLocationId: string;
    stockItemId: string; materialName: string; unit: string;
    quantity: number; reason: string; requestedBy: string;
  }) {
    return db.insert(stockTransferRequests).values({
      id: uuid(), companyId: params.companyId,
      fromLocationId: params.fromLocationId,
      toLocationId: params.toLocationId,
      stockItemId: params.stockItemId,
      materialName: params.materialName, unit: params.unit,
      quantity: params.quantity, reason: params.reason,
      requestedBy: params.requestedBy,
    }).returning().get();
  },

  approveTransfer(transferId: string, approvedBy: string) {
    const now = new Date().toISOString();
    const tr = db.update(stockTransferRequests).set({
      status: 'approved', approvedBy, approvedAt: now, updatedAt: now,
    }).where(eq(stockTransferRequests.id, transferId)).returning().get();

    if (tr) {
      // Deduct from source
      const source = db.select().from(stockItems)
        .where(eq(stockItems.id, tr.stockItemId)).get();
      if (source) {
        db.update(stockItems).set({
          quantity: Math.max(0, source.quantity - tr.quantity),
          available: Math.max(0, source.available - tr.quantity),
          updatedAt: now,
        }).where(eq(stockItems.id, tr.stockItemId)).run();
      }
      // Add to destination (new stock item at target location)
      db.insert(stockItems).values({
        id: uuid(), companyId: tr.companyId,
        storeLocationId: tr.toLocationId,
        materialName: tr.materialName, unit: tr.unit,
        quantity: tr.quantity, reserved: 0, available: tr.quantity,
      }).run();
    }
    return tr;
  },

  getPendingTransfers(companyId: string) {
    return db.select().from(stockTransferRequests)
      .where(eq(stockTransferRequests.companyId, companyId)).all();
  },
};

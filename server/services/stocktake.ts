// =============================================================================
// Stocktake + Adjustment Service — PR-STO-4
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { stocktakeBatches, stocktakeLines, stockAdjustmentRequests, stockItems } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const stocktakeService = {
  createBatch(params: {
    companyId: string; storeLocationId: string; scheduledDate: string;
    countedBy: string; projectId?: string;
  }) {
    return db.insert(stocktakeBatches).values({
      id: uuid(), companyId: params.companyId,
      storeLocationId: params.storeLocationId,
      scheduledDate: params.scheduledDate,
      countedBy: params.countedBy,
      projectId: params.projectId || null,
    }).returning().get();
  },

  addLine(params: {
    batchId: string; stockItemId: string; materialName: string;
    unit: string; systemQty: number; countedQty: number;
    varianceReason?: string;
  }) {
    const variance = params.countedQty - params.systemQty;
    return db.insert(stocktakeLines).values({
      id: uuid(), batchId: params.batchId,
      stockItemId: params.stockItemId, materialName: params.materialName,
      unit: params.unit, systemQty: params.systemQty,
      countedQty: params.countedQty, varianceQty: variance,
      varianceReason: params.varianceReason || null,
    }).returning().get();
  },

  startBatch(batchId: string) {
    return db.update(stocktakeBatches)
      .set({ status: 'in_progress', updatedAt: new Date().toISOString() })
      .where(eq(stocktakeBatches.id, batchId)).returning().get();
  },

  completeBatch(batchId: string, verifiedBy: string) {
    const now = new Date().toISOString();
    return db.update(stocktakeBatches)
      .set({ status: 'completed', verifiedBy, updatedAt: now })
      .where(eq(stocktakeBatches.id, batchId)).returning().get();
  },

  getBatch(batchId: string) {
    const batch = db.select().from(stocktakeBatches)
      .where(eq(stocktakeBatches.id, batchId)).get();
    if (!batch) return null;
    const lines = db.select().from(stocktakeLines)
      .where(eq(stocktakeLines.batchId, batchId)).all();
    return { batch, lines };
  },

  getVarianceLines(batchId: string) {
    return db.select().from(stocktakeLines)
      .where(and(
        eq(stocktakeLines.batchId, batchId),
        eq(stocktakeLines.status, 'counted'),
      )).all()
      .filter(l => l.varianceQty !== 0);
  },
};

export const stockAdjustmentService = {
  requestAdjustment(params: {
    companyId: string; stockItemId: string; adjustmentQty: number;
    reason: string; reasonCategory?: string; requestedBy: string;
    stocktakeBatchId?: string; stocktakeLineId?: string;
  }) {
    return db.insert(stockAdjustmentRequests).values({
      id: uuid(), companyId: params.companyId,
      stockItemId: params.stockItemId,
      adjustmentQty: params.adjustmentQty,
      reason: params.reason,
      reasonCategory: params.reasonCategory || 'counting_error',
      requestedBy: params.requestedBy,
      stocktakeBatchId: params.stocktakeBatchId || null,
      stocktakeLineId: params.stocktakeLineId || null,
    }).returning().get();
  },

  approveAdjustment(adjustmentId: string, approvedBy: string) {
    const now = new Date().toISOString();
    const adj = db.update(stockAdjustmentRequests).set({
      status: 'approved', approvedBy, approvedAt: now, updatedAt: now,
    }).where(eq(stockAdjustmentRequests.id, adjustmentId)).returning().get();

    if (adj) {
      const stock = db.select().from(stockItems)
        .where(eq(stockItems.id, adj.stockItemId)).get();
      if (stock) {
        const newQty = stock.quantity + adj.adjustmentQty;
        db.update(stockItems).set({
          quantity: newQty, available: newQty - stock.reserved,
          lastStocktakeAt: now, updatedAt: now,
        }).where(eq(stockItems.id, adj.stockItemId)).run();
      }
    }
    return adj;
  },

  rejectAdjustment(adjustmentId: string) {
    return db.update(stockAdjustmentRequests)
      .set({ status: 'rejected', updatedAt: new Date().toISOString() })
      .where(eq(stockAdjustmentRequests.id, adjustmentId)).returning().get();
  },

  getPendingAdjustments(companyId: string) {
    return db.select().from(stockAdjustmentRequests)
      .where(and(
        eq(stockAdjustmentRequests.companyId, companyId),
        eq(stockAdjustmentRequests.status, 'pending'),
      )).all();
  },
};

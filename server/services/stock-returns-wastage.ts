// =============================================================================
// Returns + Wastage Service — PR-STO-3
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { materialReturns, materialWastageRecords, stockItems } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const stockReturnsService = {
  recordReturn(params: {
    companyId: string; stockItemId: string; materialName: string;
    unit: string; quantity: number; returnedTo: string; returnedBy: string;
    date: string; reason?: string; condition?: string;
    issueNoteId?: string; workPackId?: string;
  }) {
    // Restock
    const stock = db.select().from(stockItems)
      .where(eq(stockItems.id, params.stockItemId)).get();
    if (stock) {
      db.update(stockItems).set({
        quantity: stock.quantity + params.quantity,
        available: stock.available + params.quantity,
        updatedAt: new Date().toISOString(),
      }).where(eq(stockItems.id, params.stockItemId)).run();
    }

    return db.insert(materialReturns).values({
      id: uuid(), companyId: params.companyId,
      stockItemId: params.stockItemId, materialName: params.materialName,
      unit: params.unit, quantity: params.quantity,
      reason: params.reason || 'excess', condition: params.condition || 'good',
      returnedTo: params.returnedTo, returnedBy: params.returnedBy,
      date: params.date, issueNoteId: params.issueNoteId || null,
      workPackId: params.workPackId || null,
    }).returning().get();
  },

  getReturns(companyId: string) {
    return db.select().from(materialReturns)
      .where(eq(materialReturns.companyId, companyId)).all();
  },
};

export const wastageService = {
  recordWastage(params: {
    companyId: string; stockItemId: string; materialName: string;
    unit: string; quantity: number; wastageType: string; reason: string;
    reportedBy: string; valueKes?: number;
    workPackId?: string; boqItemId?: string; activityId?: string;
    foremanId?: string; evidence?: string; projectId?: string;
  }) {
    // Deduct from stock
    const stock = db.select().from(stockItems)
      .where(eq(stockItems.id, params.stockItemId)).get();
    if (stock) {
      db.update(stockItems).set({
        quantity: Math.max(0, stock.quantity - params.quantity),
        available: Math.max(0, stock.available - params.quantity),
        updatedAt: new Date().toISOString(),
      }).where(eq(stockItems.id, params.stockItemId)).run();
    }

    return db.insert(materialWastageRecords).values({
      id: uuid(), companyId: params.companyId,
      stockItemId: params.stockItemId, materialName: params.materialName,
      unit: params.unit, quantity: params.quantity,
      wastageType: params.wastageType, reason: params.reason,
      reportedBy: params.reportedBy,
      valueKes: params.valueKes || 0,
      workPackId: params.workPackId || null,
      boqItemId: params.boqItemId || null,
      activityId: params.activityId || null,
      foremanId: params.foremanId || null,
      evidence: params.evidence || null,
      projectId: params.projectId || null,
    }).returning().get();
  },

  approveForeman(wastageId: string) {
    const now = new Date().toISOString();
    const r = db.update(materialWastageRecords).set({
      approvedByForeman: 1, foremanApprovedAt: now, updatedAt: now,
    }).where(eq(materialWastageRecords.id, wastageId)).returning().get();

    if (r && r.approvedByPm) {
      db.update(materialWastageRecords).set({ status: 'approved' })
        .where(eq(materialWastageRecords.id, wastageId)).run();
    }
    return r;
  },

  approvePm(wastageId: string) {
    const now = new Date().toISOString();
    const r = db.update(materialWastageRecords).set({
      approvedByPm: 1, pmApprovedAt: now, updatedAt: now,
    }).where(eq(materialWastageRecords.id, wastageId)).returning().get();

    if (r && r.approvedByForeman) {
      db.update(materialWastageRecords).set({ status: 'approved' })
        .where(eq(materialWastageRecords.id, wastageId)).run();
    }
    return r;
  },

  getPendingWastage(companyId: string) {
    return db.select().from(materialWastageRecords)
      .where(and(
        eq(materialWastageRecords.companyId, companyId),
        eq(materialWastageRecords.status, 'pending'),
      )).all();
  },

  getWastageByType(companyId: string, wastageType: string) {
    return db.select().from(materialWastageRecords)
      .where(and(
        eq(materialWastageRecords.companyId, companyId),
        eq(materialWastageRecords.wastageType, wastageType),
      )).all();
  },
};

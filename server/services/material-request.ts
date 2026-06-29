// =============================================================================
// Material Request + Issue Service — PR-STO-2
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  materialRequests, materialRequestItems, materialIssueNotes,
  materialIssueItems, stockReservations, stockItems,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const materialRequestService = {
  createRequest(params: {
    companyId: string; requestedBy: string; date: string;
    projectId?: string; workPackId?: string; requestedFor?: string;
  }) {
    return db.insert(materialRequests).values({
      id: uuid(), companyId: params.companyId,
      requestedBy: params.requestedBy, date: params.date,
      projectId: params.projectId || null,
      workPackId: params.workPackId || null,
      requestedFor: params.requestedFor || null,
    }).returning().get();
  },

  addRequestItem(params: {
    requestId: string; materialName: string; unit: string;
    requestedQty: number; materialId?: string;
    boqItemId?: string; activityId?: string;
  }) {
    return db.insert(materialRequestItems).values({
      id: uuid(), requestId: params.requestId,
      materialName: params.materialName, unit: params.unit,
      requestedQty: params.requestedQty,
      materialId: params.materialId || null,
      boqItemId: params.boqItemId || null,
      activityId: params.activityId || null,
    }).returning().get();
  },

  approveRequest(requestId: string, approvedBy: string) {
    const now = new Date().toISOString();
    return db.update(materialRequests)
      .set({ status: 'approved', approvedBy, approvedAt: now, updatedAt: now })
      .where(eq(materialRequests.id, requestId)).returning().get();
  },

  getRequest(requestId: string) {
    const req = db.select().from(materialRequests)
      .where(eq(materialRequests.id, requestId)).get();
    if (!req) return null;
    const items = db.select().from(materialRequestItems)
      .where(eq(materialRequestItems.requestId, requestId)).all();
    return { request: req, items };
  },

  // Issue material
  issueMaterials(params: {
    companyId: string; requestId?: string; workPackId?: string;
    storeLocationId: string; issuedTo: string; issuedBy: string;
    date: string;
    items: {
      stockItemId: string; materialName: string; unit: string;
      quantity: number; requestItemId?: string;
      boqItemId?: string; activityId?: string;
    }[];
  }) {
    const noteId = uuid();
    db.insert(materialIssueNotes).values({
      id: noteId, companyId: params.companyId,
      requestId: params.requestId || null,
      workPackId: params.workPackId || null,
      storeLocationId: params.storeLocationId,
      issuedTo: params.issuedTo, issuedBy: params.issuedBy,
      date: params.date,
    }).run();

    for (const item of params.items) {
      db.insert(materialIssueItems).values({
        id: uuid(), issueNoteId: noteId,
        stockItemId: item.stockItemId,
        materialName: item.materialName, unit: item.unit,
        quantity: item.quantity,
        requestItemId: item.requestItemId || null,
        boqItemId: item.boqItemId || null,
        activityId: item.activityId || null,
      }).run();

      // Update stock and post ledger transaction
      const stock = db.select().from(stockItems)
        .where(eq(stockItems.id, item.stockItemId)).get();
      if (stock) {
        const newQty = stock.quantity - item.quantity;
        const newAvail = stock.available - item.quantity;
        db.update(stockItems).set({
          quantity: newQty, available: newAvail,
          updatedAt: new Date().toISOString(),
        }).where(eq(stockItems.id, item.stockItemId)).run();
      }
    }

    // Mark request items as fulfilled
    if (params.requestId) {
      for (const item of params.items) {
        if (item.requestItemId) {
          const ri = db.select().from(materialRequestItems)
            .where(eq(materialRequestItems.id, item.requestItemId)).get();
          if (ri) {
            db.update(materialRequestItems).set({
              issuedQty: ri.issuedQty + item.quantity,
              status: ri.issuedQty + item.quantity >= ri.requestedQty ? 'fulfilled' : 'partial',
            }).where(eq(materialRequestItems.id, item.requestItemId)).run();
          }
        }
      }
    }

    return db.select().from(materialIssueNotes).where(eq(materialIssueNotes.id, noteId)).get();
  },

  getIssueNote(issueNoteId: string) {
    const note = db.select().from(materialIssueNotes)
      .where(eq(materialIssueNotes.id, issueNoteId)).get();
    if (!note) return null;
    const items = db.select().from(materialIssueItems)
      .where(eq(materialIssueItems.issueNoteId, issueNoteId)).all();
    return { note, items };
  },

  // Stock reservations
  reserveStock(stockItemId: string, quantity: number, workPackId?: string, requestItemId?: string) {
    const stock = db.select().from(stockItems)
      .where(eq(stockItems.id, stockItemId)).get();
    if (!stock || stock.available < quantity) {
      return { error: 'Insufficient available stock' };
    }

    db.update(stockItems).set({
      reserved: stock.reserved + quantity,
      available: stock.available - quantity,
      updatedAt: new Date().toISOString(),
    }).where(eq(stockItems.id, stockItemId)).run();

    return db.insert(stockReservations).values({
      id: uuid(), stockItemId, quantity,
      workPackId: workPackId || null,
      requestItemId: requestItemId || null,
    }).returning().get();
  },

  releaseReservation(reservationId: string) {
    const res = db.select().from(stockReservations)
      .where(eq(stockReservations.id, reservationId)).get();
    if (!res || res.status !== 'active') return null;

    const stock = db.select().from(stockItems)
      .where(eq(stockItems.id, res.stockItemId)).get();
    if (stock) {
      db.update(stockItems).set({
        reserved: Math.max(0, stock.reserved - res.quantity),
        available: stock.available + res.quantity,
        updatedAt: new Date().toISOString(),
      }).where(eq(stockItems.id, res.stockItemId)).run();
    }

    return db.update(stockReservations)
      .set({ status: 'released', releasedAt: new Date().toISOString() })
      .where(eq(stockReservations.id, reservationId)).returning().get();
  },
};

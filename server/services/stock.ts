// =============================================================================
// Stock Ledger Service — PR-STO-1
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { storeLocations, stockItems, stockLedgerTransactions } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const stockService = {
  // Store locations
  createStoreLocation(params: {
    companyId: string; name: string; locationType?: string;
    description?: string; projectId?: string;
  }) {
    return db.insert(storeLocations).values({
      id: uuid(), companyId: params.companyId, name: params.name,
      locationType: params.locationType || 'main_store',
      description: params.description || null,
      projectId: params.projectId || null,
    }).returning().get();
  },

  getStoreLocations(companyId: string) {
    return db.select().from(storeLocations)
      .where(eq(storeLocations.companyId, companyId)).all();
  },

  // Stock items
  postStock(params: {
    companyId: string; storeLocationId: string; materialName: string;
    unit: string; quantity: number; materialId?: string;
    minLevel?: number; reorderLevel?: number;
    batchNumber?: string; expiryDate?: string;
    projectId?: string;
  }) {
    return db.insert(stockItems).values({
      id: uuid(), companyId: params.companyId,
      storeLocationId: params.storeLocationId,
      materialId: params.materialId || null,
      materialName: params.materialName, unit: params.unit,
      quantity: params.quantity, reserved: 0,
      available: params.quantity,
      minLevel: params.minLevel ?? null,
      reorderLevel: params.reorderLevel ?? null,
      batchNumber: params.batchNumber || null,
      expiryDate: params.expiryDate || null,
      projectId: params.projectId || null,
    }).returning().get();
  },

  getStockItem(stockItemId: string) {
    return db.select().from(stockItems)
      .where(eq(stockItems.id, stockItemId)).get();
  },

  getStoreStock(storeLocationId: string) {
    return db.select().from(stockItems)
      .where(eq(stockItems.storeLocationId, storeLocationId)).all();
  },

  getLowStock(companyId: string) {
    return db.select().from(stockItems)
      .where(eq(stockItems.companyId, companyId))
      .all()
      .filter(s => s.reorderLevel && s.available <= s.reorderLevel);
  },

  // Stock ledger
  postTransaction(params: {
    companyId: string; stockItemId: string; transactionType: string;
    quantity: number; referenceId?: string; referenceType?: string;
    activityId?: string; workPackId?: string; boqItemId?: string;
    userId?: string; fromLocation?: string; toLocation?: string;
    description?: string; createdBy: string;
  }) {
    const item = db.select().from(stockItems)
      .where(eq(stockItems.id, params.stockItemId)).get();
    if (!item) throw new Error('Stock item not found');

    const balance = item.quantity + params.quantity;

    // Update stock item balance
    db.update(stockItems).set({
      quantity: balance, available: balance - item.reserved,
      updatedAt: new Date().toISOString(),
    }).where(eq(stockItems.id, params.stockItemId)).run();

    return db.insert(stockLedgerTransactions).values({
      id: uuid(), companyId: params.companyId,
      stockItemId: params.stockItemId,
      transactionType: params.transactionType,
      quantity: params.quantity, balanceAfter: balance,
      referenceId: params.referenceId || null,
      referenceType: params.referenceType || null,
      activityId: params.activityId || null,
      workPackId: params.workPackId || null,
      boqItemId: params.boqItemId || null,
      userId: params.userId || null,
      fromLocation: params.fromLocation || null,
      toLocation: params.toLocation || null,
      description: params.description || null,
      createdBy: params.createdBy,
    }).returning().get();
  },

  // GRN-to-stock posting
  postGrnReceipt(params: {
    companyId: string; storeLocationId: string; materialName: string;
    unit: string; quantity: number; grnId: string;
    createdBy: string; projectId?: string;
  }) {
    const item = db.select().from(stockItems)
      .where(and(
        eq(stockItems.storeLocationId, params.storeLocationId),
        eq(stockItems.materialName, params.materialName),
      )).get();

    const stockItemId = item ? item.id : this.postStock({
      companyId: params.companyId,
      storeLocationId: params.storeLocationId,
      materialName: params.materialName,
      unit: params.unit, quantity: 0,
      projectId: params.projectId,
    }).id;

    return this.postTransaction({
      companyId: params.companyId, stockItemId,
      transactionType: 'grn_receipt', quantity: params.quantity,
      referenceId: params.grnId, referenceType: 'grn',
      createdBy: params.createdBy,
    });
  },

  getLedger(stockItemId: string, limit = 50) {
    return db.select().from(stockLedgerTransactions)
      .where(eq(stockLedgerTransactions.stockItemId, stockItemId))
      .limit(limit).all();
  },
};

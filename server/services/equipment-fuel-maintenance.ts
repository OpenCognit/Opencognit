// =============================================================================
// Equipment Fuel + Maintenance + Intelligence Service — PR-EQP-3+4+5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  fuelStores, fuelIssues, fuelReconciliations, equipmentAssets,
  equipmentMaintenanceSchedules, equipmentMaintenanceRecords,
  equipmentBreakdowns, equipmentReviews,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---- Fuel ----
export const fuelService = {
  createFuelStore(params: {
    companyId: string; name: string; location: string;
    fuelType?: string; capacity?: number; minLevel?: number; projectId?: string;
  }) {
    return db.insert(fuelStores).values({
      id: uuid(), companyId: params.companyId, name: params.name,
      location: params.location, fuelType: params.fuelType || 'diesel',
      capacity: params.capacity ?? null, minLevel: params.minLevel ?? null,
      projectId: params.projectId || null,
    }).returning().get();
  },

  issueFuel(params: {
    companyId: string; fuelStoreId: string; equipmentId: string;
    quantity: number; issuedBy: string; receivedBy: string; date: string;
    operatorId?: string; workPackId?: string; meterBefore?: number;
  }) {
    // Deduct from fuel store
    const store = db.select().from(fuelStores).where(eq(fuelStores.id, params.fuelStoreId)).get();
    if (store) {
      db.update(fuelStores)
        .set({ currentStock: Math.max(0, store.currentStock - params.quantity), updatedAt: new Date().toISOString() })
        .where(eq(fuelStores.id, params.fuelStoreId)).run();
    }

    return db.insert(fuelIssues).values({
      id: uuid(), companyId: params.companyId,
      fuelStoreId: params.fuelStoreId, equipmentId: params.equipmentId,
      quantity: params.quantity, issuedBy: params.issuedBy,
      receivedBy: params.receivedBy, date: params.date,
      operatorId: params.operatorId || null,
      workPackId: params.workPackId || null,
      meterBefore: params.meterBefore ?? null,
    }).returning().get();
  },

  getFuelIssues(equipmentId: string) {
    return db.select().from(fuelIssues)
      .where(eq(fuelIssues.equipmentId, equipmentId))
      .orderBy(desc(fuelIssues.date)).all();
  },

  reconcile(params: {
    companyId: string; fuelStoreId: string; date: string;
    openingStock: number; received: number; issued: number;
    actualClosing: number; reconciledBy: string; explanation?: string;
  }) {
    const expected = params.openingStock + params.received - params.issued;
    const variance = params.actualClosing - expected;

    // Update store stock
    db.update(fuelStores)
      .set({ currentStock: params.actualClosing, updatedAt: new Date().toISOString() })
      .where(eq(fuelStores.id, params.fuelStoreId)).run();

    return db.insert(fuelReconciliations).values({
      id: uuid(), companyId: params.companyId,
      fuelStoreId: params.fuelStoreId, date: params.date,
      openingStock: params.openingStock, received: params.received,
      issued: params.issued, expectedClosing: expected,
      actualClosing: params.actualClosing, variance,
      reconciledBy: params.reconciledBy,
      explanation: params.explanation || null,
    }).returning().get();
  },
};

// ---- Maintenance ----
export const maintenanceService = {
  setSchedule(params: {
    equipmentId: string; serviceType?: string;
    intervalHours?: number; intervalDays?: number;
  }) {
    return db.insert(equipmentMaintenanceSchedules).values({
      id: uuid(), equipmentId: params.equipmentId,
      serviceType: params.serviceType || 'routine',
      intervalHours: params.intervalHours ?? null,
      intervalDays: params.intervalDays ?? null,
    }).returning().get();
  },

  recordService(params: {
    equipmentId: string; serviceType: string; date: string;
    servicedBy: string; meterAt?: number; description?: string;
    partsUsed?: string; costKes?: number; scheduleId?: string;
    nextServiceRecommendation?: string;
  }) {
    const rec = db.insert(equipmentMaintenanceRecords).values({
      id: uuid(), equipmentId: params.equipmentId,
      serviceType: params.serviceType, date: params.date,
      servicedBy: params.servicedBy,
      meterAt: params.meterAt ?? null,
      description: params.description || null,
      partsUsed: params.partsUsed || null,
      costKes: params.costKes || 0,
      scheduleId: params.scheduleId || null,
      nextServiceRecommendation: params.nextServiceRecommendation || null,
    }).returning().get();

    // Update equipment last_maintenance_at and next if schedule exists
    const now = new Date().toISOString();
    db.update(equipmentAssets).set({
      lastMaintenanceAt: params.date, updatedAt: now,
    }).where(eq(equipmentAssets.id, params.equipmentId)).run();

    return rec;
  },

  getMaintenanceRecords(equipmentId: string) {
    return db.select().from(equipmentMaintenanceRecords)
      .where(eq(equipmentMaintenanceRecords.equipmentId, equipmentId))
      .orderBy(desc(equipmentMaintenanceRecords.date)).all();
  },

  findOverdueMaintenance(companyId: string) {
    const assets = db.select().from(equipmentAssets)
      .where(eq(equipmentAssets.companyId, companyId)).all();
    return assets.filter(a => {
      if (!a.nextMaintenanceAt) return false;
      return a.nextMaintenanceAt < new Date().toISOString();
    });
  },
};

// ---- Breakdowns + Reviews ----
export const breakdownService = {
  reportBreakdown(params: {
    companyId: string; equipmentId: string; faultDescription: string;
    reportedBy: string; severity?: string; projectId?: string;
    operatorId?: string; equipmentStopped?: boolean;
  }) {
    // Update equipment status
    db.update(equipmentAssets)
      .set({ status: 'broken_down', updatedAt: new Date().toISOString() })
      .where(eq(equipmentAssets.id, params.equipmentId)).run();

    return db.insert(equipmentBreakdowns).values({
      id: uuid(), companyId: params.companyId,
      equipmentId: params.equipmentId,
      faultDescription: params.faultDescription,
      reportedBy: params.reportedBy,
      severity: params.severity || 'medium',
      projectId: params.projectId || null,
      operatorId: params.operatorId || null,
      equipmentStopped: params.equipmentStopped !== false ? 1 : 0,
    }).returning().get();
  },

  resolveBreakdown(breakdownId: string, params: {
    repairAction?: string; partsUsed?: string; costKes?: number;
    downtimeHours?: number; returnedBy: string;
  }) {
    const now = new Date().toISOString();
    const bd = db.update(equipmentBreakdowns).set({
      repairAction: params.repairAction || null,
      partsUsed: params.partsUsed || null,
      costKes: params.costKes || 0,
      downtimeHours: params.downtimeHours ?? null,
      returnedToServiceAt: now, returnedBy: params.returnedBy,
      status: 'resolved', updatedAt: now,
    }).where(eq(equipmentBreakdowns.id, breakdownId)).returning().get();

    if (bd) {
      db.update(equipmentAssets)
        .set({ status: 'available', updatedAt: now })
        .where(eq(equipmentAssets.id, bd.equipmentId)).run();
    }
    return bd;
  },

  getBreakdowns(equipmentId: string) {
    return db.select().from(equipmentBreakdowns)
      .where(eq(equipmentBreakdowns.equipmentId, equipmentId))
      .orderBy(desc(equipmentBreakdowns.reportedAt)).all();
  },
};

export const equipmentReviewService = {
  submitReview(params: {
    companyId: string; reviewedBy: string; decision: string;
    role?: string; comments?: string;
    recommendationId?: string; breakdownId?: string;
  }) {
    return db.insert(equipmentReviews).values({
      id: uuid(), companyId: params.companyId,
      reviewedBy: params.reviewedBy, decision: params.decision,
      role: params.role || 'plant_manager',
      comments: params.comments || null,
      recommendationId: params.recommendationId || null,
      breakdownId: params.breakdownId || null,
      reviewedAt: new Date().toISOString(),
    }).returning().get();
  },
};

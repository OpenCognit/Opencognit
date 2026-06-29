// =============================================================================
// Equipment Service — PR-EQP-1 Equipment Register + Allocation
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  equipmentAssets, equipmentAllocations, equipmentOperatorAssignments,
  equipmentAgentRecommendations, equipmentCategories,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const equipmentService = {
  registerAsset(params: {
    companyId: string; categoryId: string; assetCode: string;
    make?: string; model?: string; year?: number;
    serialNumber?: string; ownership?: string;
    hireRatePerDay?: number; baseLocation?: string;
  }) {
    return db.insert(equipmentAssets).values({
      id: uuid(), companyId: params.companyId,
      categoryId: params.categoryId, assetCode: params.assetCode,
      make: params.make || null, model: params.model || null,
      year: params.year ?? null, serialNumber: params.serialNumber || null,
      ownership: params.ownership || 'owned',
      hireRatePerDay: params.hireRatePerDay ?? null,
      baseLocation: params.baseLocation || null,
    }).returning().get();
  },

  getAsset(equipmentId: string) {
    const asset = db.select().from(equipmentAssets)
      .where(eq(equipmentAssets.id, equipmentId)).get();
    if (!asset) return null;

    const alloc = db.select().from(equipmentAllocations)
      .where(and(
        eq(equipmentAllocations.equipmentId, equipmentId),
        eq(equipmentAllocations.status, 'active'),
      )).limit(1).all();

    const op = db.select().from(equipmentOperatorAssignments)
      .where(and(
        eq(equipmentOperatorAssignments.equipmentId, equipmentId),
        eq(equipmentOperatorAssignments.status, 'active'),
      )).limit(1).all();

    return { asset, allocation: alloc[0] || null, operator: op[0] || null };
  },

  allocateToProject(params: {
    companyId: string; equipmentId: string; projectId: string;
    workPackId?: string; createdBy: string;
  }) {
    db.update(equipmentAssets)
      .set({ status: 'allocated', updatedAt: new Date().toISOString() })
      .where(eq(equipmentAssets.id, params.equipmentId)).run();

    return db.insert(equipmentAllocations).values({
      id: uuid(), companyId: params.companyId,
      equipmentId: params.equipmentId,
      projectId: params.projectId,
      workPackId: params.workPackId || null,
      createdBy: params.createdBy,
    }).returning().get();
  },

  releaseFromProject(allocationId: string) {
    const now = new Date().toISOString();
    const alloc = db.update(equipmentAllocations)
      .set({ status: 'released', releasedAt: now })
      .where(eq(equipmentAllocations.id, allocationId)).returning().get();
    if (alloc) {
      db.update(equipmentAssets)
        .set({ status: 'available', updatedAt: now })
        .where(eq(equipmentAssets.id, alloc.equipmentId)).run();
    }
    return alloc;
  },

  assignOperator(equipmentId: string, operatorId: string, createdBy: string) {
    return db.insert(equipmentOperatorAssignments).values({
      id: uuid(), equipmentId, operatorId, createdBy,
    }).returning().get();
  },

  releaseOperator(assignmentId: string) {
    return db.update(equipmentOperatorAssignments)
      .set({ status: 'released', releasedAt: new Date().toISOString() })
      .where(eq(equipmentOperatorAssignments.id, assignmentId)).returning().get();
  },

  getProjectEquipment(projectId: string) {
    return db.select().from(equipmentAllocations)
      .where(and(
        eq(equipmentAllocations.projectId, projectId),
        eq(equipmentAllocations.status, 'active'),
      )).all();
  },

  getIdleEquipment(companyId: string) {
    return db.select().from(equipmentAssets)
      .where(and(
        eq(equipmentAssets.companyId, companyId),
        eq(equipmentAssets.status, 'available'),
      )).all();
  },

  createRecommendation(params: {
    companyId: string; issue: string; severity?: string;
    equipmentId?: string; projectId?: string;
    evidence?: string; recommendedAction?: string;
  }) {
    return db.insert(equipmentAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      issue: params.issue, severity: params.severity || 'medium',
      equipmentId: params.equipmentId || null,
      projectId: params.projectId || null,
      evidence: params.evidence || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },
};

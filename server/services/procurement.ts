// =============================================================================
// Procurement Service — PR-PRO-1 Purchase Requisition + Budget Check Backbone
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  purchaseRequisitions, purchaseRequisitionItems,
  procurementAgentRecommendations,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const prService = {
  createPR(params: {
    companyId: string; projectId: string; requesterId: string;
    requiredDate: string; reason: string;
    procurementType?: string; priority?: string;
    costCodeId?: string; dailyWorkPackId?: string;
    prNumber?: string; estimatedTotalCost?: number;
  }) {
    const now = new Date().toISOString();
    return db.insert(purchaseRequisitions).values({
      id: uuid(),
      companyId: params.companyId,
      projectId: params.projectId,
      requesterId: params.requesterId,
      requiredDate: params.requiredDate,
      reason: params.reason,
      procurementType: params.procurementType || 'material',
      priority: params.priority || 'normal',
      costCodeId: params.costCodeId || null,
      dailyWorkPackId: params.dailyWorkPackId || null,
      prNumber: params.prNumber || null,
      estimatedTotalCost: params.estimatedTotalCost || 0,
      createdAt: now, updatedAt: now,
    }).returning().get();
  },

  addPRItem(params: {
    prId: string; itemName: string; quantity: number;
    itemType?: string; boqItemId?: string; activityId?: string;
    unit?: string; estimatedUnitCost?: number;
    estimatedTotalCost?: number; specification?: string;
  }) {
    return db.insert(purchaseRequisitionItems).values({
      id: uuid(),
      prId: params.prId,
      itemName: params.itemName,
      quantity: params.quantity,
      itemType: params.itemType || 'material',
      boqItemId: params.boqItemId || null,
      activityId: params.activityId || null,
      unit: params.unit || 'No.',
      estimatedUnitCost: params.estimatedUnitCost ?? null,
      estimatedTotalCost: params.estimatedTotalCost || (params.quantity * (params.estimatedUnitCost || 0)),
      specification: params.specification || null,
    }).returning().get();
  },

  submitPR(prId: string) {
    return db.update(purchaseRequisitions).set({
      status: 'submitted', updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  approvePR(prId: string, approvedBy: string) {
    return db.update(purchaseRequisitions).set({
      status: 'approved', approvedBy,
      approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  rejectPR(prId: string, rejectedBy: string, reason: string) {
    return db.update(purchaseRequisitions).set({
      status: 'rejected', rejectedBy, rejectionReason: reason,
      rejectedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  advanceToRfq(prId: string) {
    return db.update(purchaseRequisitions).set({
      status: 'rfq_in_progress', updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  markPoCreated(prId: string) {
    return db.update(purchaseRequisitions).set({
      status: 'po_created', updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  setStockCheckResult(prId: string, result: string) {
    return db.update(purchaseRequisitions).set({
      stockCheckResult: result, updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  setBudgetCheckResult(prId: string, result: string) {
    return db.update(purchaseRequisitions).set({
      budgetCheckResult: result, updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequisitions.id, prId)).returning().get();
  },

  getPRWithItems(prId: string) {
    const pr = db.select().from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, prId)).get();
    if (!pr) return null;
    const items = db.select().from(purchaseRequisitionItems)
      .where(eq(purchaseRequisitionItems.prId, prId)).all();
    return { ...pr, items };
  },

  listPRsByProject(projectId: string) {
    return db.select().from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.projectId, projectId))
      .orderBy(desc(purchaseRequisitions.createdAt)).all();
  },

  listPRsByStatus(projectId: string, status: string) {
    return db.select().from(purchaseRequisitions)
      .where(and(
        eq(purchaseRequisitions.projectId, projectId),
        eq(purchaseRequisitions.status, status),
      )).orderBy(desc(purchaseRequisitions.createdAt)).all();
  },
};

export const procurementAgentService = {
  createRecommendation(params: {
    companyId: string; issue: string; recommendedAction: string;
    prId?: string; poId?: string; vendorId?: string;
    evidence?: string; riskLevel?: string; owner?: string;
  }) {
    return db.insert(procurementAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      issue: params.issue, recommendedAction: params.recommendedAction,
      prId: params.prId || null, poId: params.poId || null,
      vendorId: params.vendorId || null,
      evidence: params.evidence || null,
      riskLevel: params.riskLevel || 'medium',
      owner: params.owner || null,
    }).returning().get();
  },

  reviewRecommendation(recId: string) {
    return db.update(procurementAgentRecommendations).set({
      status: 'reviewed', reviewedAt: new Date().toISOString(),
    }).where(eq(procurementAgentRecommendations.id, recId)).returning().get();
  },

  getPRRecommendations(prId: string) {
    return db.select().from(procurementAgentRecommendations)
      .where(eq(procurementAgentRecommendations.prId, prId)).all();
  },

  getPendingRecommendations(companyId: string) {
    return db.select().from(procurementAgentRecommendations)
      .where(and(
        eq(procurementAgentRecommendations.companyId, companyId),
        eq(procurementAgentRecommendations.status, 'pending_review'),
      )).all();
  },
};

export const procurementBudgetStockAgent = {
  checkStockBeforePurchase(params: {
    projectId: string; itemName: string; quantity: number;
  }) {
    const result = {
      storeAvailable: 0,
      otherProjectAvailable: 0,
      pendingPoQuantity: 0,
      shortfall: params.quantity,
      recommendedActions: [] as string[],
      riskLevel: 'low' as string,
    };

    if (params.quantity > 0) {
      result.recommendedActions.push(
        `Create purchase requisition for ${params.quantity} ${params.itemName}`,
      );
    }

    return result;
  },

  checkBudget(params: {
    estimatedTotalCost: number; boqBudgetLine?: number;
  }) {
    const result = {
      withinBudget: true,
      variancePct: 0,
      riskLevel: 'low' as string,
      recommendation: '',
    };

    if (params.boqBudgetLine && params.estimatedTotalCost > params.boqBudgetLine) {
      result.withinBudget = false;
      result.variancePct = ((params.estimatedTotalCost - params.boqBudgetLine) / params.boqBudgetLine) * 100;
      result.riskLevel = result.variancePct > 15 ? 'critical' : result.variancePct > 5 ? 'medium' : 'low';
      result.recommendation = `PR exceeds BOQ allowance by ${result.variancePct.toFixed(1)}%. Hold for QS review before RFQ.`;
    }

    return result;
  },
};

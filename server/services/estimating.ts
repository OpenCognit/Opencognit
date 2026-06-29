// =============================================================================
// Estimating Service — PR-EST-1 Estimate Register + BOQ Import
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { estimates, estimateVersions, estimateBoqItems, estimateAgentRecommendations } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CreateEstimateParams {
  companyId: string;
  projectId?: string;
  name: string;
  referenceCode?: string;
  marginPct?: number;
  overheadPct?: number;
  createdBy: string;
}

export interface AddBoqItemParams {
  estimateId: string;
  versionId: string;
  itemCode?: string;
  description: string;
  unit: string;
  quantity: number;
  rate?: number;
  quantitySource?: string;
  rateSource?: string;
  sortOrder?: number;
}

export interface AgentRecParams {
  estimateId: string;
  companyId: string;
  agentId?: string;
  issue: string;
  severity?: string;
  affectedItemId?: string;
  evidence?: string;
  recommendedAction?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const estimatingService = {
  createEstimate(params: CreateEstimateParams) {
    const estimateId = uuid();
    const versionId = uuid();

    db.insert(estimates).values({
      id: estimateId,
      companyId: params.companyId,
      projectId: params.projectId || null,
      name: params.name,
      referenceCode: params.referenceCode || null,
      marginPct: params.marginPct ?? null,
      overheadPct: params.overheadPct ?? null,
      createdBy: params.createdBy,
    }).run();

    db.insert(estimateVersions).values({
      id: versionId,
      estimateId,
      createdBy: params.createdBy,
    }).run();

    return this.getEstimate(estimateId);
  },

  getEstimate(estimateId: string) {
    const est = db.select().from(estimates).where(eq(estimates.id, estimateId)).get();
    if (!est) return null;

    const versions = db.select().from(estimateVersions)
      .where(eq(estimateVersions.estimateId, estimateId))
      .orderBy(desc(estimateVersions.versionNumber)).all();

    const items = db.select().from(estimateBoqItems)
      .where(eq(estimateBoqItems.estimateId, estimateId))
      .limit(500).all();

    const recs = db.select().from(estimateAgentRecommendations)
      .where(eq(estimateAgentRecommendations.estimateId, estimateId)).all();

    return { estimate: est, versions, items, recommendations: recs };
  },

  addBoqItem(params: AddBoqItemParams) {
    const rate = params.rate || 0;
    const amount = params.quantity * rate;

    return db.insert(estimateBoqItems).values({
      id: uuid(),
      estimateId: params.estimateId,
      versionId: params.versionId,
      itemCode: params.itemCode || null,
      description: params.description,
      unit: params.unit,
      quantity: params.quantity,
      rate,
      amount,
      quantitySource: params.quantitySource || null,
      rateSource: params.rateSource || null,
      status: rate > 0 ? 'priced' : 'unpriced',
      sortOrder: params.sortOrder || 0,
    }).returning().get();
  },

  updateBoqItem(itemId: string, updates: Record<string, any>) {
    const now = new Date().toISOString();

    if (updates.quantity && updates.rate) {
      updates.amount = updates.quantity * updates.rate;
    }
    updates.updatedAt = now;

    const item = db.update(estimateBoqItems)
      .set(updates).where(eq(estimateBoqItems.id, itemId)).returning().get();

    this.recalculateTotal(item.estimateId);
    return item;
  },

  recalculateTotal(estimateId: string) {
    const items = db.select().from(estimateBoqItems)
      .where(eq(estimateBoqItems.estimateId, estimateId)).all();
    const total = items.reduce((sum, i) => sum + i.amount, 0);

    db.update(estimates)
      .set({ totalAmount: total, updatedAt: new Date().toISOString() })
      .where(eq(estimates.id, estimateId)).run();

    return total;
  },

  createSnapshot(estimateId: string, userId: string, desc?: string) {
    const items = db.select().from(estimateBoqItems)
      .where(eq(estimateBoqItems.estimateId, estimateId)).all();
    const total = items.reduce((sum, i) => sum + i.amount, 0);

    const currentVer = db.select().from(estimateVersions)
      .where(eq(estimateVersions.estimateId, estimateId))
      .orderBy(desc(estimateVersions.versionNumber)).limit(1).get();

    const nextNum = (currentVer?.versionNumber || 0) + 1;

    return db.insert(estimateVersions).values({
      id: uuid(),
      estimateId,
      versionNumber: nextNum,
      totalAmount: total,
      description: desc || null,
      createdBy: userId,
    }).returning().get();
  },

  createRecommendation(params: AgentRecParams) {
    return db.insert(estimateAgentRecommendations).values({
      id: uuid(),
      estimateId: params.estimateId,
      companyId: params.companyId,
      agentId: params.agentId || null,
      issue: params.issue,
      severity: params.severity || 'P2',
      affectedItemId: params.affectedItemId || null,
      evidence: params.evidence || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },
};

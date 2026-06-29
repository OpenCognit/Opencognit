// =============================================================================
// Evidence Pack Service — PR-SRCH-2 Evidence Link Search
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  searchEvidencePacks,
  searchEvidencePackItems,
  searchResultClicks,
  searchAgentRecommendations,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CreateEvidencePackParams {
  companyId: string;
  projectId?: string;
  name: string;
  purpose: string;
  createdBy: string;
}

export interface AddEvidenceItemParams {
  packId: string;
  sourceModule: string;
  sourceRecordId: string;
  recordType: string;
  title: string;
  evidenceType: string;
  addedBy: string;
  sortOrder?: number;
}

export interface RecordClickParams {
  userId: string;
  companyId: string;
  queryText: string;
  clickedRecordId: string;
  position: number;
}

export interface CreateSearchRecommendationParams {
  companyId: string;
  agentId?: string;
  issue: string;
  severity?: string;
  affectedQuery?: string;
  evidence?: string;
  recommendedAction?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const searchEvidenceService = {
  // -------------------------------------------------------------------------
  // Evidence Packs
  // -------------------------------------------------------------------------
  createEvidencePack(params: CreateEvidencePackParams) {
    return db.insert(searchEvidencePacks).values({
      id: uuid(),
      companyId: params.companyId,
      projectId: params.projectId || null,
      name: params.name,
      purpose: params.purpose,
      createdBy: params.createdBy,
    }).returning().get();
  },

  getEvidencePack(packId: string) {
    const pack = db.select().from(searchEvidencePacks)
      .where(eq(searchEvidencePacks.id, packId)).get();
    if (!pack) return null;

    const items = db.select().from(searchEvidencePackItems)
      .where(eq(searchEvidencePackItems.packId, packId))
      .orderBy(eq(searchEvidencePackItems.sortOrder, 0))
      .all();

    return { pack, items };
  },

  listEvidencePacks(companyId: string, projectId?: string) {
    let q = db.select().from(searchEvidencePacks)
      .where(eq(searchEvidencePacks.companyId, companyId));
    if (projectId) {
      q = q.where(eq(searchEvidencePacks.projectId, projectId));
    }
    return q.orderBy(desc(searchEvidencePacks.createdAt)).all();
  },

  addEvidenceItem(params: AddEvidenceItemParams) {
    // Get current max sort_order
    const items = db.select().from(searchEvidencePackItems)
      .where(eq(searchEvidencePackItems.packId, params.packId)).all();
    const maxOrder = items.length > 0
      ? Math.max(...items.map(i => i.sortOrder))
      : 0;

    return db.insert(searchEvidencePackItems).values({
      id: uuid(),
      packId: params.packId,
      sourceModule: params.sourceModule,
      sourceRecordId: params.sourceRecordId,
      recordType: params.recordType,
      title: params.title,
      evidenceType: params.evidenceType,
      addedBy: params.addedBy,
      sortOrder: params.sortOrder ?? maxOrder + 1,
    }).returning().get();
  },

  removeEvidenceItem(itemId: string) {
    return db.delete(searchEvidencePackItems)
      .where(eq(searchEvidencePackItems.id, itemId)).run();
  },

  getEvidenceForRecord(sourceModule: string, sourceRecordId: string) {
    // Find all packs that contain this record
    return db.select().from(searchEvidencePackItems)
      .where(and(
        eq(searchEvidencePackItems.sourceModule, sourceModule),
        eq(searchEvidencePackItems.sourceRecordId, sourceRecordId),
      )).all();
  },

  // -------------------------------------------------------------------------
  // Click Tracking
  // -------------------------------------------------------------------------
  recordClick(params: RecordClickParams) {
    return db.insert(searchResultClicks).values({
      id: uuid(),
      userId: params.userId,
      companyId: params.companyId,
      queryText: params.queryText,
      clickedRecordId: params.clickedRecordId,
      position: params.position,
    }).returning().get();
  },

  getClickAnalytics(companyId: string, limit = 20) {
    // Top queries
    return db.select().from(searchResultClicks)
      .where(eq(searchResultClicks.companyId, companyId))
      .orderBy(desc(searchResultClicks.clickedAt))
      .limit(limit)
      .all();
  },

  // -------------------------------------------------------------------------
  // Agent Recommendations
  // -------------------------------------------------------------------------
  createRecommendation(params: CreateSearchRecommendationParams) {
    return db.insert(searchAgentRecommendations).values({
      id: uuid(),
      companyId: params.companyId,
      agentId: params.agentId || null,
      issue: params.issue,
      severity: params.severity || 'P3',
      affectedQuery: params.affectedQuery || null,
      evidence: params.evidence || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },

  getPendingRecommendations(companyId: string) {
    return db.select().from(searchAgentRecommendations)
      .where(eq(searchAgentRecommendations.companyId, companyId))
      .orderBy(desc(searchAgentRecommendations.detectedAt))
      .all();
  },

  reviewRecommendation(recId: string, status: string) {
    return db.update(searchAgentRecommendations)
      .set({ status, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(searchAgentRecommendations.id, recId))
      .returning()
      .get();
  },
};

// =============================================================================
// Post-Award Service — PR-PAW-1 Award Register + Contract Summary
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  projectAwards, awardDocuments, contractConditionSummaries,
  postAwardReviews, postAwardAgentRecommendations,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const postAwardService = {
  registerAward(params: {
    companyId: string; tenderId: string; awardDate: string;
    contractSum: number; contractCurrency?: string;
    commencementDate?: string; completionDate?: string;
    contractDurationDays?: number; projectId?: string;
    clientId?: string; awardDocumentUrl?: string;
  }) {
    return db.insert(projectAwards).values({
      id: uuid(), companyId: params.companyId,
      tenderId: params.tenderId, awardDate: params.awardDate,
      contractSum: params.contractSum,
      contractCurrency: params.contractCurrency || 'KES',
      commencementDate: params.commencementDate || null,
      completionDate: params.completionDate || null,
      contractDurationDays: params.contractDurationDays ?? null,
      projectId: params.projectId || null,
      clientId: params.clientId || null,
      awardDocumentUrl: params.awardDocumentUrl || null,
    }).returning().get();
  },

  acceptAward(awardId: string, acceptedBy: string) {
    return db.update(projectAwards).set({
      awardStatus: 'accepted', acceptedBy,
      acceptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(projectAwards.id, awardId)).returning().get();
  },

  addDocument(params: {
    awardId: string; documentType: string; title: string;
    fileUrl?: string; receivedAt?: string;
  }) {
    return db.insert(awardDocuments).values({
      id: uuid(), awardId: params.awardId,
      documentType: params.documentType, title: params.title,
      fileUrl: params.fileUrl || null,
      receivedAt: params.receivedAt || null,
    }).returning().get();
  },

  captureContractCondition(params: {
    awardId: string; conditionType: string; summary: string;
    capturedBy: string; deviationFromTender?: boolean;
    riskLevel?: string; notes?: string;
  }) {
    return db.insert(contractConditionSummaries).values({
      id: uuid(), awardId: params.awardId,
      conditionType: params.conditionType, summary: params.summary,
      capturedBy: params.capturedBy,
      deviationFromTender: params.deviationFromTender ? 1 : 0,
      riskLevel: params.riskLevel || 'low',
      notes: params.notes || null,
    }).returning().get();
  },

  getContractConditions(awardId: string) {
    return db.select().from(contractConditionSummaries)
      .where(eq(contractConditionSummaries.awardId, awardId)).all();
  },

  getConditionDeviations(awardId: string) {
    return db.select().from(contractConditionSummaries)
      .where(and(
        eq(contractConditionSummaries.awardId, awardId),
        eq(contractConditionSummaries.deviationFromTender, 1),
      )).all();
  },

  submitReview(params: {
    awardId: string; reviewedBy: string; reviewType?: string;
    role?: string; findings?: string; recommendedAction?: string;
  }) {
    return db.insert(postAwardReviews).values({
      id: uuid(), awardId: params.awardId,
      reviewedBy: params.reviewedBy,
      reviewType: params.reviewType || 'general',
      role: params.role || 'project_manager',
      findings: params.findings || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },

  getReviews(awardId: string) {
    return db.select().from(postAwardReviews)
      .where(eq(postAwardReviews.awardId, awardId)).all();
  },

  createRecommendation(params: {
    companyId: string; awardId: string; issue: string;
    recommendedAction: string; riskLevel?: string;
    evidence?: string; owner?: string;
  }) {
    return db.insert(postAwardAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      awardId: params.awardId, issue: params.issue,
      recommendedAction: params.recommendedAction,
      riskLevel: params.riskLevel || 'medium',
      evidence: params.evidence || null,
      owner: params.owner || null,
    }).returning().get();
  },

  getRiskAlerts(companyId: string) {
    return db.select().from(postAwardAgentRecommendations)
      .where(and(
        eq(postAwardAgentRecommendations.companyId, companyId),
        eq(postAwardAgentRecommendations.status, 'pending_review'),
      )).all();
  },
};

// =============================================================================
// Tender Pipeline Service — PR-TDR-1 Opportunity Register
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  tenderOpportunities, tenderRecords, tenderBidNoBidReviews,
  tenderTeamAssignments, tenderAgentRecommendations,
} from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export const tenderService = {
  registerOpportunity(params: {
    companyId: string; title: string; deadlineAt: string;
    clientId?: string; clientName?: string; source?: string;
    sourceUrl?: string; description?: string;
    projectLocation?: string; estimatedValue?: number;
    prequalificationRequired?: boolean; bondRequired?: boolean;
  }) {
    return db.insert(tenderOpportunities).values({
      id: uuid(), companyId: params.companyId,
      title: params.title, deadlineAt: params.deadlineAt,
      clientId: params.clientId || null,
      clientName: params.clientName || null,
      source: params.source || 'portal',
      sourceUrl: params.sourceUrl || null,
      description: params.description || null,
      projectLocation: params.projectLocation || null,
      estimatedValue: params.estimatedValue ?? null,
      prequalificationRequired: params.prequalificationRequired ? 1 : 0,
      bondRequired: params.bondRequired ? 1 : 0,
    }).returning().get();
  },

  getUpcomingDeadlines(companyId: string, daysOut: number = 7) {
    const all = db.select().from(tenderOpportunities)
      .where(eq(tenderOpportunities.companyId, companyId)).all();
    const now = new Date();
    const limit = new Date(now.getTime() + daysOut * 86400000).toISOString();
    return all.filter(o => o.deadlineAt >= now.toISOString() && o.deadlineAt <= limit
      && !['won', 'lost', 'withdrawn'].includes(o.status || '')
    );
  },

  registerTender(params: {
    companyId: string; opportunityId: string; employerName: string;
    projectName: string; deadlineAt: string;
    tenderNumber?: string; employerAddress?: string;
    projectLocation?: string; submissionType?: string;
    bidBondAmount?: number; bidBondRequired?: boolean;
    ncaClassification?: string;
  }) {
    const record = db.insert(tenderRecords).values({
      id: uuid(), companyId: params.companyId,
      opportunityId: params.opportunityId,
      employerName: params.employerName,
      projectName: params.projectName,
      deadlineAt: params.deadlineAt,
      tenderNumber: params.tenderNumber || null,
      employerAddress: params.employerAddress || null,
      projectLocation: params.projectLocation || null,
      submissionType: params.submissionType || 'physical',
      bidBondAmount: params.bidBondAmount ?? null,
      bidBondRequired: params.bidBondRequired ? 1 : 0,
      ncaClassification: params.ncaClassification || null,
    }).returning().get();

    db.update(tenderOpportunities).set({
      status: 'in_review', updatedAt: new Date().toISOString(),
    }).where(eq(tenderOpportunities.id, params.opportunityId)).run();

    return record;
  },

  reviewBidNoBid(params: {
    companyId: string; reviewedBy: string; decision: string;
    opportunityId?: string; tenderId?: string;
    clientQuality?: string; projectLocationScore?: string;
    contractSize?: number; marginPotential?: string;
    cashflowRisk?: string; securityRisk?: string;
    technicalCapability?: string; resourceAvailability?: string;
    bondRequirement?: string; paymentTerms?: string;
    competitionLevel?: string; strategicValue?: string;
    pastClientBehaviour?: string; overallScore?: number;
    decisionReason?: string;
  }) {
    const review = db.insert(tenderBidNoBidReviews).values({
      id: uuid(), companyId: params.companyId,
      reviewedBy: params.reviewedBy, decision: params.decision,
      opportunityId: params.opportunityId || null,
      tenderId: params.tenderId || null,
      clientQuality: params.clientQuality || null,
      projectLocationScore: params.projectLocationScore || null,
      contractSize: params.contractSize ?? null,
      marginPotential: params.marginPotential || null,
      cashflowRisk: params.cashflowRisk || null,
      securityRisk: params.securityRisk || null,
      technicalCapability: params.technicalCapability || null,
      resourceAvailability: params.resourceAvailability || null,
      bondRequirement: params.bondRequirement || null,
      paymentTerms: params.paymentTerms || null,
      competitionLevel: params.competitionLevel || null,
      strategicValue: params.strategicValue || null,
      pastClientBehaviour: params.pastClientBehaviour || null,
      overallScore: params.overallScore ?? null,
      decisionReason: params.decisionReason || null,
    }).returning().get();

    if (params.tenderId) {
      const newStatus = params.decision === 'bid' ? 'bid_approved'
        : params.decision === 'no_bid' ? 'no_bid' : 'registered';
      db.update(tenderRecords).set({
        status: newStatus, updatedAt: new Date().toISOString(),
      }).where(eq(tenderRecords.id, params.tenderId)).run();
    }

    return review;
  },

  assignTeamMember(tenderId: string, userId: string, role: string) {
    return db.insert(tenderTeamAssignments).values({
      id: uuid(), tenderId, userId, role,
    }).returning().get();
  },

  getTenderTeam(tenderId: string) {
    return db.select().from(tenderTeamAssignments)
      .where(eq(tenderTeamAssignments.tenderId, tenderId)).all();
  },

  createRecommendation(params: {
    companyId: string; issue: string; recommendedAction: string;
    riskLevel?: string; tenderId?: string; opportunityId?: string;
    evidence?: string; owner?: string;
  }) {
    return db.insert(tenderAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      issue: params.issue, recommendedAction: params.recommendedAction,
      riskLevel: params.riskLevel || 'medium',
      tenderId: params.tenderId || null,
      opportunityId: params.opportunityId || null,
      evidence: params.evidence || null,
      owner: params.owner || null,
    }).returning().get();
  },

  getOpenRecommendations(companyId: string, status: string = 'pending_review') {
    return db.select().from(tenderAgentRecommendations)
      .where(and(
        eq(tenderAgentRecommendations.companyId, companyId),
        eq(tenderAgentRecommendations.status, status),
      )).all();
  },
};

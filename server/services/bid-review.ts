// =============================================================================
// Bid Review + Lock Service — PR-EST-5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { estimates, estimateAssumptions, estimateReviews } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AddAssumptionParams {
  estimateId: string;
  versionId?: string;
  category: string;
  description: string;
  riskLevel?: string;
  commercialImpact?: number;
  createdBy: string;
}

export interface SubmitReviewParams {
  estimateId: string;
  versionId: string;
  reviewedBy: string;
  role?: string;
  level?: number;
  decision: string;
  comments?: string;
  checks?: {
    materialOk?: boolean;
    labourOk?: boolean;
    equipmentOk?: boolean;
    subcontractOk?: boolean;
    overheadOk?: boolean;
    marginOk?: boolean;
    riskOk?: boolean;
    assumptionsOk?: boolean;
    quotesOk?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const bidReviewService = {
  // Assumptions/Exclusions
  addAssumption(params: AddAssumptionParams) {
    return db.insert(estimateAssumptions).values({
      id: uuid(),
      estimateId: params.estimateId,
      versionId: params.versionId || null,
      category: params.category,
      description: params.description,
      riskLevel: params.riskLevel || 'low',
      commercialImpact: params.commercialImpact ?? null,
      createdBy: params.createdBy,
    }).returning().get();
  },

  approveAssumption(assumptionId: string, approvedBy: string) {
    const now = new Date().toISOString();
    return db.update(estimateAssumptions)
      .set({ status: 'approved', approvedBy, approvedAt: now, updatedAt: now })
      .where(eq(estimateAssumptions.id, assumptionId))
      .returning().get();
  },

  getEstimateAssumptions(estimateId: string, category?: string) {
    let q = db.select().from(estimateAssumptions)
      .where(eq(estimateAssumptions.estimateId, estimateId));
    if (category) {
      q = q.where(eq(estimateAssumptions.category, category));
    }
    return q.orderBy(eq(estimateAssumptions.category, 'general')).all();
  },

  // Reviews
  submitReview(params: SubmitReviewParams) {
    const c = params.checks || {};
    const now = new Date().toISOString();

    return db.insert(estimateReviews).values({
      id: uuid(),
      estimateId: params.estimateId,
      versionId: params.versionId,
      reviewedBy: params.reviewedBy,
      role: params.role || 'estimator',
      level: params.level || 1,
      decision: params.decision,
      comments: params.comments || null,
      materialOk: c.materialOk !== undefined ? (c.materialOk ? 1 : 0) : null,
      labourOk: c.labourOk !== undefined ? (c.labourOk ? 1 : 0) : null,
      equipmentOk: c.equipmentOk !== undefined ? (c.equipmentOk ? 1 : 0) : null,
      subcontractOk: c.subcontractOk !== undefined ? (c.subcontractOk ? 1 : 0) : null,
      overheadOk: c.overheadOk !== undefined ? (c.overheadOk ? 1 : 0) : null,
      marginOk: c.marginOk !== undefined ? (c.marginOk ? 1 : 0) : null,
      riskOk: c.riskOk !== undefined ? (c.riskOk ? 1 : 0) : null,
      assumptionsOk: c.assumptionsOk !== undefined ? (c.assumptionsOk ? 1 : 0) : null,
      quotesOk: c.quotesOk !== undefined ? (c.quotesOk ? 1 : 0) : null,
      reviewedAt: now,
    }).returning().get();
  },

  getEstimateReviews(estimateId: string) {
    return db.select().from(estimateReviews)
      .where(eq(estimateReviews.estimateId, estimateId))
      .orderBy(desc(estimateReviews.createdAt))
      .all();
  },

  // Bid lock
  lockBid(estimateId: string, approvedBy: string) {
    const now = new Date().toISOString();

    // Check all reviews are done
    const reviews = this.getEstimateReviews(estimateId);
    const hasApproval = reviews.some(r => r.decision === 'approved');
    if (!hasApproval) {
      return { error: 'No approved review found. Cannot lock bid without approval.' };
    }

    return db.update(estimates)
      .set({ status: 'locked', approvedBy, approvedAt: now, updatedAt: now })
      .where(eq(estimates.id, estimateId))
      .returning()
      .get();
  },

  // Bid review completeness check
  checkReadiness(estimateId: string) {
    const est = db.select().from(estimates).where(eq(estimates.id, estimateId)).get();
    if (!est) return { ready: false, issues: ['Estimate not found'] };

    const issues: string[] = [];

    const reviews = this.getEstimateReviews(estimateId);
    if (reviews.length === 0) issues.push('No reviews submitted');
    const hasApproval = reviews.some(r => r.decision === 'approved');
    if (!hasApproval) issues.push('No approved review');

    const assumptions = this.getEstimateAssumptions(estimateId);
    if (assumptions.length === 0) issues.push('No assumptions/exclusions registered');

    const unapproved = assumptions.filter(a => a.status !== 'approved');
    if (unapproved.length) issues.push(`${unapproved.length} assumption(s) not approved`);

    return {
      ready: issues.length === 0,
      issues,
      totalReviews: reviews.length,
      totalAssumptions: assumptions.length,
      approvedReviews: reviews.filter(r => r.decision === 'approved').length,
    };
  },
};

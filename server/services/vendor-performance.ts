// =============================================================================
// Vendor Performance + Blacklist Service — PR-VND-2
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  vendorBankDetails, vendorPerformanceReviews,
  vendorBlacklistEvents, vendorReviews,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const vendorBankService = {
  addBankDetail(params: {
    vendorId: string; bankName: string; accountNumber: string;
    accountName?: string; branch?: string; swiftCode?: string;
    currency?: string; changedBy?: string; changeReason?: string;
  }) {
    // Deactivate existing
    db.update(vendorBankDetails).set({ isActive: 0 })
      .where(eq(vendorBankDetails.vendorId, params.vendorId)).run();

    return db.insert(vendorBankDetails).values({
      id: uuid(), vendorId: params.vendorId,
      bankName: params.bankName, accountNumber: params.accountNumber,
      accountName: params.accountName || null,
      branch: params.branch || null,
      swiftCode: params.swiftCode || null,
      currency: params.currency || 'KES',
      changedBy: params.changedBy || null,
      changeReason: params.changeReason || null,
    }).returning().get();
  },

  getActiveBankDetail(vendorId: string) {
    return db.select().from(vendorBankDetails)
      .where(and(
        eq(vendorBankDetails.vendorId, vendorId),
        eq(vendorBankDetails.isActive, 1),
      )).get();
  },

  getBankHistory(vendorId: string) {
    return db.select().from(vendorBankDetails)
      .where(eq(vendorBankDetails.vendorId, vendorId))
      .orderBy(desc(vendorBankDetails.createdAt)).all();
  },
};

export const vendorPerformanceService = {
  createReview(params: {
    companyId: string; vendorId: string;
    reviewPeriodStart: string; reviewPeriodEnd: string;
    reviewedBy: string;
    deliveryScore?: number; qualityScore?: number;
    pricingScore?: number; responsivenessScore?: number;
    complianceScore?: number; totalPosIssued?: number;
    totalPosOnTime?: number; totalValueAwarded?: number;
    disputeCount?: number; comments?: string; nextReviewDate?: string;
  }) {
    const scores = [
      params.deliveryScore || 0,
      params.qualityScore || 0,
      params.pricingScore || 0,
      params.responsivenessScore || 0,
      params.complianceScore || 0,
    ];
    const overallScore = scores.filter(s => s > 0).length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.filter(s => s > 0).length
      : 0;

    return db.insert(vendorPerformanceReviews).values({
      id: uuid(), companyId: params.companyId,
      vendorId: params.vendorId,
      reviewPeriodStart: params.reviewPeriodStart,
      reviewPeriodEnd: params.reviewPeriodEnd,
      reviewedBy: params.reviewedBy,
      deliveryScore: params.deliveryScore || 0,
      qualityScore: params.qualityScore || 0,
      pricingScore: params.pricingScore || 0,
      responsivenessScore: params.responsivenessScore || 0,
      complianceScore: params.complianceScore || 0,
      overallScore,
      totalPosIssued: params.totalPosIssued || 0,
      totalPosOnTime: params.totalPosOnTime || 0,
      totalValueAwarded: params.totalValueAwarded || 0,
      disputeCount: params.disputeCount || 0,
      comments: params.comments || null,
      nextReviewDate: params.nextReviewDate || null,
    }).returning().get();
  },

  publishReview(reviewId: string) {
    return db.update(vendorPerformanceReviews).set({
      status: 'published', updatedAt: new Date().toISOString(),
    }).where(eq(vendorPerformanceReviews.id, reviewId)).returning().get();
  },

  getVendorPerformanceHistory(vendorId: string) {
    return db.select().from(vendorPerformanceReviews)
      .where(eq(vendorPerformanceReviews.vendorId, vendorId))
      .orderBy(desc(vendorPerformanceReviews.createdAt)).all();
  },

  getLatestReview(vendorId: string) {
    return db.select().from(vendorPerformanceReviews)
      .where(eq(vendorPerformanceReviews.vendorId, vendorId))
      .orderBy(desc(vendorPerformanceReviews.createdAt)).get();
  },
};

export const vendorBlacklistService = {
  blacklistVendor(params: {
    companyId: string; vendorId: string; blacklistedBy: string;
    reason: string; effectiveFrom: string;
    effectiveUntil?: string; evidence?: string;
  }) {
    return db.insert(vendorBlacklistEvents).values({
      id: uuid(), companyId: params.companyId,
      vendorId: params.vendorId, blacklistedBy: params.blacklistedBy,
      reason: params.reason, effectiveFrom: params.effectiveFrom,
      effectiveUntil: params.effectiveUntil || null,
      evidence: params.evidence || null,
    }).returning().get();
  },

  liftBlacklist(eventId: string, liftedBy: string, reason: string) {
    return db.update(vendorBlacklistEvents).set({
      status: 'lifted', liftedBy, liftReason: reason,
      liftedAt: new Date().toISOString(),
    }).where(eq(vendorBlacklistEvents.id, eventId)).returning().get();
  },

  isVendorBlacklisted(vendorId: string): boolean {
    const active = db.select().from(vendorBlacklistEvents)
      .where(and(
        eq(vendorBlacklistEvents.vendorId, vendorId),
        eq(vendorBlacklistEvents.status, 'active'),
      )).get();
    return !!active;
  },

  getBlacklistHistory(vendorId: string) {
    return db.select().from(vendorBlacklistEvents)
      .where(eq(vendorBlacklistEvents.vendorId, vendorId))
      .orderBy(desc(vendorBlacklistEvents.createdAt)).all();
  },
};

export const vendorReviewService = {
  submitReview(params: {
    companyId: string; vendorId: string; reviewedBy: string;
    decision?: string; rating?: number; poId?: string;
    role?: string; comments?: string;
  }) {
    return db.insert(vendorReviews).values({
      id: uuid(), companyId: params.companyId,
      vendorId: params.vendorId, reviewedBy: params.reviewedBy,
      decision: params.decision || 'no_action',
      rating: params.rating ?? null,
      poId: params.poId || null,
      role: params.role || 'procurement_officer',
      comments: params.comments || null,
    }).returning().get();
  },

  getVendorReviews(vendorId: string) {
    return db.select().from(vendorReviews)
      .where(eq(vendorReviews.vendorId, vendorId)).all();
  },
};

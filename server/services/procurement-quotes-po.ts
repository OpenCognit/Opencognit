// =============================================================================
// Procurement PRO-3+4+5 — Quotation, PO, Commitment, Expediting
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  vendorQuotations, vendorQuotationItems, quotationComparisons,
  purchaseOrders, purchaseOrderItems, poApprovals,
  poDeliverySchedules, procurementCommitments,
  procurementExpedites, procurementReviews,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const quotationService = {
  captureQuotation(params: {
    companyId: string; rfqId: string; vendorId: string;
    totalAmount: number; submittedBy?: string;
    quotationRef?: string; taxAmount?: number;
    deliveryDays?: number; paymentTerms?: string;
    warranty?: string; validityDays?: number;
    transportIncluded?: boolean; complianceScore?: number;
  }) {
    return db.insert(vendorQuotations).values({
      id: uuid(), companyId: params.companyId,
      rfqId: params.rfqId, vendorId: params.vendorId,
      totalAmount: params.totalAmount,
      submittedBy: params.submittedBy || null,
      quotationRef: params.quotationRef || null,
      taxAmount: params.taxAmount ?? null,
      deliveryDays: params.deliveryDays ?? null,
      paymentTerms: params.paymentTerms || null,
      warranty: params.warranty || null,
      validityDays: params.validityDays ?? null,
      transportIncluded: params.transportIncluded ? 1 : 0,
      complianceScore: params.complianceScore ?? null,
    }).returning().get();
  },

  addQuotationItem(params: {
    quotationId: string; itemName: string; quantity: number;
    unitRate: number; rfqItemId?: string; unit?: string;
  }) {
    return db.insert(vendorQuotationItems).values({
      id: uuid(), quotationId: params.quotationId,
      itemName: params.itemName, quantity: params.quantity,
      unitRate: params.unitRate,
      totalAmount: params.quantity * params.unitRate,
      rfqItemId: params.rfqItemId || null,
      unit: params.unit || 'No.',
    }).returning().get();
  },

  compareQuotations(params: {
    companyId: string; rfqId: string; preparedBy: string;
    recommendedVendorId?: string; recommendedReason?: string;
    evaluationCriteria?: string; recommendation?: string; prId?: string;
  }) {
    return db.insert(quotationComparisons).values({
      id: uuid(), companyId: params.companyId,
      rfqId: params.rfqId, preparedBy: params.preparedBy,
      recommendedVendorId: params.recommendedVendorId || null,
      recommendedReason: params.recommendedReason || null,
      evaluationCriteria: params.evaluationCriteria || null,
      recommendation: params.recommendation || null,
      prId: params.prId || null,
    }).returning().get();
  },

  approveComparison(comparisonId: string, approvedBy: string) {
    return db.update(quotationComparisons).set({
      status: 'approved', approvedBy,
      approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(quotationComparisons.id, comparisonId)).returning().get();
  },

  getQuotationsForRFQ(rfqId: string) {
    return db.select().from(vendorQuotations)
      .where(eq(vendorQuotations.rfqId, rfqId)).all();
  },
};

export const poService = {
  createPO(params: {
    companyId: string; projectId: string; vendorId: string;
    prId: string; deliveryLocation: string; deliveryDate: string;
    subtotal: number; taxAmount: number; totalAmount: number;
    quotationId?: string; poNumber?: string; paymentTerms?: string;
    currency?: string;
  }) {
    return db.insert(purchaseOrders).values({
      id: uuid(), companyId: params.companyId,
      projectId: params.projectId, vendorId: params.vendorId,
      prId: params.prId,
      deliveryLocation: params.deliveryLocation,
      deliveryDate: params.deliveryDate,
      subtotal: params.subtotal, taxAmount: params.taxAmount,
      totalAmount: params.totalAmount,
      quotationId: params.quotationId || null,
      poNumber: params.poNumber || null,
      paymentTerms: params.paymentTerms || null,
      currency: params.currency || 'KES',
    }).returning().get();
  },

  addPOItem(params: {
    poId: string; itemName: string; itemType: string;
    quantity: number; unitRate: number;
    prItemId?: string; rfqItemId?: string; quotationItemId?: string;
    unit?: string; taxRate?: number; boqItemId?: string; activityId?: string;
  }) {
    return db.insert(purchaseOrderItems).values({
      id: uuid(), poId: params.poId,
      itemName: params.itemName, itemType: params.itemType || 'material',
      quantity: params.quantity, unitRate: params.unitRate,
      totalAmount: params.quantity * params.unitRate,
      prItemId: params.prItemId || null,
      rfqItemId: params.rfqItemId || null,
      quotationItemId: params.quotationItemId || null,
      unit: params.unit || 'No.', taxRate: params.taxRate ?? null,
      boqItemId: params.boqItemId || null,
      activityId: params.activityId || null,
    }).returning().get();
  },

  approvePO(poId: string, approvedBy: string, role?: string, comments?: string) {
    db.insert(poApprovals).values({
      id: uuid(), poId, approvedBy,
      role: role || 'procurement_manager',
      decision: 'approved',
      comments: comments || null,
    }).run();

    return db.update(purchaseOrders).set({
      status: 'approved', updatedAt: new Date().toISOString(),
    }).where(eq(purchaseOrders.id, poId)).returning().get();
  },

  rejectPO(poId: string, approvedBy: string, comments: string) {
    db.insert(poApprovals).values({
      id: uuid(), poId, approvedBy,
      role: 'procurement_manager', decision: 'rejected',
      comments,
    }).run();

    return db.update(purchaseOrders).set({
      status: 'rejected', updatedAt: new Date().toISOString(),
    }).where(eq(purchaseOrders.id, poId)).returning().get();
  },

  createCommitment(params: {
    companyId: string; projectId: string; poId: string;
    committedAmount: number; costCodeId?: string; currency?: string;
  }) {
    return db.insert(procurementCommitments).values({
      id: uuid(), companyId: params.companyId,
      projectId: params.projectId, poId: params.poId,
      committedAmount: params.committedAmount,
      costCodeId: params.costCodeId || null,
      currency: params.currency || 'KES',
    }).returning().get();
  },

  releaseCommitment(commitmentId: string, releasedAmount: number) {
    return db.update(procurementCommitments).set({
      releasedAmount: releasedAmount,
      status: releasedAmount >= 0 ? 'released' : 'open',
      releasedDate: new Date().toISOString(),
    }).where(eq(procurementCommitments.id, commitmentId)).returning().get();
  },

  getPOWithDetails(poId: string) {
    const po = db.select().from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId)).get();
    if (!po) return null;
    const items = db.select().from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, poId)).all();
    const approvals = db.select().from(poApprovals)
      .where(eq(poApprovals.poId, poId)).all();
    const deliveries = db.select().from(poDeliverySchedules)
      .where(eq(poDeliverySchedules.poId, poId)).all();
    const commitments = db.select().from(procurementCommitments)
      .where(eq(procurementCommitments.poId, poId)).all();
    return { ...po, items, approvals, deliveries, commitments };
  },
};

export const expeditingService = {
  trackDelivery(params: {
    poId: string; poItemId?: string; promisedDate: string;
    quantityScheduled: number;
  }) {
    return db.insert(poDeliverySchedules).values({
      id: uuid(), poId: params.poId,
      poItemId: params.poItemId || null,
      promisedDate: params.promisedDate,
      quantityScheduled: params.quantityScheduled,
    }).returning().get();
  },

  confirmDelivery(scheduleId: string, confirmedDate: string) {
    return db.update(poDeliverySchedules).set({
      confirmedDate, status: 'confirmed',
      updatedAt: new Date().toISOString(),
    }).where(eq(poDeliverySchedules.id, scheduleId)).returning().get();
  },

  recordPartialDelivery(scheduleId: string, quantityDelivered: number, quantityScheduled: number) {
    const status = quantityDelivered >= quantityScheduled ? 'delivered' : 'partial';
    return db.update(poDeliverySchedules).set({
      quantityDelivered, status, updatedAt: new Date().toISOString(),
    }).where(eq(poDeliverySchedules.id, scheduleId)).returning().get();
  },

  escalateDelay(params: {
    companyId: string; poId: string; issue: string;
    deliveryScheduleId?: string; activityId?: string;
    escalationLevel?: string; criticalPathImpact?: boolean;
  }) {
    return db.insert(procurementExpedites).values({
      id: uuid(), companyId: params.companyId,
      poId: params.poId, issue: params.issue,
      deliveryScheduleId: params.deliveryScheduleId || null,
      activityId: params.activityId || null,
      escalationLevel: params.escalationLevel || 'vendor_only',
      criticalPathImpact: params.criticalPathImpact ? 1 : 0,
    }).returning().get();
  },

  updateExpedite(expediteId: string, actionTaken: string, nextFollowup?: string) {
    return db.update(procurementExpedites).set({
      actionTaken, nextFollowup: nextFollowup || null,
      updatedAt: new Date().toISOString(),
    }).where(eq(procurementExpedites.id, expediteId)).returning().get();
  },

  resolveExpedite(expediteId: string, resolvedBy: string) {
    return db.update(procurementExpedites).set({
      status: 'resolved', resolvedBy,
      resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(procurementExpedites.id, expediteId)).returning().get();
  },

  getLateDeliveries(companyId: string) {
    return db.select().from(poDeliverySchedules)
      .where(and(
        eq(poDeliverySchedules.status, 'delivery_date'),
      )).all();
  },

  getOpenExpedites(companyId: string) {
    return db.select().from(procurementExpedites)
      .where(and(
        eq(procurementExpedites.companyId, companyId),
        eq(procurementExpedites.status, 'open'),
      )).all();
  },
};

export const procurementReviewService = {
  submitReview(params: {
    companyId: string; poId: string; vendorId: string;
    reviewedBy: string; ratingScore: number;
    onTimeDelivery?: number; qualityCompliance?: number;
    documentationScore?: number; role?: string; comments?: string;
  }) {
    return db.insert(procurementReviews).values({
      id: uuid(), companyId: params.companyId,
      poId: params.poId, vendorId: params.vendorId,
      reviewedBy: params.reviewedBy, ratingScore: params.ratingScore,
      onTimeDelivery: params.onTimeDelivery ?? null,
      qualityCompliance: params.qualityCompliance ?? null,
      documentationScore: params.documentationScore ?? null,
      role: params.role || 'procurement',
      comments: params.comments || null,
    }).returning().get();
  },

  getVendorReviews(vendorId: string) {
    return db.select().from(procurementReviews)
      .where(eq(procurementReviews.vendorId, vendorId)).all();
  },
};

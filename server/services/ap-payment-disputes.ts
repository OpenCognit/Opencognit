// =============================================================================
// AP Payment, Disputes + Audit Service — PR-AP-2+3+4+5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  serviceConfirmations, serviceConfirmationItems,
  invoiceMatchExceptions, accountsPayableReviews,
  paymentApprovalRequests, vendorPaymentRecords,
  vendorDisputes, apAuditEvents, vendorInvoices,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const serviceConfirmationService = {
  confirmService(params: {
    companyId: string; poId: string; vendorId: string;
    serviceType: string; confirmedBy: string;
    confirmedDays?: number; confirmedUnits?: number;
    description?: string; periodStart?: string; periodEnd?: string;
  }) {
    return db.insert(serviceConfirmations).values({
      id: uuid(), companyId: params.companyId,
      poId: params.poId, vendorId: params.vendorId,
      serviceType: params.serviceType,
      confirmedBy: params.confirmedBy,
      confirmedDays: params.confirmedDays || 0,
      confirmedUnits: params.confirmedUnits ?? null,
      description: params.description || null,
      periodStart: params.periodStart || null,
      periodEnd: params.periodEnd || null,
    }).returning().get();
  },

  addConfirmationItem(params: {
    confirmationId: string; poItemId: string; description: string;
    orderedQty: number; confirmedQty: number; unit?: string;
    unitRate?: number; rejectionReason?: string;
  }) {
    return db.insert(serviceConfirmationItems).values({
      id: uuid(), confirmationId: params.confirmationId,
      poItemId: params.poItemId, description: params.description,
      orderedQty: params.orderedQty, confirmedQty: params.confirmedQty,
      unit: params.unit || 'days',
      unitRate: params.unitRate ?? null,
      rejectionReason: params.rejectionReason || null,
    }).returning().get();
  },
};

export const exceptionService = {
  flagException(params: {
    invoiceId: string; exceptionType: string; description: string;
    severity?: string; matchResultId?: string;
  }) {
    return db.insert(invoiceMatchExceptions).values({
      id: uuid(), invoiceId: params.invoiceId,
      exceptionType: params.exceptionType,
      description: params.description,
      severity: params.severity || 'medium',
      matchResultId: params.matchResultId || null,
    }).returning().get();
  },

  resolveException(exceptionId: string, resolvedBy: string, resolution: string) {
    return db.update(invoiceMatchExceptions).set({
      status: 'resolved', resolvedBy, resolution,
      resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(invoiceMatchExceptions.id, exceptionId)).returning().get();
  },

  getOpenExceptions(invoiceId: string) {
    return db.select().from(invoiceMatchExceptions)
      .where(and(
        eq(invoiceMatchExceptions.invoiceId, invoiceId),
        eq(invoiceMatchExceptions.status, 'open'),
      )).all();
  },
};

export const paymentWorkflowService = {
  reviewInvoice(params: {
    companyId: string; invoiceId: string; reviewedBy: string;
    decision: string; payableAmount?: number; role?: string;
    comments?: string;
  }) {
    return db.insert(accountsPayableReviews).values({
      id: uuid(), companyId: params.companyId,
      invoiceId: params.invoiceId, reviewedBy: params.reviewedBy,
      decision: params.decision,
      payableAmount: params.payableAmount || 0,
      role: params.role || 'finance',
      comments: params.comments || null,
    }).returning().get();
  },

  requestPaymentApproval(params: {
    companyId: string; invoiceId: string; requestedBy: string;
    amount: number; approvalLevel?: string;
  }) {
    return db.insert(paymentApprovalRequests).values({
      id: uuid(), companyId: params.companyId,
      invoiceId: params.invoiceId, requestedBy: params.requestedBy,
      amount: params.amount,
      approvalLevel: params.approvalLevel || 'finance_manager',
    }).returning().get();
  },

  approvePayment(requestId: string, approvedBy: string) {
    const req = db.update(paymentApprovalRequests).set({
      status: 'approved', approvedBy, approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(paymentApprovalRequests.id, requestId)).returning().get();

    return req;
  },

  recordPayment(params: {
    companyId: string; invoiceId: string; vendorId: string;
    amountPaid: number; paymentDate: string; paidBy: string;
    paymentMethod?: string; paymentRef?: string; notes?: string;
  }) {
    const payment = db.insert(vendorPaymentRecords).values({
      id: uuid(), companyId: params.companyId,
      invoiceId: params.invoiceId, vendorId: params.vendorId,
      amountPaid: params.amountPaid, paymentDate: params.paymentDate,
      paidBy: params.paidBy,
      paymentMethod: params.paymentMethod || 'bank_transfer',
      paymentRef: params.paymentRef || null,
      notes: params.notes || null,
    }).returning().get();

    db.update(vendorInvoices).set({
      status: 'paid', updatedAt: new Date().toISOString(),
    }).where(eq(vendorInvoices.id, params.invoiceId)).run();

    return payment;
  },
};

export const disputeService = {
  raiseDispute(params: {
    companyId: string; vendorId: string; disputeType: string;
    description: string; invoiceId?: string; grnId?: string;
    amountDisputed?: number;
  }) {
    return db.insert(vendorDisputes).values({
      id: uuid(), companyId: params.companyId,
      vendorId: params.vendorId, disputeType: params.disputeType,
      description: params.description,
      invoiceId: params.invoiceId || null,
      grnId: params.grnId || null,
      amountDisputed: params.amountDisputed || 0,
    }).returning().get();
  },

  resolveDispute(disputeId: string, resolvedBy: string, resolution: string) {
    return db.update(vendorDisputes).set({
      status: 'resolved', resolution, resolvedBy,
      resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(vendorDisputes.id, disputeId)).returning().get();
  },

  getVendorDisputes(vendorId: string) {
    return db.select().from(vendorDisputes)
      .where(eq(vendorDisputes.vendorId, vendorId)).all();
  },
};

export const auditService = {
  recordEvent(params: {
    companyId: string; eventType: string; actor: string;
    invoiceId?: string; paymentId?: string;
    oldValue?: string; newValue?: string;
  }) {
    return db.insert(apAuditEvents).values({
      id: uuid(), companyId: params.companyId,
      eventType: params.eventType, actor: params.actor,
      invoiceId: params.invoiceId || null,
      paymentId: params.paymentId || null,
      oldValue: params.oldValue || null,
      newValue: params.newValue || null,
    }).returning().get();
  },

  getAuditTrail(invoiceId: string) {
    return db.select().from(apAuditEvents)
      .where(eq(apAuditEvents.invoiceId, invoiceId)).all();
  },
};

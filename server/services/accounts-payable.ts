// =============================================================================
// Accounts Payable Service — PR-AP-1 Invoice + Match Backbone
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  deliveryNotes, goodsReceiptNotes, goodsReceiptItems,
  vendorInvoices, vendorInvoiceItems, invoiceMatchResults,
  apAgentRecommendations,
} from '../db/schema';
import { eq, and, count } from 'drizzle-orm';

export const grnService = {
  recordDelivery(params: {
    companyId: string; poId: string; vendorId: string;
    deliveryDate: string; deliveryType?: string;
    deliveryNoteNumber?: string; transportRef?: string;
    driverName?: string; vehicleNumber?: string; notes?: string;
  }) {
    return db.insert(deliveryNotes).values({
      id: uuid(), companyId: params.companyId,
      poId: params.poId, vendorId: params.vendorId,
      deliveryDate: params.deliveryDate,
      deliveryType: params.deliveryType || 'materials',
      deliveryNoteNumber: params.deliveryNoteNumber || null,
      transportRef: params.transportRef || null,
      driverName: params.driverName || null,
      vehicleNumber: params.vehicleNumber || null,
      notes: params.notes || null,
    }).returning().get();
  },

  createGRN(params: {
    companyId: string; deliveryNoteId: string; poId: string;
    vendorId: string; receivedDate: string; receivedBy: string;
    grnNumber?: string; notes?: string;
  }) {
    return db.insert(goodsReceiptNotes).values({
      id: uuid(), companyId: params.companyId,
      deliveryNoteId: params.deliveryNoteId,
      poId: params.poId, vendorId: params.vendorId,
      receivedDate: params.receivedDate,
      receivedBy: params.receivedBy,
      grnNumber: params.grnNumber || null,
      notes: params.notes || null,
    }).returning().get();
  },

  addGRNItem(params: {
    grnId: string; poItemId: string; itemName: string;
    quantityOrdered: number; quantityDelivered: number;
    quantityAccepted: number; quantityRejected?: number;
    rejectionReason?: string; unit?: string; unitPricePo?: number;
  }) {
    return db.insert(goodsReceiptItems).values({
      id: uuid(), grnId: params.grnId,
      poItemId: params.poItemId, itemName: params.itemName,
      quantityOrdered: params.quantityOrdered,
      quantityDelivered: params.quantityDelivered,
      quantityAccepted: params.quantityAccepted,
      quantityRejected: params.quantityRejected || 0,
      rejectionReason: params.rejectionReason || null,
      unit: params.unit || 'No.',
      unitPricePo: params.unitPricePo ?? null,
    }).returning().get();
  },

  getGRN(grnId: string) {
    const grn = db.select().from(goodsReceiptNotes).where(eq(goodsReceiptNotes.id, grnId)).get();
    if (!grn) return null;
    const items = db.select().from(goodsReceiptItems)
      .where(eq(goodsReceiptItems.grnId, grnId)).all();
    return { ...grn, items };
  },
};

export const apService = {
  registerInvoice(params: {
    companyId: string; vendorId: string; invoiceNumber: string;
    invoiceDate: string; subtotal: number; taxAmount: number;
    totalAmount: number; poId?: string; grnId?: string;
    paymentDueDate?: string; currency?: string; paymentTerms?: string;
  }) {
    // Duplicate check
    const existing = db.select({ id: vendorInvoices.id }).from(vendorInvoices)
      .where(and(
        eq(vendorInvoices.vendorId, params.vendorId),
        eq(vendorInvoices.invoiceNumber, params.invoiceNumber),
      )).get();

    return db.insert(vendorInvoices).values({
      id: uuid(), companyId: params.companyId,
      vendorId: params.vendorId, invoiceNumber: params.invoiceNumber,
      invoiceDate: params.invoiceDate,
      subtotal: params.subtotal, taxAmount: params.taxAmount,
      totalAmount: params.totalAmount,
      poId: params.poId || null, grnId: params.grnId || null,
      paymentDueDate: params.paymentDueDate || null,
      currency: params.currency || 'KES',
      paymentTerms: params.paymentTerms || null,
      duplicateCheck: existing ? 1 : 0,
    }).returning().get();
  },

  addInvoiceItem(params: {
    invoiceId: string; itemName: string; quantity: number;
    unitPrice: number; lineTotal?: number;
    poItemId?: string; grnItemId?: string; taxRate?: number;
  }) {
    return db.insert(vendorInvoiceItems).values({
      id: uuid(), invoiceId: params.invoiceId,
      itemName: params.itemName, quantity: params.quantity,
      unitPrice: params.unitPrice,
      lineTotal: params.lineTotal || (params.quantity * params.unitPrice),
      poItemId: params.poItemId || null,
      grnItemId: params.grnItemId || null,
      taxRate: params.taxRate ?? null,
    }).returning().get();
  },

  matchInvoice(params: {
    invoiceId: string; invoiceItemId?: string;
    poQuantity?: number; grnAccepted?: number;
    invoiceQuantity?: number; poRate?: number; invoiceRate?: number;
    matchedBy: string;
  }) {
    const payableAmount = (params.grnAccepted && params.poRate)
      ? params.grnAccepted * params.poRate : undefined;

    let matchStatus = 'matched';
    let varianceType: string | null = null;

    if (params.grnanAccepted && params.invoiceQuantity
      && params.invoiceQuantity > params.grnanAccepted) {
      matchStatus = 'quantity_variance';
      varianceType = 'quantity_variance';
    }
    if (params.poRate && params.invoiceRate
      && params.invoiceRate > params.poRate) {
      matchStatus = 'rate_variance';
      varianceType = 'rate_variance';
    }

    const result = db.insert(invoiceMatchResults).values({
      id: uuid(), invoiceId: params.invoiceId,
      invoiceItemId: params.invoiceItemId || null,
      poQuantity: params.poQuantity ?? null,
      grnAccepted: params.grnAccepted ?? null,
      invoiceQuantity: params.invoiceQuantity ?? null,
      poRate: params.poRate ?? null,
      invoiceRate: params.invoiceRate ?? null,
      matchStatus, varianceType,
      payableAmount: payableAmount ?? 0,
      matchedBy: params.matchedBy,
    }).returning().get();

    // Update invoice status
    db.update(vendorInvoices).set({
      matchedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(vendorInvoices.id, params.invoiceId)).run();

    return result;
  },

  getMatchResults(invoiceId: string) {
    return db.select().from(invoiceMatchResults)
      .where(eq(invoiceMatchResults.invoiceId, invoiceId)).all();
  },

  getUnmatchedInvoices(companyId: string) {
    return db.select().from(vendorInvoices)
      .where(and(
        eq(vendorInvoices.companyId, companyId),
        eq(vendorInvoices.matchedAt, '1970-01-01T00:00:00.000Z'), // hack: null check
      )).all();
  },

  holdInvoice(invoiceId: string, reason: string) {
    return db.update(vendorInvoices).set({
      status: 'held', holdReason: reason, updatedAt: new Date().toISOString(),
    }).where(eq(vendorInvoices.id, invoiceId)).returning().get();
  },

  createRecommendation(params: {
    companyId: string; issue: string; recommendedAction: string;
    invoiceId?: string; poId?: string; vendorId?: string;
    riskLevel?: string; evidence?: string; owner?: string;
  }) {
    return db.insert(apAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      issue: params.issue, recommendedAction: params.recommendedAction,
      invoiceId: params.invoiceId || null,
      poId: params.poId || null,
      vendorId: params.vendorId || null,
      riskLevel: params.riskLevel || 'medium',
      evidence: params.evidence || null,
      owner: params.owner || null,
    }).returning().get();
  },
};

// =============================================================================
// Procurement RFQ Service — PR-PRO-2 RFQ + Vendor Invitation
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { rfqs, rfqItems, rfqVendorInvites } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const rfqService = {
  createRFQ(params: {
    companyId: string; prId: string; title: string;
    deliveryLocation: string; requiredDate: string;
    quotationDeadline: string;
    description?: string; paymentTerms?: string;
    specification?: string; rfqNumber?: string;
  }) {
    return db.insert(rfqs).values({
      id: uuid(), companyId: params.companyId,
      prId: params.prId, title: params.title,
      deliveryLocation: params.deliveryLocation,
      requiredDate: params.requiredDate,
      quotationDeadline: params.quotationDeadline,
      description: params.description || null,
      paymentTerms: params.paymentTerms || null,
      specification: params.specification || null,
      rfqNumber: params.rfqNumber || null,
    }).returning().get();
  },

  addRFQItem(params: {
    rfqId: string; itemName: string; quantity: number;
    prItemId?: string; itemType?: string; unit?: string;
    specification?: string; notes?: string;
  }) {
    return db.insert(rfqItems).values({
      id: uuid(), rfqId: params.rfqId,
      itemName: params.itemName, quantity: params.quantity,
      prItemId: params.prItemId || null,
      itemType: params.itemType || 'material',
      unit: params.unit || 'No.',
      specification: params.specification || null,
      notes: params.notes || null,
    }).returning().get();
  },

  issueRFQ(rfqId: string) {
    return db.update(rfqs).set({
      status: 'issued', updatedAt: new Date().toISOString(),
    }).where(eq(rfqs.id, rfqId)).returning().get();
  },

  closeRFQ(rfqId: string) {
    return db.update(rfqs).set({
      status: 'closed', updatedAt: new Date().toISOString(),
    }).where(eq(rfqs.id, rfqId)).returning().get();
  },

  inviteVendor(params: {
    rfqId: string; vendorId: string; invitedBy: string;
  }) {
    return db.insert(rfqVendorInvites).values({
      id: uuid(), rfqId: params.rfqId,
      vendorId: params.vendorId, invitedBy: params.invitedBy,
    }).returning().get();
  },

  recordVendorResponse(inviteId: string, responseStatus: string, bidIntent?: string, declinedReason?: string) {
    return db.update(rfqVendorInvites).set({
      responseStatus, bidIntent: bidIntent || null,
      declinedReason: declinedReason || null,
      respondedAt: new Date().toISOString(),
    }).where(eq(rfqVendorInvites.id, inviteId)).returning().get();
  },

  getRFQWithItems(rfqId: string) {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) return null;
    const items = db.select().from(rfqItems).where(eq(rfqItems.rfqId, rfqId)).all();
    const invites = db.select().from(rfqVendorInvites).where(eq(rfqVendorInvites.rfqId, rfqId)).all();
    return { ...rfq, items, invites };
  },

  getRFQsByPR(prId: string) {
    return db.select().from(rfqs).where(eq(rfqs.prId, prId)).all();
  },

  getVendorResponseRate(rfqId: string) {
    const invites = db.select().from(rfqVendorInvites)
      .where(eq(rfqVendorInvites.rfqId, rfqId)).all();
    if (!invites.length) return { total: 0, responded: 0, rate: 0 };
    const responded = invites.filter(i => i.responseStatus !== 'pending').length;
    return { total: invites.length, responded, rate: (responded / invites.length) * 100 };
  },
};

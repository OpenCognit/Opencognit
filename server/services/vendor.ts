// =============================================================================
// Vendor Control Room Service — PR-VND-1 Register + Qualification Backbone
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  vendors, vendorContacts, vendorCategories,
  vendorComplianceDocuments, vendorApprovals,
  vendorAgentRecommendations,
} from '../db/schema';
import { eq, and, desc, like } from 'drizzle-orm';

export const vendorService = {
  registerVendor(params: {
    companyId: string; vendorName: string;
    vendorType?: string; registrationNumber?: string; taxId?: string;
    contactPerson?: string; contactPhone?: string; contactEmail?: string;
    physicalAddress?: string; postalAddress?: string; website?: string;
    yearEstablished?: number; employeeCount?: number; annualTurnover?: number;
    bankName?: string; bankAccountNumber?: string; bankBranch?: string;
    swiftCode?: string; currency?: string; paymentTerms?: string;
    creditLimit?: number; insuranceExpiry?: string;
    registeredBy?: string; notes?: string;
  }) {
    return db.insert(vendors).values({
      id: uuid(), companyId: params.companyId,
      vendorName: params.vendorName,
      vendorType: params.vendorType || 'material_supplier',
      registrationNumber: params.registrationNumber || null,
      taxId: params.taxId || null,
      contactPerson: params.contactPerson || null,
      contactPhone: params.contactPhone || null,
      contactEmail: params.contactEmail || null,
      physicalAddress: params.physicalAddress || null,
      postalAddress: params.postalAddress || null,
      website: params.website || null,
      yearEstablished: params.yearEstablished ?? null,
      employeeCount: params.employeeCount ?? null,
      annualTurnover: params.annualTurnover ?? null,
      bankName: params.bankName || null,
      bankAccountNumber: params.bankAccountNumber || null,
      bankBranch: params.bankBranch || null,
      swiftCode: params.swiftCode || null,
      currency: params.currency || 'KES',
      paymentTerms: params.paymentTerms || null,
      creditLimit: params.creditLimit ?? null,
      insuranceExpiry: params.insuranceExpiry || null,
      registeredBy: params.registeredBy || null,
      notes: params.notes || null,
    }).returning().get();
  },

  approveVendor(vendorId: string, approvedBy: string) {
    db.insert(vendorApprovals).values({
      id: uuid(), vendorId, approvedBy,
      role: 'procurement', decision: 'approved',
    }).run();

    return db.update(vendors).set({
      status: 'approved', approvedBy,
      approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(vendors.id, vendorId)).returning().get();
  },

  rejectVendor(vendorId: string, approvedBy: string, reason: string) {
    db.insert(vendorApprovals).values({
      id: uuid(), vendorId, approvedBy,
      role: 'procurement', decision: 'rejected', comments: reason,
    }).run();

    return db.update(vendors).set({
      status: 'rejected', rejectionReason: reason,
      updatedAt: new Date().toISOString(),
    }).where(eq(vendors.id, vendorId)).returning().get();
  },

  blockVendor(vendorId: string, reason: string) {
    return db.update(vendors).set({
      status: 'blocked', blockedReason: reason, updatedAt: new Date().toISOString(),
    }).where(eq(vendors.id, vendorId)).returning().get();
  },

  addContact(params: {
    vendorId: string; contactName: string;
    position?: string; department?: string;
    phone?: string; email?: string; isPrimary?: boolean;
  }) {
    return db.insert(vendorContacts).values({
      id: uuid(), vendorId: params.vendorId,
      contactName: params.contactName,
      position: params.position || null,
      department: params.department || null,
      phone: params.phone || null, email: params.email || null,
      isPrimary: params.isPrimary ? 1 : 0,
    }).returning().get();
  },

  addCategory(params: {
    vendorId: string; category: string;
    subcategory?: string; tradeLicense?: string;
    tradeLicenseExpiry?: string;
  }) {
    return db.insert(vendorCategories).values({
      id: uuid(), vendorId: params.vendorId,
      category: params.category,
      subcategory: params.subcategory || null,
      tradeLicense: params.tradeLicense || null,
      tradeLicenseExpiry: params.tradeLicenseExpiry || null,
    }).returning().get();
  },

  addComplianceDoc(params: {
    vendorId: string; documentType: string;
    documentRef?: string; issuedBy?: string;
    issuedDate?: string; expiryDate?: string; filePath?: string;
  }) {
    return db.insert(vendorComplianceDocuments).values({
      id: uuid(), vendorId: params.vendorId,
      documentType: params.documentType,
      documentRef: params.documentRef || null,
      issuedBy: params.issuedBy || null,
      issuedDate: params.issuedDate || null,
      expiryDate: params.expiryDate || null,
      filePath: params.filePath || null,
    }).returning().get();
  },

  verifyComplianceDoc(docId: string, verifiedBy: string) {
    return db.update(vendorComplianceDocuments).set({
      verificationStatus: 'verified', verifiedBy,
      verifiedAt: new Date().toISOString(),
    }).where(eq(vendorComplianceDocuments.id, docId)).returning().get();
  },

  getVendorWithDetails(vendorId: string) {
    const vendor = db.select().from(vendors)
      .where(eq(vendors.id, vendorId)).get();
    if (!vendor) return null;
    const contacts = db.select().from(vendorContacts)
      .where(eq(vendorContacts.vendorId, vendorId)).all();
    const categories = db.select().from(vendorCategories)
      .where(eq(vendorCategories.vendorId, vendorId)).all();
    const docs = db.select().from(vendorComplianceDocuments)
      .where(eq(vendorComplianceDocuments.vendorId, vendorId)).all();
    const approvals = db.select().from(vendorApprovals)
      .where(eq(vendorApprovals.vendorId, vendorId)).all();
    return { ...vendor, contacts, categories, documents: docs, approvals };
  },

  listApprovedVendors(companyId: string) {
    return db.select().from(vendors)
      .where(and(
        eq(vendors.companyId, companyId),
        eq(vendors.status, 'approved'),
      )).all();
  },

  listVendorsByType(companyId: string, vendorType: string) {
    return db.select().from(vendors)
      .where(and(
        eq(vendors.companyId, companyId),
        eq(vendors.vendorType, vendorType),
        eq(vendors.status, 'approved'),
      )).all();
  },

  getVendorsWithExpiringDocs(companyId: string, daysThreshold: number = 30) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + daysThreshold);
    const thresholdStr = threshold.toISOString().split('T')[0];

    return db.select().from(vendorComplianceDocuments)
      .where(eq(vendorComplianceDocuments.verificationStatus, 'verified'))
      .all()
      .filter(d => d.expiryDate && d.expiryDate <= thresholdStr);
  },
};

export const vendorAgentService = {
  createRecommendation(params: {
    companyId: string; vendorId: string;
    issue: string; recommendedAction: string;
    evidence?: string; riskLevel?: string; owner?: string;
  }) {
    return db.insert(vendorAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      vendorId: params.vendorId, issue: params.issue,
      recommendedAction: params.recommendedAction,
      evidence: params.evidence || null,
      riskLevel: params.riskLevel || 'medium',
      owner: params.owner || null,
    }).returning().get();
  },

  reviewRecommendation(recId: string) {
    return db.update(vendorAgentRecommendations).set({
      status: 'reviewed', reviewedAt: new Date().toISOString(),
    }).where(eq(vendorAgentRecommendations.id, recId)).returning().get();
  },

  getVendorRecommendations(vendorId: string) {
    return db.select().from(vendorAgentRecommendations)
      .where(eq(vendorAgentRecommendations.vendorId, vendorId)).all();
  },

  getPendingRecommendations(companyId: string) {
    return db.select().from(vendorAgentRecommendations)
      .where(and(
        eq(vendorAgentRecommendations.companyId, companyId),
        eq(vendorAgentRecommendations.status, 'pending_review'),
      )).all();
  },
};

// =============================================================================
// Tender Docs, Compliance, Submission, Outcomes Service — PR-TDR-2+3+4+5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  tenderDocuments, tenderAddenda, tenderClarifications,
  tenderComplianceRequirements, tenderSubmissionChecklists,
  tenderSubmissionEvidence, tenderApprovalReviews, tenderOutcomes,
  tenderRecords,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

export const tenderDocService = {
  addDocument(params: {
    tenderId: string; documentType: string; title: string;
    fileUrl?: string; description?: string; issuedAt?: string;
  }) {
    return db.insert(tenderDocuments).values({
      id: uuid(), tenderId: params.tenderId,
      documentType: params.documentType, title: params.title,
      fileUrl: params.fileUrl || null, description: params.description || null,
      issuedAt: params.issuedAt || null,
    }).returning().get();
  },

  acknowledgeDocument(docId: string, userId: string) {
    return db.update(tenderDocuments).set({
      acknowledged: 1, acknowledgedBy: userId,
      acknowledgedAt: new Date().toISOString(),
    }).where(eq(tenderDocuments.id, docId)).returning().get();
  },

  getDocuments(tenderId: string) {
    return db.select().from(tenderDocuments)
      .where(eq(tenderDocuments.tenderId, tenderId)).all();
  },
};

export const tenderAddendaService = {
  recordAddendum(params: {
    tenderId: string; addendumNumber: number; title: string;
    issuedAt: string; description?: string; affectedDocuments?: string;
    pricingImpact?: boolean; programmeImpact?: boolean;
    technicalImpact?: boolean;
  }) {
    return db.insert(tenderAddenda).values({
      id: uuid(), tenderId: params.tenderId,
      addendumNumber: params.addendumNumber, title: params.title,
      issuedAt: params.issuedAt, description: params.description || null,
      affectedDocuments: params.affectedDocuments || null,
      pricingImpact: params.pricingImpact ? 1 : 0,
      programmeImpact: params.programmeImpact ? 1 : 0,
      technicalImpact: params.technicalImpact ? 1 : 0,
    }).returning().get();
  },

  acknowledgeAddendum(addendumId: string, userId: string) {
    return db.update(tenderAddenda).set({
      acknowledged: 1, acknowledgedBy: userId,
      acknowledgedAt: new Date().toISOString(), reviewStatus: 'reviewed',
    }).where(eq(tenderAddenda.id, addendumId)).returning().get();
  },

  getAddenda(tenderId: string) {
    return db.select().from(tenderAddenda)
      .where(eq(tenderAddenda.tenderId, tenderId)).all();
  },

  findUnacknowledgedAddenda(tenderId: string) {
    return db.select().from(tenderAddenda)
      .where(and(
        eq(tenderAddenda.tenderId, tenderId),
        eq(tenderAddenda.acknowledged, 0),
      )).all();
  },
};

export const tenderClarificationService = {
  askClarification(tenderId: string, question: string, askedBy: string) {
    return db.insert(tenderClarifications).values({
      id: uuid(), tenderId, question, askedBy,
    }).returning().get();
  },

  recordAnswer(clarificationId: string, answer: string, answeredBy: string) {
    return db.update(tenderClarifications).set({
      answer, answeredBy, answeredAt: new Date().toISOString(), status: 'answered',
    }).where(eq(tenderClarifications.id, clarificationId)).returning().get();
  },

  getClarifications(tenderId: string) {
    return db.select().from(tenderClarifications)
      .where(eq(tenderClarifications.tenderId, tenderId)).all();
  },
};

export const tenderComplianceService = {
  addRequirement(params: {
    tenderId: string; requirement: string; owner: string;
    mandatory?: boolean; sourceDocument?: string;
    sectionReference?: string; dueDate?: string;
  }) {
    return db.insert(tenderComplianceRequirements).values({
      id: uuid(), tenderId: params.tenderId,
      requirement: params.requirement, owner: params.owner,
      mandatory: params.mandatory !== false ? 1 : 0,
      sourceDocument: params.sourceDocument || null,
      sectionReference: params.sectionReference || null,
      dueDate: params.dueDate || null,
    }).returning().get();
  },

  markComplete(reqId: string, userId: string) {
    return db.update(tenderComplianceRequirements).set({
      status: 'complete', reviewedBy: userId,
      reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).where(eq(tenderComplianceRequirements.id, reqId)).returning().get();
  },

  getMissingMandatory(tenderId: string) {
    return db.select().from(tenderComplianceRequirements)
      .where(and(
        eq(tenderComplianceRequirements.tenderId, tenderId),
        eq(tenderComplianceRequirements.mandatory, 1),
        eq(tenderComplianceRequirements.status, 'pending'),
      )).all();
  },

  submissionReadiness(tenderId: string) {
    const all = db.select().from(tenderComplianceRequirements)
      .where(eq(tenderComplianceRequirements.tenderId, tenderId)).all();
    const mandatory = all.filter(r => r.mandatory === 1);
    const mandatoryComplete = mandatory.filter(r => r.status === 'complete').length;
    const missingMandatory = mandatory.length - mandatoryComplete;
    return {
      tenderId, totalRequirements: all.length,
      mandatoryComplete, mandatoryTotal: mandatory.length,
      missingMandatory, ready: missingMandatory === 0,
    };
  },
};

export const tenderSubmissionService = {
  addChecklistItem(params: {
    tenderId: string; item: string; category?: string;
  }) {
    return db.insert(tenderSubmissionChecklists).values({
      id: uuid(), tenderId: params.tenderId,
      item: params.item, category: params.category || 'general',
    }).returning().get();
  },

  checkItem(itemId: string, userId: string) {
    return db.update(tenderSubmissionChecklists).set({
      checked: 1, checkedBy: userId, checkedAt: new Date().toISOString(),
    }).where(eq(tenderSubmissionChecklists.id, itemId)).returning().get();
  },

  recordSubmissionEvidence(params: {
    tenderId: string; evidenceType: string; submittedBy: string;
    description?: string; fileUrl?: string;
  }) {
    db.update(tenderRecords).set({
      status: 'submitted', updatedAt: new Date().toISOString(),
    }).where(eq(tenderRecords.id, params.tenderId)).run();

    return db.insert(tenderSubmissionEvidence).values({
      id: uuid(), tenderId: params.tenderId,
      evidenceType: params.evidenceType,
      submittedBy: params.submittedBy,
      description: params.description || null,
      fileUrl: params.fileUrl || null,
    }).returning().get();
  },
};

export const tenderApprovalService = {
  submitForApproval(params: {
    tenderId: string; reviewedBy: string; decision: string;
    role?: string; stage?: string; comments?: string;
  }) {
    return db.insert(tenderApprovalReviews).values({
      id: uuid(), tenderId: params.tenderId,
      reviewedBy: params.reviewedBy, decision: params.decision,
      role: params.role || 'executive',
      stage: params.stage || 'final',
      comments: params.comments || null,
    }).returning().get();
  },

  getApprovals(tenderId: string) {
    return db.select().from(tenderApprovalReviews)
      .where(eq(tenderApprovalReviews.tenderId, tenderId)).all();
  },
};

export const tenderOutcomeService = {
  recordOutcome(params: {
    tenderId: string; result: string; recordedBy: string;
    contractValue?: number; announcedAt?: string;
    lessonsLearned?: string;
  }) {
    const outcome = db.insert(tenderOutcomes).values({
      id: uuid(), tenderId: params.tenderId,
      result: params.result, recordedBy: params.recordedBy,
      contractValue: params.contractValue ?? null,
      announcedAt: params.announcedAt || null,
      lessonsLearned: params.lessonsLearned || null,
    }).returning().get();

    const newStatus = params.result === 'won' ? 'won' : params.result === 'lost' ? 'lost' : 'pending';
    db.update(tenderRecords).set({
      status: newStatus, updatedAt: new Date().toISOString(),
    }).where(eq(tenderRecords.id, params.tenderId)).run();

    return outcome;
  },

  getWinLoss(companyId: string) {
    return db.select({
      tenderId: tenderRecords.id,
      projectName: tenderRecords.projectName,
      result: tenderOutcomes.result,
    }).from(tenderRecords)
      .innerJoin(tenderOutcomes, eq(tenderRecords.id, tenderOutcomes.tenderId))
      .where(eq(tenderRecords.companyId, companyId)).all();
  },
};

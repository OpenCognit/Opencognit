// =============================================================================
// Permit-to-Work Service — PR-HSE-2
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { hsePermits, hsePermitControls } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const permitService = {
  createPermit(params: {
    companyId: string; projectId?: string; permitType: string;
    location: string; validFrom: string; validTo: string;
    requestedBy: string; description?: string; riskLevel?: string;
    activityId?: string; workPackId?: string;
  }) {
    return db.insert(hsePermits).values({
      id: uuid(), companyId: params.companyId, projectId: params.projectId || null,
      permitType: params.permitType, location: params.location,
      validFrom: params.validFrom, validTo: params.validTo,
      requestedBy: params.requestedBy, description: params.description || null,
      riskLevel: params.riskLevel || 'medium',
      activityId: params.activityId || null, workPackId: params.workPackId || null,
    }).returning().get();
  },

  addControl(permitId: string, controlName: string, controlType?: string) {
    return db.insert(hsePermitControls).values({
      id: uuid(), permitId, controlName,
      controlType: controlType || 'check',
    }).returning().get();
  },

  approvePermit(permitId: string, approvedBy: string) {
    const now = new Date().toISOString();
    return db.update(hsePermits)
      .set({ status: 'approved', approvedBy, approvedAt: now, updatedAt: now })
      .where(eq(hsePermits.id, permitId)).returning().get();
  },

  issuePermit(permitId: string) {
    const now = new Date().toISOString();
    return db.update(hsePermits)
      .set({ status: 'active', issuedAt: now, updatedAt: now })
      .where(eq(hsePermits.id, permitId)).returning().get();
  },

  suspendPermit(permitId: string) {
    return db.update(hsePermits)
      .set({ status: 'suspended', updatedAt: new Date().toISOString() })
      .where(eq(hsePermits.id, permitId)).returning().get();
  },

  closePermit(permitId: string) {
    return db.update(hsePermits)
      .set({ status: 'closed', updatedAt: new Date().toISOString() })
      .where(eq(hsePermits.id, permitId)).returning().get();
  },

  getPermit(permitId: string) {
    const permit = db.select().from(hsePermits)
      .where(eq(hsePermits.id, permitId)).get();
    if (!permit) return null;
    const controls = db.select().from(hsePermitControls)
      .where(eq(hsePermitControls.permitId, permitId)).all();
    return { permit, controls };
  },

  checkControl(controlId: string, checkedBy: string, evidence?: string) {
    const now = new Date().toISOString();
    return db.update(hsePermitControls)
      .set({ status: 'complete', checkedBy, checkedAt: now, evidence: evidence || null, updatedAt: now })
      .where(eq(hsePermitControls.id, controlId)).returning().get();
  },

  getActivePermits(companyId: string) {
    return db.select().from(hsePermits)
      .where(and(
        eq(hsePermits.companyId, companyId),
        eq(hsePermits.status, 'active'),
      )).all();
  },

  findExpiredPermits(companyId: string) {
    const now = new Date().toISOString();
    return db.select().from(hsePermits)
      .where(and(
        eq(hsePermits.companyId, companyId),
        eq(hsePermits.status, 'active'),
      )).all()
      .filter(p => p.validTo < now);
  },

  checkWorkPackPermits(workPackId: string) {
    const permits = db.select().from(hsePermits)
      .where(eq(hsePermits.workPackId, workPackId)).all();

    const expired = permits.filter(p => p.validTo < new Date().toISOString());
    const suspended = permits.filter(p => p.status === 'suspended');
    const missing = permits.length === 0;

    // Check controls complete on active permits
    const active = permits.filter(p => p.status === 'active');
    let incompleteControls = 0;
    for (const p of active) {
      const controls = db.select().from(hsePermitControls)
        .where(eq(hsePermitControls.permitId, p.id)).all();
      incompleteControls += controls.filter(c => c.status !== 'complete').length;
    }

    const issues: string[] = [];
    if (missing) issues.push('No permits found');
    if (expired.length) issues.push(`${expired.length} permit(s) expired`);
    if (suspended.length) issues.push(`${suspended.length} permit(s) suspended`);
    if (incompleteControls) issues.push(`${incompleteControls} control(s) incomplete`);

    return {
      ready: issues.length === 0,
      issues,
      total: permits.length,
      activeCount: active.length,
      expiredCount: expired.length,
      suspendedCount: suspended.length,
      incompleteControls,
    };
  },
};

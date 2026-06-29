// =============================================================================
// Payroll Service — PR-PAY-1 Timesheet + Labour Allocation
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  attendanceRecords, timesheets, timesheetLines,
  labourCostAllocations, payrollAgentRecommendations, payrollReviews,
} from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export const payrollService = {
  markAttendance(params: {
    companyId: string; workerId: string; projectId: string; date: string;
    checkIn?: string; checkOut?: string; source?: string;
    status?: string; notes?: string;
  }) {
    return db.insert(attendanceRecords).values({
      id: uuid(), companyId: params.companyId,
      workerId: params.workerId, projectId: params.projectId,
      date: params.date, checkIn: params.checkIn || null,
      checkOut: params.checkOut || null,
      source: params.source || 'manual',
      status: params.status || 'present',
      notes: params.notes || null,
    }).returning().get();
  },

  createTimesheet(params: {
    companyId: string; workerId: string; projectId: string; date: string;
    crewId?: string; foremanId?: string; rateType?: string;
    createdBy: string;
  }) {
    return db.insert(timesheets).values({
      id: uuid(), companyId: params.companyId,
      workerId: params.workerId, projectId: params.projectId,
      date: params.date, crewId: params.crewId || null,
      foremanId: params.foremanId || null,
      rateType: params.rateType || 'hourly',
      createdBy: params.createdBy,
    }).returning().get();
  },

  addTimesheetLine(params: {
    timesheetId: string; normalHours: number; overtimeHours?: number;
    rateAmount?: number; activityId?: string; workPackId?: string;
    costCodeId?: string; boqItemId?: string; notes?: string;
  }) {
    const line = db.insert(timesheetLines).values({
      id: uuid(), timesheetId: params.timesheetId,
      normalHours: params.normalHours,
      overtimeHours: params.overtimeHours || 0,
      rateAmount: params.rateAmount || 0,
      activityId: params.activityId || null,
      workPackId: params.workPackId || null,
      costCodeId: params.costCodeId || null,
      boqItemId: params.boqItemId || null,
      notes: params.notes || null,
    }).returning().get();

    // Update totals on the timesheet
    // Recalculate from all lines
    const lines = db.select().from(timesheetLines)
      .where(eq(timesheetLines.timesheetId, params.timesheetId)).all();
    const totalNormal = lines.reduce((s, l) => s + l.normalHours, 0);
    const totalOvertime = lines.reduce((s, l) => s + l.overtimeHours, 0);
    db.update(timesheets).set({
      totalNormalHours: totalNormal,
      totalOvertimeHours: totalOvertime,
      updatedAt: new Date().toISOString(),
    }).where(eq(timesheets.id, params.timesheetId)).run();

    return line;
  },

  getTimesheet(timesheetId: string) {
    const ts = db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).get();
    if (!ts) return null;
    const lines = db.select().from(timesheetLines)
      .where(eq(timesheetLines.timesheetId, timesheetId)).all();
    return { ...ts, lines };
  },

  approveTimesheet(timesheetId: string, approvedBy: string) {
    return db.update(timesheets).set({
      status: 'approved', approvedBy, approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(timesheets.id, timesheetId)).returning().get();
  },

  rejectTimesheet(timesheetId: string, reason: string) {
    return db.update(timesheets).set({
      status: 'rejected', rejectionReason: reason,
      updatedAt: new Date().toISOString(),
    }).where(eq(timesheets.id, timesheetId)).returning().get();
  },

  allocateLabourCost(params: {
    companyId: string; timesheetLineId: string; projectId: string;
    labourCost: number; date: string;
    activityId?: string; costCodeId?: string; boqItemId?: string;
  }) {
    return db.insert(labourCostAllocations).values({
      id: uuid(), companyId: params.companyId,
      timesheetLineId: params.timesheetLineId,
      projectId: params.projectId, labourCost: params.labourCost,
      date: params.date, activityId: params.activityId || null,
      costCodeId: params.costCodeId || null,
      boqItemId: params.boqItemId || null,
    }).returning().get();
  },

  getLabourCostByActivity(projectId: string, activityId: string) {
    return db.select().from(labourCostAllocations)
      .where(and(
        eq(labourCostAllocations.projectId, projectId),
        eq(labourCostAllocations.activityId, activityId),
      )).all();
  },

  detectDuplicates(companyId: string, date: string) {
    return db.select({
      workerId: attendanceRecords.workerId,
      count: sql<number>`COUNT(*)`,
    }).from(attendanceRecords)
      .where(and(
        eq(attendanceRecords.companyId, companyId),
        eq(attendanceRecords.date, date),
      ))
      .groupBy(attendanceRecords.workerId)
      .having(sql`COUNT(*) > 1`)
      .all();
  },

  createRecommendation(params: {
    companyId: string; issue: string; severity?: string;
    workerId?: string; timesheetId?: string; projectId?: string;
    evidence?: string; recommendedAction?: string;
  }) {
    return db.insert(payrollAgentRecommendations).values({
      id: uuid(), companyId: params.companyId,
      issue: params.issue, severity: params.severity || 'medium',
      workerId: params.workerId || null,
      timesheetId: params.timesheetId || null,
      projectId: params.projectId || null,
      evidence: params.evidence || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },

  submitReview(params: {
    companyId: string; reviewedBy: string; decision: string;
    role?: string; comments?: string;
    timesheetId?: string; recommendationId?: string;
  }) {
    return db.insert(payrollReviews).values({
      id: uuid(), companyId: params.companyId,
      reviewedBy: params.reviewedBy, decision: params.decision,
      role: params.role || 'foreman',
      comments: params.comments || null,
      timesheetId: params.timesheetId || null,
      recommendationId: params.recommendationId || null,
      reviewedAt: new Date().toISOString(),
    }).returning().get();
  },
};

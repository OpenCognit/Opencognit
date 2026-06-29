// =============================================================================
// Payroll Overtime + Batch + Variance Service — PR-PAY-2+3+4+5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  overtimeRequests, overtimeApprovals, labourAllowances,
  payrollBatches, payrollBatchLines, payrollExceptions,
  timesheets, timesheetLines, labourCostAllocations,
} from '../db/schema';
import { eq, and, between, desc, sql } from 'drizzle-orm';

export const overtimeService = {
  requestOvertime(params: {
    companyId: string; workerId: string; projectId: string;
    date: string; hoursRequested: number; reason: string;
    requestedBy: string; activityId?: string; workPackId?: string;
  }) {
    return db.insert(overtimeRequests).values({
      id: uuid(), companyId: params.companyId,
      workerId: params.workerId, projektId: params.projectId,
      date: params.date, hoursRequested: params.hoursRequested,
      reason: params.reason, requestedBy: params.requestedBy,
      activityId: params.activityId || null,
      workPackId: params.workPackId || null,
    }).returning().get();
  },

  approveOvertime(requestId: string, params: {
    approvedBy: string; hoursApproved: number; role?: string;
    decision?: string; comments?: string;
  }) {
    const approval = db.insert(overtimeApprovals).values({
      id: uuid(), overtimeRequestId: requestId,
      approvedBy: params.approvedBy,
      hoursApproved: params.hoursApproved,
      role: params.role || 'foreman',
      decision: params.decision || 'approved',
      comments: params.comments || null,
    }).returning().get();

    const status = params.decision === 'rejected' ? 'rejected' : 'approved';
    db.update(overtimeRequests)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(overtimeRequests.id, requestId)).run();

    return approval;
  },

  findExcessiveOvertime(companyId: string, date: string) {
    return db.select({
      workerId: overtimeRequests.workerId,
      total: sql<number>`SUM(${overtimeRequests.hoursRequested})`,
    }).from(overtimeRequests)
      .where(and(
        eq(overtimeRequests.companyId, companyId),
        eq(overtimeRequests.date, date),
      ))
      .groupBy(overtimeRequests.workerId)
      .having(sql`SUM(${overtimeRequests.hoursRequested}) > 4`)
      .all();
  },
};

export const allowanceService = {
  addAllowance(params: {
    companyId: string; workerId?: string; timesheetId?: string;
    allowanceType: string; amount: number; date: string;
    description?: string;
  }) {
    return db.insert(labourAllowances).values({
      id: uuid(), companyId: params.companyId,
      workerId: params.workerId || null,
      timesheetId: params.timesheetId || null,
      allowanceType: params.allowanceType,
      amount: params.amount, date: params.date,
      description: params.description || null,
    }).returning().get();
  },
};

export const payrollBatchService = {
  createBatch(params: {
    companyId: string; periodStart: string; periodEnd: string;
    preparedBy?: string;
  }) {
    return db.insert(payrollBatches).values({
      id: uuid(), companyId: params.companyId,
      periodStart: params.periodStart, periodEnd: params.periodEnd,
      preparedBy: params.preparedBy || null,
    }).returning().get();
  },

  addBatchLine(batchId: string, timesheetId: string) {
    const ts = db.select().from(timesheets).where(eq(timesheets.id, timesheetId)).get();
    if (!ts) throw new Error('Timesheet not found');

    const rateAmount = ts.rateType === 'hourly' ? 350 : 0; // default hourly rate
    const grossPay = (ts.totalNormalHours * rateAmount) + (ts.totalOvertimeHours * rateAmount * 1.5);
    const allowancesTotal = ts.allowancesTotal || 0;

    return db.insert(payrollBatchLines).values({
      id: uuid(), payrollBatchId: batchId,
      timesheetId, workerId: ts.workerId,
      projectId: ts.projectId,
      normalHours: ts.totalNormalHours,
      overtimeHours: ts.totalOvertimeHours,
      rateAmount,
      grossPay,
      allowances: allowancesTotal,
      deductions: 0,
      netPay: grossPay + allowancesTotal,
    }).returning().get();
  },

  refreshBatchTotals(batchId: string) {
    const lines = db.select().from(payrollBatchLines)
      .where(eq(payrollBatchLines.payrollBatchId, batchId)).all();
    const totalWorkers = new Set(lines.map(l => l.workerId)).size;
    const totalNormal = lines.reduce((s, l) => s + l.normalHours, 0);
    const totalOvertime = lines.reduce((s, l) => s + l.overtimeHours, 0);
    const totalAllowances = lines.reduce((s, l) => s + l.allowances, 0);
    const totalGross = lines.reduce((s, l) => s + l.grossPay, 0);
    const totalDeductions = lines.reduce((s, l) => s + l.deductions, 0);
    const totalNet = lines.reduce((s, l) => s + l.netPay, 0);

    return db.update(payrollBatches).set({
      totalWorkers, totalNormalHours: totalNormal,
      totalOvertimeHours: totalOvertime, totalAllowances,
      totalGross, totalDeductions, totalNet,
      updatedAt: new Date().toISOString(),
    }).where(eq(payrollBatches.id, batchId)).returning().get();
  },

  approveBatch(batchId: string, approvedBy: string) {
    return db.update(payrollBatches).set({
      status: 'approved', approvedBy, approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(payrollBatches.id, batchId)).returning().get();
  },

  lockBatch(batchId: string) {
    return db.update(payrollBatches).set({
      status: 'locked', lockedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(payrollBatches.id, batchId)).returning().get();
  },

  getBatchSummary(batchId: string) {
    return db.select().from(payrollBatches).where(eq(payrollBatches.id, batchId)).get();
  },
};

export const payrollExceptionService = {
  flagException(params: {
    companyId: string; exceptionType: string; description: string;
    payrollBatchId?: string; timesheetId?: string; workerId?: string;
    severity?: string;
  }) {
    return db.insert(payrollExceptions).values({
      id: uuid(), companyId: params.companyId,
      exceptionType: params.exceptionType,
      description: params.description,
      payrollBatchId: params.payrollBatchId || null,
      timesheetId: params.timesheetId || null,
      workerId: params.workerId || null,
      severity: params.severity || 'medium',
    }).returning().get();
  },

  resolveException(exceptionId: string, resolvedBy: string) {
    return db.update(payrollExceptions).set({
      status: 'resolved', resolvedBy, resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(payrollExceptions.id, exceptionId)).returning().get();
  },

  getOpenExceptions(batchId: string) {
    return db.select().from(payrollExceptions)
      .where(and(
        eq(payrollExceptions.payrollBatchId, batchId),
        eq(payrollExceptions.status, 'open'),
      )).all();
  },
};

export const labourVarianceService = {
  getLabourCostVariance(projectId: string, boqItemId: string) {
    const allocations = db.select().from(labourCostAllocations)
      .where(and(
        eq(labourCostAllocations.projectId, projectId),
        eq(labourCostAllocations.boqItemId, boqItemId),
      )).all();
    const totalLabourCost = allocations.reduce((s, a) => s + a.labourCost, 0);
    return { boqItemId, projectId, totalLabourCost, allocations };
  },

  getActivityLabourCost(projectId: string) {
    return db.select({
      activityId: labourCostAllocations.activityId,
      totalCost: sql<number>`SUM(${labourCostAllocations.labourCost})`,
      days: sql<number>`COUNT(DISTINCT ${labourCostAllocations.date})`,
    }).from(labourCostAllocations)
      .where(eq(labourCostAllocations.projectId, projectId))
      .groupBy(labourCostAllocations.activityId)
      .all();
  },
};

// =============================================================================
// HSE Service — PR-HSE-1 Toolbox Talks + Readiness
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  hseToolboxTalks, hseToolboxAttendance, hseWorkerInductions,
  hsePpeChecks, hseAgentRecommendations,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const hseService = {
  // Toolbox Talks
  createToolboxTalk(params: {
    companyId: string; projectId?: string; topic: string;
    activityId?: string; workPackId?: string; crewId?: string;
    date: string; time?: string; foremanId: string;
    hazardsDiscussed?: string; controlsAgreed?: string;
  }) {
    return db.insert(hseToolboxTalks).values({
      id: uuid(), companyId: params.companyId, projectId: params.projectId || null,
      topic: params.topic, activityId: params.activityId || null,
      workPackId: params.workPackId || null, crewId: params.crewId || null,
      date: params.date, time: params.time || null,
      foremanId: params.foremanId, hazardsDiscussed: params.hazardsDiscussed || null,
      controlsAgreed: params.controlsAgreed || null,
    }).returning().get();
  },

  addAttendance(toolboxId: string, workers: { workerId: string; workerName: string }[]) {
    return workers.map(w => db.insert(hseToolboxAttendance).values({
      id: uuid(), toolboxId, workerId: w.workerId, workerName: w.workerName,
    }).returning().get());
  },

  completeToolboxTalk(toolboxId: string) {
    const now = new Date().toISOString();
    return db.update(hseToolboxTalks)
      .set({ status: 'complete', updatedAt: now })
      .where(eq(hseToolboxTalks.id, toolboxId)).returning().get();
  },

  getToolboxTalk(toolboxId: string) {
    const talk = db.select().from(hseToolboxTalks)
      .where(eq(hseToolboxTalks.id, toolboxId)).get();
    if (!talk) return null;
    const att = db.select().from(hseToolboxAttendance)
      .where(eq(hseToolboxAttendance.toolboxId, toolboxId)).all();
    return { talk, attendance: att };
  },

  getWorkPackToolbox(workPackId: string) {
    return db.select().from(hseToolboxTalks)
      .where(eq(hseToolboxTalks.workPackId, workPackId)).all();
  },

  getDailyToolboxTalks(companyId: string, date: string) {
    return db.select().from(hseToolboxTalks)
      .where(and(
        eq(hseToolboxTalks.companyId, companyId),
        eq(hseToolboxTalks.date, date),
      )).all();
  },

  // Worker Inductions
  recordInduction(params: {
    companyId: string; workerId: string; inductionType?: string;
    inductedAt: string; expiryAt?: string; completedBy: string;
  }) {
    return db.insert(hseWorkerInductions).values({
      id: uuid(), companyId: params.companyId, workerId: params.workerId,
      inductionType: params.inductionType || 'general',
      inductedAt: params.inductedAt, expiryAt: params.expiryAt || null,
      completedBy: params.completedBy,
    }).returning().get();
  },

  getWorkerInductions(workerId: string) {
    return db.select().from(hseWorkerInductions)
      .where(eq(hseWorkerInductions.workerId, workerId))
      .orderBy(desc(hseWorkerInductions.inductedAt)).all();
  },

  findExpiredInductions(companyId: string) {
    const now = new Date().toISOString();
    return db.select().from(hseWorkerInductions)
      .where(eq(hseWorkerInductions.companyId, companyId))
      .all()
      .filter(i => i.expiryAt && i.expiryAt < now);
  },

  // PPE Checks
  recordPpeCheck(params: {
    companyId: string; workerId: string; date: string;
    helmet?: boolean; boots?: boolean; vest?: boolean;
    gloves?: boolean; goggles?: boolean; harness?: boolean;
    respiratory?: boolean; checkedBy: string;
    comments?: string; workPackId?: string;
  }) {
    const pass = [params.helmet, params.boots, params.vest, params.gloves,
      params.goggles, params.harness, params.respiratory]
      .filter(v => v !== undefined);
    const allOk = pass.every(v => v === true);

    return db.insert(hsePpeChecks).values({
      id: uuid(), companyId: params.companyId, workerId: params.workerId,
      date: params.date,
      helmet: params.helmet !== undefined ? (params.helmet ? 1 : 0) : null,
      boots: params.boots !== undefined ? (params.boots ? 1 : 0) : null,
      vest: params.vest !== undefined ? (params.vest ? 1 : 0) : null,
      gloves: params.gloves !== undefined ? (params.gloves ? 1 : 0) : null,
      goggles: params.goggles !== undefined ? (params.goggles ? 1 : 0) : null,
      harness: params.harness !== undefined ? (params.harness ? 1 : 0) : null,
      respiratory: params.respiratory !== undefined ? (params.respiratory ? 1 : 0) : null,
      status: allOk ? 'ok' : 'issue', checkedBy: params.checkedBy,
      comments: params.comments || null, workPackId: params.workPackId || null,
    }).returning().get();
  },

  // Agent Recommendations
  createRecommendation(params: {
    companyId: string; projectId?: string; issue: string;
    severity?: string; affectedWorkPack?: string; affectedWorkerId?: string;
    evidence?: string; recommendedAction?: string;
  }) {
    return db.insert(hseAgentRecommendations).values({
      id: uuid(), companyId: params.companyId, projectId: params.projectId || null,
      issue: params.issue, severity: params.severity || 'medium',
      affectedWorkPack: params.affectedWorkPack || null,
      affectedWorkerId: params.affectedWorkerId || null,
      evidence: params.evidence || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },

  reviewRecommendation(recId: string, status: string) {
    const now = new Date().toISOString();
    return db.update(hseAgentRecommendations)
      .set({ status, reviewedAt: now, updatedAt: now })
      .where(eq(hseAgentRecommendations.id, recId)).returning().get();
  },

  getPendingRecommendations(companyId: string) {
    return db.select().from(hseAgentRecommendations)
      .where(eq(hseAgentRecommendations.companyId, companyId))
      .orderBy(desc(hseAgentRecommendations.detectedAt)).all();
  },

  // HSE Readiness check for work pack release
  checkWorkPackReadiness(companyId: string, workPackId: string) {
    const talk = this.getWorkPackToolbox(workPackId);
    const issues: string[] = [];

    const talks = talk || [];
    const completedTalks = talks.filter(t => t.status === 'complete');
    if (talks.length === 0) issues.push('No toolbox talk assigned');
    if (completedTalks.length < talks.length) {
      issues.push(`${talks.length - completedTalks.length} toolbox talk(s) incomplete`);
    }

    return {
      ready: issues.length === 0,
      issues,
      toolboxTalks: talks.length,
      completedTalks: completedTalks.length,
    };
  },
};

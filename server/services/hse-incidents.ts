// =============================================================================
// Incident + Near-Miss Service — PR-HSE-3
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { hseIncidents, hseIncidentInvestigations, hseObservations } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const incidentService = {
  // Incidents
  reportIncident(params: {
    companyId: string; projectId?: string; incidentType: string;
    severity: string; title: string; description?: string;
    location: string; date: string; time?: string;
    reportedBy: string; immediateAction?: string;
    activityId?: string; workPackId?: string;
  }) {
    return db.insert(hseIncidents).values({
      id: uuid(), companyId: params.companyId, projectId: params.projectId || null,
      incidentType: params.incidentType, severity: params.severity,
      title: params.title, description: params.description || null,
      location: params.location, date: params.date, time: params.time || null,
      reportedBy: params.reportedBy, immediateAction: params.immediateAction || null,
      activityId: params.activityId || null, workPackId: params.workPackId || null,
    }).returning().get();
  },

  escalateIncident(incidentId: string, severity: string) {
    return db.update(hseIncidents)
      .set({ severity, updatedAt: new Date().toISOString() })
      .where(eq(hseIncidents.id, incidentId)).returning().get();
  },

  closeIncident(incidentId: string) {
    const now = new Date().toISOString();
    return db.update(hseIncidents)
      .set({ status: 'closed', closedAt: now, updatedAt: now })
      .where(eq(hseIncidents.id, incidentId)).returning().get();
  },

  getIncident(incidentId: string) {
    const incident = db.select().from(hseIncidents)
      .where(eq(hseIncidents.id, incidentId)).get();
    if (!incident) return null;
    const investigation = db.select().from(hseIncidentInvestigations)
      .where(eq(hseIncidentInvestigations.incidentId, incidentId)).limit(1).all();
    return { incident, investigations: investigation };
  },

  getOpenIncidents(companyId: string) {
    return db.select().from(hseIncidents)
      .where(and(
        eq(hseIncidents.companyId, companyId),
        eq(hseIncidents.status, 'open'),
      )).orderBy(desc(hseIncidents.createdAt)).all();
  },

  getCriticalIncidents(companyId: string) {
    return db.select().from(hseIncidents)
      .where(and(
        eq(hseIncidents.companyId, companyId),
        eq(hseIncidents.severity, 'critical'),
      )).all();
  },

  // Investigations
  startInvestigation(params: {
    incidentId: string; assignedTo: string;
  }) {
    return db.insert(hseIncidentInvestigations).values({
      id: uuid(), incidentId: params.incidentId,
      assignedTo: params.assignedTo, startedAt: new Date().toISOString(),
    }).returning().get();
  },

  completeInvestigation(investigationId: string, params: {
    rootCause?: string; contributingFactors?: string;
    findings?: string; recommendations?: string;
  }) {
    const now = new Date().toISOString();
    const inv = db.update(hseIncidentInvestigations).set({
      rootCause: params.rootCause || null,
      contributingFactors: params.contributingFactors || null,
      findings: params.findings || null,
      recommendations: params.recommendations || null,
      status: 'completed', completedAt: now, updatedAt: now,
    }).where(eq(hseIncidentInvestigations.id, investigationId)).returning().get();

    // Update incident investigation_status
    if (inv) {
      db.update(hseIncidents)
        .set({ investigationStatus: 'completed', updatedAt: now })
        .where(eq(hseIncidents.id, inv.incidentId)).run();
    }
    return inv;
  },

  // Observations
  reportObservation(params: {
    companyId: string; projectId?: string; observationType: string;
    severity?: string; description: string; location: string;
    date: string; reportedBy?: string;
    activityId?: string; workPackId?: string;
  }) {
    return db.insert(hseObservations).values({
      id: uuid(), companyId: params.companyId, projectId: params.projectId || null,
      observationType: params.observationType,
      severity: params.severity || 'low', description: params.description,
      location: params.location, date: params.date,
      reportedBy: params.reportedBy || null,
      activityId: params.activityId || null, workPackId: params.workPackId || null,
    }).returning().get();
  },

  resolveObservation(observationId: string, resolvedBy: string) {
    const now = new Date().toISOString();
    return db.update(hseObservations)
      .set({ status: 'resolved', resolvedAt: now, resolvedBy, updatedAt: now })
      .where(eq(hseObservations.id, observationId)).returning().get();
  },

  getOpenObservations(companyId: string) {
    return db.select().from(hseObservations)
      .where(and(
        eq(hseObservations.companyId, companyId),
        eq(hseObservations.status, 'open'),
      )).all();
  },
};

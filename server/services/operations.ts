// =============================================================================
// Operations Service — PR-OPS-1 Platform Health + Incident Register
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  platformHealthChecks,
  platformIncidents,
  platformIncidentEvents,
  platformErrorLogs,
  platformReleaseHealth,
  platformObservabilityAlerts,
} from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type HealthCheck = InferSelectModel<typeof platformHealthChecks>;
export type Incident = InferSelectModel<typeof platformIncidents>;
export type IncidentEvent = InferSelectModel<typeof platformIncidentEvents>;
export type ErrorLog = InferSelectModel<typeof platformErrorLogs>;
export type ReleaseHealth = InferSelectModel<typeof platformReleaseHealth>;
export type ObservabilityAlert = InferSelectModel<typeof platformObservabilityAlerts>;

export interface HealthCheckParams {
  companyId: string;
  checkType: string;   // 'gateway', 'database', 'agent', 'route', 'integration'
  status: string;       // 'healthy', 'degraded', 'critical'
  target?: string;
  latencyMs?: number;
  message?: string;
}

export interface CreateIncidentParams {
  companyId: string;
  title: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  affectedModule?: string;
  affectedTenantId?: string;
  affectedProjectId?: string;
  releaseId?: string;
  detectedBy?: string;  // 'agent', 'user', 'health_check', 'integration'
}

export interface UpdateIncidentParams {
  status?: string;
  owner?: string;
  severity?: string;
}

export interface LogErrorParams {
  companyId: string;
  module: string;
  route?: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  statusCode?: number;
  releaseId?: string;
  affectedTenantId?: string;
  affectedUserId?: string;
}

export interface CreateAlertParams {
  companyId: string;
  agentId?: string;
  issue: string;
  severity: string;
  affectedModule?: string;
  affectedTenantId?: string;
  affectedProjectId?: string;
  evidence?: string;
  suspectedCause?: string;
  recommendedAction?: string;
}

export interface RegisterReleaseParams {
  companyId: string;
  version: string;
  commitSha: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const opsService = {
  // -------------------------------------------------------------------------
  // Health Checks
  // -------------------------------------------------------------------------
  recordHealthCheck(params: HealthCheckParams): HealthCheck {
    return db.insert(platformHealthChecks).values({
      id: uuid(),
      companyId: params.companyId,
      checkType: params.checkType,
      status: params.status,
      target: params.target || null,
      latencyMs: params.latencyMs ?? null,
      message: params.message || null,
    }).returning().get();
  },

  getLatestHealthChecks(companyId: string) {
    // Get latest check per type
    const types = ['gateway', 'database', 'agent', 'route', 'integration'];
    const results: Record<string, HealthCheck | null> = {};
    for (const type of types) {
      results[type] = db.select()
        .from(platformHealthChecks)
        .where(and(
          eq(platformHealthChecks.companyId, companyId),
          eq(platformHealthChecks.checkType, type),
        ))
        .orderBy(desc(platformHealthChecks.createdAt))
        .limit(1)
        .get() || null;
    }
    return results;
  },

  // -------------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------------
  createIncident(params: CreateIncidentParams): Incident {
    const incidentId = uuid();
    const now = new Date().toISOString();

    const incident = db.insert(platformIncidents).values({
      id: incidentId,
      companyId: params.companyId,
      title: params.title,
      severity: params.severity,
      affectedModule: params.affectedModule || null,
      affectedTenantId: params.affectedTenantId || null,
      affectedProjectId: params.affectedProjectId || null,
      releaseId: params.releaseId || null,
      detectedBy: params.detectedBy || 'system',
      detectedAt: now,
    }).returning().get();

    // Record creation event
    db.insert(platformIncidentEvents).values({
      id: uuid(),
      incidentId,
      eventType: 'detected',
      actor: params.detectedBy || 'system',
      createdAt: now,
    }).run();

    return incident;
  },

  updateIncident(incidentId: string, params: UpdateIncidentParams): Incident {
    const now = new Date().toISOString();
    const updates: Record<string, any> = { updatedAt: now };

    if (params.status) updates.status = params.status;
    if (params.owner) updates.owner = params.owner;
    if (params.severity) updates.severity = params.severity;

    if (params.status === 'resolved') {
      updates.resolvedAt = now;
    }

    const incident = db.update(platformIncidents)
      .set(updates)
      .where(eq(platformIncidents.id, incidentId))
      .returning()
      .get();

    // Record event for non-trivial transitions
    if (params.status) {
      const eventType = this.statusToEventType(params.status);
      if (eventType) {
        db.insert(platformIncidentEvents).values({
          id: uuid(),
          incidentId,
          eventType,
          actor: 'system',
          createdAt: now,
        }).run();
      }
    }
    if (params.owner) {
      db.insert(platformIncidentEvents).values({
        id: uuid(),
        incidentId,
        eventType: 'owner_assigned',
        actor: 'system',
        createdAt: now,
      }).run();
    }

    return incident;
  },

  getIncident(incidentId: string): { incident: Incident; events: IncidentEvent[] } | null {
    const incident = db.select().from(platformIncidents)
      .where(eq(platformIncidents.id, incidentId)).get();
    if (!incident) return null;

    const events = db.select().from(platformIncidentEvents)
      .where(eq(platformIncidentEvents.incidentId, incidentId))
      .orderBy(sql`${platformIncidentEvents.createdAt} ASC`)
      .all();

    return { incident, events };
  },

  listActiveIncidents(companyId: string): Incident[] {
    return db.select().from(platformIncidents)
      .where(and(
        eq(platformIncidents.companyId, companyId),
        sql`${platformIncidents.status} NOT IN ('resolved', 'closed')`
      ))
      .orderBy(sql`CASE ${platformIncidents.severity} WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 WHEN 'P3' THEN 4 WHEN 'P4' THEN 5 END`)
      .all();
  },

  // -------------------------------------------------------------------------
  // Error Logging (with deduplication)
  // -------------------------------------------------------------------------
  logError(params: LogErrorParams): ErrorLog {
    const now = new Date().toISOString();

    // Check for existing error with same dedup key
    const existing = db.select()
      .from(platformErrorLogs)
      .where(and(
        eq(platformErrorLogs.companyId, params.companyId),
        eq(platformErrorLogs.module, params.module),
        eq(platformErrorLogs.route, params.route || ''),
        eq(platformErrorLogs.errorType, params.errorType),
      ))
      .get();

    if (existing) {
      return db.update(platformErrorLogs)
        .set({
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now,
          updatedAt: now,
          statusCode: params.statusCode ?? existing.statusCode,
          errorMessage: params.errorMessage,
          stackTrace: params.stackTrace || existing.stackTrace,
          releaseId: params.releaseId || existing.releaseId,
        })
        .where(eq(platformErrorLogs.id, existing.id))
        .returning()
        .get();
    }

    // New error
    return db.insert(platformErrorLogs).values({
      id: uuid(),
      companyId: params.companyId,
      module: params.module,
      route: params.route || null,
      errorType: params.errorType,
      errorMessage: params.errorMessage,
      stackTrace: params.stackTrace || null,
      statusCode: params.statusCode ?? null,
      releaseId: params.releaseId || null,
      affectedTenantId: params.affectedTenantId || null,
      affectedUserId: params.affectedUserId || null,
      firstSeenAt: now,
      lastSeenAt: now,
    }).returning().get();
  },

  // -------------------------------------------------------------------------
  // Release Health
  // -------------------------------------------------------------------------
  registerRelease(params: RegisterReleaseParams): ReleaseHealth {
    return db.insert(platformReleaseHealth).values({
      id: uuid(),
      companyId: params.companyId,
      version: params.version,
      commitSha: params.commitSha,
      description: params.description || null,
    }).returning().get();
  },

  detectRegression(releaseId: string): ReleaseHealth {
    const now = new Date().toISOString();

    // Count errors since release
    const release = db.select().from(platformReleaseHealth)
      .where(eq(platformReleaseHealth.id, releaseId)).get();
    if (!release) throw new Error(`Release ${releaseId} not found.`);

    const recentCount = db.select({ count: sql<number>`COUNT(*)` })
      .from(platformErrorLogs)
      .where(eq(platformErrorLogs.releaseId, releaseId))
      .get();

    const isSpike = (recentCount?.count ?? 0) >= 10;

    return db.update(platformReleaseHealth)
      .set({
        errorSpikeDetected: isSpike ? 1 : 0,
        regressionCount: recentCount?.count ?? 0,
        status: isSpike ? 'degraded' : 'healthy',
        rollbackRecommended: isSpike ? 1 : 0,
        updatedAt: now,
      })
      .where(eq(platformReleaseHealth.id, releaseId))
      .returning()
      .get();
  },

  // -------------------------------------------------------------------------
  // Observability Alerts
  // -------------------------------------------------------------------------
  createAlert(params: CreateAlertParams): ObservabilityAlert {
    return db.insert(platformObservabilityAlerts).values({
      id: uuid(),
      companyId: params.companyId,
      agentId: params.agentId || null,
      issue: params.issue,
      severity: params.severity,
      affectedModule: params.affectedModule || null,
      affectedTenantId: params.affectedTenantId || null,
      affectedProjectId: params.affectedProjectId || null,
      evidence: params.evidence || null,
      suspectedCause: params.suspectedCause || null,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },

  linkAlertToIncident(alertId: string, incidentId: string): void {
    db.update(platformObservabilityAlerts)
      .set({ linkIncidentId: incidentId, updatedAt: new Date().toISOString() })
      .where(eq(platformObservabilityAlerts.id, alertId))
      .run();
  },

  acknowledgeAlert(alertId: string): void {
    db.update(platformObservabilityAlerts)
      .set({ acknowledgedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(platformObservabilityAlerts.id, alertId))
      .run();
  },

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  statusToEventType(status: string): string | null {
    const map: Record<string, string> = {
      'open': 'detected',
      'investigating': 'investigating',
      'owner_assigned': 'owner_assigned',
      'mitigated': 'mitigated',
      'resolved': 'resolved',
      'closed': 'closed',
      'reopened': 'reopened',
    };
    return map[status] || null;
  },
};

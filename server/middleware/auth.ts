// =============================================================================
// Auth Middleware — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work. Pure module: no side effects on import,
// no globals written. Functions read JWT_SECRET from process.env at call time
// so the existing index.ts startup validation (which sets a dev fallback)
// still gates whether this module produces valid tokens.
// =============================================================================

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { fromNodeHeaders } from 'better-auth/node';
import { eq, and } from 'drizzle-orm';

import { auth as betterAuth } from '../auth.js';
import { db } from '../db/client.js';
import {
  users,
  companyMemberships,
  agents,
  tasks,
  projects,
  approvals,
  routines,
  routineTrigger,
  agentMeetings,
  skillsLibrary,
  executionWorkspaces,
  workProducts,
  comments,
  goals,
  costEntries,
  budgetPolicies,
  budgetIncidents,
  palaceWings,
  palaceDrawers,
  palaceDiary,
  palaceKg,
} from '../db/schema.js';

// ---------------------------------------------------------------------------
// authMiddleware — BetterAuth session, JWT fallback for legacy tokens
// ---------------------------------------------------------------------------
export async function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // 1. Try BetterAuth session first
  try {
    const session = await betterAuth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session?.user) {
      (req as any).users = {
        userId: session.user.id,
        email: session.user.email,
        rolle: (session.user as any).role ?? 'mitglied',
      };
      return next();
    }
  } catch {
    // Session check failed — fall through to JWT
  }

  // 2. JWT fallback (legacy tokens during migration)
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string;

  if (!authHeader?.startsWith('Bearer ') && !queryToken) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  try {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
    if (!token) throw new Error('No token');
    const secret = process.env.JWT_SECRET as string;
    const payload = jwt.verify(token, secret) as { userId: string; email: string; rolle: string };
    // Verify user still exists in DB (prevents stale tokens after user deletion)
    const user = db.select({ id: users.id }).from(users).where(eq(users.id, payload.userId)).get();
    if (!user) return res.status(401).json({ error: 'User not found.' });
    (req as any).users = payload;
    next();
  } catch (err: any) {
    console.error('[Auth] Validation failed:', err?.message);
    return res.status(401).json({ error: 'Token invalid or expired.' });
  }
}

// ---------------------------------------------------------------------------
// requireCompanyAccess — must run AFTER authMiddleware
// ---------------------------------------------------------------------------
/**
 * Requires that the authenticated user has a membership in the requested company.
 *
 * @param allowedRoles - optional array of roles (e.g. ['owner','admin']).
 *                      If omitted, any membership works.
 */
export function requireCompanyAccess(allowedRoles?: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = (req as any).users?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    // Extract companyId from various param names used across the API
    const companyId =
      req.params.unternehmenId ||
      req.params.companyId ||
      req.params.id ||
      (req.body as any)?.companyId ||
      (req.query.unternehmenId as string | undefined) ||
      (req.query.companyId as string | undefined) ||
      (req.headers['x-company-id'] as string | undefined);

    if (!companyId) {
      // Some endpoints don't have a company context (e.g. /api/plugin-registry)
      return next();
    }

    const membership = db.select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.userId, userId),
          eq(companyMemberships.companyId, companyId as string),
        ),
      )
      .get();

    if (!membership) {
      return res.status(403).json({ error: 'You do not have access to this company.' });
    }

    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }

    // Attach membership + resolved companyId to request for downstream use
    (req as any).companyMembership = membership;
    (req as any).companyId = companyId;
    next();
  };
}

// ---------------------------------------------------------------------------
// requireResourceAccess — resolves a resource by id, checks company membership
// ---------------------------------------------------------------------------
export type ResourceType =
  | 'agent' | 'task' | 'project' | 'approval' | 'routine' | 'trigger'
  | 'meeting' | 'skillsLibrary' | 'workspace' | 'workProduct' | 'comment'
  | 'palaceWing' | 'palaceDrawer' | 'palaceDiary' | 'palaceKgFact'
  | 'budgetPolicy' | 'budgetIncident' | 'goal' | 'costEntry';

function resolveCompanyIdForResource(type: ResourceType, id: string): string | null {
  switch (type) {
    case 'agent':         return db.select({ c: agents.companyId }).from(agents).where(eq(agents.id, id)).get()?.c ?? null;
    case 'task':          return db.select({ c: tasks.companyId }).from(tasks).where(eq(tasks.id, id)).get()?.c ?? null;
    case 'project':       return db.select({ c: projects.companyId }).from(projects).where(eq(projects.id, id)).get()?.c ?? null;
    case 'approval':      return db.select({ c: approvals.companyId }).from(approvals).where(eq(approvals.id, id)).get()?.c ?? null;
    case 'routine':       return db.select({ c: routines.companyId }).from(routines).where(eq(routines.id, id)).get()?.c ?? null;
    case 'trigger':       return db.select({ c: routineTrigger.companyId }).from(routineTrigger).where(eq(routineTrigger.id, id)).get()?.c ?? null;
    case 'meeting':       return db.select({ c: agentMeetings.companyId }).from(agentMeetings).where(eq(agentMeetings.id, id)).get()?.c ?? null;
    case 'skillsLibrary': return db.select({ c: skillsLibrary.companyId }).from(skillsLibrary).where(eq(skillsLibrary.id, id)).get()?.c ?? null;
    case 'workspace':     return db.select({ c: executionWorkspaces.companyId }).from(executionWorkspaces).where(eq(executionWorkspaces.id, id)).get()?.c ?? null;
    case 'workProduct':   return db.select({ c: workProducts.companyId }).from(workProducts).where(eq(workProducts.id, id)).get()?.c ?? null;
    case 'comment':       return db.select({ c: comments.companyId }).from(comments).where(eq(comments.id, id)).get()?.c ?? null;
    case 'goal':          return db.select({ c: goals.companyId }).from(goals).where(eq(goals.id, id)).get()?.c ?? null;
    case 'costEntry':     return db.select({ c: costEntries.companyId }).from(costEntries).where(eq(costEntries.id, id)).get()?.c ?? null;
    case 'budgetPolicy':  return db.select({ c: budgetPolicies.companyId }).from(budgetPolicies).where(eq(budgetPolicies.id, id)).get()?.c ?? null;
    case 'budgetIncident':return db.select({ c: budgetIncidents.companyId }).from(budgetIncidents).where(eq(budgetIncidents.id, id)).get()?.c ?? null;
    case 'palaceWing':    return db.select({ c: palaceWings.companyId }).from(palaceWings).where(eq(palaceWings.id, id)).get()?.c ?? null;
    case 'palaceKgFact':  return db.select({ c: palaceKg.companyId }).from(palaceKg).where(eq(palaceKg.id, id)).get()?.c ?? null;
    case 'palaceDrawer': {
      const row = db.select({ wid: palaceDrawers.wingId }).from(palaceDrawers).where(eq(palaceDrawers.id, id)).get();
      if (!row) return null;
      return db.select({ c: palaceWings.companyId }).from(palaceWings).where(eq(palaceWings.id, row.wid)).get()?.c ?? null;
    }
    case 'palaceDiary': {
      const row = db.select({ wid: palaceDiary.wingId }).from(palaceDiary).where(eq(palaceDiary.id, id)).get();
      if (!row) return null;
      return db.select({ c: palaceWings.companyId }).from(palaceWings).where(eq(palaceWings.id, row.wid)).get()?.c ?? null;
    }
  }
}

export function requireResourceAccess(
  resourceType: ResourceType,
  paramName: string = 'id',
  allowedRoles?: string[],
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = (req as any).users?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated.' });

    const resourceId = req.params[paramName] as string | undefined;
    if (!resourceId) return res.status(400).json({ error: `Missing :${paramName} param` });

    const companyId = resolveCompanyIdForResource(resourceType, resourceId);
    if (!companyId) return res.status(404).json({ error: `${resourceType} not found` });

    const membership = db.select()
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.userId, userId),
        eq(companyMemberships.companyId, companyId),
      ))
      .get();

    if (!membership) return res.status(403).json({ error: 'You do not have access to this company.' });
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }

    (req as any).companyMembership = membership;
    (req as any).resolvedCompanyId = companyId;
    next();
  };
}

// ---------------------------------------------------------------------------
// agentAuth — token-based auth for agents calling /api/agent/*
// ---------------------------------------------------------------------------

// Token = "ak_" + HMAC-SHA256(JWT_SECRET, agentId:companyId)[0..31]
export function deriveAgentToken(agentId: string, companyId: string): string {
  const secret = process.env.JWT_SECRET as string;
  return 'ak_' + crypto.createHmac('sha256', secret).update(`${agentId}:${companyId}`).digest('hex').slice(0, 32);
}

export const agentAuth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const expertId = req.headers['x-expert-id'] || req.headers['x-agent-id'] || process.env.OPENCOGNIT_EXPERT_ID;
  const unternehmenId = req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id'] || process.env.OPENCOGNIT_UNTERNEHMEN_ID;

  if (!authHeader || !authHeader.startsWith('Bearer ak_')) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API Key format.' });
  }

  if (!expertId || !unternehmenId) {
    return res.status(400).json({ error: 'Missing x-agent-id or x-company-id headers' });
  }

  // Verify the token cryptographically — must match HMAC(secret, agentId:companyId)
  const providedToken = authHeader.slice(7);
  const expectedToken = deriveAgentToken(expertId as string, unternehmenId as string);
  const providedBuf = Buffer.from(providedToken);
  const expectedBuf = Buffer.from(expectedToken);
  if (providedBuf.length !== expectedBuf.length) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  // Verify agent exists and belongs to company
  const expert = db.select()
    .from(agents)
    .where(and(eq(agents.id, expertId as string), eq(agents.companyId, unternehmenId as string)))
    .get();

  if (!expert) {
    return res.status(401).json({ error: 'Agent not found or does not belong to company' });
  }

  // Check if agent is paused or terminated
  if (expert.status === 'paused' || expert.status === 'terminated') {
    return res.status(403).json({ error: `Agent is ${expert.status}`, status: expert.status });
  }

  (req as any).expert = expert;
  req.body.agentId = expertId;
  req.body.companyId = unternehmenId;
  next();
};

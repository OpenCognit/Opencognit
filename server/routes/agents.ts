// =============================================================================
// Agents routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// In scope: list/create company-agents, GET/PATCH/DELETE single, get-token,
// pause/resume, config-history (list + restore), permissions (get + set),
// activity, wakeup, performance (single + company leaderboard), inbox,
// team-status, stats.
//
// Out of scope (future routers): SOUL.md endpoints, chat (SSE streaming),
// trace, agent-skills + agent-skills-library (under /api/agents/:id/skills),
// the token-based /api/agent/* endpoints used by external agent clients.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { eq, and, or, desc, sql, count, inArray, isNotNull, isNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  agents,
  agentPermissions,
  agentConfigHistory,
  agentMeetings,
  agentTrustScores,
  agentVotes,
  agentCapabilities,
  agentWakeupRequests,
  agentSkills,
  contractNetBids,
  tasks,
  comments,
  goals,
  routines,
  projects,
  approvals,
  issueRelations,
  workCycles,
  workCyclesArchive,
  workProducts,
  traceEvents,
  chatMessages,
  costEntries,
  activityLog,
  executionWorkspaces,
  ceoDecisionLog,
  palaceWings,
  palaceDrawers,
  palaceDiary,
  palaceSummaries,
  palaceKg,
} from '../db/schema.js';
import { wakeupService } from '../services/wakeup.js';
import { messagingService } from '../services/messaging.js';
import { logAktivitaet } from '../services/activity-log.js';
import { appEvents } from '../events.js';
import { validate } from '../utils/validate.js';
import {
  authMiddleware,
  requireCompanyAccess,
  requireResourceAccess,
  deriveAgentToken,
} from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();
const broadcast = (type: string, data: any) => appEvents.emit('broadcast', { type, data });

const zAgent = z.object({
  name: z.string().min(1).max(100),
  rolle: z.string().min(1).max(100),
  titel: z.string().max(100).nullish(),
  faehigkeiten: z.string().max(2000).nullish(),
  verbindungsTyp: z.string().max(50).nullish(),
  budgetMonatCent: z.number().int().min(0).max(10_000_000).nullish(),
  systemPrompt: z.string().max(10_000).nullish(),
}).passthrough();

// Frontend (Experte type in src/api/client.ts) expects German-keyed agent objects.
// Used by both list, single-GET, and PATCH responses so the shape is consistent —
// otherwise editing settings (which calls PATCH and writes the response back into
// `expert` state) silently breaks downstream code that reads `expert.unternehmenId`,
// `expert.verbindungsTyp` etc.
function mapAgentToFrontend(a: any) {
  return {
    id: a.id,
    unternehmenId: a.companyId,
    name: a.name,
    rolle: a.role,
    titel: a.title,
    status: a.status,
    reportsTo: a.reportsTo,
    faehigkeiten: a.skills,
    verbindungsTyp: a.connectionType,
    verbindungsConfig: a.connectionConfig,
    avatar: a.avatar,
    avatarFarbe: a.avatarColor,
    budgetMonatCent: a.monthlyBudgetCent,
    verbrauchtMonatCent: a.monthlySpendCent,
    letzterZyklus: a.lastCycle,
    zyklusIntervallSek: a.autoCycleIntervalSec,
    zyklusAktiv: a.autoCycleActive,
    isOrchestrator: a.isOrchestrator,
    systemPrompt: a.systemPrompt,
    advisorId: a.advisorId,
    advisorStrategy: a.advisorStrategy,
    advisorConfig: a.advisorConfig,
    soulPath: a.soulPath,
    soulVersion: a.soulVersion,
    nachrichtenCount: a.messageCount,
    erstelltAm: a.createdAt,
    aktualisiertAm: a.updatedAt,
  };
}

function checkFreeModel(verbindungsConfig: any): string | null {
  try {
    const cfg = typeof verbindungsConfig === 'string' ? JSON.parse(verbindungsConfig) : verbindungsConfig;
    const model: string = cfg?.model || '';
    if (model.endsWith(':free') || model === 'auto:free') return model;
  } catch {}
  return null;
}

// =============================================
// LIST / CREATE / READ / UPDATE / DELETE
// =============================================

router.get('/api/companies/:unternehmenId/agents', requireCompanyAccess(), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const rows = db.select().from(agents)
    .where(eq(agents.companyId, req.params.unternehmenId))
    .orderBy(agents.name)
    .limit(limit)
    .offset(offset)
    .all();
  res.json(rows.map(mapAgentToFrontend));
});

router.post('/api/companies/:unternehmenId/agents', requireCompanyAccess(), (req, res) => {
  const body = validate(zAgent, req, res);
  if (!body) return;
  const { name, rolle, titel, faehigkeiten, verbindungsTyp, verbindungsConfig, reportsTo, avatar, avatarFarbe, budgetMonatCent, zyklusIntervallSek, zyklusAktiv, advisorId, advisorStrategy, advisorConfig, systemPrompt, isOrchestrator } = body as any;

  const freeModel = checkFreeModel(verbindungsConfig);
  if (freeModel) return res.status(400).json({ error: `Free model "${freeModel}" not allowed. Use a paid model.` });

  const unternehmenId = req.params.unternehmenId;
  const id = uuid();
  const initials = name.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();

  db.insert(agents).values({
    id, companyId: unternehmenId, name, role: rolle,
    title: titel || rolle,
    skills: faehigkeiten,
    connectionType: verbindungsTyp || 'claude',
    connectionConfig: verbindungsConfig
      ? (typeof verbindungsConfig === 'string' ? verbindungsConfig : JSON.stringify(verbindungsConfig))
      : null,
    reportsTo: reportsTo || null,
    avatar: avatar || initials,
    avatarColor: avatarFarbe || '#23CDCA',
    monthlyBudgetCent: budgetMonatCent ?? 0,
    autoCycleIntervalSec: zyklusIntervallSek || 300,
    autoCycleActive: zyklusAktiv || false,
    advisorId: advisorId || null,
    advisorStrategy: advisorStrategy || 'none',
    advisorConfig: advisorConfig
      ? (typeof advisorConfig === 'string' ? advisorConfig : JSON.stringify(advisorConfig))
      : null,
    systemPrompt: systemPrompt || null,
    isOrchestrator: isOrchestrator === true || isOrchestrator === 1 || false,
    status: 'idle',
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const agent = db.select().from(agents).where(eq(agents.id, id)).get();
  logAktivitaet(unternehmenId, 'board', 'board', 'Board', `hat „${name}" als Experten eingestellt`, 'agents', id);
  broadcast('expert_created', { unternehmenId, id, name, rolle });
  res.status(201).json(mapAgentToFrontend(agent));
});

router.get('/api/agents/:id', requireResourceAccess('agent'), (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(mapAgentToFrontend(agent));
});

// GET /api/agents/:id/token — returns the HMAC-derived API key for this agent.
// Protected by user session so only the logged-in user can retrieve it.
router.get('/api/agents/:id/token', authMiddleware, requireResourceAccess('agent'), (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ token: deriveAgentToken(agent.id, agent.companyId) });
});

// PATCH /api/agents/:id — update agent config + record a config-history snapshot.
//
// NOTE: index.ts had two PATCH handlers registered for the same URL — Express
// only invokes the first match, so the second (more complete) one was dead
// code. We've kept the more complete handler (the one that snapshots the
// changed fields into agent_config_history); the GET /config-history endpoint
// will now actually return non-empty results. The simpler handler was deleted.
router.patch('/api/agents/:id', requireResourceAccess('agent'), (req, res) => {
  if (req.body.connectionConfig !== undefined) {
    const freeModel = checkFreeModel(req.body.connectionConfig);
    if (freeModel) return res.status(400).json({ error: `Free model "${freeModel}" not allowed.` });
  }
  const keyMap: Record<string, string> = {
    rolle: 'role', titel: 'title', faehigkeiten: 'skills',
    verbindungsTyp: 'connectionType', verbindungsConfig: 'connectionConfig',
    avatarFarbe: 'avatarColor', budgetMonatCent: 'monthlyBudgetCent',
    zyklusIntervallSek: 'autoCycleIntervalSec', zyklusAktiv: 'autoCycleActive',
  };
  const allowed = ['name', 'rolle', 'titel', 'faehigkeiten', 'verbindungsTyp', 'verbindungsConfig', 'reportsTo', 'avatar', 'avatarFarbe', 'budgetMonatCent', 'zyklusIntervallSek', 'zyklusAktiv', 'status', 'systemPrompt', 'advisorId', 'advisorStrategy', 'advisorConfig', 'isOrchestrator'];
  const updates: any = { updatedAt: now() };
  const changedFields: Record<string, any> = {};

  // Snapshot current values of fields being changed
  const current = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get() as any;
  if (current) {
    for (const key of allowed) {
      const dbKey = keyMap[key] || key;
      if (req.body[key] !== undefined && req.body[key] !== current[dbKey]) {
        changedFields[key] = current[dbKey]; // old value snapshot
      }
    }
  }

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const dbKey = keyMap[key] || key;
      if ((dbKey === 'connectionConfig' || dbKey === 'advisorConfig') && typeof req.body[key] === 'object' && req.body[key] !== null) {
        updates[dbKey] = JSON.stringify(req.body[key]);
      } else {
        updates[dbKey] = req.body[key];
      }
    }
  }
  db.update(agents).set(updates).where(eq(agents.id, req.params.id as string)).run();

  // Save config history snapshot if anything changed
  if (Object.keys(changedFields).length > 0) {
    db.insert(agentConfigHistory).values({
      id: uuid(),
      agentId: req.params.id,
      changedAt: now(),
      changedBy: (req as any).user?.id || 'board',
      configJson: JSON.stringify(changedFields),
      note: req.body._note || null,
    } as any).run();
  }

  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  res.json(mapAgentToFrontend(agent));
});

// GET /api/agents/:id/config-history — last N snapshots (default 20)
router.get('/api/agents/:id/config-history', authMiddleware, requireResourceAccess('agent'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.select().from(agentConfigHistory)
    .where(eq(agentConfigHistory.agentId, req.params.id as string))
    .orderBy(desc(agentConfigHistory.changedAt))
    .limit(limit)
    .all();
  res.json(rows);
});

// POST /api/agents/:id/config-history/:historyId/restore — restore a snapshot
router.post('/api/agents/:id/config-history/:historyId/restore', authMiddleware, requireResourceAccess('agent'), (req, res) => {
  const snap = db.select().from(agentConfigHistory)
    .where(and(eq(agentConfigHistory.id, req.params.historyId as string), eq(agentConfigHistory.agentId, req.params.id as string)))
    .get() as any;
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

  let fields: Record<string, any>;
  try { fields = JSON.parse(snap.configJson); } catch { return res.status(422).json({ error: 'Invalid snapshot data' }); }

  const keyMap: Record<string, string> = {
    rolle: 'role', titel: 'title', faehigkeiten: 'skills',
    verbindungsTyp: 'connectionType', verbindungsConfig: 'connectionConfig',
    avatarFarbe: 'avatarColor', budgetMonatCent: 'monthlyBudgetCent',
    zyklusIntervallSek: 'autoCycleIntervalSec', zyklusAktiv: 'autoCycleActive',
  };
  const safeFields: any = { updatedAt: now() };
  const allowed = ['name', 'rolle', 'titel', 'faehigkeiten', 'verbindungsTyp', 'verbindungsConfig', 'reportsTo', 'avatar', 'avatarFarbe', 'budgetMonatCent', 'zyklusIntervallSek', 'zyklusAktiv', 'status', 'systemPrompt', 'advisorId', 'advisorStrategy', 'advisorConfig', 'isOrchestrator'];
  for (const key of allowed) {
    const sourceKey = key in fields ? key : Object.entries(keyMap).find(([de]) => de === key)?.[0];
    if (sourceKey !== undefined && sourceKey in fields) {
      const dbKey = keyMap[key] || key;
      safeFields[dbKey] = fields[sourceKey];
    }
  }
  db.update(agents).set(safeFields).where(eq(agents.id, req.params.id as string)).run();

  // Record the restore action itself as a new history entry
  db.insert(agentConfigHistory).values({
    id: uuid(),
    agentId: req.params.id,
    changedAt: now(),
    changedBy: (req as any).user?.id || 'board',
    configJson: JSON.stringify(safeFields),
    note: `Restored from snapshot ${req.params.historyId}`,
  } as any).run();

  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  res.json({ ok: true, agent });
});

// =============================================
// LIFECYCLE — pause / resume / delete
// =============================================
router.post('/api/agents/:id/pause', requireResourceAccess('agent'), (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Not found' });

  db.update(agents).set({ status: 'paused', updatedAt: now() }).where(eq(agents.id, req.params.id as string)).run();
  logAktivitaet(agent.companyId, 'board', 'board', 'Board', `hat „${agent.name}" pausiert`, 'agents', agent.id);
  res.json({ success: true });
});

router.post('/api/agents/:id/resume', requireResourceAccess('agent'), (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Not found' });

  db.update(agents).set({ status: 'idle', updatedAt: now() }).where(eq(agents.id, req.params.id as string)).run();
  logAktivitaet(agent.companyId, 'board', 'board', 'Board', `hat „${agent.name}" fortgesetzt`, 'agents', agent.id);
  res.json({ success: true });
});

router.delete('/api/agents/:id', requireResourceAccess('agent'), (req, res) => {
  const agentId = req.params.id;
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) return res.status(404).json({ error: 'Not found' });

  try {
    // 1. Identify all execution runs for this agent (outside transaction)
    const runIds = db.select({ id: workCycles.id })
      .from(workCycles)
      .where(eq(workCycles.agentId, agentId))
      .all()
      .map(r => r.id);

    // 2–5. All deletions in a single atomic transaction
    db.transaction((tx) => {
      // Clear references to these runs in all possible tables (FK cleanup)
      if (runIds.length > 0) {
        tx.update(workCycles).set({ retryOfRunId: null }).where(inArray(workCycles.retryOfRunId, runIds)).run();
        tx.update(agentWakeupRequests).set({ runId: null }).where(inArray(agentWakeupRequests.runId, runIds)).run();
        tx.update(workProducts).set({ runId: null }).where(inArray(workProducts.runId, runIds)).run();
        tx.update(tasks).set({ executionRunId: null }).where(inArray(tasks.executionRunId, runIds)).run();
      }

      // Nullify direct agent references (keep records but remove connection)
      tx.update(comments).set({ authorAgentId: null }).where(eq(comments.authorAgentId, agentId)).run();
      tx.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, agentId)).run();
      tx.update(agents).set({ advisorId: null }).where(eq(agents.advisorId, agentId)).run();
      tx.update(goals).set({ ownerAgentId: null }).where(eq(goals.ownerAgentId, agentId)).run();
      tx.update(routines).set({ assignedTo: null }).where(eq(routines.assignedTo, agentId)).run();
      tx.update(projects).set({ ownerAgentId: null }).where(eq(projects.ownerAgentId, agentId)).run();
      tx.update(issueRelations).set({ createdBy: null }).where(eq(issueRelations.createdBy, agentId)).run();
      tx.delete(workProducts).where(eq(workProducts.agentId, agentId)).run();
      tx.update(tasks).set({ assignedTo: null }).where(eq(tasks.assignedTo, agentId)).run();
      tx.delete(agentMeetings).where(eq(agentMeetings.organizerAgentId, agentId)).run();

      // Delete agent-owned coupled data
      tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId)).run();
      tx.delete(agentTrustScores).where(eq(agentTrustScores.subjectAgentId, agentId)).run();
      tx.delete(agentVotes).where(eq(agentVotes.agentId, agentId)).run();
      tx.delete(agentCapabilities).where(eq(agentCapabilities.agentId, agentId)).run();
      tx.delete(contractNetBids).where(eq(contractNetBids.bidderAgentId, agentId)).run();
      tx.delete(traceEvents).where(eq(traceEvents.agentId, agentId)).run();
      tx.delete(workCycles).where(eq(workCycles.agentId, agentId)).run();
      tx.delete(chatMessages).where(eq(chatMessages.agentId, agentId)).run();
      tx.delete(costEntries).where(eq(costEntries.agentId, agentId)).run();
      tx.delete(agentSkills).where(eq(agentSkills.agentId, agentId)).run();
      tx.delete(agentPermissions).where(eq(agentPermissions.agentId, agentId)).run();
      tx.update(approvals).set({ requestedBy: null }).where(eq(approvals.requestedBy, agentId)).run();

      // Memory data (palace_wings → palace_drawers + palace_diary, palace_summaries)
      const wings = tx.select({ id: palaceWings.id }).from(palaceWings).where(eq(palaceWings.agentId, agentId)).all();
      if (wings.length > 0) {
        const wingIds = wings.map(w => w.id);
        tx.delete(palaceDrawers).where(inArray(palaceDrawers.wingId, wingIds)).run();
        tx.delete(palaceDiary).where(inArray(palaceDiary.wingId, wingIds)).run();
        tx.delete(palaceWings).where(eq(palaceWings.agentId, agentId)).run();
      }
      tx.delete(palaceSummaries).where(eq(palaceSummaries.agentId, agentId)).run();

      // Execution workspaces (agentId nullable — just nullify)
      tx.update(executionWorkspaces).set({ agentId: null }).where(eq(executionWorkspaces.agentId, agentId)).run();

      // Knowledge graph — remove all triples that mention this agent by name
      tx.delete(palaceKg)
        .where(and(
          eq(palaceKg.companyId, agent.companyId),
          or(eq(palaceKg.subject, agent.name), eq(palaceKg.object, agent.name)),
        ))
        .run();

      // Archive, CEO decision log, config history
      tx.delete(workCyclesArchive).where(eq(workCyclesArchive.agentId, agentId)).run();
      tx.delete(ceoDecisionLog).where(eq(ceoDecisionLog.agentId, agentId)).run();
      tx.delete(agentConfigHistory).where(eq(agentConfigHistory.agentId, agentId)).run();

      // Finally delete the agent
      tx.delete(agents).where(eq(agents.id, agentId)).run();
    });

    // Count unassigned tasks (outside transaction, after agent is deleted)
    const freedTaskCount = db.select({ count: count() }).from(tasks)
      .where(and(eq(tasks.companyId, agent.companyId), isNull(tasks.assignedTo)))
      .get()?.count ?? 0;

    // 6. Notify the CEO (orchestrator) about the dismissal
    try {
      const ceo = db.select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(eq(agents.companyId, agent.companyId), eq(agents.isOrchestrator, true)))
        .get() as any;
      if (ceo) {
        const briefing = `📋 **Personalmeldung**: **${agent.name}** (${agent.role}) wurde aus dem Unternehmen entfernt.\n\nSeine/ihre Aufgaben sind jetzt unzugewiesen (${freedTaskCount} offene Tasks). Bitte neue Prioritäten setzen oder jemanden einarbeiten.`;
        const msgId = uuid();
        db.insert(chatMessages).values({
          id: msgId,
          companyId: agent.companyId,
          agentId: ceo.id,
          senderType: 'system',
          message: briefing,
          read: false,
          createdAt: now(),
        }).run();
        broadcast('chat_message', { id: msgId, unternehmenId: agent.companyId, expertId: ceo.id, nachricht: briefing });
        // Also notify via Telegram
        messagingService.sendTelegram(agent.companyId,
          `🔴 *${agent.name}* (${agent.role}) wurde entlassen.\n${freedTaskCount} Aufgaben sind jetzt unzugewiesen.`,
        ).catch(() => {});
      }
    } catch { /* non-critical */ }

    logAktivitaet(agent.companyId, 'board', 'board', 'Board', `hat „${agent.name}" entlassen`, 'agents', agent.id);
    broadcast('expert_deleted', { id: agentId, name: agent.name, unternehmenId: agent.companyId });
    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to delete agent ${agentId}:`, error);
    res.status(500).json({ error: 'Failed to delete agent (Foreign Key / Constraints).' });
  }
});

// =============================================
// ACTIVITY — last N activity log entries for this agent (DE-keyed shape)
// =============================================
router.get('/api/agents/:id/activity', requireResourceAccess('agent'), (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const rows = db.select().from(activityLog)
    .where(eq(activityLog.actorId, req.params.id as string))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .all();
  res.json(rows.map((a: any) => ({
    id: a.id,
    unternehmenId: a.companyId,
    akteurTyp: a.actorType,
    akteurId: a.actorId,
    akteurName: a.actorName,
    aktion: a.action,
    entitaetTyp: a.entityType,
    entitaetId: a.entityId,
    details: a.details,
    erstelltAm: a.createdAt,
  })));
});

// =============================================
// PERMISSIONS
// =============================================
router.get('/api/agents/:id/permissions', requireResourceAccess('agent'), (req, res) => {
  const perms = db.select().from(agentPermissions)
    .where(eq(agentPermissions.agentId, req.params.id as string)).get();

  if (!perms) {
    // Default permissions returned (not persisted)
    return res.json({
      expertId: req.params.id,
      darfAufgabenErstellen: true,
      darfAufgabenZuweisen: false,
      darfGenehmigungAnfordern: true,
      darfGenehmigungEntscheiden: false,
      darfExpertenAnwerben: false,
      budgetLimitCent: null,
      erlaubtePfade: null,
      erlaubteDomains: null,
    });
  }
  res.json(perms);
});

router.put('/api/agents/:id/permissions', requireResourceAccess('agent'), (req, res) => {
  const expertId = req.params.id as string;
  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });

  const existing = db.select().from(agentPermissions)
    .where(eq(agentPermissions.agentId, expertId)).get();

  const data = {
    agentId: expertId,
    darfAufgabenErstellen: req.body.darfAufgabenErstellen ?? true,
    darfAufgabenZuweisen: req.body.darfAufgabenZuweisen ?? false,
    darfGenehmigungAnfordern: req.body.darfGenehmigungAnfordern ?? true,
    darfGenehmigungEntscheiden: req.body.darfGenehmigungEntscheiden ?? false,
    darfExpertenAnwerben: req.body.darfExpertenAnwerben ?? false,
    budgetLimitCent: req.body.budgetLimitCent ?? null,
    erlaubtePfade: req.body.erlaubtePfade ? JSON.stringify(req.body.erlaubtePfade) : null,
    erlaubteDomains: req.body.erlaubteDomains ? JSON.stringify(req.body.erlaubteDomains) : null,
    updatedAt: now(),
  };

  if (existing) {
    db.update(agentPermissions).set(data).where(eq(agentPermissions.agentId, expertId)).run();
  } else {
    db.insert(agentPermissions).values({ id: uuid(), createdAt: now(), ...data }).run();
  }

  res.json(db.select().from(agentPermissions).where(eq(agentPermissions.agentId, expertId)).get());
});

// =============================================
// WAKEUP / PERFORMANCE / INBOX / TEAM-STATUS / STATS
// =============================================
router.post('/api/agents/:id/wakeup', requireResourceAccess('agent'), async (req, res) => {
  const expertId = req.params.id as string;
  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });
  if (expert.status === 'terminated') return res.status(409).json({ error: 'Agent ist beendet' });

  try {
    const wakeupId = await wakeupService.wakeup(expertId, expert.companyId, {
      source: 'on_demand',
      triggerDetail: 'manual',
      reason: 'Manuell aufgeweckt über Dashboard',
    });
    res.json({ ok: true, wakeupId, message: `Agent "${expert.name}" wird aufgeweckt` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/agents/:id/performance', requireResourceAccess('agent'), async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days as string) || 30));
    const { getAgentPerformance } = await import('../services/agent-performance.js');
    const result = getAgentPerformance(req.params.id, days);
    if (!result) return res.status(404).json({ error: 'Agent not found' });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/companies/:id/performance/leaderboard', requireCompanyAccess(), async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days as string) || 30));
    const { getCompanyLeaderboard } = await import('../services/agent-performance.js');
    res.json({ days, agents: getCompanyLeaderboard(req.params.id, days) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Inbox — agent fetches assigned tasks
router.get('/api/agents/:id/inbox', requireResourceAccess('agent'), (req, res) => {
  const expertId = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.query.unternehmenId) as string;

  if (!unternehmenId) {
    return res.status(400).json({ error: 'unternehmenId query parameter is required' });
  }

  const expert = db.select()
    .from(agents)
    .where(and(eq(agents.id, expertId), eq(agents.companyId, unternehmenId)))
    .get();

  if (!expert) {
    return res.status(404).json({ error: 'Expert not found or does not belong to company' });
  }

  if (expert.status === 'paused' || expert.status === 'terminated') {
    return res.status(403).json({ error: 'Expert is paused or terminated', status: expert.status });
  }

  const assignedTasks = db.select({
    id: tasks.id,
    titel: tasks.title,
    beschreibung: tasks.description,
    status: tasks.status,
    prioritaet: tasks.priority,
    executionLockedAt: tasks.executionLockedAt,
    executionRunId: tasks.executionRunId,
    erstelltAm: tasks.createdAt,
    aktualisiertAm: tasks.updatedAt,
  })
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, unternehmenId),
        eq(tasks.assignedTo, expertId),
        inArray(tasks.status, ['backlog', 'todo', 'in_progress', 'blocked']),
      ),
    )
    .all();

  res.json({
    expertId,
    unternehmenId,
    inbox: assignedTasks,
    count: assignedTasks.length,
  });
});

// Team-status — orchestrator fetches team overview
router.get('/api/agents/:id/team-status', authMiddleware, requireResourceAccess('agent'), (req, res) => {
  const expertId = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;

  if (!unternehmenId) return res.status(400).json({ error: 'unternehmenId header required' });

  const expert = db.select().from(agents).where(and(eq(agents.id, expertId), eq(agents.companyId, unternehmenId))).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });

  // Direct reports
  const directReports = db.select({
    id: agents.id,
    name: agents.name,
    rolle: agents.role,
    status: agents.status,
    letzterZyklus: agents.lastCycle,
    isOrchestrator: agents.isOrchestrator,
  }).from(agents).where(and(eq(agents.companyId, unternehmenId), eq(agents.reportsTo, expertId as string))).all();

  const reportIds = directReports.map((e: any) => e.id);

  // Tasks for direct reports
  const teamTasks = reportIds.length > 0
    ? db.select({
        id: tasks.id,
        titel: tasks.title,
        status: tasks.status,
        prioritaet: tasks.priority,
        zugewiesenAn: tasks.assignedTo,
      }).from(tasks)
        .where(and(eq(tasks.companyId, unternehmenId), inArray(tasks.assignedTo, reportIds)))
        .all()
    : [];

  // Unassigned tasks (orchestrator can delegate)
  const unassigned = db.select({
    id: tasks.id,
    titel: tasks.title,
    prioritaet: tasks.priority,
    status: tasks.status,
    beschreibung: tasks.description,
  }).from(tasks)
    .where(and(eq(tasks.companyId, unternehmenId), isNull(tasks.assignedTo)))
    .all()
    .filter((t: any) => !['done', 'cancelled', 'abgeschlossen'].includes(t.status));

  // Enrich direct reports with task stats
  const tasksByAgent: Record<string, any[]> = {};
  for (const t of teamTasks) {
    if (!tasksByAgent[t.assignedTo]) tasksByAgent[t.assignedTo] = [];
    tasksByAgent[t.assignedTo].push(t);
  }

  const team = directReports.map((e: any) => {
    const agentTasks = tasksByAgent[e.id] || [];
    return {
      ...e,
      activeTasks: agentTasks.filter((t: any) => !['done', 'abgeschlossen', 'cancelled'].includes(t.status)),
      doneTasks: agentTasks.filter((t: any) => ['done', 'abgeschlossen'].includes(t.status)),
      topTask: agentTasks.find((t: any) => !['done', 'abgeschlossen', 'cancelled'].includes(t.status)) || null,
    };
  });

  res.json({ team, unassigned });
});

// Stats — last-30-days overview for an agent's run history + tasks
router.get('/api/agents/:id/stats', authMiddleware, requireResourceAccess('agent'), (req, res) => {
  const expertId = req.params.id as string;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const zyklen = db.select({
    status: workCycles.status,
    erstelltAm: workCycles.createdAt,
  }).from(workCycles)
    .where(and(eq(workCycles.agentId, expertId), sql`${workCycles.createdAt} > ${thirtyDaysAgo}`))
    .orderBy(desc(workCycles.createdAt))
    .all();

  const agentTasks = db.select({
    status: tasks.status,
    prioritaet: tasks.priority,
    erstelltAm: tasks.createdAt,
  }).from(tasks)
    .where(eq(tasks.assignedTo, expertId))
    .orderBy(desc(tasks.createdAt))
    .limit(100)
    .all();

  const latestRunResult = db.select().from(workCycles)
    .where(and(eq(workCycles.agentId, expertId), isNotNull(workCycles.endedAt)))
    .orderBy(desc(workCycles.createdAt))
    .limit(1)
    .get();

  const recentTasks = db.select().from(tasks)
    .where(eq(tasks.assignedTo, expertId))
    .orderBy(desc(tasks.createdAt))
    .limit(5)
    .all();

  res.json({
    workCycles: zyklen,
    tasks: agentTasks,
    latestRun: latestRunResult,
    recentTasks,
  });
});

export default router;

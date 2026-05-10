// =============================================================================
// Companies routes (core CRUD + memberships) — extracted from server/index.ts.
//
// In scope here: list/create, GET/PATCH/DELETE :id, workspace probe,
// open-folder, /reset, members + invites (incl. /api/user/memberships and
// /api/invites/:token/accept which logically belong with this group).
//
// Out of scope (future PRs): costs/budget, dashboard, activity, AI endpoints
// (briefing/focus/weekly-report/ask/standup), import/export, work-products
// gallery, agent-quality, intelligence/memory, tasks/graph, clipmart.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { eq, and, desc, inArray, count } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { db, sqlite } from '../db/client.js';
import {
  companies,
  companyMemberships,
  agents,
  agentSkills,
  agentPermissions,
  agentWakeupRequests,
  user,
  tasks,
  projects,
  goals,
  comments,
  costEntries,
  workCycles,
  workProducts,
  activityLog,
  approvals,
  routines,
  routineTrigger,
  routineRuns,
  skillsLibrary,
  settings,
  chatMessages,
  traceEvents,
} from '../db/schema.js';
import { logAktivitaet } from '../services/activity-log.js';
import { validate } from '../utils/validate.js';
import { authMiddleware, requireCompanyAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

const zCompany = z.object({
  name: z.string().min(1).max(120),
  beschreibung: z.string().max(1000).optional(),
  ziel: z.string().max(1000).optional(),
});

// =============================================
// LIST / CREATE / READ / UPDATE
// =============================================

router.get('/api/companies', (req, res) => {
  const userId = (req as any).users?.userId;
  if (!userId) {
    const result = db.select().from(companies).orderBy(desc(companies.createdAt)).all();
    return res.json(result);
  }
  // Multi-user: return only companies the user is a member of
  const memberships = db.select({ companyId: companyMemberships.companyId })
    .from(companyMemberships)
    .where(eq(companyMemberships.userId, userId))
    .all();
  const companyIds = memberships.map(m => m.companyId);
  if (companyIds.length === 0) return res.json([]);
  const result = db.select().from(companies)
    .where(inArray(companies.id, companyIds))
    .orderBy(desc(companies.createdAt))
    .all();
  res.json(result);
});

router.post('/api/companies', (req, res) => {
  const body = validate(zCompany, req, res);
  if (!body) return;
  const { name, beschreibung, ziel } = body;
  const userId = (req as any).users?.userId;

  const id = uuid();
  db.insert(companies).values({
    id, name, description: beschreibung, goal: ziel,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  }).run();

  // Auto-assign owner membership to the creating user
  if (userId) {
    db.insert(companyMemberships).values({
      id: uuid(),
      userId,
      companyId: id,
      role: 'owner',
      joinedAt: now(),
    }).run();
  }

  const data = db.select().from(companies).where(eq(companies.id, id)).get();
  logAktivitaet(id, 'board', 'board', 'Board', `hat Unternehmen „${name}" erstellt`, 'companies', id);
  res.status(201).json(data);
});

router.get('/api/companies/:id', requireCompanyAccess(), (req, res) => {
  const data = db.select().from(companies).where(eq(companies.id, req.params.id as string)).get();
  if (!data) return res.status(404).json({ error: 'Company not found' });
  res.json(data);
});

router.patch('/api/companies/:id', requireCompanyAccess(), (req, res) => {
  const { name, beschreibung, ziel, status, workDir } = req.body;
  const updates: any = { updatedAt: now() };
  if (name !== undefined) updates.name = name;
  if (beschreibung !== undefined) updates.description = beschreibung;
  if (ziel !== undefined) updates.goal = ziel;
  if (status !== undefined) updates.status = status;
  if (workDir !== undefined) updates.workDir = workDir || null;  // empty string clears it

  db.update(companies).set(updates).where(eq(companies.id, req.params.id as string)).run();
  const data = db.select().from(companies).where(eq(companies.id, req.params.id as string)).get();
  res.json(data);
});

// =============================================
// WORKSPACE DIRECTORY HELPERS
// =============================================

router.get('/api/companies/:id/workspace/check', requireCompanyAccess(), (req, res) => {
  const company = db.select().from(companies).where(eq(companies.id, req.params.id as string)).get() as any;
  const dir = (req.query.path as string) || company?.workDir;
  if (!dir) return res.json({ exists: false, writable: false, error: 'No directory specified' });
  try {
    if (!path.isAbsolute(dir)) return res.json({ exists: false, writable: false, error: 'Path must be absolute (e.g. /home/user/project)' });
    const exists = fs.existsSync(dir);
    if (!exists) return res.json({ exists: false, writable: false, error: `Directory "${dir}" does not exist` });
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return res.json({ exists: false, writable: false, error: `"${dir}" ist kein Verzeichnis` });
    // Try writing a temp file to check write access
    const testFile = path.join(dir, '.opencognit_write_test');
    try {
      fs.writeFileSync(testFile, 'test', 'utf8');
      fs.unlinkSync(testFile);
      return res.json({ exists: true, writable: true, path: dir });
    } catch {
      return res.json({ exists: true, writable: false, error: 'No write access to this directory' });
    }
  } catch (e: any) {
    return res.json({ exists: false, writable: false, error: e.message });
  }
});

// Open company work directory in system file manager
router.post('/api/companies/:id/open-folder', requireCompanyAccess(), (req, res) => {
  // Accept path from body (current input value) or fall back to saved DB value
  const company = db.select().from(companies).where(eq(companies.id, req.params.id as string)).get() as any;
  const dir = (req.body?.path as string) || company?.workDir;
  if (!dir) return res.status(400).json({ error: 'No project directory configured' });
  if (!fs.existsSync(dir)) return res.status(400).json({ error: `Directory "${dir}" does not exist` });

  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true, path: dir });
});

// =============================================
// DELETE / RESET
// =============================================

// Wipes a company including ALL dependent data. FK is briefly disabled for the
// purge transaction because circular refs (agent.reportsTo → agent) make a
// strict FK-ordered deletion practically impossible to maintain.
router.delete('/api/companies/:id', authMiddleware, requireCompanyAccess(['owner', 'admin']), (req, res) => {
  const id = req.params.id as string;
  const company = db.select().from(companies).where(eq(companies.id, id)).get();
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const expertIds = db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, id)).all().map((e: any) => e.id);

  try {
    sqlite.exec('PRAGMA foreign_keys = OFF');

    const runPurge = sqlite.transaction(() => {
      // 1. Tables that reference other tables (other than companies)
      db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, id)).run();
      db.delete(workProducts).where(eq(workProducts.companyId, id)).run();
      db.delete(traceEvents).where(eq(traceEvents.companyId, id)).run();
      db.delete(routineRuns).where(eq(routineRuns.companyId, id)).run();
      db.delete(costEntries).where(eq(costEntries.companyId, id)).run();
      db.delete(comments).where(eq(comments.companyId, id)).run();

      // 2. Tables that may reference the above
      db.delete(workCycles).where(eq(workCycles.companyId, id)).run();
      db.delete(approvals).where(eq(approvals.companyId, id)).run();
      db.delete(routineTrigger).where(eq(routineTrigger.companyId, id)).run();
      db.delete(routines).where(eq(routines.companyId, id)).run();
      db.delete(tasks).where(eq(tasks.companyId, id)).run();
      db.delete(projects).where(eq(projects.companyId, id)).run();
      db.delete(goals).where(eq(goals.companyId, id)).run();

      // 3. Remaining company-scoped data
      db.delete(settings).where(eq(settings.companyId, id)).run();
      db.delete(chatMessages).where(eq(chatMessages.companyId, id)).run();
      db.delete(activityLog).where(eq(activityLog.companyId, id)).run();
      db.delete(skillsLibrary).where(eq(skillsLibrary.companyId, id)).run();

      if (expertIds.length > 0) {
        db.delete(agentSkills).where(inArray(agentSkills.agentId, expertIds)).run();
        db.delete(agentPermissions).where(inArray(agentPermissions.agentId, expertIds)).run();
      }

      db.delete(agents).where(eq(agents.companyId, id)).run();
      db.delete(companies).where(eq(companies.id, id)).run();
    });

    runPurge();
    sqlite.exec('PRAGMA foreign_keys = ON');

    console.log(`🗑️  Unternehmen ${company.name} (${id}) vollständig gelöscht`);
    res.json({ ok: true, name: company.name });
  } catch (error: any) {
    console.error(`❌ Fehler beim Löschen von Unternehmen ${id}:`, error);
    try { sqlite.exec('PRAGMA foreign_keys = ON'); } catch {}
    res.status(500).json({ error: 'Internal server error while deleting company.', details: error.message });
  }
});

// Wipes all data INSIDE a company but keeps the company row itself.
router.delete('/api/companies/:id/reset', authMiddleware, requireCompanyAccess(['owner', 'admin']), (req, res) => {
  const id = req.params.id as string;
  const company = db.select().from(companies).where(eq(companies.id, id)).get();
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const execRaw = (raw: string, params: unknown[] = []) => {
    try { sqlite?.prepare(raw).run(...params); } catch { /* ignore missing tables on older DBs */ }
  };

  execRaw(`DELETE FROM ceo_decision_log WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM expert_config_history WHERE expert_id IN (SELECT id FROM experten WHERE unternehmen_id = ?)`, [id]);
  execRaw(`DELETE FROM experten_skills WHERE expert_id IN (SELECT id FROM experten WHERE unternehmen_id = ?)`, [id]);
  execRaw(`DELETE FROM agent_permissions WHERE expert_id IN (SELECT id FROM experten WHERE unternehmen_id = ?)`, [id]);
  execRaw(`DELETE FROM agent_gedaechtnis WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM palace_wings WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM palace_summaries WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM palace_drawers WHERE expert_id IN (SELECT id FROM experten WHERE unternehmen_id = ?)`, [id]);
  execRaw(`DELETE FROM palace_diary WHERE expert_id IN (SELECT id FROM experten WHERE unternehmen_id = ?)`, [id]);
  execRaw(`DELETE FROM palace_kg WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM budget_policies WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM budget_incidents WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM execution_workspaces WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM openclaw_tokens WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM agenten_meetings WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM trace_ereignisse WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM work_products WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM agent_wakeup_requests WHERE unternehmen_id = ?`, [id]);
  // issue_relations references tasks
  execRaw(`DELETE FROM issue_relations WHERE quell_id IN (SELECT id FROM aufgaben WHERE unternehmen_id = ?) OR ziel_id IN (SELECT id FROM aufgaben WHERE unternehmen_id = ?)`, [id, id]);
  // routine children before routines
  execRaw(`DELETE FROM routine_ausfuehrung WHERE routine_id IN (SELECT id FROM routinen WHERE unternehmen_id = ?)`, [id]);
  execRaw(`DELETE FROM routine_trigger WHERE routine_id IN (SELECT id FROM routinen WHERE unternehmen_id = ?)`, [id]);
  db.delete(routines).where(eq(routines.companyId, id)).run();
  db.delete(projects).where(eq(projects.companyId, id)).run();
  db.delete(chatMessages).where(eq(chatMessages.companyId, id)).run();
  db.delete(comments).where(eq(comments.companyId, id)).run();
  db.delete(costEntries).where(eq(costEntries.companyId, id)).run();
  db.delete(workCycles).where(eq(workCycles.companyId, id)).run();
  db.delete(activityLog).where(eq(activityLog.companyId, id)).run();
  db.delete(approvals).where(eq(approvals.companyId, id)).run();
  db.delete(goals).where(eq(goals.companyId, id)).run();
  db.delete(tasks).where(eq(tasks.companyId, id)).run();
  execRaw(`DELETE FROM skills_library WHERE unternehmen_id = ?`, [id]);
  execRaw(`DELETE FROM einstellungen WHERE unternehmen_id = ?`, [id]);
  db.delete(agents).where(eq(agents.companyId, id)).run();

  console.log(`🗑️  Unternehmen ${company.name} (${id}) zurückgesetzt`);
  res.json({ ok: true, name: company.name });
});

// =============================================
// MEMBERSHIPS & INVITES
// =============================================

// Companies the current user belongs to
router.get('/api/user/memberships', authMiddleware, (req, res) => {
  const userId = (req as any).users?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const rows = db.select({
    companyId: companyMemberships.companyId,
    role: companyMemberships.role,
    joinedAt: companyMemberships.joinedAt,
  })
    .from(companyMemberships)
    .where(eq(companyMemberships.userId, userId))
    .all();

  const companyIds = rows.map(r => r.companyId);
  if (companyIds.length === 0) return res.json([]);

  const companyRows = db.select().from(companies)
    .where(inArray(companies.id, companyIds))
    .all() as any[];

  const result = rows.map(m => {
    const c = companyRows.find((x: any) => x.id === m.companyId);
    return {
      companyId: m.companyId,
      role: m.role,
      joinedAt: m.joinedAt,
      companyName: c?.name || null,
      companyStatus: c?.status || null,
    };
  });

  res.json(result);
});

router.get('/api/companies/:id/members', authMiddleware, requireCompanyAccess(['owner', 'admin']), (req, res) => {
  const companyId = req.params.id as string;

  const rows = db.select({
    userId: companyMemberships.userId,
    role: companyMemberships.role,
    joinedAt: companyMemberships.joinedAt,
  })
    .from(companyMemberships)
    .where(eq(companyMemberships.companyId, companyId))
    .all();

  const userIds = rows.map(r => r.userId);
  if (userIds.length === 0) return res.json([]);

  const userRows = db.select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, userIds))
    .all() as any[];

  const result = rows.map(m => {
    const u = userRows.find((x: any) => x.id === m.userId);
    return {
      userId: m.userId,
      name: u?.name || null,
      email: u?.email || null,
      role: m.role,
      joinedAt: m.joinedAt,
    };
  });

  res.json(result);
});

router.post('/api/companies/:id/invites', authMiddleware, requireCompanyAccess(['owner', 'admin']), (req, res) => {
  const companyId = req.params.id as string;
  const { email, role = 'member' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const targetUser = db.select().from(user).where(eq(user.email, email)).get() as any;
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const existing = db.select().from(companyMemberships)
    .where(and(
      eq(companyMemberships.userId, targetUser.id),
      eq(companyMemberships.companyId, companyId),
    )).get();
  if (existing) return res.status(409).json({ error: 'User is already a member' });

  const token = uuid();
  db.insert(companyMemberships).values({
    id: uuid(),
    userId: targetUser.id,
    companyId,
    role,
    invitedAt: new Date().toISOString(),
    inviteToken: token,
  }).run();

  res.json({ token, email, role, message: 'Invite created' });
});

router.post('/api/invites/:token/accept', authMiddleware, (req, res) => {
  const token = req.params.token as string;
  const userId = (req as any).users?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const membership = db.select().from(companyMemberships)
    .where(eq(companyMemberships.inviteToken, token))
    .get() as any;

  if (!membership) return res.status(404).json({ error: 'Invite not found' });
  if (membership.userId !== userId) return res.status(403).json({ error: 'Invite belongs to another user' });
  if (membership.joinedAt) return res.status(409).json({ error: 'Invite already accepted' });

  db.update(companyMemberships)
    .set({ joinedAt: new Date().toISOString(), inviteToken: null })
    .where(eq(companyMemberships.id, membership.id))
    .run();

  res.json({ ok: true, companyId: membership.companyId, role: membership.role });
});

router.delete('/api/companies/:id/members/:userId', authMiddleware, requireCompanyAccess(['owner', 'admin']), (req, res) => {
  const companyId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  // Prevent self-removal of the last owner
  const selfMembership = (req as any).companyMembership;
  if (selfMembership?.userId === targetUserId) {
    const ownerCount = db.select({ value: count() })
      .from(companyMemberships)
      .where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.role, 'owner'),
      ))
      .get()?.value ?? 0;
    if (ownerCount <= 1) return res.status(400).json({ error: 'Cannot remove the last owner' });
  }

  db.delete(companyMemberships)
    .where(and(
      eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.userId, targetUserId),
    )).run();

  res.json({ ok: true });
});

export default router;

// =============================================================================
// System routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// Covers: health checks, system status, factory-reset, backups, cleanup,
// CLI detection (claude/gemini/codex/kimi), CLI path overrides.
// =============================================================================

import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { eq, and, sql, count } from 'drizzle-orm';

import { db, sqlite } from '../db/client.js';
import {
  agents,
  companies,
  settings,
  routines,
  projects,
  chatMessages,
  comments,
  costEntries,
  workCycles,
  activityLog,
  approvals,
  goals,
  tasks,
  users,
} from '../db/schema.js';
import { backupService } from '../services/backup.js';
import { cleanupService } from '../services/cleanup.js';
import { getCliPath, getAllCliPaths, setCliPath } from '../adapters/cli-paths.js';
import { encryptSetting } from '../utils/crypto.js';
import { authMiddleware, requireCompanyAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

// =============================================
// HEALTH & STATUS
// =============================================

router.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.9.0', name: 'OpenCognit' });
});

// Agent health monitor — surfaces stuck/looping/error agents
router.get('/api/health/agents', authMiddleware, async (req, res) => {
  try {
    const unternehmenId = req.query.unternehmenId as string;

    // Agents currently stuck in 'running' for >5 minutes
    const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const stuckAgents = db.all(
      sql`SELECT id, name, status, letzter_zyklus as letzterZyklus FROM experten
          WHERE status = 'running' AND letzter_zyklus < ${stuckCutoff}
          ${unternehmenId ? sql`AND unternehmen_id = ${unternehmenId}` : sql``}`,
    );

    // Agents with high wakeup coalescedCount (potential loop detection)
    const loopyWakeups = db.all(
      sql`SELECT w.expert_id as expertId, e.name as expertName,
             w.coalesced_count as coalescedCount, w.reason, w.requested_at as requestedAt
          FROM agent_wakeup_requests w LEFT JOIN experten e ON w.expert_id = e.id
          WHERE w.status = 'queued' AND w.coalesced_count >= 10
          ${unternehmenId ? sql`AND w.unternehmen_id = ${unternehmenId}` : sql``}
          ORDER BY w.coalesced_count DESC LIMIT 20`,
    );

    // Agents in error state
    const errorAgents = db.all(
      sql`SELECT id, name, letzter_zyklus as letzterZyklus FROM experten
          WHERE status = 'error'
          ${unternehmenId ? sql`AND unternehmen_id = ${unternehmenId}` : sql``}`,
    );

    // Recent failed runs (last 24h)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentFailures = db.all(
      sql`SELECT a.expert_id as expertId, e.name as expertName, COUNT(*) as failCount
          FROM arbeitszyklen a LEFT JOIN experten e ON a.expert_id = e.id
          WHERE a.status IN ('failed', 'timed_out') AND a.erstellt_am >= ${since24h}
          ${unternehmenId ? sql`AND a.unternehmen_id = ${unternehmenId}` : sql``}
          GROUP BY a.expert_id HAVING failCount >= 3
          ORDER BY failCount DESC`,
    );

    // Stale queued wakeups (>2h old, still queued)
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const staleWakeups = db.all(
      sql`SELECT w.expert_id as expertId, e.name as expertName, COUNT(*) as count
          FROM agent_wakeup_requests w LEFT JOIN experten e ON w.expert_id = e.id
          WHERE w.status = 'queued' AND w.requested_at < ${staleCutoff}
          ${unternehmenId ? sql`AND w.unternehmen_id = ${unternehmenId}` : sql``}
          GROUP BY w.expert_id`,
    );

    const healthy = stuckAgents.length === 0 && loopyWakeups.length === 0 &&
                    errorAgents.length === 0 && recentFailures.length === 0;

    res.json({
      healthy,
      stuckAgents,
      loopyWakeups,
      errorAgents,
      recentFailures,
      staleWakeups,
      checkedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/system/status', (_req, res) => {
  const unternehmenCount = db.select({ value: count(companies.id) }).from(companies).get()?.value ?? 0;
  const benutzerCount = db.select({ value: count(users.id) }).from(users).get()?.value ?? 0;
  res.json({ needsSetup: unternehmenCount === 0, brauchtRegistrierung: benutzerCount === 0 });
});

// =============================================
// FACTORY RESET
// =============================================

router.delete('/api/system/factory-reset', authMiddleware, requireCompanyAccess(['owner', 'admin']), (_req, res) => {
  const execAll = (raw: string) => { try { sqlite?.prepare(raw).run(); } catch { /* ignore */ } };
  // Delete leaf tables first (FK order)
  execAll(`DELETE FROM ceo_decision_log`);
  execAll(`DELETE FROM expert_config_history`);
  execAll(`DELETE FROM experten_skills`);
  execAll(`DELETE FROM agent_permissions`);
  execAll(`DELETE FROM agent_gedaechtnis`);
  execAll(`DELETE FROM palace_wings`);
  execAll(`DELETE FROM palace_drawers`);
  execAll(`DELETE FROM palace_diary`);
  execAll(`DELETE FROM palace_kg`);
  execAll(`DELETE FROM palace_summaries`);
  execAll(`DELETE FROM budget_policies`);
  execAll(`DELETE FROM budget_incidents`);
  execAll(`DELETE FROM execution_workspaces`);
  execAll(`DELETE FROM openclaw_tokens`);
  execAll(`DELETE FROM agenten_meetings`);
  execAll(`DELETE FROM trace_ereignisse`);
  execAll(`DELETE FROM work_products`);
  execAll(`DELETE FROM agent_wakeup_requests`);
  execAll(`DELETE FROM issue_relations`);
  execAll(`DELETE FROM routine_ausfuehrung`);
  execAll(`DELETE FROM routine_trigger`);
  db.delete(routines).run();
  db.delete(projects).run();
  db.delete(chatMessages).run();
  db.delete(comments).run();
  db.delete(costEntries).run();
  db.delete(workCycles).run();
  db.delete(activityLog).run();
  db.delete(approvals).run();
  db.delete(goals).run();
  db.delete(tasks).run();
  execAll(`DELETE FROM skills_library`);
  execAll(`DELETE FROM einstellungen`);
  db.delete(agents).run();
  db.delete(companies).run();

  console.log('🔴 Factory Reset ausgeführt');
  res.json({ ok: true });
});

// =============================================
// BACKUPS / CLEANUP
// =============================================

router.get('/api/system/backups', authMiddleware, (_req, res) => {
  try {
    const backups = backupService.listBackups();
    res.json({ backups });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/system/backups', authMiddleware, async (_req, res) => {
  try {
    const result = await backupService.runBackup();
    res.json({ success: true, backup: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/system/cleanup', authMiddleware, async (_req, res) => {
  try {
    const stats = await cleanupService.runCleanup();
    res.json({ success: true, stats });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// CLI DETECTION (claude / gemini / codex / kimi)
// =============================================

// GET /api/system/claude-status — Claude Code CLI auth-status check
router.get('/api/system/claude-status', authMiddleware, async (_req, res) => {
  try {
    let installed = false;
    let version = '';
    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const proc = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
        proc.on('close', (code) => code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(err || out)));
        setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 5000);
      });
      version = stdout.trim().split('\n')[0] || 'installed';
      installed = true;
    } catch {
      installed = false;
    }

    // Read credentials file (~/.claude/.credentials.json)
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const credPath = path.join(home, '.claude', '.credentials.json');
    let authenticated = false;
    let subscriptionType = '';
    let tokenExpired = false;
    let expiresAt: string | null = null;

    if (fs.existsSync(credPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        const oauth = raw?.claudeAiOauth;
        if (oauth?.accessToken) {
          authenticated = true;
          subscriptionType = oauth.subscriptionType || 'unknown';
          if (oauth.expiresAt) {
            const exp = new Date(oauth.expiresAt);
            tokenExpired = Date.now() > oauth.expiresAt;
            expiresAt = exp.toISOString();
          }
        }
      } catch { /* ignore parse errors */ }
    }

    res.json({
      installed,
      version,
      authenticated: authenticated && !tokenExpired,
      subscriptionType,
      tokenExpired,
      expiresAt,
      credPath,
    });
  } catch (e: any) {
    res.status(500).json({ installed: false, authenticated: false, error: e.message });
  }
});

// GET /api/system/cli-status — Gemini + Codex CLI install check (legacy)
router.get('/api/system/cli-status', authMiddleware, async (_req, res) => {
  const checkCli = async (cmd: string): Promise<{ installed: boolean; version: string }> => {
    try {
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const proc = spawn(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('error', () => reject(new Error('not found')));
        proc.on('close', (code) => code === 0 ? resolve({ stdout: out }) : reject(new Error('not found')));
        setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('timeout')); }, 4000);
      });
      return { installed: true, version: stdout.trim().split('\n')[0] || 'installed' };
    } catch {
      return { installed: false, version: '' };
    }
  };

  const [gemini, codex] = await Promise.all([
    checkCli('gemini'),
    checkCli('codex'),
  ]);

  res.json({ gemini, codex });
});

// GET /api/system/cli-detect — generic auto-detection for ALL supported CLI tools
interface CLIDetectResult {
  name: string;
  cmd: string;
  installed: boolean;
  version: string;
  authenticated?: boolean;
  subscriptionType?: string;
  authHint?: string;
}

const CLI_TOOLS: { name: string; cmd: string; authHint: string }[] = [
  { name: 'claude-code', cmd: 'claude', authHint: 'claude login' },
  { name: 'gemini-cli', cmd: 'gemini', authHint: 'gemini login' },
  { name: 'codex-cli', cmd: 'codex', authHint: 'codex login' },
  { name: 'kimi-cli', cmd: 'kimi', authHint: 'kimi login' },
];

router.get('/api/system/cli-detect', authMiddleware, async (_req, res) => {
  try {
    const checkOne = async (tool: typeof CLI_TOOLS[0]): Promise<CLIDetectResult> => {
      // Prefer configured path, then default command
      const configuredPath = getCliPath(tool.name.replace('-cli', '').replace('-code', ''));
      const candidates = configuredPath ? [configuredPath, tool.cmd] : [tool.cmd];

      for (const cmd of candidates) {
        try {
          const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
            const proc = spawn(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
            proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
            proc.on('error', () => reject(new Error('not found')));
            proc.on('close', (code) => code === 0 ? resolve({ stdout: out }) : reject(new Error('exit ' + code)));
            setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('timeout')); }, 4000);
          });
          return {
            name: tool.name,
            cmd,
            installed: true,
            version: stdout.trim().split('\n')[0] || 'installed',
            authHint: tool.authHint,
          };
        } catch { /* try next candidate */ }
      }

      return {
        name: tool.name,
        cmd: tool.cmd,
        installed: false,
        version: '',
        authHint: tool.authHint,
      };
    };

    const results = await Promise.all(CLI_TOOLS.map(checkOne));

    // Enrich claude with auth status (same logic as /api/system/claude-status)
    const claudeResult = results.find(r => r.name === 'claude-code');
    if (claudeResult?.installed) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const credPath = path.join(home, '.claude', '.credentials.json');
      if (fs.existsSync(credPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
          const oauth = raw?.claudeAiOauth;
          if (oauth?.accessToken) {
            const tokenExpired = oauth.expiresAt ? Date.now() > oauth.expiresAt : false;
            claudeResult.authenticated = !tokenExpired;
            claudeResult.subscriptionType = oauth.subscriptionType || 'unknown';
          }
        } catch { /* ignore */ }
      }
    }

    // Enrich kimi-cli with auth status
    const kimiResult = results.find(r => r.name === 'kimi-cli');
    if (kimiResult?.installed) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const credPath = path.join(home, '.kimi', 'credentials', 'kimi-code.json');
      if (fs.existsSync(credPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
          // Prefer refresh token expiry (30-day session) over access token expiry (15 min)
          if (raw?.refresh_token) {
            try {
              const payload = JSON.parse(Buffer.from(raw.refresh_token.split('.')[1], 'base64').toString());
              const refreshExpired = payload.exp ? Date.now() > payload.exp * 1000 : false;
              kimiResult.authenticated = !refreshExpired;
            } catch {
              const tokenExpired = raw.expires_at ? Date.now() > (raw.expires_at * 1000) : false;
              kimiResult.authenticated = !tokenExpired;
            }
          } else if (raw?.access_token) {
            const tokenExpired = raw.expires_at ? Date.now() > (raw.expires_at * 1000) : false;
            kimiResult.authenticated = !tokenExpired;
          }
        } catch { /* ignore */ }
      }
    }

    res.json({
      tools: results,
      anyInstalled: results.some(r => r.installed),
      installedCount: results.filter(r => r.installed).length,
    });
  } catch (err: any) {
    console.error('❌ [cli-detect] Internal error:', err);
    res.status(500).json({ error: 'cli-detect failed', message: err.message });
  }
});

// =============================================
// CLI PATH OVERRIDES (global, not per-company)
// =============================================

router.get('/api/system/cli-paths', authMiddleware, (_req, res) => {
  res.json(getAllCliPaths());
});

router.put('/api/system/cli-paths/:tool', authMiddleware, async (req, res) => {
  const tool = req.params.tool;
  const pathValue = (req.body.path ?? '') as string;

  const key = `cli_path_${tool}`;
  const wertToStore = encryptSetting(key, pathValue);

  const existing = db.select().from(settings)
    .where(and(eq(settings.key, key), eq(settings.companyId, '')))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value: wertToStore, updatedAt: now() })
      .where(and(eq(settings.key, key), eq(settings.companyId, '')))
      .run();
  } else {
    db.insert(settings)
      .values({ key, value: wertToStore, companyId: '', updatedAt: now() })
      .run();
  }

  setCliPath(tool, pathValue);

  console.log(`🔧 CLI path override updated: ${tool} = ${pathValue || '(cleared)'}`);
  res.json({ ok: true, tool, path: pathValue });
});

export default router;

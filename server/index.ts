import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth as betterAuth } from './auth.js';
import { db, initializeDatabase, sqlite } from './db/client.js';
import { companies, agents, tasks, comments, approvals, activityLog, costEntries, workCycles, workCyclesArchive, goals, settings, chatMessages, users, user, routines, routineTrigger, routineRuns, workProducts, projects, agentPermissions, traceEvents, skillsLibrary, agentSkills, agentWakeupRequests, palaceWings, palaceDrawers, palaceDiary, palaceKg, palaceSummaries, budgetPolicies, budgetIncidents, executionWorkspaces, issueRelations, agentMeetings, openclawTokens, agentConfigHistory, ceoDecisionLog, agentTrustScores, agentVotes, agentCapabilities, contractNetBids, companyMemberships, learnedSkills } from './db/schema.js';
import { getWorkspaceInfo, readWorkspaceFile } from './services/workspace.js';
import { encryptSetting, decryptSetting } from './utils/crypto.js';
import { eq, desc, asc, and, sql, count, sum, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { seedDatabase } from './db/seed.js';
import { WebSocketServer } from 'ws';
import http from 'http';
import { spawn } from 'child_process';
import { scheduler, setEmitTrace, setBroadcastUpdate } from './scheduler.js';
import { cronService } from './services/cron.js';
import { heartbeatService } from './services/heartbeat.js';
import { wakeupService } from './services/wakeup.js';
import { skillsService } from './services/skills.js';
import { cleanupService } from './services/cleanup.js';
import { backupService } from './services/backup.js';
import { initializePluginSystem, shutdownPluginSystem, pluginManager } from './plugins/index.js';
import { discordBotService } from './services/discord-bot.js';
import { runClaudeDirectChat } from './adapters/claude-code.js';
import { runCodexDirectChat } from './adapters/codex-cli.js';
import { runGeminiDirectChat } from './adapters/gemini-cli.js';
import { runKimiDirectChat } from './adapters/kimi-cli.js';
import { adapterRegistry } from './adapters/registry.js';
import { setCliPath, getCliPath, getAllCliPaths } from './adapters/cli-paths.js';
import { ensureWorkspace, listeWorkspaces, raeumeWorkspaceAuf, schliesseWorkspace } from './services/execution-workspaces.js';

import { messagingService, buildConfigContext, executeConfigAction, getUiLanguage, langLine } from './services/messaging.js';
import { processChatActions } from './services/chat-actions.js';
import { TOOL_DEFINITIONS, executeTool, extractToolCalls, stripToolBlocks } from './services/chat-tools.js';
import { loadSoul } from './services/heartbeat/utils.js';
import { appEvents } from './events.js';
import { autoSaveInsights, loadRelevantMemory } from './services/memory-auto.js';
import { nodeManager } from './services/nodeManager.js';
import webhooksRouter from './routes/webhooks.js';
import semanticMemoryRouter from './routes/semantic-memory.js';
import skillsRouter from './routes/skills.js';
import routinesRouter from './routes/routines.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import approvalsRouter from './routes/approvals.js';
import goalsRouter from './routes/goals.js';
import agentsRouter from './routes/agents.js';
import meetingsRouter from './routes/meetings.js';
import pluginsRouter from './routes/plugins.js';
import systemRouter from './routes/system.js';
import companiesRouter from './routes/companies.js';
import { logAktivitaet } from './services/activity-log.js';
import {
  authMiddleware,
  requireCompanyAccess,
  requireResourceAccess,
  agentAuth,
  deriveAgentToken,
} from './middleware/auth.js';
// Re-export for any external module still importing from './index.js'
export { authMiddleware, requireCompanyAccess, requireResourceAccess };

const isProduction = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET) {
  if (isProduction) {
    console.error('🚨 FATAL: JWT_SECRET is not set. Set a secure random value before running in production.');
    process.exit(1);
  } else {
    // Generate a fresh random secret each dev restart — sessions don't persist anyway
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  JWT_SECRET not set — generated a random dev secret. Set JWT_SECRET in .env for stable sessions.');
  }
}
const JWT_SECRET = process.env.JWT_SECRET as string;

// ── Zod schemas for input validation ─────────────────────────────────────────
const zCompany = z.object({
  name: z.string().min(1).max(120),
  beschreibung: z.string().max(1000).optional(),
  ziel: z.string().max(1000).optional(),
});

// (zAgent moved to ./routes/agents.ts)

const zTask = z.object({
  title: z.string().min(1).max(300).optional(),
  titel: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  beschreibung: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  prioritaet: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
}).passthrough();

/** Validates req.body against schema. Returns parsed data or sends 400 and returns null. */
function validate<T>(schema: z.ZodType<T>, req: express.Request, res: express.Response): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid input', details: result.error.flatten() });
    return null;
  }
  return result.data;
}

// ── Process-level error safety: log instead of silently crashing ─────────────
// These catch async errors that escape try/catch blocks in adapters, plugins,
// timers, or WebSocket handlers. Without these, one unhandled promise takes
// the whole server down.
process.on('unhandledRejection', (reason: any, promise) => {
  console.error('🚨 UnhandledRejection:', reason?.stack || reason, '\n  Promise:', promise);
});
process.on('uncaughtException', (err: any) => {
  console.error('🚨 UncaughtException:', err?.stack || err);
  // Note: Node recommends exiting after uncaughtException since state may be corrupt.
  // We log-and-continue here because OpenCognit's heartbeat/cron loops must survive
  // transient adapter failures. Real fatals (OOM, stack overflow) will still abort.
});

const app = express();

// ===== DE → EN URL compatibility layer =====
// The frontend still calls German-named endpoints while the backend
// routes were refactored to English. This middleware rewrites URLs
// so old frontend code continues to work.
app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.url = req.url
    .replace(/^\/api\/unternehmen/, '/api/companies')
    .replace(/^\/api\/einstellungen/, '/api/settings')
    .replace(/\/experten\b/g, '/agents')
    .replace(/\/mitarbeiter\b/g, '/agents')
    .replace(/\/aufgaben\b/g, '/tasks')
    .replace(/\/ziele\b/g, '/goals')
    .replace(/\/routinen\b/g, '/routines')
    .replace(/\/genehmigungen\b/g, '/approvals')
    .replace(/\/projekte\b/g, '/projects')
    .replace(/\/aktivitaet\b/g, '/activity')
    .replace(/\/agent-qualitaet\b/g, '/agent-quality')
    .replace(/\/kosten\b/g, '/costs')
    .replace(/\/zusammenfassung\b/g, '/summary')
    .replace(/\/nach-provider\b/g, '/by-provider')
    .replace(/\/pausieren\b/g, '/pause')
    .replace(/\/fortsetzen\b/g, '/resume')
    .replace(/\/genehmigen\b/g, '/approve')
    .replace(/\/ablehnen\b/g, '/reject');
  next();
});

// ===== EN → DE response field aliasing =====
// Frontend code still reads German field names on many pages.
// This middleware wraps res.json to add German aliases on responses
// so old frontend code keeps working until the migration is complete.
const FIELD_ALIASES: Record<string, string> = {
  title: 'titel',
  description: 'beschreibung',
  createdAt: 'erstelltAm',
  updatedAt: 'aktualisiertAm',
  completedAt: 'abgeschlossenAm',
  assignedTo: 'zugewiesenAn',
  priority: 'prioritaet',
  connectionType: 'verbindungsTyp',
  connectionConfig: 'verbindungsConfig',
  costCent: 'kostenCent',
  message: 'nachricht',
  senderType: 'absenderTyp',
  agentId: 'expertId',
  companyId: 'unternehmenId',
  taskId: 'aufgabeId',
  key: 'schluessel',
  value: 'wert',
  type: 'typ',
  role: 'rolle',
  skills: 'faehigkeiten',
  avatarColor: 'avatarFarbe',
  autoCycleActive: 'zyklusAktiv',
  autoCycleIntervalSec: 'zyklusIntervallSek',
  monthlyBudgetCent: 'budgetMonatCent',
  monthlySpendCent: 'verbrauchtMonatCent',
  goal: 'ziel',
  level: 'ebene',
  progress: 'fortschritt',
  ownerAgentId: 'eigentuemerExpertId',
  organizerAgentId: 'veranstalterExpertId',
  participantIds: 'teilnehmerIds',
  result: 'ergebnis',
  decidedAt: 'entschiedenAm',
  decisionNote: 'entscheidungsnotiz',
  requestedBy: 'angefordertVon',
  actorType: 'akteurTyp',
  actorId: 'akteurId',
  actorName: 'akteurName',
  action: 'aktion',
  entityType: 'entitaetTyp',
  entityId: 'entitaetId',
  read: 'gelesen',
  active: 'aktiv',
  content: 'inhalt',
  lastCycle: 'letzterZyklus',
  monthlyBudgetCent: 'budgetMonatCent',
  uses: 'nutzungen',
  successes: 'erfolge',
  confidence: 'konfidenz',
  source: 'quelle',
  createdBy: 'erstelltVon',
};

function aliasObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(aliasObject);
  const out: any = { ...obj };
  for (const [eng, de] of Object.entries(FIELD_ALIASES)) {
    if (eng in out && !(de in out)) out[de] = out[eng];
  }
  // Recurse into nested objects (e.g., approval.payload.params)
  for (const k of Object.keys(out)) {
    if (out[k] && typeof out[k] === 'object') out[k] = aliasObject(out[k]);
  }
  return out;
}

app.use((_req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body: any) => orig(aliasObject(body));
  next();
});

const PORT = parseInt(process.env.PORT || '3201');
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ===== WebSocket Auth (BetterAuth cookie first, JWT token fallback) =====
wss.on('upgrade', (request, socket, head) => {
  (async () => {
    try {
      const urlParams = new URL(request.url || '', `http://localhost`).searchParams;
      const token = urlParams.get('token');

      if (token) {
        // Legacy JWT auth
        const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
        const user = db.select({ id: users.id }).from(users).where(eq(users.id, payload.userId)).get();
        if (!user) throw new Error('JWT user not found');
        // Authenticated — proceed with upgrade
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
        return;
      }

      // BetterAuth cookie auth — cookies are sent automatically during WS upgrade
      const session = await betterAuth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (session?.user) {
        // Authenticated — proceed with upgrade
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
        return;
      }

      throw new Error('No valid auth');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  })();
});

// ===== WebSocket Inbound Handling =====
wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection (authenticated)');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'node.describe') {
        const { nodeId, capabilities } = message;
        nodeManager.registerNode(ws, nodeId, capabilities);
        ws.send(JSON.stringify({ type: 'node.registered', nodeId, timestamp: new Date().toISOString() }));
      }
      
      if (message.type === 'node.response') {
        nodeManager.handleResponse(message);
      }
      
      // More message types can be added here (e.g., node.response for invoke results)
    } catch (err) {
      console.error('❌ Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    nodeManager.unregisterNodeBySocket(ws);
  });
});

app.use(cors({
  origin: ['http://localhost:3200', 'http://localhost:3201'],
  credentials: true,
}));

// Legacy /api/auth/ich endpoint — MUST be before BetterAuth mount
app.get('/api/auth/ich', async (req, res) => {
  try {
    const session = await betterAuth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session?.user) {
      return res.json({
        id: session.user.id,
        name: session.user.name || session.user.email,
        email: session.user.email,
        rolle: (session.user as any).role || 'mitglied',
      });
    }
  } catch { /* fall through */ }

  // JWT fallback
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    const nutzer = db.select().from(users).where(eq(users.id, payload.userId)).get();
    if (!nutzer) return res.status(401).json({ error: 'User not found.' });
    res.json({ id: nutzer.id, name: nutzer.name, email: nutzer.email, rolle: nutzer.role });
  } catch {
    res.status(401).json({ error: 'Token invalid or expired.' });
  }
});

// Mount BetterAuth BEFORE express.json() — per BetterAuth docs
app.use('/api/auth', toNodeHandler(betterAuth));

app.use(express.json());

// Silence Chrome DevTools probe — harmless 404 spam in dev
app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req: any, res: any) => res.json({}));

// Webhooks need to bypass the global auth (they verify their own signatures).
app.use('/api/webhooks', webhooksRouter);

// All other routers are mounted AFTER the global auth middleware below
// so they participate in the same auth/rate-limit chain as the inline /api
// routes. (Search this file for "MOUNT EXTRACTED ROUTERS HERE".)

// ── Global API Rate Limiter (all /api routes) ───────────────────────────────
// Protects against DoS, brute-force, and accidental request floods.
// Configurable via env vars:
//   API_RATE_LIMIT_READ=120      (GET/HEAD requests per window)
//   API_RATE_LIMIT_WRITE=30      (POST/PUT/PATCH/DELETE per window)
//   API_RATE_LIMIT_WINDOW_MS=60000 (window size in ms)
//
// NOTE: In-memory only — use Redis in multi-instance deployments.

const RATE_LIMIT_READ = parseInt(process.env.API_RATE_LIMIT_READ || '120', 10);
const RATE_LIMIT_WRITE = parseInt(process.env.API_RATE_LIMIT_WRITE || '30', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10);

interface RateLimitEntry {
  readCount: number;
  writeCount: number;
  resetAt: number;
}

const apiRateLimits = new Map<string, RateLimitEntry>();

function apiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Skip rate limiting for webhooks (they have their own auth)
  if (req.path.startsWith('/webhooks')) return next();

  // Skip rate limiting for localhost/development
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress || 'unknown';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const now_ms = Date.now();

  let entry = apiRateLimits.get(ip);
  if (!entry || now_ms > entry.resetAt) {
    entry = { readCount: 0, writeCount: 0, resetAt: now_ms + RATE_LIMIT_WINDOW_MS };
    apiRateLimits.set(ip, entry);
  }

  const limit = isWrite ? RATE_LIMIT_WRITE : RATE_LIMIT_READ;
  const current = isWrite ? entry.writeCount : entry.readCount;

  if (current >= limit) {
    const retryAfter = Math.ceil((entry.resetAt - now_ms) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Rate limit exceeded. Please wait.',
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
      retryAfter,
    });
  }

  if (isWrite) entry.writeCount++;
  else entry.readCount++;

  // Expose rate limit headers
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - (isWrite ? entry.writeCount : entry.readCount))));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  next();
}

// Prune both rate limit maps periodically
setInterval(() => {
  const now_ms = Date.now();
  for (const [ip, entry] of apiRateLimits.entries()) {
    if (now_ms > entry.resetAt) apiRateLimits.delete(ip);
  }
}, 60000);

// Apply global rate limiter to all /api routes
app.use('/api', apiRateLimit);
// ────────────────────────────────────────────────────────────────────────────

// ── Simple in-memory rate limiter for auth endpoints ────────────────────────
const authRateLimits = new Map<string, { count: number; resetAt: number }>();
function authRateLimit(maxPerWindow: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const entry = authRateLimits.get(ip);
    const now_ms = Date.now();
    if (!entry || now_ms > entry.resetAt) {
      authRateLimits.set(ip, { count: 1, resetAt: now_ms + windowMs });
      return next();
    }
    if (entry.count >= maxPerWindow) {
      return res.status(429).json({ error: 'Too many attempts. Please wait.' });
    }
    entry.count++;
    return next();
  };
}
// Prune rate limit map periodically to avoid unbounded growth
setInterval(() => {
  const now_ms = Date.now();
  for (const [ip, entry] of authRateLimits.entries()) {
    if (now_ms > entry.resetAt) authRateLimits.delete(ip);
  }
}, 60000);
// ────────────────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

// ===== WebSocket Live-Updates =====
function broadcastUpdate(type: string, data: any) {
  const msg = JSON.stringify({ type, data, timestamp: now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(msg);
    }
  });
}

// Allow other services (messaging, etc.) to broadcast without circular imports
appEvents.on('broadcast', ({ type, data }: { type: string; data: any }) => {
  broadcastUpdate(type, data);
});

// Forward trace events from heartbeat/services → SSE clients (avoids circular import)
appEvents.on('trace', ({ agentId, companyId, type, title, details, runId }: any) => {
  emitTrace(agentId, companyId, type, title, details, runId);
});

// Wire up scheduler broadcast + trace functions (these were imported but never registered)
setBroadcastUpdate(broadcastUpdate);
setEmitTrace(emitTrace);

// (auth middleware moved to ./middleware/auth.ts — imported above)

// (logAktivitaet moved to ./services/activity-log.ts — imported above)

// ===== Globaler Auth-Schutz =====
// Alle /api Routen außer öffentliche sind geschützt
app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const oeffentlich = [
    '/auth/sign-in', '/auth/sign-up', '/auth/sign-out',
    '/auth/session', '/auth/callback', '/auth/ich',
    '/health', '/system/status',
  ];
  if (oeffentlich.some(p => req.path.startsWith(p)) || req.path.startsWith('/agent/')) return next();
  return authMiddleware(req, res, next);
});

// MOUNT EXTRACTED ROUTERS HERE — after the global rate-limiter and auth chain
// so a request to a moved route still passes through them, exactly as it did
// before the routes were factored out. semantic-memory has its own per-route
// authMiddleware so the order doesn't matter for it; bundling it here keeps
// all the moved routers together.
app.use('/api/semantic-memory', semanticMemoryRouter);
// Skills router uses full /api/... paths internally because skill-related
// endpoints span multiple URL prefixes that don't share a clean base path.
app.use('/', skillsRouter);
app.use('/', routinesRouter);
app.use('/', projectsRouter);
app.use('/', tasksRouter);
app.use('/', approvalsRouter);
app.use('/', goalsRouter);
app.use('/', agentsRouter);
app.use('/', meetingsRouter);
app.use('/', pluginsRouter);
app.use('/', systemRouter);
app.use('/', companiesRouter);

// =============================================
// UNTERNEHMEN — moved to ./routes/companies.ts
// =============================================

// (workspace/check moved to ./routes/companies.ts)

// Filesystem directory browser — lists subdirectories of a given path
app.get('/api/fs/dirs', authMiddleware, (req: any, res) => {
  const requested = (req.query.path as string) || '';
  const home = process.env.HOME || process.env.USERPROFILE || '/home';
  const current = requested ? path.resolve(requested) : home;

  // Safety: never list inside server/, src/, node_modules/
  const projectRoot = path.resolve(process.cwd());
  const blocked = ['node_modules', 'src', 'server', '.git'].map(d => path.join(projectRoot, d));
  if (blocked.some(b => current.startsWith(b))) {
    return res.status(403).json({ error: 'This path is not browsable' });
  }

  if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
    return res.status(400).json({ error: 'Path does not exist or is not a folder' });
  }

  let dirs: { name: string; path: string }[] = [];
  try {
    dirs = fs.readdirSync(current, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => ({ name: d.name, path: path.join(current, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* permission denied etc. */ }

  const parent = path.dirname(current) !== current ? path.dirname(current) : null;
  res.json({ current, parent, home, dirs });
});

// Create a directory (used by FolderPickerModal)
app.post('/api/fs/mkdir', authMiddleware, (req: any, res) => {
  const { path: dirPath } = req.body as { path?: string };
  if (!dirPath || !path.isAbsolute(dirPath)) return res.status(400).json({ error: 'Absolute path required' });
  // Block creating inside project source tree
  const projectRoot = path.resolve(process.cwd());
  const blocked = ['node_modules', 'src', 'server', '.git'].map(d => path.join(projectRoot, d));
  if (blocked.some(b => path.resolve(dirPath).startsWith(b))) {
    return res.status(403).json({ error: 'Cannot create folder here' });
  }
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ ok: true, path: dirPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// (open-folder moved to ./routes/companies.ts)

// =============================================
// MITARBEITER (agents) — moved to ./routes/agents.ts
// (chat, soul, trace, agent-skills, /api/agent/* endpoints stay
//  here for now and will move in follow-up PRs)
// =============================================

// =============================================
// AUFGABEN — moved to ./routes/tasks.ts
// (work-products list / workspace endpoints, blockers, decompose,
//  tasks/graph stay here for now)
// =============================================

// Company-level work products gallery
app.get('/api/companies/:id/work-products', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const typ = req.query.type as string | undefined;
  const products = db.select().from(workProducts)
    .where(and(
      eq(workProducts.companyId, req.params.id as string),
      ...(typ ? [eq(workProducts.type, typ)] : []),
    ))
    .orderBy(desc(workProducts.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  res.json(products);
});

// Workspace info (file listing)
app.get('/api/tasks/:id/workspace', requireResourceAccess("task"), (req, res) => {
  const info = getWorkspaceInfo(req.params.id as string);
  res.json(info);
});

// Read single workspace file (for preview in UI)
app.get('/api/tasks/:id/workspace/file', requireResourceAccess("task"), (req, res) => {
  const filename = req.query.path as string;
  if (!filename) return res.status(400).json({ error: 'path query parameter required' });

  const content = readWorkspaceFile(req.params.id, filename);
  if (content === null) return res.status(404).json({ error: 'File not found' });

  res.type('text/plain').send(content);
});

// =============================================
// COMPANY WORKDIR FILE READ (for chat [FILE] cards)
// =============================================
app.get('/api/files/read', authMiddleware, requireCompanyAccess(), (req, res) => {
  const unternehmenId = req.companyId as string;
  const relPath = (req.query.path as string || '').trim();
  if (!unternehmenId) return res.status(400).json({ error: 'Missing x-company-id header' });
  if (!relPath) return res.status(400).json({ error: 'path query required' });

  const comp = db.select().from(companies).where(eq(companies.id, unternehmenId)).get() as any;
  const workDir = comp?.workDir;
  if (!workDir) return res.status(400).json({ error: 'workdir_not_set' });

  const root = path.resolve(workDir);
  const target = path.resolve(root, relPath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    return res.status(403).json({ error: 'path_escape' });
  }
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'not_found' });
  const stat = fs.statSync(target);
  if (!stat.isFile()) return res.status(400).json({ error: 'not_a_file' });
  if (stat.size > 1024 * 1024) return res.status(413).json({ error: 'too_large', size: stat.size });

  const ext = path.extname(target).toLowerCase();
  const TEXT_EXT = new Set(['.md','.txt','.json','.yaml','.yml','.ts','.tsx','.js','.jsx','.py','.go','.rs','.html','.css','.csv','.log','.sh','.toml','.xml','.sql','.env','.ini','.conf']);
  const isText = TEXT_EXT.has(ext) || stat.size < 32 * 1024;
  let content = '';
  try { content = fs.readFileSync(target, 'utf-8'); } catch { return res.status(500).json({ error: 'read_failed' }); }

  res.json({
    path: relPath,
    absPath: target,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    ext,
    content: isText ? content : '',
    binary: !isText,
  });
});

// =============================================
// GENEHMIGUNGEN — moved to ./routes/approvals.ts
// =============================================

// =============================================
// KOSTEN
// =============================================

// Budget forecast — projected spend trajectory per active policy
app.get('/api/companies/:unternehmenId/budget/forecast', requireCompanyAccess(), async (req, res) => {
  try {
    const { getForecasts } = await import('./services/budget-forecast.js');
    res.json({ forecasts: getForecasts(req.params.unternehmenId) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/companies/:unternehmenId/costs/summary', requireCompanyAccess(), (req, res) => {
  const agenten = db.select().from(agents).where(eq(agents.companyId, req.params.unternehmenId)).all();

  const gesamtVerbraucht = agenten.reduce((s: number, a: any) => s + a.monthlySpendCent, 0);
  const gesamtBudget = agenten.reduce((s: number, a: any) => s + a.monthlyBudgetCent, 0);

  const proAgent = agenten.map((a: any) => ({
    id: a.id,
    name: a.name,
    titel: a.title,
    avatar: a.avatar,
    avatarFarbe: a.avatarColor,
    verbindungsTyp: a.connectionType,
    verbrauchtMonatCent: a.monthlySpendCent,
    budgetMonatCent: a.monthlyBudgetCent,
    prozent: a.monthlyBudgetCent > 0 ? Math.round((a.monthlySpendCent / a.monthlyBudgetCent) * 100) : 0,
  })).sort((a: any, b: any) => b.prozent - a.prozent);

  res.json({
    gesamtVerbraucht,
    gesamtBudget,
    gesamtProzent: gesamtBudget > 0 ? Math.round((gesamtVerbraucht / gesamtBudget) * 100) : 0,
    proExperte: proAgent,
  });
});

// Kosten nach Provider aggregiert
app.get('/api/companies/:unternehmenId/costs/by-provider', requireCompanyAccess(), (req, res) => {
  const buchungen = db.select().from(costEntries)
    .where(eq(costEntries.companyId, req.params.unternehmenId as string)).all();

  const providerMap = new Map<string, { kosten: number; tokens: number; buchungen: number }>();
  for (const b of buchungen) {
    const key = b.provider;
    const entry = providerMap.get(key) || { kosten: 0, tokens: 0, buchungen: 0 };
    entry.kosten += b.costCent;
    entry.tokens += b.inputTokens + b.outputTokens;
    entry.buchungen += 1;
    providerMap.set(key, entry);
  }

  const result = Array.from(providerMap.entries())
    .map(([anbieter, data]) => ({ anbieter, ...data }))
    .sort((a, b) => b.kosten - a.kosten);

  res.json(result);
});

// Kosten Timeline (letzte 14 Tage, pro Tag aggregiert)
app.get('/api/companies/:unternehmenId/costs/timeline', requireCompanyAccess(), (req, res) => {
  const tage = parseInt(req.query.tage as string) || 14;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - tage);
  const startISO = startDate.toISOString();

  const buchungen = db.select().from(costEntries)
    .where(eq(costEntries.companyId, req.params.unternehmenId as string))
    .all()
    .filter(b => b.timestamp >= startISO);

  const tageMap = new Map<string, number>();
  // Alle Tage vorab initialisieren
  for (let i = 0; i < tage; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (tage - 1 - i));
    tageMap.set(d.toISOString().split('T')[0], 0);
  }

  for (const b of buchungen) {
    const tag = b.timestamp.split('T')[0];
    tageMap.set(tag, (tageMap.get(tag) || 0) + b.costCent);
  }

  const result = Array.from(tageMap.entries())
    .map(([datum, kostenCent]) => ({ datum, kostenCent }));

  res.json(result);
});

app.post('/api/companies/:unternehmenId/costEntries', requireCompanyAccess(), (req, res) => {
  const { expertId, aufgabeId, anbieter, modell, inputTokens, outputTokens, kostenCent } = req.body;
  if (!expertId || !anbieter || !modell || kostenCent === undefined) {
    return res.status(400).json({ error: 'Required: agentId, provider, model, costCent' });
  }

  const id = uuid();
  db.insert(costEntries).values({
    id,
    companyId: req.params.unternehmenId,
    agentId: expertId,
    taskId: aufgabeId || null,
    provider: anbieter,
    model: modell,
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    costCent: kostenCent,
    timestamp: now(),
    createdAt: now(),
  }).run();

  // Update expert spent
  db.update(agents).set({
    monthlySpendCent: sql`${agents.monthlySpendCent} + ${kostenCent}`,
    updatedAt: now(),
  }).where(eq(agents.id, expertId as string)).run();

  // Check budget threshold
  const agent = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (agent && agent.monthlyBudgetCent > 0) {
    const prozent = Math.round((agent.monthlySpendCent / agent.monthlyBudgetCent) * 100);
    if (prozent >= 100 && agent.status !== 'paused') {
      db.update(agents).set({ status: 'paused', updatedAt: now() }).where(eq(agents.id, expertId as string)).run();
      logAktivitaet(req.params.unternehmenId, 'system', 'system', 'System', `${agent.name} wurde pausiert (Budget ${prozent}%)`, 'agents', expertId);
    }
  }

  res.status(201).json({ id });
});

// =============================================
// PROJEKTE — moved to ./routes/projects.ts
// (whiteboard endpoints stay here for now — they need broadcastUpdate)
// =============================================
// AGENT PERMISSIONS — moved to ./routes/agents.ts
// =============================================

// =============================================
// AKTIVITÄT
// =============================================
app.get('/api/companies/:unternehmenId/activity', requireCompanyAccess(), (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const rows = db.select().from(activityLog)
    .where(eq(activityLog.companyId, req.params.unternehmenId))
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
// AGENTEN API (Für ausgehende Aufrufe der Agenten)
// =============================================

// (deriveAgentToken + agentAuth moved to ./middleware/auth.ts — imported above)

// ===== Permission Helper =====
function getAgentPermissions(expertId: string) {
  const perms = db.select().from(agentPermissions)
    .where(eq(agentPermissions.agentId, expertId)).get();
  // Defaults wenn keine Permissions gesetzt
  return perms ?? {
    darfAufgabenErstellen: true,
    darfAufgabenZuweisen: false,
    darfGenehmigungAnfordern: true,
    darfGenehmigungEntscheiden: false,
    darfExpertenAnwerben: false,
    budgetLimitCent: null,
    erlaubtePfade: null,
    erlaubteDomains: null,
  };
}

// =============================================
// AGENT WAKEUP / PERFORMANCE / INBOX / TEAM-STATUS
// moved to ./routes/agents.ts
// =============================================

app.post('/api/agent/tasks', agentAuth, (req, res) => {
  const { titel, beschreibung, prioritaet, zugewiesenAn, expertId, unternehmenId } = req.body;
  if (!titel) return res.status(400).json({ error: 'Title required' });

  // Permission check
  const perms = getAgentPermissions(expertId);
  if (!perms.darfAufgabenErstellen) {
    return res.status(403).json({ error: 'No permission: cannot create tasks' });
  }
  if (zugewiesenAn && !perms.darfAufgabenZuweisen) {
    return res.status(403).json({ error: 'No permission: cannot assign tasks' });
  }

  const agent = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  const id = uuid();

  db.insert(tasks).values({
    id, companyId: unternehmenId, title: titel, description: beschreibung,
    status: 'backlog',
    priority: prioritaet || 'medium',
    assignedTo: zugewiesenAn || null,
    createdBy: expertId,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  logAktivitaet(unternehmenId, 'agent', expertId, agent?.name || 'Experte', `hat Aufgabe „${titel}" erstellt`, 'aufgabe', id);
  res.status(201).json({ success: true, id });
});

app.post('/api/agent/tasks/:id/status', agentAuth, (req, res) => {
  const id = req.params.id as string;
  const { status } = req.body;
  const expertId = req.body.agentId as string;

  const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'];
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Ungültiger Status. Erlaubt: ${VALID_STATUSES.join(', ')}` });
  }

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  db.update(tasks)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();

  broadcastUpdate('task_updated', { id, status });

  const agent = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  const agentName = agent?.name || '';
  const taskTitel = aufgabe?.title || '';
  const unternehmenId = aufgabe?.companyId || req.body.companyId;

  if (status === 'done') {
    broadcastUpdate('task_completed', { unternehmenId, taskId: id, taskTitel, agentName });
  } else if (status === 'in_progress') {
    broadcastUpdate('task_started', { unternehmenId, taskId: id, taskTitel, agentName });
  }

  logAktivitaet(unternehmenId, 'agent', expertId, agentName || 'Experte', `hat Ticket ${id} auf ${status} gesetzt.`, 'aufgabe', id);

  res.json({ status: 'ok' });
});

// Agent Chat Reply Endpoint
app.post('/api/agent/chat', agentAuth, (req, res) => {
  const expertId = req.body.agentId;
  const unternehmenId = req.body.companyId;
  const { nachricht } = req.body;

  if (!nachricht) return res.status(400).json({ error: 'Missing nachricht' });

  const msg = {
    id: uuid(),
    companyId: unternehmenId,
    agentId: expertId,
    senderType: 'agent' as const,
    message: nachricht,
    read: false,
    createdAt: new Date().toISOString()
  };

  db.insert(chatMessages).values(msg).run();

  broadcastUpdate('chat_message', msg);

  res.json({ status: 'ok', message: msg });
});

app.post('/api/agent/tasks/:id/kommentar', agentAuth, (req, res) => {
  const aufgabeId = req.params.id as string;
  const { inhalt, expertId, unternehmenId } = req.body;
  const id = uuid();
  db.insert(comments).values({
    id, companyId: unternehmenId, taskId: aufgabeId, authorAgentId: expertId, authorType: 'agent', content: inhalt, createdAt: now()
  }).run();

  const agent = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  logAktivitaet(unternehmenId, 'agent', expertId, agent?.name || 'Experte', 'hat einen Kommentar hinterlassen', 'aufgabe', aufgabeId);
  res.status(201).json({ success: true });
});

// =============================================
// DASHBOARD
// =============================================
app.get('/api/companies/:unternehmenId/dashboard', requireCompanyAccess(), (req, res) => {
  const unternehmenId = req.params.unternehmenId;

  try {
    const agenten = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
    const companyTasks = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();
    const pendingApprovals = db.select().from(approvals).where(and(eq(approvals.companyId, unternehmenId), eq(approvals.status, 'pending'))).all();
    const recentActivity = db.select().from(activityLog).where(eq(activityLog.companyId, unternehmenId)).orderBy(desc(activityLog.createdAt)).limit(10).all();
    const unternehmenData = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();

    const aktiveAgenten = agenten.filter((a: any) => ['active', 'running', 'idle'].includes(a.status)).length;
    const offeneAufgaben = companyTasks.filter((t: any) => !['done', 'cancelled'].includes(t.status)).length;
    const inBearbeitung = companyTasks.filter((t: any) => t.status === 'in_progress').length;
    const gesamtVerbraucht = agenten.reduce((s: number, a: any) => s + (a.monthlySpendCent || 0), 0);
    const gesamtBudget = agenten.reduce((s: number, a: any) => s + (a.monthlyBudgetCent || 0), 0);

    // Projects: top 5 active by progress descending
    const alleProj = db.select().from(projects)
      .where(and(eq(projects.companyId, unternehmenId), eq(projects.status, 'aktiv')))
      .orderBy(desc(projects.updatedAt))
      .limit(5).all();

    // Goals: active/planned company-level
    const aktiveZiele = db.select().from(goals)
      .where(and(
        eq(goals.companyId, unternehmenId),
        eq(goals.level, 'company'),
        sql`${goals.status} IN ('active','planned')`,
      ))
      .orderBy(asc(goals.createdAt))
      .limit(8).all();

    // Last trace events (across all agents)
    const letzteTrace = db.select({
      id: traceEvents.id,
      expertId: traceEvents.agentId,
      typ: traceEvents.type,
      titel: traceEvents.title,
      erstelltAm: traceEvents.createdAt,
    }).from(traceEvents)
      .where(eq(traceEvents.companyId, unternehmenId))
      .orderBy(desc(traceEvents.createdAt))
      .limit(10).all();

    // Build expert-name lookup for trace events
    const agentNameMap = Object.fromEntries(agenten.map((a: any) => [a.id, a.name]));

    // Enrich agents with their current active task + last trace event + principles
    const enrichedAgenten = agenten.map((a: any) => {
      const currentTask = companyTasks.find((t: any) =>
        t.assignedTo === a.id && t.status === 'in_progress'
      ) || companyTasks.find((t: any) =>
        t.assignedTo === a.id && t.status === 'todo'
      ) || null;
      const lastTrace = letzteTrace.find(t => t.agentId === a.id) || null;
      const budgetPct = a.monthlyBudgetCent > 0
        ? Math.round((a.monthlySpendCent / a.monthlyBudgetCent) * 100) : 0;
      // Extract principles from system prompt
      const sp = a.systemPrompt || '';
      const extract = (tag: string) => {
        const m = sp.match(new RegExp(`## ${tag}\n([\\s\\S]*?)(?=\n## |$)`));
        return m ? m[1].trim() : '';
      };
      const principlesRaw = extract('ENTSCHEIDUNGSPRINZIPIEN') || extract('DECISION PRINCIPLES');
      const principles = principlesRaw
        ? principlesRaw.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0 && /^[-•*\d]/.test(l)).slice(0, 3)
        : [];
      return {
        ...a,
        currentTask: currentTask ? { id: currentTask.id, titel: currentTask.title, status: currentTask.status } : null,
        lastTrace,
        budgetPct,
        principles,
      };
    });

    const agentsData = {
      gesamt: agenten.length,
      aktiv: aktiveAgenten,
      running: agenten.filter((a: any) => a.status === 'running').length,
      paused: agenten.filter((a: any) => a.status === 'paused').length,
      error: agenten.filter((a: any) => a.status === 'error').length,
    };
    const tasksData = {
      gesamt: companyTasks.length,
      offen: offeneAufgaben,
      inBearbeitung,
      erledigt: companyTasks.filter((t: any) => t.status === 'done').length,
      fehlgeschlagen: companyTasks.filter((t: any) => t.status === 'failed').length,
      blockiert: companyTasks.filter((t: any) => t.status === 'blocked').length,
      completedPerDay: (() => {
        const days: string[] = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          days.push(d.toDateString());
        }
        return days.map(day =>
          companyTasks.filter((t: any) =>
            t.status === 'done' && t.completedAt &&
            new Date(t.completedAt).toDateString() === day
          ).length
        );
      })(),
    };

    res.json({
      companies: unternehmenData,
      unternehmen: unternehmenData,
      agents: agentsData,
      experten: agentsData,
      tasks: tasksData,
      aufgaben: tasksData,
      kosten: {
        gesamtVerbraucht,
        gesamtBudget,
        prozent: gesamtBudget > 0 ? Math.round((gesamtVerbraucht / gesamtBudget) * 100) : 0,
      },
      zyklen: (() => {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const recentZyklen = db.select({ status: workCycles.status })
          .from(workCycles)
          .where(and(eq(workCycles.companyId, unternehmenId), sql`${workCycles.createdAt} >= ${cutoff}`))
          .all();
        return {
          total: recentZyklen.length,
          succeeded: recentZyklen.filter((z: any) => z.status === 'succeeded').length,
          failed: recentZyklen.filter((z: any) => z.status === 'failed').length,
        };
      })(),
      recentActivityCount: (() => {
        const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        return agenten.filter((a: any) => a.lastCycle && a.lastCycle >= cutoff24h).length;
      })(),
      pendingApprovals: pendingApprovals.length,
      topExperten: agenten.slice(0, 5),
      alleExperten: enrichedAgenten,
      letzteAktivitaet: recentActivity.map((a: any) => ({
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
      })),
      topProjekte: alleProj,
      aktiveZiele,
      letzteTrace: letzteTrace.map((t: any) => ({ ...t, expertName: agentNameMap[t.agentId] || t.agentId })),
    });
  } catch (err: any) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// =============================================
// ZIELE (Goals) — moved to ./routes/goals.ts
// =============================================

// =============================================
// ROUTINEN + ROUTINE TRIGGER + ROUTINE AUSFÜHRUNGEN
// moved to ./routes/routines.ts
// =============================================

// =============================================
// WORKSPACES (Isolation via git worktree)
// =============================================
app.get('/api/companies/:id/workspaces', requireCompanyAccess(), (req, res) => {
  try {
    res.json(listeWorkspaces(req.params.id as string));
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.post('/api/tasks/:id/workspace', requireResourceAccess("task"), (req, res) => {
  try {
    const task = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.assignedTo) return res.status(400).json({ error: 'Task has no assigned agent' });
    const ws = ensureWorkspace(task.companyId, task.id, task.assignedTo);
    res.json(ws);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.post('/api/workspaces/:id/close', requireResourceAccess("workspace"), (req, res) => {
  try {
    schliesseWorkspace(req.params.id as string);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.delete('/api/workspaces/:id', requireResourceAccess("workspace"), (req, res) => {
  try {
    const force = String(req.query.force || '') === 'true';
    const result = raeumeWorkspaceAuf(req.params.id, force);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// =============================================
// ADAPTER-PLUGINS (Ökosystem)
// =============================================
app.get('/api/adapters', (_req, res) => {
  res.json({
    registered: adapterRegistry.getRegisteredAdapters(),
    plugins: adapterRegistry.getLoadedPlugins(),
  });
});

// (plugin-registry routes moved to ./routes/plugins.ts)

// =============================================
// WORKER POOL (Multi-Node)
// =============================================
function workerAuthMiddleware(req: any, res: any, next: any) {
  const id = req.headers['x-worker-id'] as string;
  const token = req.headers['x-worker-token'] as string;
  if (!id || !token) return res.status(401).json({ error: 'missing worker credentials' });
  // Lazy load to break module init cycle
  import('./services/worker-pool.js').then(({ authenticateWorker }) => {
    if (!authenticateWorker(id, token)) return res.status(401).json({ error: 'invalid worker credentials' });
    req.workerId = id;
    next();
  }).catch(e => res.status(500).json({ error: e.message }));
}

app.get('/api/workers', authMiddleware, async (_req, res) => {
  try {
    const { listWorkers } = await import('./services/worker-pool.js');
    res.json({ workers: listWorkers() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/workers/register', authMiddleware, async (req, res) => {
  try {
    const { name, hostname, capabilities, maxConcurrency, id } = req.body;
    if (!name || !Array.isArray(capabilities)) {
      return res.status(400).json({ error: 'name and capabilities[] required' });
    }
    const { registerWorker } = await import('./services/worker-pool.js');
    const w = registerWorker({ name, hostname, capabilities, maxConcurrency, id });
    res.json(w); // includes plaintext token — shown once
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

app.post('/api/workers/:id/disable', authMiddleware, async (req, res) => {
  try {
    const { disableWorker } = await import('./services/worker-pool.js');
    disableWorker(req.params.id as string);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Worker-authenticated endpoints (worker sends X-Worker-Id + X-Worker-Token)
app.post('/api/worker/heartbeat', workerAuthMiddleware, async (req: any, res) => {
  try {
    const { heartbeat } = await import('./services/worker-pool.js');
    res.json(heartbeat(req.workerId));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/worker/claim', workerAuthMiddleware, async (req: any, res) => {
  try {
    const { claimWork } = await import('./services/worker-pool.js');
    const capability = (req.body?.capability as string) || null;
    const claim = claimWork(req.workerId, capability);
    if (!claim) return res.json({ claim: null });
    res.json({ claim });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/worker/submit', workerAuthMiddleware, async (req: any, res) => {
  try {
    const { wakeupId, success, error } = req.body;
    if (!wakeupId) return res.status(400).json({ error: 'wakeupId required' });
    const { submitResult } = await import('./services/worker-pool.js');
    res.json(submitResult(req.workerId, wakeupId, !!success, error));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// =============================================
// SKILLS (Phase 3) — GET /api/skills, /api/skills/categories,
// /api/tasks/match-agent and the skills-library + learned-skills routes are
// now in ./routes/skills.ts. Agent-scoped variants stay here for now and
// will move with the future agents router.
// =============================================
app.get('/api/agents/:id/skills', requireResourceAccess("agent"), async (req, res) => {
  try {
    const skills = await skillsService.getAgentSkills(req.params.id as string);
    res.json(skills);
  } catch (error) {
    console.error('Failed to get agent skills:', error);
    res.status(500).json({ error: 'Failed to get agent skills' });
  }
});

app.post('/api/agents/:id/skills', requireResourceAccess("agent"), async (req, res) => {
  const { skillId, proficiency } = req.body;
  if (!skillId) {
    return res.status(400).json({ error: 'skillId is required' });
  }

  try {
    const success = await skillsService.assignSkillToAgent(
      req.params.id,
      skillId,
      proficiency || 50
    );
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to assign skill' });
    }
  } catch (error) {
    console.error('Failed to assign skill:', error);
    res.status(500).json({ error: 'Failed to assign skill' });
  }
});

app.delete('/api/agents/:id/skills/:skillId', requireResourceAccess("agent"), async (req, res) => {
  try {
    const success = await skillsService.removeSkillFromAgent(
      req.params.id,
      req.params.skillId
    );
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to remove skill' });
    }
  } catch (error) {
    console.error('Failed to remove skill:', error);
    res.status(500).json({ error: 'Failed to remove skill' });
  }
});

// ── Export-Soul: migrate existing systemPrompt → SOUL.md file ────────────────
app.post('/api/agents/:id/export-soul', authMiddleware, requireResourceAccess("agent"), async (req, res) => {
  try {
    const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const soulsDir = path.resolve('data', 'souls');
    if (!fs.existsSync(soulsDir)) fs.mkdirSync(soulsDir, { recursive: true });

    const safeName = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const soulPath = path.join(soulsDir, `${safeName}.soul.md`);

    // Build structured SOUL.md from systemPrompt + agent metadata
    const company = db.select().from(companies).where(eq(companies.id, agent.companyId)).get();
    const soulContent = [
      `# SOUL — ${agent.name} [${agent.role}]`,
      `version: ${new Date().toISOString().slice(0, 10)}`,
      '',
      `## Identität`,
      `Ich bin ${agent.name}, ${agent.role}${company ? ` bei {{company.name}}` : ''}.`,
      agent.title ? `Titel: ${agent.title}` : '',
      '',
      `## Fähigkeiten`,
      agent.skills
        ? agent.skills.split(',').map((s: string) => `- ${s.trim()}`).join('\n')
        : `- Allgemeiner Agent`,
      '',
      `## Kernverhalten`,
      agent.systemPrompt
        ? agent.systemPrompt
        : `- Ich erledige mir zugewiesene Aufgaben präzise und vollständig.`,
      '',
      `## Gedächtnis-Präferenzen`,
      `- Ich speichere Entscheidungen in [entscheidungen]`,
      `- Ich tracke Projektstatus in [projekt]`,
      `- Ich archiviere abgeschlossene Erkenntnisse in [erkenntnisse]`,
      '',
      `## Grenzen`,
      `- Ich handle nur im Rahmen meiner zugewiesenen Aufgaben`,
      `- Ich eskaliere blockierte Tasks an meinen Vorgesetzten`,
    ].filter(l => l !== undefined && l !== null).join('\n');

    fs.writeFileSync(soulPath, soulContent, 'utf-8');

    // Update DB: link soul_path, clear old systemPrompt
    db.update(agents)
      .set({ soulPath, soulVersion: null })
      .where(eq(agents.id, agent.id))
      .run();

    res.json({ soulPath, content: soulContent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── SOUL.md: read file content ────────────────────────────────────────────────
app.get('/api/agents/:id/soul', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  try {
    const agent = db.select({ soulPath: agents.soulPath, soulVersion: agents.soulVersion, name: agents.name })
      .from(agents).where(eq(agents.id, req.params.id as string)).get();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.soulPath || !fs.existsSync(agent.soulPath)) {
      return res.json({ soulPath: null, content: null });
    }
    const content = fs.readFileSync(agent.soulPath, 'utf-8');
    res.json({ soulPath: agent.soulPath, soulVersion: agent.soulVersion, content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── SOUL.md: save edited content ──────────────────────────────────────────────
app.put('/api/agents/:id/soul', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });

    const agent = db.select({ soulPath: agents.soulPath, name: agents.name, unternehmenId: agents.companyId })
      .from(agents).where(eq(agents.id, req.params.id as string)).get();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // If no soul_path yet, create one
    let soulPath = agent.soulPath;
    if (!soulPath) {
      const soulsDir = path.resolve('data', 'souls');
      if (!fs.existsSync(soulsDir)) fs.mkdirSync(soulsDir, { recursive: true });
      const safeName = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      soulPath = path.join(soulsDir, `${safeName}.soul.md`);
    }

    fs.writeFileSync(soulPath, content, 'utf-8');
    db.update(agents).set({ soulPath, soulVersion: null }).where(eq(agents.id, req.params.id as string)).run();

    res.json({ success: true, soulPath });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SOUL Generator ──────────────────────────────────────────────────────────
app.post('/api/agents/:id/soul/generate', authMiddleware, requireResourceAccess("agent"), async (req, res) => {
  try {
    const expert = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get() as any;
    if (!expert) return res.status(404).json({ error: 'Expert not found' });

    const company = db.select().from(companies).where(eq(companies.id, expert.companyId)).get() as any;
    const lang = getUiLanguage(expert.companyId);
    const isEn = lang === 'en';

    const prompt = isEn ? `You are an AI architect. Generate a structured SOUL document for this AI agent.

Agent:
- Name: ${expert.name}
- Role: ${expert.role}
- Skills: ${expert.skills || 'none specified'}
- Is Orchestrator/CEO: ${expert.isOrchestrator ? 'yes' : 'no'}
- Company: ${company?.name || 'unknown'}
- Company goal: ${company?.goal || 'not defined'}

Generate a SOUL with exactly these 4 sections. Respond ONLY with this JSON, no text before/after:
{
  "identity": "2-3 sentences: Who am I? What is my core task?",
  "principles": "4-5 decision principles as a numbered list",
  "checklist": "5-6 bullet points of what the agent does on every wakeup",
  "personality": "2-3 sentences about communication style and personality"
}` : `Du bist ein KI-Architekt. Generiere ein strukturiertes SOUL-Dokument für diesen KI-Agenten.

Agent:
- Name: ${expert.name}
- Rolle: ${expert.role}
- Skills: ${expert.skills || 'keine angegeben'}
- Ist Orchestrator/CEO: ${expert.isOrchestrator ? 'ja' : 'nein'}
- Unternehmen: ${company?.name || 'unbekannt'}
- Unternehmensziel: ${company?.goal || 'nicht definiert'}

Generiere ein SOUL mit genau diesen 4 Abschnitten. Antworte NUR mit diesem JSON, kein Text davor/danach:
{
  "identity": "2-3 Sätze: Wer bin ich? Was ist meine Kernaufgabe?",
  "principles": "4-5 Entscheidungsprinzipien als nummerierte Liste",
  "checklist": "5-6 Punkte als Bullet-Liste was der Agent bei jedem Wakeup tut",
  "personality": "2-3 Sätze über Kommunikationsstil und Persönlichkeit"
}`;

    // Try Anthropic first, then OpenRouter
    const anthropicKeyRaw = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get()?.value;
    const anthropicKey = anthropicKeyRaw ? decryptSetting('anthropic_api_key', anthropicKeyRaw) : null;

    let generated: any = null;

    if (anthropicKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
      });
      if (r.ok) {
        const d = await r.json() as any;
        const text = d.content?.[0]?.text || '';
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { generated = JSON.parse(m[0]); } catch { /* ignore */ } }
      }
    }

    if (!generated) {
      const orKeyRaw = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get()?.value;
      const orKey = orKeyRaw ? decryptSetting('openrouter_api_key', orKeyRaw) : null;
      if (orKey) {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${orKey}`, 'HTTP-Referer': 'http://localhost:3200', 'X-Title': 'OpenCognit SOUL' },
          body: JSON.stringify({ model: 'openrouter/auto', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 }),
        });
        if (r.ok) {
          const d = await r.json() as any;
          const text = d.choices?.[0]?.message?.content || '';
          const m = text.match(/\{[\s\S]*\}/);
          if (m) { try { generated = JSON.parse(m[0]); } catch { /* ignore */ } }
        }
      }
    }

    if (!generated) {
      // Fallback: template-based generation
      generated = isEn ? {
        identity: `I am ${expert.name}, ${expert.role} at ${company?.name || 'our company'}. My main task is to ${expert.skills ? `bring expertise in ${expert.skills.split(',')[0].trim()}` : 'professionally handle my assigned tasks'} and contribute to the company goal.`,
        principles: `1. Quality over speed — thorough beats fast\n2. Escalate blockers immediately, don't wait\n3. Document every decision\n4. When in doubt, ask the CEO\n5. Always formulate results clearly and measurably`,
        checklist: `- Check inbox and read all new messages\n- Review active tasks and assess status\n- Identify blockers and report immediately\n- Document progress\n- Define next steps`,
        personality: `Direct, solution-oriented and professional. Communicate clearly without filler. Take responsibility for results.`,
      } : {
        identity: `Ich bin ${expert.name}, ${expert.role} bei ${company?.name || 'unserem Unternehmen'}. Meine Hauptaufgabe ist es, ${expert.skills ? `Expertise in ${expert.skills.split(',')[0].trim()} einzubringen` : 'meine zugewiesenen Aufgaben professionell zu erledigen'} und zum Unternehmensziel beizutragen.`,
        principles: `1. Qualität vor Geschwindigkeit — lieber gründlich als schnell\n2. Bei Blockern sofort eskalieren, nicht warten\n3. Jede Entscheidung dokumentieren\n4. Im Zweifel den CEO fragen\n5. Ergebnisse immer klar und messbar formulieren`,
        checklist: `- Inbox prüfen und alle neuen Nachrichten lesen\n- Aktive Tasks reviewen und Status bewerten\n- Blocker identifizieren und sofort melden\n- Fortschritt dokumentieren\n- Nächste Schritte definieren`,
        personality: `Direkt, lösungsorientiert und professionell. Kommuniziere klar und ohne Umschweife. Übernehme Verantwortung für Ergebnisse.`,
      };
    }

    res.json(generated);
  } catch (err: any) {
    console.error('SOUL generation failed:', err);
    res.status(500).json({ error: 'SOUL generation failed' });
  }
});

// (POST /api/tasks/match-agent moved to ./routes/skills.ts)

// =============================================
// EINSTELLUNGEN
// =============================================
app.get('/api/settings', (req, res) => {
  const uId = (req.query.unternehmenId as string) || '';
  try {
    // Load global ('') and company-specific keys
    const result = db.select().from(settings).where(inArray(settings.companyId, ['', uId])).all();
    
    const obj: Record<string, string> = {};
    // Sort by unternehmenId length so that '' (length 0) comes first, and specific uId (length > 0) overwrites
    const sorted = [...result].sort((a, b) => a.companyId.length - b.companyId.length);
    
    for (const e of sorted) {
      try {
        obj[e.key] = decryptSetting(e.key, e.value);
      } catch (decryptErr) {
        console.warn(`[Settings] Failed to decrypt ${e.key}:`, decryptErr);
        obj[e.key] = e.value; // fallback: return raw value
      }
    }
    res.json(obj);
  } catch (err) {
    console.error('[Settings] Error loading settings:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.put('/api/settings/:key', async (req: express.Request, res: express.Response) => {
  const key = req.params.key;
  const uId = req.body.unternehmenId || '';
  const wert = (req.body.value ?? req.body.wert ?? '') as string;

  // Validate Telegram bot token before saving
  if (key === 'telegram_bot_token' && wert) {
    try {
      const tgCheck = await fetch(`https://api.telegram.org/bot${wert}/getMe`);
      const tgData = await tgCheck.json() as any;
      if (!tgData.ok) {
        return res.status(400).json({ error: 'invalid_token', message: `Telegram bot token ungültig: ${tgData.description || 'Unauthorized'}` });
      }
      console.log(`[Telegram] Token validiert: @${tgData.result?.username}`);
    } catch (e: any) {
      return res.status(400).json({ error: 'validation_failed', message: `Telegram Validierung fehlgeschlagen: ${e.message}` });
    }
  }

  const wertToStore = encryptSetting(key as string, String(wert));

  const existing = db.select().from(settings)
    .where(and(eq(settings.key, key), eq(settings.companyId, uId)))
    .get();

  if (existing) {
    db.update(settings)
      .set({ value: wertToStore, updatedAt: now() })
      .where(and(eq(settings.key, key), eq(settings.companyId, uId)))
      .run();
  } else {
    db.insert(settings)
      .values({ key, companyId: uId, value: wertToStore, updatedAt: now() })
      .run();
  }

  // If a new Telegram token was saved, clear the invalid-token cache so polling resumes
  if (key === 'telegram_bot_token') {
    messagingService.clearInvalidTokens();
  }

  res.json({ schluessel: key, unternehmenId: uId, wert });
});

// =============================================
// RESET / DELETE company endpoints — moved to ./routes/companies.ts
// =============================================

// =============================================
// COMPANY MEMBERSHIPS & INVITES — moved to ./routes/companies.ts
// =============================================

// (factory-reset moved to ./routes/system.ts)

// =============================================
// M I T A R B E I T E R - C H A T  (CEOs -> Agent)
// =============================================
function handleChatGet(req: express.Request, res: express.Response) {
  const id = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
  if (!unternehmenId) return res.status(400).json({ error: 'Missing x-company-id header' });

  const history = db.select()
    .from(chatMessages)
    .where(and(eq(chatMessages.companyId, unternehmenId), eq(chatMessages.agentId, id)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(50)
    .all();

  // First-time welcome: if no messages exist yet, inject a CEO greeting
  if (history.length === 0) {
    const agent = db.select().from(agents).where(eq(agents.id, id)).get() as any;
    const company = db.select().from(companies).where(eq(companies.id, unternehmenId)).get() as any;
    if (agent && (agent.isOrchestrator === true || agent.isOrchestrator === 1)) {
      const lang = getUiLanguage(unternehmenId);
      const isEn = lang === 'en';
      const companyName = company?.name || 'your company';
      const agentName = agent.name || 'CEO';

      const welcomeText = isEn
        ? `Hi! I'm ${agentName}, your AI CEO at **${companyName}**.\n\nI'm here to run your company — I can build teams, manage tasks, set up automations and report back to you. Think of me as your chief of staff.\n\nHere's what you can ask me to do:\n• **"Build me a content team"** — I create the agents, assign them roles, set up daily routines\n• **"Set up a social media bot that posts daily on X"** — I configure the agent and schedule it\n• **"Research competitors and write a weekly report"** — I create a research agent with a cron schedule\n• **"What's the status of my team?"** — I give you a full briefing\n\nWhat should we build first?`
        : `Hi! Ich bin ${agentName}, dein KI-CEO bei **${companyName}**.\n\nIch bin hier um dein Unternehmen zu führen — ich kann Teams aufbauen, Tasks managen, Automationen einrichten und dir berichten. Denk an mich als deinen Chief of Staff.\n\nHier was du mich fragen kannst:\n• **"Bau mir ein Content-Team"** — ich erstelle die Agenten, gebe ihnen Rollen und Routinen\n• **"Richte einen Social-Media-Bot ein der täglich auf X postet"** — ich konfiguriere den Agenten und plane ihn ein\n• **"Recherchiere Wettbewerber und schreib wöchentlich einen Report"** — ich erstelle einen Research-Agenten mit Cron-Schedule\n• **"Wie ist der Status meines Teams?"** — ich gebe dir ein vollständiges Briefing\n\nWas sollen wir als erstes aufbauen?`;

      const welcomeMsg = {
        id: uuid(),
        companyId: unternehmenId,
        agentId: id,
        senderType: 'agent',
        message: welcomeText,
        read: false,
        createdAt: new Date().toISOString(),
      };
      db.insert(chatMessages).values(welcomeMsg).run();
      return res.json([welcomeMsg]);
    }
  }

  res.json(history.reverse());
}

function handleChatPost(req: express.Request, res: express.Response) {
  const id = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id'] || req.body.unternehmenId || req.body.companyId) as string;
  const nachricht = req.body.nachricht || req.body.message;
  const absenderTyp = req.body.absenderTyp || req.body.senderType || 'board';
  if (!unternehmenId || !nachricht) return res.status(400).json({ error: 'Missing parameters' });
  const msg = {
    id: uuid(),
    companyId: unternehmenId,
    agentId: id,
    senderType: absenderTyp,
    message: nachricht,
    read: false,
    createdAt: new Date().toISOString()
  };
  db.insert(chatMessages).values(msg).run();
  broadcastUpdate('chat_message', msg);
  res.json({ status: 'ok', message: msg });
  
  if (absenderTyp === 'board') {
    scheduler.triggerZyklus(id, unternehmenId, 'manual').catch(console.error);
  }
}

// Both /api/agents/:id/chat and /api/mitarbeiter/:id/chat point to the same handlers
app.get('/api/agents/:id/chat', requireResourceAccess('agent'), handleChatGet);
app.post('/api/agents/:id/chat', requireResourceAccess('agent'), handleChatPost);

// DELETE entire chat history for an agent
app.delete('/api/agents/:id/chat', requireResourceAccess('agent'), (req: express.Request, res: express.Response) => {
  const expertId = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
  if (!unternehmenId) return res.status(400).json({ error: 'Missing x-company-id header' });
  db.delete(chatMessages).where(and(eq(chatMessages.companyId, unternehmenId), eq(chatMessages.agentId, expertId))).run();
  res.json({ status: 'ok', deleted: true });
});

// DELETE a single chat message
app.delete('/api/agents/:id/chat/messages/:msgId', requireResourceAccess('agent'), (req: express.Request, res: express.Response) => {
  const expertId = req.params.id as string;
  const msgId = req.params.msgId as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
  if (!unternehmenId) return res.status(400).json({ error: 'Missing x-company-id header' });
  db.delete(chatMessages).where(and(eq(chatMessages.companyId, unternehmenId), eq(chatMessages.agentId, expertId), eq(chatMessages.id, msgId))).run();
  res.json({ status: 'ok', deleted: true });
});

// ─── Direct LLM Chat (fast, context-aware, bypasses heartbeat) ─────────────
// ── URL-Fetch helper for chat context ───────────────────────────────────────
async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenCognit/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text') && !contentType.includes('json')) return null;
    const text = await res.text();
    // Strip HTML tags, collapse whitespace
    const plain = text
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 4000); // Max 4k chars to avoid context overflow
    return plain.length > 100 ? plain : null;
  } catch {
    return null;
  }
}

const URL_PATTERN = /https?:\/\/[^\s)>"']+/g;

app.post('/api/agents/:id/chat/direct', requireResourceAccess("agent"), async (req: express.Request, res: express.Response) => {
  const expertId = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
  const { nachricht } = req.body;
  if (!unternehmenId || !nachricht) return res.status(400).json({ error: 'Missing parameters' });

  // ── 1. Load expert + company ──────────────────────────────────────────────
  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  const unternehmenData = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!expert || !unternehmenData) return res.status(404).json({ error: 'Expert or company not found' });

  // ── 2. Load API key based on agent's verbindungsTyp ───────────────────────
  let apiKey = '';
  let apiUrl = 'https://api.anthropic.com/v1/messages';
  let modelId = 'claude-haiku-4-5-20251001';
  let provider = expert.connectionType;

  // CLI-based providers don't need an API key
  const isCliProvider = ['claude-code', 'codex-cli', 'gemini-cli', 'kimi-cli'].includes(provider || '');

  try {
    const cfg = JSON.parse(expert.connectionConfig || '{}');
    if (cfg.model) modelId = cfg.model;
  } catch {}

  // Also read per-agent baseUrl from verbindungsConfig (can override global setting)
  let agentBaseUrl = '';
  try { agentBaseUrl = JSON.parse(expert.connectionConfig || '{}').baseUrl || ''; } catch {}

  if (!isCliProvider) {
    if (provider === 'anthropic' || provider === 'claude') {
      const row = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
      if (row) apiKey = decryptSetting('anthropic_api_key', row.value);
    } else if (provider === 'openrouter') {
      const row = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
      if (row) apiKey = decryptSetting('openrouter_api_key', row.value);
      apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    } else if (provider === 'openai') {
      const row = db.select().from(settings).where(eq(settings.key, 'openai_api_key')).get();
      if (row) apiKey = decryptSetting('openai_api_key', row.value);
      // Agent-level baseUrl overrides default (e.g. Groq, Together, LM Studio)
      apiUrl = agentBaseUrl || 'https://api.openai.com/v1/chat/completions';
    } else if (provider === 'custom') {
      // Custom OpenAI-compatible provider: resolve named connection or fall back to global key
      let resolvedKey = '';
      let resolvedBaseUrl = agentBaseUrl; // per-agent override takes priority
      const connId = (() => { try { return JSON.parse(expert.connectionConfig || '{}').connectionId || ''; } catch { return ''; } })();
      if (connId) {
        // Named connection: look up from custom_connections JSON
        const connsRow = db.select().from(settings).where(eq(settings.key, 'custom_connections')).get();
        if (connsRow?.value) {
          try {
            const conns: { id: string; name: string; apiKey: string; baseUrl: string }[] = JSON.parse(decryptSetting('custom_connections', connsRow.value));
            const match = conns.find(c => c.id === connId);
            if (match) {
              resolvedKey = match.apiKey;
              if (!resolvedBaseUrl) resolvedBaseUrl = match.baseUrl;
            }
          } catch {}
        }
      }
      if (!resolvedKey) {
        // Fallback to global custom_api_key
        const keyRow = db.select().from(settings).where(eq(settings.key, 'custom_api_key')).get();
        if (keyRow) resolvedKey = decryptSetting('custom_api_key', keyRow.value);
      }
      if (!resolvedBaseUrl) {
        const urlRow = db.select().from(settings).where(eq(settings.key, 'custom_api_base_url')).get();
        resolvedBaseUrl = urlRow?.value || '';
      }
      apiKey = resolvedKey;
      apiUrl = (resolvedBaseUrl || 'https://api.openai.com/v1') + '/chat/completions';
      provider = 'openai'; // treat as OpenAI-compatible for LLM call below
    } else if (provider === 'ollama') {
      const ollamaBase = agentBaseUrl || 'http://localhost:11434';
      apiUrl = ollamaBase + '/v1/chat/completions';
      apiKey = 'ollama'; // Ollama doesn't require a real key
      provider = 'openai'; // treat as OpenAI-compatible for LLM call below
    } else if (provider === 'poe') {
      const row = db.select().from(settings).where(eq(settings.key, 'poe_api_key')).get();
      if (row) { apiKey = decryptSetting('poe_api_key', row.value); }
      apiUrl = 'https://api.poe.com/v1/chat/completions';
      provider = 'openai';
    } else if (provider === 'moonshot') {
      const row = db.select().from(settings).where(eq(settings.key, 'moonshot_api_key')).get();
      if (row) { apiKey = decryptSetting('moonshot_api_key', row.value); }
      apiUrl = 'https://api.moonshot.cn/v1/chat/completions';
      provider = 'openai';
    } else {
      // Fallback: try anthropic key
      const row = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
      if (row) { apiKey = decryptSetting('anthropic_api_key', row.value); provider = 'anthropic'; }
    }

    if (!apiKey) {
      return res.status(200).json({ error: 'no_api_key', message: 'No API key configured for this agent. Configure one in Settings.' });
    }
  }

  // ── 3. Build rich context ─────────────────────────────────────────────────
  // Team: who reports to this agent + who this agent reports to
  const teamMembers = db.select().from(agents)
    .where(and(eq(agents.companyId, unternehmenId), eq(agents.reportsTo, expertId as string)))
    .all();
  const supervisor = expert.reportsTo
    ? db.select().from(agents).where(eq(agents.id, expert.reportsTo)).get()
    : null;

  // Recent chat history (last 12 messages)
  const chatHistory = db.select().from(chatMessages)
    .where(and(eq(chatMessages.companyId, unternehmenId), eq(chatMessages.agentId, expertId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(12)
    .all()
    .reverse();

  // Open tasks assigned to this agent
  const openTasks = db.select().from(tasks)
    .where(and(eq(tasks.companyId, unternehmenId), eq(tasks.assignedTo, expertId)))
    .orderBy(desc(tasks.createdAt))
    .limit(5)
    .all();

  // ── 4. Fetch URL content if user pasted a link ───────────────────────────
  const urls = nachricht.match(URL_PATTERN) || [];
  let urlContext = '';
  if (urls.length > 0) {
    const fetched = await Promise.all(urls.slice(0, 2).map(async u => {
      const content = await fetchUrlContent(u);
      return content ? `\n\n[Inhalt von ${u}]:\n${content}` : null;
    }));
    const valid = fetched.filter(Boolean);
    if (valid.length > 0) {
      urlContext = `\n\nZUSATZKONTEXT (vom Board eingefügte Links):${valid.join('')}`;
    }
  }

  // ── 5. Load Memory context ─────────────────────────────────────────────
  const taskKeywords = nachricht.toLowerCase().split(/\W+/).filter(w => w.length > 4);
  const memoryContext = loadRelevantMemory(expertId, taskKeywords);

  // ── 6. Build system prompt ────────────────────────────────────────────────
  const teamLine = teamMembers.length > 0
    ? teamMembers.map(m => `  - ${m.name} (${m.role})`).join('\n')
    : '  (keine direkten Berichte)';
  const supervisorLine = supervisor ? `  Vorgesetzter: ${supervisor.name} (${supervisor.role})` : '  (kein Vorgesetzter — autonome Einheit)';
  const tasksLine = openTasks.length > 0
    ? openTasks.map(t => `  - [${t.status}] ${t.title}`).join('\n')
    : '  (keine offenen Aufgaben)';
  const permLine = expert.isOrchestrator
    ? 'Orchestrator-Modus aktiv: du kannst Aufgaben erstellen, delegieren und Genehmigungen einholen.'
    : 'Standard-Modus: du kannst Aufgaben entgegennehmen, Ergebnisse liefern und Genehmigungen anfordern.';

  const configCtx = expert.isOrchestrator ? buildConfigContext(unternehmenId) : '';
  const uiLang = getUiLanguage(unternehmenId);
  const isEn = uiLang === 'en';

  const productKnowledge = `
${isEn ? 'OPENCOGNIT PRODUCT KNOWLEDGE (for questions about the system):' : 'OPENCOGNIT PRODUKTWISSEN (für Fragen über das System):'}
  • Dashboard — ${isEn ? 'Real-time overview: agent status, open tasks, costs, recent activity' : 'Echtzeit-Überblick: Agenten-Status, offene Tasks, Kosten, letzte Aktivitäten'}
  • Focus Mode — ${isEn ? "Personal daily briefing: which tasks the user must handle (blocked, unassigned, high-priority), what agents are doing. Includes Pomodoro timer (25 min / 5 min break) — for the user only, no agent function." : 'Persönliche Tages-Übersicht für den User: welche Tasks er selbst erledigen muss, was Agenten tun. Pomodoro-Timer (25 min / 5 min Pause) — nur für den User.'}
  • Agents — ${isEn ? 'Create, configure, set LLM connections, manage permissions & roles' : 'Agenten erstellen, konfigurieren, LLM-Verbindung setzen, Permissions verwalten'}
  • Tasks — ${isEn ? 'Create, assign, track status, complete tasks' : 'Aufgaben erstellen, zuweisen, Status tracken'}
  • Goals — ${isEn ? 'OKR goals with progress tracking, linked to tasks' : 'OKR-Ziele mit Fortschrittsanzeige, verknüpft mit Tasks'}
  • Projects — ${isEn ? 'Project management with tasks and agents' : 'Projekt-Verwaltung mit Tasks und Agenten'}
  • Meetings — ${isEn ? 'Agent meetings: multiple agents discuss a topic and produce a transcript' : 'Agent-Besprechungen: mehrere Agenten diskutieren ein Thema, produzieren ein Protokoll'}
  • Routines — ${isEn ? 'Automated workflows with cron schedule (e.g. daily 9am: create standup)' : 'Automatisierte Workflows mit Cron-Schedule (z.B. täglich 9 Uhr: Standup erstellen)'}
  • Skill Library — ${isEn ? 'Knowledge base: Markdown docs agents use as context (RAG-lite)' : 'Wissens-Datenbank: Markdown-Dokumente als Agent-Kontext (RAG-lite)'}
  • Org Chart — ${isEn ? 'Visual org chart of agent hierarchy' : 'Visuelles Organigramm der Agenten-Hierarchie'}
  • Costs — ${isEn ? 'Cost tracking: token usage and API costs per agent' : 'Kosten-Tracking: Token-Verbrauch und API-Kosten pro Agent'}
  • Approvals — ${isEn ? 'Actions awaiting user approval' : 'Aktionen die auf User-Freigabe warten'}
  • Activity — ${isEn ? 'Full activity log of all agent actions' : 'Vollständiges Aktivitäts-Log aller Agenten'}
  • Intelligence — ${isEn ? 'Agent dashboard by "Wings"/"Rooms": budget and activity logs per agent' : 'Agent-Dashboard nach "Wings"/"Rooms": Budget und Aktivitäts-Logs pro Agent'}
  • War Room — ${isEn ? 'Real-time monitor: running agents/tasks with costs and execution controls' : 'Echtzeit-Monitor: laufende Agenten/Tasks mit Kosten und Ausführungskontrollen'}
  • Clipmart — ${isEn ? 'Template marketplace: import pre-built agent teams' : 'Template-Marktplatz: vorgefertigte Agent-Teams importieren'}
  • Performance — ${isEn ? 'Per-agent metrics: completion rate, success rate, trend' : 'Metriken einzelner Agenten: Abschlussquote, Erfolgsrate, Trend'}
  • Metrics — ${isEn ? 'System-wide analytics: tokens, costs, infrastructure diagnostics' : 'System-weite Analytik: Token, Kosten, Infrastruktur-Diagnostik'}
  • Weekly Report — ${isEn ? 'Auto-generated weekly report' : 'Automatisch generierter Wochenbericht'}
  • Work Products — ${isEn ? 'Agent outputs: files, text, URLs agents have created' : 'Outputs der Agenten: Dateien, Texte, URLs die Agenten erstellt haben'}
  • Settings — ${isEn ? 'API keys, Telegram bot, working directory' : 'API-Keys, Telegram-Bot, Arbeitsverzeichnis konfigurieren'}`;

  const systemPrompt = `${expert.systemPrompt ? expert.systemPrompt + '\n\n' : ''}${isEn ? `You are ${expert.name}, ${expert.role} at ${unternehmenData.name}.` : `Du bist ${expert.name}, ${expert.role} bei ${unternehmenData.name}.`}
${unternehmenData.goal ? (isEn ? `Company goal: ${unternehmenData.goal}` : `Unternehmensziel: ${unternehmenData.goal}`) : ''}
${expert.skills ? (isEn ? `Your skills: ${expert.skills}` : `Deine Fähigkeiten: ${expert.skills}`) : ''}

${isEn ? 'HIERARCHY:' : 'HIERARCHIE:'}
${supervisorLine}
${isEn ? 'Direct reports:' : 'Direkte Berichte:'}
${teamLine}

${isEn ? 'PERMISSIONS:' : 'BERECHTIGUNGEN:'} ${permLine}

${isEn ? 'ACTIVE TASKS:' : 'AKTIVE AUFGABEN:'}
${tasksLine}
${memoryContext}
${configCtx}
${productKnowledge}

${langLine(uiLang)} ${isEn ? `You respond directly to board messages. Be precise and action-oriented. Actions only when explicitly requested, always as [ACTION]{...}[/ACTION] block at the end.` : `Du antwortest direkt im Chat auf Nachrichten des Boards. Sei präzise und handlungsorientiert. Aktionen nur wenn explizit gewünscht, immer als [ACTION]{...}[/ACTION] Block am Ende.`}`;

  // ── 7. Format conversation for LLM ───────────────────────────────────────
  const conversationMessages = chatHistory
    .filter(m => m.senderType !== 'system')
    .map(m => ({
      role: m.senderType === 'board' ? 'user' : 'assistant',
      content: m.message,
    }));
  // Add current message (with URL context appended if any)
  conversationMessages.push({ role: 'user', content: nachricht + urlContext });

  // ── 7b. CLI provider path (claude-code / codex-cli / gemini-cli) ──────────
  if (isCliProvider) {
    // Build a flat prompt: system context + history + current message
    const historyText = conversationMessages.slice(0, -1)
      .map(m => `[${m.role === 'user' ? 'Board' : expert.name}]: ${m.content}`)
      .join('\n\n');
    const cliPrompt = `${systemPrompt}\n\n${historyText ? `[BISHERIGER CHAT]\n${historyText}\n\n` : ''}[AKTUELLE NACHRICHT]\n${nachricht}${urlContext}\n\nAntworte direkt und hilfreich.`;

    const boardMsg = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'board' as const, message: nachricht, read: false, createdAt: new Date().toISOString() };
    db.insert(chatMessages).values(boardMsg).run();
    broadcastUpdate('chat_message', boardMsg);

    let cliReply: string;
    try {
      if (provider === 'codex-cli') {
        cliReply = await runCodexDirectChat(cliPrompt, expertId);
      } else if (provider === 'gemini-cli') {
        cliReply = await runGeminiDirectChat(cliPrompt, expertId);
      } else if (provider === 'kimi-cli') {
        cliReply = await runKimiDirectChat(cliPrompt, expertId);
      } else {
        cliReply = await runClaudeDirectChat(cliPrompt, expertId);
      }
    } catch (err: any) {
      console.error('[DirectChat CLI] error:', err.message);
      return res.status(500).json({ error: 'cli_error', message: err.message });
    }

    // Parse and execute config/task actions from CLI response
    const actionMatches = [...cliReply.matchAll(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/g)];
    const actionResults: string[] = [];
    let cleanReply = cliReply.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, '').trim();
    for (const match of actionMatches) {
      try {
        const action = JSON.parse(match[1]);
        const msg = executeConfigAction(action, unternehmenId);
        if (msg) actionResults.push(msg);
      } catch {}
    }
    if (actionResults.length > 0) {
      cleanReply = actionResults.join('\n') + (cleanReply ? '\n\n' + cleanReply : '');
    }

    const agentMsg = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'agent' as const, message: cleanReply, read: false, createdAt: new Date().toISOString() };
    db.insert(chatMessages).values(agentMsg).run();
    broadcastUpdate('chat_message', agentMsg);

    autoSaveInsights(expertId, unternehmenId, cleanReply, urlContext ? `Chat + Links` : 'Chat').catch(() => {});

    return res.json({ status: 'ok', reply: cleanReply });
  }

  // ── 8. Save board message ─────────────────────────────────────────────────
  const boardMsg = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'board' as const, message: nachricht, read: false, createdAt: new Date().toISOString() };
  db.insert(chatMessages).values(boardMsg).run();
  broadcastUpdate('chat_message', boardMsg);

  // ── 9. Call LLM ───────────────────────────────────────────────────────────
  let agentReply = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    if (provider === 'anthropic' || provider === 'claude') {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelId, max_tokens: 1024, system: systemPrompt, messages: conversationMessages }),
      });
      if (!anthropicRes.ok) throw new Error(`Anthropic ${anthropicRes.status}`);
      const data = await anthropicRes.json() as any;
      agentReply = data.content?.find((b: any) => b.type === 'text')?.text || '';
      inputTokens = data.usage?.input_tokens || 0;
      outputTokens = data.usage?.output_tokens || 0;
    } else {
      // OpenAI-compatible (openrouter, openai)
      const oaiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, max_tokens: 1024, messages: [{ role: 'system', content: systemPrompt }, ...conversationMessages] }),
      });
      if (!oaiRes.ok) throw new Error(`LLM ${oaiRes.status}`);
      const data = await oaiRes.json() as any;
      agentReply = data.choices?.[0]?.message?.content || '';
      inputTokens = data.usage?.prompt_tokens || 0;
      outputTokens = data.usage?.completion_tokens || 0;
    }
  } catch (err: any) {
    console.error('[DirectChat] LLM error:', err.message);
    return res.status(500).json({ error: 'llm_error', message: err.message });
  }

  if (!agentReply) return res.status(500).json({ error: 'empty_response' });

  // ── 10. Save agent reply ──────────────────────────────────────────────────
  const agentMsg = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'agent' as const, message: agentReply, read: false, createdAt: new Date().toISOString() };
  db.insert(chatMessages).values(agentMsg).run();
  broadcastUpdate('chat_message', agentMsg);

  // ── 11. Auto-save memories from reply (non-blocking) ─────────────────────
  // Processes [REMEMBER:room] tags, patterns, URL insights, etc.
  autoSaveInsights(expertId, unternehmenId, agentReply, urlContext ? `Chat + Links: ${urls[0] || ''}` : 'Chat').catch(() => {});

  // Track cost
  const n2 = new Date().toISOString();
  const kostenCent = Math.ceil((inputTokens * 0.0008 + outputTokens * 0.004) / 100);
  if (kostenCent > 0) {
    db.insert(costEntries).values({ id: uuid(), companyId: unternehmenId, agentId: expertId, provider: expert.connectionType || 'custom', model: modelId, inputTokens, outputTokens, costCent: kostenCent, timestamp: n2, createdAt: n2 }).run();
    db.update(agents).set({ monthlySpendCent: sql`${agents.monthlySpendCent} + ${kostenCent}`, updatedAt: n2 }).where(eq(agents.id, expertId as string)).run();
  }

  res.json({ status: 'ok', reply: agentReply, tokensVerwendet: inputTokens + outputTokens, modell: modelId, provider: expert.connectionType });
});

// =============================================
// CHAT STREAMING — SSE with thinking + images
// =============================================
app.post(['/api/agents/:id/chat/stream', '/api/experten/:id/chat/stream'], authMiddleware, requireResourceAccess('agent'), async (req: express.Request, res: express.Response) => {
  const expertId = req.params.id as string;
  const unternehmenId = ((req as any).resolvedCompanyId || req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
  const { nachricht, image } = req.body; // image: { data: string (base64), mimeType: string }
  if (!unternehmenId || !nachricht) return res.status(400).json({ error: 'Missing parameters' });

  // SSE headers (set before any emit() so error paths can stream)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (type: string, payload: Record<string, unknown>) => {
    try { res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); } catch {}
  };

  // Validate image upload
  if (image) {
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
    const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

    if (!ALLOWED_MIME_TYPES.includes(image.mimeType)) {
      emit('error', { message: `Invalid image type: ${image.mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` });
      return res.end();
    }

    // Base64 data length check (~1.4x binary size)
    if (typeof image.data === 'string' && image.data.length > MAX_IMAGE_SIZE * 1.4) {
      emit('error', { message: 'Image too large (max 5MB)' });
      return res.end();
    }

    // Basic base64 validation
    if (typeof image.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data.replace(/\s/g, ''))) {
      emit('error', { message: 'Invalid image data format' });
      return res.end();
    }
  }

  // Load expert + company (same as /chat/direct)
  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  const unternehmenData = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!expert || !unternehmenData) { emit('error', { message: 'Expert not found' }); return res.end(); }

  let apiKey = '';
  let apiUrl = 'https://api.anthropic.com/v1/messages';
  let modelId = 'claude-haiku-4-5-20251001';
  let provider = expert.connectionType || 'anthropic';
  try { const c = JSON.parse(expert.connectionConfig || '{}'); if (c.model) modelId = c.model; } catch {}
  let agentBaseUrl = '';
  try { agentBaseUrl = JSON.parse(expert.connectionConfig || '{}').baseUrl || ''; } catch {}

  // CLI providers don't use an API key — run via CLI adapter and emit as SSE
  const isCliProvider = ['claude-code', 'codex-cli', 'gemini-cli', 'kimi-cli'].includes(provider || '');
  if (isCliProvider) {
    const chatHistory2 = db.select().from(chatMessages)
      .where(and(eq(chatMessages.companyId, unternehmenId), eq(chatMessages.agentId, expertId)))
      .orderBy(desc(chatMessages.createdAt)).limit(12).all().reverse();
    const historyText = chatHistory2.filter(m => m.senderType !== 'system')
      .map(m => `[${m.senderType === 'board' ? 'Board' : expert.name}]: ${m.message}`).join('\n\n');
    const cliPrompt = `${expert.systemPrompt ? expert.systemPrompt + '\n\n' : ''}${historyText ? `[BISHERIGER CHAT]\n${historyText}\n\n` : ''}[AKTUELLE NACHRICHT]\n${nachricht}\n\nAntworte direkt und hilfreich.`;

    const boardMsg2 = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'board' as const, message: nachricht, read: false, createdAt: new Date().toISOString() };
    db.insert(chatMessages).values(boardMsg2).run();
    broadcastUpdate('chat_message', boardMsg2);

    // Keepalive: prevents browser/proxy from closing the SSE connection during long CLI runs
    const keepalive = setInterval(() => { try { res.write(':ping\n\n'); } catch {} }, 8000);

    // Immediate "thinking" indicator so the user sees something right away
    emit('thinking_delta', { chunk: `${expert.name} denkt nach…` });

    try {
      let cliReply: string;
      if (provider === 'codex-cli') {
        cliReply = await runCodexDirectChat(cliPrompt, expertId);
      } else if (provider === 'gemini-cli') {
        cliReply = await runGeminiDirectChat(cliPrompt, expertId);
      } else if (provider === 'kimi-cli') {
        cliReply = await runKimiDirectChat(cliPrompt, expertId);
      } else {
        cliReply = await runClaudeDirectChat(cliPrompt, expertId);
      }
      emit('text_delta', { chunk: cliReply });
      const agentMsg2 = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'agent' as const, message: cliReply, read: false, createdAt: new Date().toISOString() };
      db.insert(chatMessages).values(agentMsg2).run();
      broadcastUpdate('chat_message', agentMsg2);
      emit('done', { reply: cliReply, model: modelId });
    } catch (err: any) {
      emit('error', { message: err.message });
    } finally {
      clearInterval(keepalive);
    }
    return res.end();
  }

  if (provider === 'anthropic' || provider === 'claude') {
    const row = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
    if (row) apiKey = decryptSetting('anthropic_api_key', row.value);
  } else if (provider === 'openrouter') {
    const row = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
    if (row) apiKey = decryptSetting('openrouter_api_key', row.value);
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions'; provider = 'openai';
  } else if (provider === 'openai' || provider === 'custom') {
    const row = db.select().from(settings).where(eq(settings.key, 'openai_api_key')).get();
    if (row) apiKey = decryptSetting('openai_api_key', row.value);
    apiUrl = agentBaseUrl ? agentBaseUrl + '/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    provider = 'openai';
  } else if (provider === 'ollama') {
    apiUrl = (agentBaseUrl || 'http://localhost:11434') + '/v1/chat/completions';
    apiKey = 'ollama'; provider = 'openai';
  } else if (provider === 'poe') {
    const row = db.select().from(settings).where(eq(settings.key, 'poe_api_key')).get();
    if (row) apiKey = decryptSetting('poe_api_key', row.value);
    apiUrl = 'https://api.poe.com/v1/chat/completions';
    provider = 'openai';
  } else if (provider === 'moonshot') {
    const row = db.select().from(settings).where(eq(settings.key, 'moonshot_api_key')).get();
    if (row) apiKey = decryptSetting('moonshot_api_key', row.value);
    apiUrl = 'https://api.moonshot.cn/v1/chat/completions';
    provider = 'openai';
  } else {
    // Fallback anthropic
    const row = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
    if (row) { apiKey = decryptSetting('anthropic_api_key', row.value); provider = 'anthropic'; }
  }

  if (!apiKey) { emit('error', { message: 'no_api_key' }); return res.end(); }

  // Build system prompt (reuse same logic)
  const chatHistory = db.select().from(chatMessages)
    .where(and(eq(chatMessages.companyId, unternehmenId), eq(chatMessages.agentId, expertId)))
    .orderBy(desc(chatMessages.createdAt)).limit(12).all().reverse();

  const teamMembers = db.select().from(agents)
    .where(and(eq(agents.companyId, unternehmenId), eq(agents.reportsTo, expertId as string))).all();
  const supervisor = expert.reportsTo
    ? db.select().from(agents).where(eq(agents.id, expert.reportsTo)).get() : null;
  const openTasks = db.select().from(tasks)
    .where(and(eq(tasks.companyId, unternehmenId), eq(tasks.assignedTo, expertId)))
    .orderBy(desc(tasks.createdAt)).limit(5).all();

  const uiLang = getUiLanguage(unternehmenId);
  const isEn = uiLang === 'en';
  const memoryContext = loadRelevantMemory(expertId, nachricht.toLowerCase().split(/\W+/).filter((w: string) => w.length > 4));
  const configCtx = expert.isOrchestrator ? buildConfigContext(unternehmenId) : '';

  // ── Load SOUL.md ──
  const soulContent = loadSoul(expert, { company: unternehmenData.name, agent: expert.name });

  // ── Load company goals ──
  const companyGoals = db.select().from(goals).where(eq(goals.companyId, unternehmenId)).orderBy(desc(goals.createdAt)).limit(10).all();

  // ── Load ALL company tasks (not just CEO's) ──
  const allCompanyTasks = db.select().from(tasks)
    .where(eq(tasks.companyId, unternehmenId))
    .orderBy(desc(tasks.createdAt)).limit(15).all();

  // ── Live agent status snapshot ──
  const allAgents = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
  const agentStatus = allAgents.map(a => {
    let conn = a.connectionType || 'custom';
    try { const c = JSON.parse(a.connectionConfig || '{}'); if (c.model) conn += `/${c.model}`; } catch {}
    return {
      name: a.name,
      role: a.role,
      status: a.status || 'idle',
      connection: conn,
      workspace: a.workspacePath || '',
      lastCycle: a.lastCycle ? new Date(a.lastCycle).toLocaleString(isEn ? 'en-US' : 'de-DE') : '-',
    };
  });
  const agentStatusText = agentStatus.length > 0
    ? (isEn
      ? `\n\n--- Agent Status ---\n${agentStatus.map(a => `• ${a.name} (${a.role}): status=${a.status}, connection=${a.connection}, workspace=${a.workspace || 'none'}, lastCycle=${a.lastCycle}`).join('\n')}`
      : `\n\n--- Agent-Status ---\n${agentStatus.map(a => `• ${a.name} (${a.role}): Status=${a.status}, Verbindung=${a.connection}, Workspace=${a.workspace || 'keiner'}, Letzter Zyklus=${a.lastCycle}`).join('\n')}`)
    : '';

  const goalsText = companyGoals.length > 0
    ? (isEn
      ? `\n\n--- Company Goals ---\n${(companyGoals as any[]).map(g => `• ${g.title}${g.status ? ` [${g.status}]` : ''}${typeof g.progress === 'number' ? ` (${g.progress}%)` : ''}`).join('\n')}`
      : `\n\n--- Unternehmensziele ---\n${(companyGoals as any[]).map(g => `• ${g.title}${g.status ? ` [${g.status}]` : ''}${typeof g.progress === 'number' ? ` (${g.progress}%)` : ''}`).join('\n')}`)
    : (isEn ? '\n\nNo goals defined yet.' : '\n\nNoch keine Ziele definiert.');

  const allTasksText = allCompanyTasks.length > 0
    ? (isEn
      ? `\n\n--- All Company Tasks ---\n${(allCompanyTasks as any[]).map(t => `• ${t.title} [${t.status}]${t.assignedTo ? ` → ${allAgents.find(a => a.id === t.assignedTo)?.name || 'unknown'}` : ''}`).join('\n')}`
      : `\n\n--- Alle Company-Tasks ---\n${(allCompanyTasks as any[]).map(t => `• ${t.title} [${t.status}]${t.assignedTo ? ` → ${allAgents.find(a => a.id === t.assignedTo)?.name || 'unbekannt'}` : ''}`).join('\n')}`)
    : '';

  const systemPrompt = `${expert.systemPrompt ? expert.systemPrompt + '\n\n' : ''}${soulContent ? soulContent + '\n\n' : ''}${isEn ? `You are ${expert.name}, ${expert.role} at ${unternehmenData.name}.` : `Du bist ${expert.name}, ${expert.role} bei ${unternehmenData.name}.`}
${unternehmenData.goal ? (isEn ? `Company goal: ${unternehmenData.goal}` : `Unternehmensziel: ${unternehmenData.goal}`) : ''}
${teamMembers.length > 0 ? (isEn ? `Direct reports: ${teamMembers.map(m => m.name).join(', ')}` : `Direkte Berichte: ${teamMembers.map(m => m.name).join(', ')}`) : ''}
${supervisor ? (isEn ? `Supervisor: ${supervisor.name}` : `Vorgesetzter: ${supervisor.name}`) : ''}
${openTasks.length > 0 ? (isEn ? `Your active tasks: ${openTasks.map(t => t.title).join(', ')}` : `Deine aktiven Tasks: ${openTasks.map(t => t.title).join(', ')}`) : ''}${allTasksText}${goalsText}
${memoryContext}${configCtx}${agentStatusText}
${expert.isOrchestrator ? (isEn ? `\n\nYou are the CEO. When the board asks you to do something, you MUST execute it immediately via [ACTION]{"type":"create_task","title":"...","assignTo":"AgentName","description":"..."}[/ACTION] or [ACTION]{"actions":[{"type":"create_task",...}]}[/ACTION]. Available actions: create_task, assign_task, mark_done, update_goal, hire_agent, call_meeting, create_project, create_routine. Do NOT just promise to do it — actually DO it.\n\nWhen presenting a project plan or roadmap, wrap it as [PLAN]{"tasks":[{"id":"1","title":"...","status":"pending","priority":"high","level":0,"dependencies":[],"subtasks":[]}]}[/PLAN] for an interactive display.` : `\n\nDu bist der CEO. Wenn das Board dich um etwas bittet, führe es SOFORT aus via [ACTION]{"type":"create_task","title":"...","assignTo":"AgentName","description":"..."}[/ACTION] oder [ACTION]{"actions":[{"type":"create_task",...}]}[/ACTION]. Verfügbare Aktionen: create_task, assign_task, mark_done, update_goal, hire_agent, call_meeting, create_project, create_routine. Verspreche nicht einfach nur — TU es wirklich.\n\nWenn du einen Projektplan oder eine Roadmap darstellst, packe ihn als [PLAN]{"tasks":[{"id":"1","title":"...","status":"pending","priority":"high","level":0,"dependencies":[],"subtasks":[]}]}[/PLAN] für eine interaktive Anzeige.`) : ''}
${langLine(uiLang)} ${isEn ? 'You respond directly to board messages. Be precise and helpful. Actions only when asked, as [ACTION]{...}[/ACTION].' : 'Du antwortest direkt auf Nachrichten des Boards. Sei präzise und hilfreich. Aktionen nur wenn gewünscht als [ACTION]{...}[/ACTION].'}`;

  const history = chatHistory.filter(m => m.senderType !== 'system').map(m => ({
    role: m.senderType === 'board' ? 'user' as const : 'assistant' as const,
    content: m.message,
  }));

  // Save board message
  const boardMsg = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'board' as const, message: nachricht, read: false, createdAt: new Date().toISOString() };
  db.insert(chatMessages).values(boardMsg).run();

  let fullReply = '';
  let inputTokens = 0;
  let outputTokens = 0;

  // ── Tool-Use Loop for CEO (max 3 rounds) ────────────────────────────────
  const toolContext: { role: 'user' | 'assistant'; content: string }[] = [];
  const enableToolUse = expert.isOrchestrator;

  if (enableToolUse) {
    emit('thinking_start', {});
    const toolPrompt = systemPrompt + '\n\n' + TOOL_DEFINITIONS;
    const toolHistory = [...history, { role: 'user' as const, content: nachricht }];

    for (let round = 0; round < 3; round++) {
      const toolMsgs = [...toolHistory, ...toolContext];
      let assistantText = '';

      try {
        if (provider === 'anthropic') {
          const toolBody = {
            model: modelId, max_tokens: 4096,
            system: toolPrompt, messages: toolMsgs, stream: false,
          };
          const toolRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(toolBody),
          });
          if (toolRes.ok) {
            const toolData = await toolRes.json();
            assistantText = toolData.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') || '';
          }
        } else {
          // OpenAI-compatible non-streaming
          const toolRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelId, messages: [{ role: 'system', content: toolPrompt }, ...toolMsgs], stream: false, max_tokens: 4096 }),
          });
          if (toolRes.ok) {
            const toolData = await toolRes.json();
            assistantText = toolData.choices?.[0]?.message?.content || '';
          }
        }
      } catch { break; }

      const toolCalls = extractToolCalls(assistantText);
      if (toolCalls.length === 0) break;

      // Strip tool blocks for clean assistant message
      const cleanAssistant = stripToolBlocks(assistantText);
      if (cleanAssistant) {
        toolContext.push({ role: 'assistant', content: cleanAssistant });
      }

      for (const call of toolCalls) {
        emit('tool_call', { tool: call.name, params: call.parameters });
        const result = await executeTool(call);
        emit('tool_result', { tool: call.name, success: result.success, output: result.output.slice(0, 2000), error: result.error });
        toolContext.push({ role: 'user', content: `[TOOL_RESULT:${call.name}]\n${result.success ? result.output : `ERROR: ${result.error}`}`.slice(0, 4000) });
      }
    }
  }

  try {
    if (provider === 'anthropic') {
      // Build user content (text + optional image)
      const userContent: any[] = [];
      if (image?.data && image?.mimeType) {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } });
      }
      userContent.push({ type: 'text', text: nachricht });

      const msgs = [...history, ...toolContext, { role: 'user' as const, content: userContent }];
      const useThinking = modelId.includes('claude-3-7') || modelId.includes('claude-opus-4') || modelId.includes('claude-sonnet-4');
      const body: any = {
        model: modelId, max_tokens: useThinking ? 16000 : 2048,
        system: systemPrompt, messages: msgs, stream: true,
      };
      if (useThinking) body.thinking = { type: 'enabled', budget_tokens: 8000 };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json', 'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      if (useThinking) headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';

      const llmRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!llmRes.ok) {
        let errBody = '';
        try { errBody = await llmRes.text(); } catch {}
        throw new Error(`Anthropic ${llmRes.status}: ${errBody.slice(0, 200)}`);
      }

      const reader = llmRes.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let inThinking = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'content_block_start') {
              if (ev.content_block?.type === 'thinking') { inThinking = true; emit('thinking_start', {}); }
              else if (ev.content_block?.type === 'text') { inThinking = false; }
            }
            if (ev.type === 'content_block_delta') {
              if (ev.delta?.type === 'thinking_delta') {
                emit('thinking_delta', { chunk: ev.delta.thinking });
              } else if (ev.delta?.type === 'text_delta') {
                fullReply += ev.delta.text;
                emit('text_delta', { chunk: ev.delta.text });
              }
            }
            if (ev.type === 'message_delta') {
              outputTokens = ev.usage?.output_tokens || outputTokens;
            }
            if (ev.type === 'message_start') {
              inputTokens = ev.message?.usage?.input_tokens || 0;
            }
          } catch {}
        }
      }
    } else {
      // OpenAI-compatible streaming (OpenRouter, OpenAI, Ollama)
      const userContent: any[] = [];
      if (image?.data && image?.mimeType) {
        userContent.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
      }
      userContent.push({ type: 'text', text: nachricht });

      const toolCtxFormatted = toolContext.map(m => ({ role: m.role, content: m.content }));
      const msgs = [...history, ...toolCtxFormatted, { role: 'user', content: image ? userContent : nachricht }];
      const llmRes = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'system', content: systemPrompt }, ...msgs], stream: true, max_tokens: 2048 }),
      });
      if (!llmRes.ok) {
        let errBody = '';
        try { errBody = await llmRes.text(); } catch {}
        throw new Error(`LLM ${llmRes.status}: ${errBody.slice(0, 200)}`);
      }

      const reader = llmRes.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const ev = JSON.parse(raw);
            const token = ev.choices?.[0]?.delta?.content || '';
            if (token) { fullReply += token; emit('text_delta', { chunk: token }); }
          } catch {}
        }
      }
    }
  } catch (err: any) {
    emit('error', { message: err.message || 'LLM error' });
    return res.end();
  }

  // ── Build auto-plan from created DB entries ─────────────────────────────
  async function buildPlanFromActions(
    companyId: string,
    taskIds: string[],
    projectIds: string[],
  ): Promise<any[]> {
    const planTasks: any[] = [];
    const now = new Date().toISOString();

    // Load created tasks with their subtask info
    if (taskIds.length > 0) {
      const taskRows = db.select()
        .from(tasks)
        .where(and(eq(tasks.companyId, companyId), inArray(tasks.id, taskIds)))
        .all();

      for (const t of taskRows as any[]) {
        planTasks.push({
          id: t.id,
          title: t.title,
          description: t.description || '',
          status: mapDbStatus(t.status),
          priority: t.priority || 'medium',
          level: 0,
          dependencies: [],
          subtasks: [],
        });
      }
    }

    // Load created projects and their child tasks as subtasks
    if (projectIds.length > 0) {
      for (const pid of projectIds) {
        const proj = db.select().from(projects).where(and(eq(projects.id, pid), eq(projects.companyId, companyId))).get();
        if (!proj) continue;

        const childTasks = db.select()
          .from(tasks)
          .where(and(eq(tasks.projectId, pid), eq(tasks.companyId, companyId)))
          .all();

        planTasks.push({
          id: proj.id,
          title: proj.name,
          description: proj.description || '',
          status: 'pending',
          priority: proj.priority || 'medium',
          level: 0,
          dependencies: [],
          subtasks: (childTasks as any[]).map((ct: any) => ({
            id: ct.id,
            title: ct.title,
            description: ct.description || '',
            status: mapDbStatus(ct.status),
            priority: ct.priority || 'medium',
          })),
        });
      }
    }

    return planTasks;
  }

  function mapDbStatus(dbStatus: string): any {
    switch (dbStatus) {
      case 'done': return 'completed';
      case 'in_progress': return 'in-progress';
      case 'blocked': return 'need-help';
      case 'todo': return 'pending';
      case 'backlog': return 'pending';
      default: return 'pending';
    }
  }

  // ── Execute [ACTION] blocks ─────────────────────────────────────────────
  let finalReply = fullReply;
  if (fullReply) {
    // Detect if any ACTION block contains a CEO action (create_task, assign_task, etc.)
    const ceoActionTypes = new Set(['create_task', 'assign_task', 'mark_done', 'update_goal', 'hire_agent', 'call_meeting', 'create_project', 'create_routine']);
    let hasCeoActions = false;
    const actionRegex = /\[ACTION\]([\s\S]*?)\[\/ACTION\]/g;
    let m;
    while ((m = actionRegex.exec(fullReply)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        const actions = Array.isArray(parsed.actions) ? parsed.actions : [parsed];
        if (actions.some((a: any) => ceoActionTypes.has(a.type))) {
          hasCeoActions = true;
          break;
        }
      } catch { /* ignore parse errors */ }
    }

    if (hasCeoActions) {
      // CEO actions go through processChatActions (with dedup, wakeup, trace events)
      const result = await processChatActions(expertId, unternehmenId, fullReply);
      finalReply = result.replyText;

      // Build auto-plan from created tasks/projects and send as interactive plan message
      if (result.createdTaskIds.length > 0 || result.createdProjectIds.length > 0) {
        const planTasks = await buildPlanFromActions(unternehmenId, result.createdTaskIds, result.createdProjectIds);
        if (planTasks.length > 0) {
          const planPayload = JSON.stringify({ tasks: planTasks });
          const planMsg = {
            id: uuid(), companyId: unternehmenId, agentId: expertId,
            senderType: 'agent' as const,
            message: `[PLAN]${planPayload}[/PLAN]`,
            read: false, createdAt: new Date().toISOString(),
          };
          db.insert(chatMessages).values(planMsg).run();
          broadcastUpdate('chat_message', planMsg);
        }
      }

      // If actions were executed, also save a system message with the summary
      if (result.executed && result.actionSummary.length > 0) {
        const isEn2 = getUiLanguage(unternehmenId) === 'en';
        const sysMsg = {
          id: uuid(), companyId: unternehmenId, agentId: expertId,
          senderType: 'system' as const,
          message: isEn2
            ? `📋 Actions executed:\n${result.actionSummary.map(s => `• ${s}`).join('\n')}`
            : `📋 Aktionen ausgeführt:\n${result.actionSummary.map(s => `• ${s}`).join('\n')}`,
          read: false, createdAt: new Date().toISOString(),
        };
        db.insert(chatMessages).values(sysMsg).run();
        broadcastUpdate('chat_message', sysMsg);
      }
    } else {
      // Config actions (configure_agent, update_agent, etc.) use executeConfigAction
      finalReply = fullReply.replace(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/g, (_m, json) => {
        try {
          const a = JSON.parse(json);
          const r = executeConfigAction(a, unternehmenId);
          return r || '';
        } catch (e: any) {
          return `❌ Action-Parse-Fehler: ${e.message?.slice(0, 80) || 'invalid JSON'}`;
        }
      }).trim();
    }

    const agentMsg = { id: uuid(), companyId: unternehmenId, agentId: expertId, senderType: 'agent' as const, message: finalReply || fullReply, read: false, createdAt: new Date().toISOString() };
    db.insert(chatMessages).values(agentMsg).run();
    broadcastUpdate('chat_message', agentMsg);
    autoSaveInsights(expertId, unternehmenId, finalReply || fullReply, 'Chat').catch(() => {});
    const kostenCent = Math.ceil((inputTokens * 0.0008 + outputTokens * 0.004) / 100);
    if (kostenCent > 0) {
      const n = new Date().toISOString();
      db.insert(costEntries).values({ id: uuid(), companyId: unternehmenId, agentId: expertId, provider: expert.connectionType || 'custom', model: modelId, inputTokens, outputTokens, costCent: kostenCent, timestamp: n, createdAt: n }).run();
    }
  }

  const kostenCentFinal = Math.ceil((inputTokens * 0.0008 + outputTokens * 0.004) / 100);
  emit('done', { reply: finalReply, inputTokens, outputTokens, costCents: kostenCentFinal, model: modelId });
  res.end();
});

// =============================================
// GLASS AGENT — SSE live trace stream
// =============================================

// Active SSE connections per expert: expertId → Set<Response>
const sseClients: Map<string, Set<express.Response>> = new Map();

function emitTrace(expertId: string, unternehmenId: string, typ: string, titel: string, details?: string, runId?: string) {
  const id = uuid();
  const erstelltAm = now();
  try {
    db.insert(traceEvents).values({ id, companyId: unternehmenId, agentId: expertId, runId: runId ?? null, type: typ, title: titel, details: details ?? null, createdAt: erstelltAm }).run();
  } catch { /* non-critical */ }
  const payload = JSON.stringify({ id, expertId, typ, titel, details, erstelltAm });
  const clients = sseClients.get(expertId);
  if (clients) {
    // Convert to array to avoid iteration errors without downlevelIteration
    Array.from(clients).forEach(client => {
      try { client.write(`data: ${payload}\n\n`); } catch { clients.delete(client); }
    });
  }
  broadcastUpdate('trace', { expertId, typ, titel, details, erstelltAm });

  // Forward important traces to Telegram (only errors/warnings, not routine info)
  if (['error', 'warning'].includes(typ) || titel?.includes('Genehmigung')) {
    messagingService.notify(unternehmenId, titel, details, typ).catch(console.error);
  }
}

// Expose emitTrace for scheduler
export { emitTrace };

// SSE stream endpoint — accepts token as query param (EventSource limitation)
app.get('/api/agents/:id/trace', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  const expertId = req.params.id as string;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send last 50 trace events as replay
  const history = db.select().from(traceEvents)
    .where(eq(traceEvents.agentId, expertId))
    .orderBy(desc(traceEvents.createdAt))
    .limit(50).all().reverse();
  for (const e of history) {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  }

  if (!sseClients.has(expertId)) sseClients.set(expertId, new Set());
  sseClients.get(expertId)!.add(res);

  req.on('close', () => {
    sseClients.get(expertId)?.delete(res);
  });
});

// Get trace history (REST fallback for initial load)
app.get('/api/agents/:id/trace/history', requireResourceAccess("agent"), async (req, res) => {
  // 1. Try BetterAuth session first
  let authenticated = false;
  try {
    const session = await betterAuth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (session?.user) authenticated = true;
  } catch {}

  // 2. Fallback to legacy JWT
  if (!authenticated) {
    const queryToken = req.query.token as string;
    const token = (req.headers.authorization?.slice(7)) || queryToken;
    if (!token) return res.status(401).json({ error: 'Not logged in.' });
    try { jwt.verify(token, JWT_SECRET); authenticated = true; } catch { return res.status(401).json({ error: 'Token invalid.' }); }
  }

  const expertId = req.params.id as string;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const history = db.select().from(traceEvents)
    .where(eq(traceEvents.agentId, expertId))
    .orderBy(desc(traceEvents.createdAt))
    .limit(limit).all().reverse();
  res.json(history);
});

// =============================================
// MAGIC ONBOARDING — AI-generated team setup
// =============================================

app.post('/api/onboarding/generate-team', authMiddleware, async (req, res) => {
  const { businessDescription, language = 'de', apiKeys: inlineKeys } = req.body;
  if (!businessDescription?.trim()) return res.status(400).json({ error: 'businessDescription required' });

  // Prefer keys sent inline (during onboarding before they're saved), then fall back to DB
  const inlineOR = inlineKeys?.openrouter?.trim();
  const inlineAnthropic = inlineKeys?.anthropic?.trim();
  const inlineOpenAI = inlineKeys?.openai?.trim();
  const inlineOllamaUrl = inlineKeys?.ollamaUrl?.trim();
  const inlineOllamaModel = inlineKeys?.ollamaModel?.trim();

  const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const ollamaUrlRow = db.select().from(settings).where(eq(settings.key, 'ollama_base_url')).get();
  const ollamaModelRow = db.select().from(settings).where(eq(settings.key, 'ollama_default_model')).get();

  const effectiveOR = inlineOR || (orKey?.value ? decryptSetting('openrouter_api_key', orKey.value) : '');
  const effectiveAnthropic = inlineAnthropic || (anthropicKey?.value ? decryptSetting('anthropic_api_key', anthropicKey.value) : '');
  const effectiveOllamaUrl = inlineOllamaUrl || (ollamaUrlRow?.value ? decryptSetting('ollama_base_url', ollamaUrlRow.value) : '');
  const effectiveOllamaModel = inlineOllamaModel || (ollamaModelRow?.value ? decryptSetting('ollama_default_model', ollamaModelRow.value) : '');

  let apiKey = '';
  let model = 'openrouter/auto';
  let endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let isOllama = false;

  let agentVerbindungsTyp = 'openrouter'; // default adapter for created agents
  let agentDefaultModel = 'openrouter/auto';

  if (effectiveOR) {
    apiKey = effectiveOR;
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['HTTP-Referer'] = 'https://opencognit.mytherrablockchain.org';
    model = 'openrouter/auto';
    agentVerbindungsTyp = 'openrouter';
    agentDefaultModel = 'openrouter/auto';
  } else if (effectiveAnthropic) {
    apiKey = effectiveAnthropic;
    endpoint = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    model = 'claude-3-5-haiku-20241022';
    agentVerbindungsTyp = 'anthropic';
    agentDefaultModel = 'claude-3-haiku-20240307';
  } else if (inlineOpenAI) {
    apiKey = inlineOpenAI;
    endpoint = 'https://api.openai.com/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    model = 'gpt-4o-mini';
    agentVerbindungsTyp = 'openai';
    agentDefaultModel = 'gpt-4o-mini';
  } else if (effectiveOllamaUrl && effectiveOllamaModel) {
    const base = effectiveOllamaUrl.endsWith('/') ? effectiveOllamaUrl : effectiveOllamaUrl + '/';
    endpoint = `${base}api/chat`;
    model = effectiveOllamaModel;
    isOllama = true;
    agentVerbindungsTyp = 'ollama';
    agentDefaultModel = effectiveOllamaModel;
  } else {
    // No API key / no Ollama model selected — return keyword-based default team
    const defaultTeams = buildDefaultTeam(businessDescription, language);
    return res.json({ team: defaultTeams, source: 'default' });
  }

  const isDE = language === 'de';
  const systemPrompt = isDE
    ? `Du bist ein Unternehmensberater der KI-Agenten-Teams für kleine und mittlere Unternehmen zusammenstellt.
Analysiere die Geschäftsbeschreibung und erstelle ein optimales Team aus 3-5 KI-Agenten.
Antworte NUR mit einem JSON-Objekt, kein anderer Text.`
    : `You are a business consultant designing AI agent teams for small and medium businesses.
Analyze the business description and create an optimal team of 3-5 AI agents.
Respond ONLY with a JSON object, no other text.`;

  const userPrompt = isDE
    ? `Geschäftsbeschreibung: "${businessDescription}"

Erstelle ein KI-Agenten-Team. Antworte mit folgendem JSON:
{
  "companyGoal": "Kurzes übergeordnetes Ziel in einem Satz",
  "agents": [
    {
      "name": "Vorname des Agenten",
      "rolle": "Rollenbezeichnung (kurz)",
      "faehigkeiten": "Komma-getrennte Fähigkeiten",
      "verbindungsTyp": "openrouter",
      "zyklusIntervallSek": 300,
      "systemPromptHint": "1-2 Sätze was dieser Agent hauptsächlich tut"
    }
  ]
}`
    : `Business description: "${businessDescription}"

Create an AI agent team. Reply with this JSON:
{
  "companyGoal": "Short overarching goal in one sentence",
  "agents": [
    {
      "name": "Agent first name",
      "rolle": "Role title (short)",
      "faehigkeiten": "Comma-separated skills",
      "verbindungsTyp": "openrouter",
      "zyklusIntervallSek": 300,
      "systemPromptHint": "1-2 sentences what this agent mainly does"
    }
  ]
}`;

  try {
    let responseText = '';
    if (endpoint.includes('anthropic.com')) {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      });
      const d = await r.json() as any;
      responseText = d.content?.[0]?.text ?? '';
    } else if (isOllama) {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
        signal: AbortSignal.timeout(120000),
      });
      const d = await r.json() as any;
      responseText = d.message?.content ?? d.choices?.[0]?.message?.content ?? '';
    } else {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
      });
      const d = await r.json() as any;
      responseText = d.choices?.[0]?.message?.content ?? '';
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const team = JSON.parse(jsonMatch[0]);
    // Overwrite verbindungsTyp and default model on all agents to match the key that was used
    if (Array.isArray(team.agents)) {
      team.agents = team.agents.map((a: any) => ({
        ...a,
        verbindungsTyp: agentVerbindungsTyp,
        verbindungsConfig: JSON.stringify({ model: agentDefaultModel }),
      }));
    }
    res.json({ team, source: 'ai', verbindungsTyp: agentVerbindungsTyp, defaultModel: agentDefaultModel });
  } catch (e: any) {
    // Fallback to default
    res.json({ team: buildDefaultTeam(businessDescription, language), source: 'default', warning: e.message });
  }
});

function buildDefaultTeam(description: string, language: string): any {
  const lower = description.toLowerCase();
  const isDE = language === 'de';

  const hasMarketing = /market|seo|content|social|ads|blog|werbung|social media|linkedin|outreach|kaltakquise|cold.?outreach|nachrichten|personali/i.test(lower);
  const hasFinance = /buchhal|steuer|finan|invoice|rechnung|kosten|budget/i.test(lower);
  const hasSales = /verkauf|sales|kunde|client|crm|angebot|kaltakquise|outreach|linkedin|lead|akquise|b2b|prospect/i.test(lower);
  const hasSupport = /support|kundenservice|helpdesk|service|hilfe/i.test(lower);
  const hasTech = /software|entwickl|code|api|tool|saas|app|plattform|automatisier|ki.?tool|ai.?tool/i.test(lower);

  const agents: any[] = [
    {
      name: isDE ? 'Max' : 'Max',
      rolle: isDE ? 'Projektmanager' : 'Project Manager',
      faehigkeiten: isDE ? 'Planung, Koordination, Strategie, Überblick' : 'Planning, Coordination, Strategy',
      verbindungsTyp: 'openrouter',
      zyklusIntervallSek: 300,
      systemPromptHint: isDE ? 'Koordiniert das Team und priorisiert Aufgaben.' : 'Coordinates the team and prioritizes tasks.',
    }
  ];

  if (hasMarketing) agents.push({
    name: isDE ? 'Lisa' : 'Lisa',
    rolle: isDE ? 'Marketing Expertin' : 'Marketing Expert',
    faehigkeiten: isDE ? 'SEO, Content, Social Media, Texten' : 'SEO, Content, Social Media, Copywriting',
    verbindungsTyp: 'openrouter',
    zyklusIntervallSek: 600,
    systemPromptHint: isDE ? 'Erstellt Marketingmaterialien und analysiert Online-Präsenz.' : 'Creates marketing materials and analyzes online presence.',
  });

  if (hasFinance) agents.push({
    name: isDE ? 'Felix' : 'Felix',
    rolle: isDE ? 'Finanz-Assistent' : 'Finance Assistant',
    faehigkeiten: isDE ? 'Buchführung, Rechnungen, Kostenanalyse' : 'Bookkeeping, Invoices, Cost Analysis',
    verbindungsTyp: 'openrouter',
    zyklusIntervallSek: 900,
    systemPromptHint: isDE ? 'Überwacht Ausgaben und erstellt Finanzberichte.' : 'Monitors expenses and creates financial reports.',
  });

  if (hasSales) agents.push({
    name: isDE ? 'Sophie' : 'Sophie',
    rolle: isDE ? 'Vertriebs-Assistentin' : 'Sales Assistant',
    faehigkeiten: isDE ? 'CRM, Angebote, Kundenpflege, Nachfassen' : 'CRM, Proposals, Client Relations',
    verbindungsTyp: 'openrouter',
    zyklusIntervallSek: 600,
    systemPromptHint: isDE ? 'Unterstützt im Vertrieb und pflegt Kundenbeziehungen.' : 'Supports sales and maintains client relationships.',
  });

  if (hasTech) agents.push({
    name: isDE ? 'Alex' : 'Alex',
    rolle: isDE ? 'Produkt-Spezialist' : 'Product Specialist',
    faehigkeiten: isDE ? 'Produktentwicklung, API, Automatisierung, Testing' : 'Product, API, Automation, Testing',
    verbindungsTyp: 'openrouter',
    zyklusIntervallSek: 600,
    systemPromptHint: isDE ? 'Analysiert Produktfeedback und koordiniert technische Verbesserungen.' : 'Analyzes product feedback and coordinates technical improvements.',
  });

  if (hasSupport || agents.length < 3) agents.push({
    name: isDE ? 'Tom' : 'Tom',
    rolle: isDE ? 'Assistent' : 'Assistant',
    faehigkeiten: isDE ? 'Recherche, E-Mail, Texte, Dokumentation' : 'Research, Email, Writing, Documentation',
    verbindungsTyp: 'openrouter',
    zyklusIntervallSek: 600,
    systemPromptHint: isDE ? 'Erledigt allgemeine Assistenzaufgaben.' : 'Handles general assistant tasks.',
  });

  // Build a description-aware goal
  const goal = isDE
    ? `${description.slice(0, 80).trim()}…`
    : `${description.slice(0, 80).trim()}…`;

  return {
    companyGoal: goal,
    agents: agents.slice(0, 5),
  };
}

// =============================================
// DAILY BRIEFING — AI-generated CEO summary
// =============================================

app.post('/api/companies/:id/briefing', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), async (req, res) => {
  const unternehmenId = req.params.id as string;
  const { language = 'de' } = req.body;
  const isDE = language === 'de';

  // Gather company snapshot
  const firma = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!firma) return res.status(404).json({ error: 'Company not found' });

  const alleExperten = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
  const alleAufgaben = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString();

  const today = new Date().toDateString();
  const aufgabenHeute = alleAufgaben.filter(a => new Date(a.createdAt).toDateString() === today);
  const erledigt = alleAufgaben.filter(a => a.status === 'done').length;
  const inProgress = alleAufgaben.filter(a => a.status === 'in_progress').length;
  const blockiert = alleAufgaben.filter(a => a.status === 'blocked').length;
  const offen = alleAufgaben.filter(a => a.status === 'todo' || a.status === 'backlog').length;
  const running = alleExperten.filter(e => e.status === 'running').length;
  const aktiv = alleExperten.filter(e => e.status !== 'terminated').length;

  // Monthly cost
  const alleKosten = db.select().from(costEntries).where(eq(costEntries.companyId, unternehmenId)).all();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
  const monthCost = alleKosten.filter((k: any) => k.timestamp?.startsWith(currentMonth))
    .reduce((s: number, k: any) => s + (k.costCent || 0), 0);

  const context = isDE
    ? `Unternehmensname: ${firma.name}
Agentenübersicht: ${aktiv} Agenten gesamt, ${running} gerade aktiv
Aufgaben: ${offen} offen, ${inProgress} in Bearbeitung, ${blockiert} blockiert, ${erledigt} erledigt
Heute neue Aufgaben: ${aufgabenHeute.length}
Monatskosten bisher: ${(monthCost / 100).toFixed(2)} EUR`
    : `Company: ${firma.name}
Agents: ${aktiv} total, ${running} currently active
Tasks: ${offen} open, ${inProgress} in progress, ${blockiert} blocked, ${erledigt} done
New tasks today: ${aufgabenHeute.length}
Monthly costs so far: $${(monthCost / 100).toFixed(2)}`;

  // Try LLM
  const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const effectiveOR = orKey?.value ? decryptSetting('openrouter_api_key', orKey.value) : '';
  const effectiveAnthropic = anthropicKey?.value ? decryptSetting('anthropic_api_key', anthropicKey.value) : '';

  const systemPrompt = isDE
    ? 'Du bist ein KI-Unternehmensassistent. Schreibe eine knappe, aufschlussreiche CEO-Zusammenfassung (3-4 Sätze) basierend auf dem Tagesstatus. Sei direkt, klar und handlungsorientiert. Kein Markdown, kein Aufzählung – Fließtext.'
    : 'You are an AI business assistant. Write a concise, insightful CEO daily briefing (3-4 sentences) based on the current company status. Be direct, clear, and action-oriented. Plain text only, no markdown, no bullet points.';

  const userPrompt = isDE
    ? `Erstelle eine CEO-Zusammenfassung für heute:\n\n${context}`
    : `Generate a CEO daily briefing for today:\n\n${context}`;

  if (effectiveOR || effectiveAnthropic) {
    try {
      let endpoint: string, headers: Record<string, string>, body: object;

      if (effectiveOR) {
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveOR}`, 'HTTP-Referer': 'http://localhost:3200' };
        body = { model: 'openrouter/auto', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 300 };
      } else {
        endpoint = 'https://api.anthropic.com/v1/messages';
        headers = { 'Content-Type': 'application/json', 'x-api-key': effectiveAnthropic, 'anthropic-version': '2023-06-01' };
        body = { model: 'claude-3-5-haiku-20241022', max_tokens: 300, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
      }

      const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await resp.json() as any;
      const text: string = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
      if (text.trim()) {
        return res.json({ briefing: text.trim(), source: 'ai', generatedAt: now.toISOString() });
      }
    } catch (e) {
      // fall through to template
    }
  }

  // Template-based fallback (no LLM key)
  const parts: string[] = [];
  if (isDE) {
    parts.push(`${firma.name} — Stand heute: ${inProgress} Aufgaben in Bearbeitung${running > 0 ? `, ${running} Agent${running > 1 ? 'en' : ''} aktiv` : ''}.`);
    if (blockiert > 0) parts.push(`Achtung: ${blockiert} Aufgabe${blockiert > 1 ? 'n sind' : ' ist'} blockiert und benötig${blockiert > 1 ? 'en' : 't'} Aufmerksamkeit.`);
    if (offen > 0) parts.push(`${offen} offene Aufgaben warten auf Bearbeitung.`);
    if (erledigt > 0) parts.push(`Insgesamt wurden ${erledigt} Aufgaben abgeschlossen – gute Arbeit.`);
    if (monthCost > 0) parts.push(`Monatskosten bisher: ${(monthCost / 100).toFixed(2)} EUR.`);
  } else {
    parts.push(`${firma.name} — Current status: ${inProgress} tasks in progress${running > 0 ? `, ${running} agent${running > 1 ? 's' : ''} active` : ''}.`);
    if (blockiert > 0) parts.push(`Watch out: ${blockiert} task${blockiert > 1 ? 's are' : ' is'} blocked and need${blockiert > 1 ? '' : 's'} attention.`);
    if (offen > 0) parts.push(`${offen} open tasks are waiting to be picked up.`);
    if (erledigt > 0) parts.push(`${erledigt} tasks completed in total — great progress.`);
    if (monthCost > 0) parts.push(`Monthly costs so far: $${(monthCost / 100).toFixed(2)}.`);
  }

  res.json({ briefing: parts.join(' '), source: 'template', generatedAt: now.toISOString() });
});

// =============================================
// TASK DECOMPOSER — AI-powered subtask creation
// =============================================

app.post('/api/tasks/:id/decompose', authMiddleware, requireResourceAccess("task"), requireResourceAccess("task"), async (req, res) => {
  const aufgabeId = req.params.id as string;
  const { language = 'de' } = req.body;
  const isDE = language === 'de';

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, aufgabeId)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  const context = `${aufgabe.title}${aufgabe.description ? `\n\n${aufgabe.description}` : ''}`;

  // Try LLM
  const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const effectiveOR = orKey?.value ? decryptSetting('openrouter_api_key', orKey.value) : '';
  const effectiveAnthropic = anthropicKey?.value ? decryptSetting('anthropic_api_key', anthropicKey.value) : '';

  const systemPrompt = isDE
    ? 'Du bist ein Projektmanager-Assistent. Zerlege die gegebene Aufgabe in 3-5 konkrete, ausführbare Teilaufgaben. Antworte NUR mit einem JSON-Array von Strings, keine anderen Texte.'
    : 'You are a project management assistant. Break the given task into 3-5 concrete, actionable subtasks. Reply ONLY with a JSON array of strings, no other text.';

  const userPrompt = isDE
    ? `Zerlege diese Aufgabe in Teilaufgaben:\n\n${context}`
    : `Break this task into subtasks:\n\n${context}`;

  if (effectiveOR || effectiveAnthropic) {
    try {
      let endpoint: string, headers: Record<string, string>, body: object;

      if (effectiveOR) {
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveOR}`, 'HTTP-Referer': 'http://localhost:3200' };
        body = { model: 'openrouter/auto', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: 400 };
      } else {
        endpoint = 'https://api.anthropic.com/v1/messages';
        headers = { 'Content-Type': 'application/json', 'x-api-key': effectiveAnthropic, 'anthropic-version': '2023-06-01' };
        body = { model: 'claude-3-5-haiku-20241022', max_tokens: 400, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
      }

      const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await resp.json() as any;
      const raw: string = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';

      if (raw.trim()) {
        // Extract JSON array from response
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const subtasks: string[] = JSON.parse(match[0]);
          const clean = subtasks.filter(s => typeof s === 'string' && s.trim()).slice(0, 6);
          if (clean.length > 0) {
            return res.json({ subtasks: clean, source: 'ai' });
          }
        }
      }
    } catch (e) {
      // fall through to template
    }
  }

  // Template-based fallback
  const title = aufgabe.title;
  const subtasks = isDE
    ? [
        `Anforderungen für "${title}" analysieren`,
        `Lösungsansatz für "${title}" konzipieren`,
        `"${title}" implementieren / ausführen`,
        `Ergebnis von "${title}" testen und validieren`,
        `Dokumentation für "${title}" erstellen`,
      ]
    : [
        `Analyze requirements for "${title}"`,
        `Design approach for "${title}"`,
        `Implement / execute "${title}"`,
        `Test and validate "${title}" results`,
        `Document "${title}" outcome`,
      ];

  res.json({ subtasks: subtasks.slice(0, 4), source: 'template' });
});

// =============================================
// FOCUS MODE — human daily command center
// =============================================

app.get('/api/companies/:id/focus', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const unternehmenId = req.params.id as string;

  const firma = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!firma) return res.status(404).json({ error: 'Company not found' });

  const alleExperten = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
  const alleAufgaben = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();
  const alleGenehmigungen = db.select().from(approvals).where(eq(approvals.companyId, unternehmenId)).all();

  const todayStr = new Date().toDateString();
  const weekAgo = Date.now() - 7 * 86400_000;

  // Tasks needing human attention
  const human_actions = alleAufgaben
    .filter(a =>
      a.status === 'blocked' ||
      (!a.assignedTo && (a.priority === 'critical' || a.priority === 'high') && a.status !== 'done' && a.status !== 'cancelled') ||
      a.status === 'in_review'
    )
    .slice(0, 8)
    .map(a => {
      const agent = a.assignedTo ? alleExperten.find(e => e.id === a.assignedTo) : null;
      return {
        id: a.id,
        titel: a.title,
        status: a.status,
        prioritaet: a.priority,
        reason: a.status === 'blocked' ? 'blocked'
          : a.status === 'in_review' ? 'needs_review'
          : !a.assignedTo ? 'unassigned'
          : 'high_priority',
        agentName: agent?.name ?? null,
        agentAvatar: agent?.avatar ?? null,
        agentFarbe: agent?.avatarColor ?? null,
        erstelltAm: a.createdAt,
      };
    });

  // Agents currently active with their tasks
  const ai_active = alleExperten
    .filter(e => e.status === 'running' || e.status === 'active')
    .map(e => {
      const currentTask = alleAufgaben.find(a => a.assignedTo === e.id && a.status === 'in_progress') ?? null;
      return {
        id: e.id,
        name: e.name,
        rolle: e.role,
        avatar: e.avatar,
        avatarFarbe: e.avatarColor,
        status: e.status,
        currentTask: currentTask ? { id: currentTask.id, titel: currentTask.title, prioritaet: currentTask.priority } : null,
      };
    });

  // Completed today
  const completed_today = alleAufgaben
    .filter(a => a.status === 'done' && a.completedAt && new Date(a.completedAt).toDateString() === todayStr)
    .slice(0, 5)
    .map(a => {
      const agent = a.assignedTo ? alleExperten.find(e => e.id === a.assignedTo) : null;
      return { id: a.id, titel: a.title, agentName: agent?.name ?? null, abgeschlossenAm: a.completedAt };
    });

  // Velocity
  const doneThisWeek = alleAufgaben.filter(a =>
    a.status === 'done' && a.completedAt && new Date(a.completedAt).getTime() >= weekAgo
  );
  const doneToday = completed_today.length;
  const week_avg = Math.round(doneThisWeek.length / 7 * 10) / 10;

  // Pending approvals
  const pending_approvals = alleGenehmigungen.filter(g => g.status === 'pending').length;

  // Stats
  const in_progress = alleAufgaben.filter(a => a.status === 'in_progress').length;
  const total_open = alleAufgaben.filter(a => !['done', 'cancelled'].includes(a.status)).length;

  res.json({
    human_actions,
    ai_active,
    completed_today,
    pending_approvals,
    velocity: { today: doneToday, week_avg },
    stats: { in_progress, total_open, agents: alleExperten.filter(e => e.status !== 'terminated').length },
  });
});

// =============================================
// FOCUS MODE — Agent suppression settings
// =============================================

// GET: check if focus mode is currently active
app.get('/api/companies/:id/focus-mode', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const unternehmenId = req.params.id as string;

  const activeRow = db.select().from(settings)
    .where(and(eq(settings.key, 'focus_mode_active'), eq(settings.companyId, unternehmenId)))
    .get();
  const untilRow = db.select().from(settings)
    .where(and(eq(settings.key, 'focus_mode_until'), eq(settings.companyId, unternehmenId)))
    .get();

  const active = activeRow?.value === 'true';
  const until = untilRow?.value ?? null;

  // Auto-expire: if until is in the past, treat as inactive
  const expired = until ? new Date(until) < new Date() : false;
  const effectiveActive = active && !expired;

  res.json({ active: effectiveActive, until: effectiveActive ? until : null });
});

// PUT: enable or disable focus mode
app.put('/api/companies/:id/focus-mode', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const unternehmenId = req.params.id as string;
  const { active, durationMinutes } = req.body as { active: boolean; durationMinutes?: number };

  const now = new Date().toISOString();
  const until = active && durationMinutes
    ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
    : null;

  // Upsert focus_mode_active
  db.insert(settings)
    .values({ key: 'focus_mode_active', companyId: unternehmenId, value: active ? 'true' : 'false', updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.key, settings.companyId],
      set: { value: active ? 'true' : 'false', updatedAt: now },
    }).run();

  // Upsert focus_mode_until
  if (until) {
    db.insert(settings)
      .values({ key: 'focus_mode_until', companyId: unternehmenId, value: until, updatedAt: now })
      .onConflictDoUpdate({
        target: [settings.key, settings.companyId],
        set: { value: until, updatedAt: now },
      }).run();
  } else {
    db.delete(settings)
      .where(and(eq(settings.key, 'focus_mode_until'), eq(settings.companyId, unternehmenId)))
      .run();
  }

  res.json({ active, until });
});

// =============================================
// WEEKLY REPORT — AI-generated performance digest
// =============================================

app.get('/api/companies/:id/weekly-report', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), async (req, res) => {
  const unternehmenId = req.params.id as string;
  const { language = 'de' } = req.query as Record<string, string>;
  const isDE = language === 'de';

  const firma = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!firma) return res.status(404).json({ error: 'Company not found' });

  // Week boundaries: Monday 00:00 → Sunday 23:59
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun,1=Mon,...
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const weekStartISO = weekStart.toISOString();
  const weekEndISO = weekEnd.toISOString();

  const alleExperten = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
  const alleAufgaben = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();
  const alleBuchungen = db.select().from(costEntries).where(eq(costEntries.companyId, unternehmenId)).all();
  const alleZiele = db.select().from(goals).where(eq(goals.companyId, unternehmenId)).all();

  // Tasks created this week
  const tasksCreated = alleAufgaben.filter(a => a.createdAt >= weekStartISO && a.createdAt < weekEndISO);
  // Tasks completed this week
  const tasksCompleted = alleAufgaben.filter(a => a.status === 'done' && a.completedAt && a.completedAt >= weekStartISO && a.completedAt < weekEndISO);
  // Tasks blocked
  const tasksBlocked = alleAufgaben.filter(a => a.status === 'blocked');
  // Tasks in progress
  const tasksInProgress = alleAufgaben.filter(a => a.status === 'in_progress');

  // Daily completion breakdown (7 days)
  const dailyCompletions = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const dayStr = day.toDateString();
    return {
      day: day.toLocaleDateString(isDE ? 'de-DE' : 'en-US', { weekday: 'short' }),
      date: day.toLocaleDateString(isDE ? 'de-DE' : 'en-US', { month: 'short', day: 'numeric' }),
      count: tasksCompleted.filter(a => new Date(a.completedAt!).toDateString() === dayStr).length,
    };
  });

  // Agent performance this week
  const agentMetrics = alleExperten
    .filter(e => e.status !== 'terminated')
    .map(e => {
      const completed = tasksCompleted.filter(a => a.assignedTo === e.id).length;
      const inProgress = tasksInProgress.filter(a => a.assignedTo === e.id).length;
      const weekCosts = alleBuchungen.filter(k => k.agentId === e.id && k.timestamp >= weekStartISO && k.timestamp < weekEndISO).reduce((s, k) => s + (k.costCent || 0), 0);
      return { id: e.id, name: e.name, avatar: e.avatar, avatarFarbe: e.avatarColor, rolle: e.role, completed, inProgress, costCent: weekCosts };
    })
    .filter(m => m.completed > 0 || m.inProgress > 0)
    .sort((a, b) => b.completed - a.completed);

  // Cost summary
  const weekCostTotal = alleBuchungen
    .filter(k => k.timestamp >= weekStartISO && k.timestamp < weekEndISO)
    .reduce((s, k) => s + (k.costCent || 0), 0);

  // Goal progress
  const activeGoals = alleZiele.filter(z => z.status === 'active').slice(0, 5).map(z => ({
    id: z.id, titel: z.title, fortschritt: z.progress, status: z.status,
  }));

  // Build the report
  const report = {
    weekLabel: weekStart.toLocaleDateString(isDE ? 'de-DE' : 'en-US', { month: 'long', day: 'numeric' }) + ' – ' + new Date(weekEnd.getTime() - 86400000).toLocaleDateString(isDE ? 'de-DE' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    weekStart: weekStartISO,
    weekEnd: weekEndISO,
    summary: {
      tasksCreated: tasksCreated.length,
      tasksCompleted: tasksCompleted.length,
      tasksBlocked: tasksBlocked.length,
      tasksInProgress: tasksInProgress.length,
      completionRate: tasksCreated.length > 0 ? Math.round((tasksCompleted.length / Math.max(tasksCreated.length, 1)) * 100) : 0,
      weekCostCent: weekCostTotal,
      activeAgents: alleExperten.filter(e => e.status !== 'terminated').length,
    },
    dailyCompletions,
    agentMetrics,
    activeGoals,
    topCompletions: tasksCompleted.slice(-5).reverse().map(a => {
      const agent = a.assignedTo ? alleExperten.find(e => e.id === a.assignedTo) : null;
      return { id: a.id, titel: a.title, agentName: agent?.name ?? null, abgeschlossenAm: a.completedAt };
    }),
  };

  // Try AI narrative
  const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const effectiveOR = orKey?.value ? decryptSetting('openrouter_api_key', orKey.value) : '';
  const effectiveAnthropic = anthropicKey?.value ? decryptSetting('anthropic_api_key', anthropicKey.value) : '';

  let aiNarrative: string | null = null;

  if (effectiveOR || effectiveAnthropic) {
    const context = isDE
      ? `KW-Zusammenfassung für ${firma.name}: ${report.summary.tasksCompleted} Aufgaben erledigt, ${report.summary.tasksCreated} neue Aufgaben, ${report.summary.tasksBlocked} blockiert, ${agentMetrics.length} Agenten aktiv, Kosten: ${(weekCostTotal / 100).toFixed(2)} EUR. Top-Agent: ${agentMetrics[0]?.name ?? '-'} (${agentMetrics[0]?.completed ?? 0} erledigt).`
      : `Weekly summary for ${firma.name}: ${report.summary.tasksCompleted} tasks completed, ${report.summary.tasksCreated} new tasks, ${report.summary.tasksBlocked} blocked, ${agentMetrics.length} agents active, costs: $${(weekCostTotal / 100).toFixed(2)}. Top agent: ${agentMetrics[0]?.name ?? '-'} (${agentMetrics[0]?.completed ?? 0} completed).`;

    const systemPrompt = isDE
      ? 'Du bist ein KI-Unternehmensassistent. Schreibe eine prägnante Wochenanalyse (3-4 Sätze) in einem professionellen, aber motivierenden Ton. Hebe Erfolge hervor und identifiziere ggf. einen Bereich zur Verbesserung. Kein Markdown, Fließtext.'
      : 'You are an AI business assistant. Write a concise weekly performance narrative (3-4 sentences) in a professional yet motivating tone. Highlight achievements and briefly identify one area for improvement. Plain text, no markdown.';

    try {
      let endpoint: string, headers: Record<string, string>, body: object;
      if (effectiveOR) {
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveOR}`, 'HTTP-Referer': 'http://localhost:3200' };
        body = { model: 'openrouter/auto', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: context }], max_tokens: 250 };
      } else {
        endpoint = 'https://api.anthropic.com/v1/messages';
        headers = { 'Content-Type': 'application/json', 'x-api-key': effectiveAnthropic, 'anthropic-version': '2023-06-01' };
        body = { model: 'claude-3-5-haiku-20241022', max_tokens: 250, system: systemPrompt, messages: [{ role: 'user', content: context }] };
      }
      const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await resp.json() as any;
      const text: string = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
      if (text.trim()) aiNarrative = text.trim();
    } catch {}
  }

  res.json({ ...report, aiNarrative });
});

// =============================================
// AI WORKSPACE ASSISTANT — ask anything
// =============================================

app.post('/api/companies/:id/ask', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), async (req, res) => {
  const unternehmenId = req.params.id as string;
  const { question, language = 'de' } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });

  const firma = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!firma) return res.status(404).json({ error: 'Company not found' });

  const alleExperten = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
  const alleAufgaben = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();
  const alleBuchungen2 = db.select().from(costEntries).where(eq(costEntries.companyId, unternehmenId)).all();
  const alleZiele2 = db.select().from(goals).where(eq(goals.companyId, unternehmenId)).all();

  const running = alleExperten.filter(e => e.status === 'running').map(e => e.name);
  const idle = alleExperten.filter(e => e.status === 'idle' || e.status === 'active').map(e => e.name);
  const inProgress = alleAufgaben.filter(a => a.status === 'in_progress');
  const blocked = alleAufgaben.filter(a => a.status === 'blocked');
  const done = alleAufgaben.filter(a => a.status === 'done');
  const activeGoals2 = alleZiele2.filter(z => z.status === 'active');
  const monthCost2 = alleBuchungen2.filter(k => k.timestamp?.startsWith(new Date().toISOString().slice(0, 7))).reduce((s, k) => s + (k.costCent || 0), 0);

  const context = `Company: ${firma.name}
Agents: ${alleExperten.length} total — ${running.length} running (${running.slice(0, 3).join(', ')}), ${idle.length} idle (${idle.slice(0, 3).join(', ')})
Tasks: ${inProgress.length} in progress, ${blocked.length} blocked, ${done.length} done
Blocked tasks: ${blocked.slice(0, 3).map(t => `"${t.title}"`).join(', ')}
Active goals: ${activeGoals2.slice(0, 3).map(z => `${z.title} (${z.progress}%)`).join(', ')}
Monthly AI cost so far: ${(monthCost2 / 100).toFixed(2)} EUR`;

  const isDE = language === 'de';
  const systemPrompt = isDE
    ? `Du bist ein intelligenter Unternehmensassistent für das KI-Agentenmanagement-Tool OpenCognit. Du hast Zugriff auf aktuelle Workspace-Daten. Beantworte Fragen präzise und hilfreich auf Deutsch. Sei konkret, verwende die echten Daten. Maximal 3-4 Sätze.`
    : `You are an intelligent workspace assistant for OpenCognit, an AI agent management platform. You have access to current workspace data. Answer questions precisely and helpfully in English. Be concrete, use the actual data. Max 3-4 sentences.`;

  const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const effectiveOR = orKey?.value ? decryptSetting('openrouter_api_key', orKey.value) : '';
  const effectiveAnthropic = anthropicKey?.value ? decryptSetting('anthropic_api_key', anthropicKey.value) : '';

  if (effectiveOR || effectiveAnthropic) {
    try {
      let endpoint: string, headers: Record<string, string>, body: object;
      if (effectiveOR) {
        endpoint = 'https://openrouter.ai/api/v1/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveOR}`, 'HTTP-Referer': 'http://localhost:3200' };
        body = { model: 'openrouter/auto', messages: [{ role: 'system', content: `${systemPrompt}\n\nWorkspace data:\n${context}` }, { role: 'user', content: question }], max_tokens: 300 };
      } else {
        endpoint = 'https://api.anthropic.com/v1/messages';
        headers = { 'Content-Type': 'application/json', 'x-api-key': effectiveAnthropic, 'anthropic-version': '2023-06-01' };
        body = { model: 'claude-3-5-haiku-20241022', max_tokens: 300, system: `${systemPrompt}\n\nWorkspace data:\n${context}`, messages: [{ role: 'user', content: question }] };
      }
      const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await resp.json() as any;
      const text: string = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
      if (text.trim()) return res.json({ answer: text.trim(), source: 'ai' });
    } catch {}
  }

  // Template fallback
  const q = question.toLowerCase();
  let answer = '';
  if (q.includes('block') || q.includes('stuck')) {
    answer = blocked.length > 0
      ? `${blocked.length} tasks are currently blocked: ${blocked.slice(0, 3).map(t => `"${t.title}"`).join(', ')}. Please check and resolve these.`
      : 'No blocked tasks right now — everything is flowing smoothly!';
  } else if (q.includes('running') || q.includes('active') || q.includes('work')) {
    answer = running.length > 0
      ? `${running.length} agents are currently running: ${running.join(', ')}. They have ${inProgress.length} tasks in progress.`
      : 'No agents are currently active. You may want to wake up an agent to start working.';
  } else if (q.includes('cost') || q.includes('budget')) {
    answer = `Monthly AI costs so far: €${(monthCost2 / 100).toFixed(2)}. ${alleBuchungen2.length > 0 ? 'Cost tracking is active.' : 'No costs recorded yet.'}`;
  } else if (q.includes('goal') || q.includes('progress')) {
    answer = activeGoals2.length > 0
      ? `Active goals: ${activeGoals2.slice(0, 3).map(z => `"${z.title}" at ${z.progress}%`).join(', ')}.`
      : 'No active goals currently. Create goals to track your objectives.';
  } else {
    answer = `Current status: ${alleExperten.length} agents (${running.length} running), ${inProgress.length} tasks in progress, ${blocked.length} blocked. Monthly cost: €${(monthCost2 / 100).toFixed(2)}.`;
  }
  res.json({ answer, source: 'template' });
});

// =============================================
// TEAM STANDUP — AI-generated daily standup
// =============================================

app.post('/api/companies/:id/standup', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), async (req, res) => {
  const unternehmenId = req.params.id as string;
  const { language = 'de' } = req.body;
  const isDE = language === 'de';

  const firma = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!firma) return res.status(404).json({ error: 'Company not found' });

  const alleExperten = db.select().from(agents)
    .where(and(eq(agents.companyId, unternehmenId)))
    .all()
    .filter(e => e.status !== 'terminated');

  if (alleExperten.length === 0) return res.json({ date: new Date().toISOString(), participants: [] });

  const alleAufgaben = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();

  const yesterday = new Date(Date.now() - 86400_000).toISOString();
  const today = new Date().toDateString();
  const yesterday2 = new Date(Date.now() - 2 * 86400_000).toISOString();

  const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const effectiveOR = orKey?.value ? decryptSetting('openrouter_api_key', orKey.value) : '';
  const effectiveAnthropic = anthropicKey?.value ? decryptSetting('anthropic_api_key', anthropicKey.value) : '';

  const participants = await Promise.all(alleExperten.map(async (agent) => {
    // Tasks completed yesterday or in last 2 days
    const doneTasks = alleAufgaben.filter(a =>
      a.assignedTo === agent.id && a.status === 'done' &&
      a.completedAt && a.completedAt >= yesterday2
    );
    // Current in-progress tasks
    const inProgress = alleAufgaben.filter(a =>
      a.assignedTo === agent.id && a.status === 'in_progress'
    );
    // Todo tasks (what's planned)
    const todo = alleAufgaben.filter(a =>
      a.assignedTo === agent.id && (a.status === 'todo' || a.status === 'backlog')
    );
    // Blocked tasks
    const blocked = alleAufgaben.filter(a =>
      a.assignedTo === agent.id && a.status === 'blocked'
    );

    let yesterdayText: string;
    let todayText: string;
    let blockersText: string;

    if (effectiveOR || effectiveAnthropic) {
      const context = isDE
        ? `Agent: ${agent.name} (${agent.role})
Erledigte Aufgaben (letzte 2 Tage): ${doneTasks.map(t => t.title).join(', ') || 'keine'}
Aktuell in Bearbeitung: ${inProgress.map(t => t.title).join(', ') || 'keine'}
Nächste Aufgaben: ${todo.slice(0, 3).map(t => t.title).join(', ') || 'keine geplant'}
Blockierte Aufgaben: ${blocked.map(t => t.title).join(', ') || 'keine'}`
        : `Agent: ${agent.name} (${agent.role})
Completed (last 2 days): ${doneTasks.map(t => t.title).join(', ') || 'none'}
Currently in progress: ${inProgress.map(t => t.title).join(', ') || 'none'}
Next up: ${todo.slice(0, 3).map(t => t.title).join(', ') || 'nothing planned'}
Blocked: ${blocked.map(t => t.title).join(', ') || 'none'}`;

      const sysPrompt = isDE
        ? `Du bist ${agent.name}, ein KI-Agent mit der Rolle "${agent.role}". Schreibe ein tägliches Standup in der Ich-Form. Antworte nur mit gültigem JSON: {"yesterday": "...", "today": "...", "blockers": "..."}. Sei prägnant (je max. 1 Satz), direkt und leicht persönlich im Ton. Wenn es nichts zu berichten gibt, sage das ehrlich.`
        : `You are ${agent.name}, an AI agent with the role "${agent.role}". Write a daily standup update in first person. Respond only with valid JSON: {"yesterday": "...", "today": "...", "blockers": "..."}. Be concise (max 1 sentence each), direct, and slightly personal in tone. If there's nothing to report, say so honestly.`;

      try {
        let endpoint: string, headers: Record<string, string>, body: object;
        if (effectiveOR) {
          endpoint = 'https://openrouter.ai/api/v1/chat/completions';
          headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${effectiveOR}`, 'HTTP-Referer': 'http://localhost:3200' };
          body = { model: 'openrouter/auto', messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: context }], max_tokens: 200 };
        } else {
          endpoint = 'https://api.anthropic.com/v1/messages';
          headers = { 'Content-Type': 'application/json', 'x-api-key': effectiveAnthropic, 'anthropic-version': '2023-06-01' };
          body = { model: 'claude-3-5-haiku-20241022', max_tokens: 200, system: sysPrompt, messages: [{ role: 'user', content: context }] };
        }
        const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await resp.json() as any;
        const raw: string = data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
        if (raw.trim()) {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            yesterdayText = parsed.yesterday || '';
            todayText = parsed.today || '';
            blockersText = parsed.blockers || '';
          }
        }
      } catch {}
    }

    // Template fallback
    if (!yesterdayText!) {
      yesterdayText = doneTasks.length > 0
        ? (isDE ? `Habe ${doneTasks.map(t => `"${t.title}"`).join(', ')} abgeschlossen.` : `Completed ${doneTasks.map(t => `"${t.title}"`).join(', ')}.`)
        : (isDE ? 'Keine Aufgaben gestern abgeschlossen.' : 'No tasks completed yesterday.');
    }
    if (!todayText!) {
      todayText = inProgress.length > 0
        ? (isDE ? `Arbeite weiter an: ${inProgress.map(t => `"${t.title}"`).join(', ')}.` : `Continuing work on: ${inProgress.map(t => `"${t.title}"`).join(', ')}.`)
        : todo.length > 0
          ? (isDE ? `Plane ${todo[0].title} zu beginnen.` : `Planning to start "${todo[0].title}".`)
          : (isDE ? 'Keine Aufgaben geplant.' : 'Nothing scheduled for today.');
    }
    if (!blockersText!) {
      blockersText = blocked.length > 0
        ? (isDE ? `Blockiert bei: ${blocked.map(t => `"${t.title}"`).join(', ')}.` : `Blocked on: ${blocked.map(t => `"${t.title}"`).join(', ')}.`)
        : (isDE ? 'Keine Blocker.' : 'No blockers.');
    }

    return {
      agent: { id: agent.id, name: agent.name, avatar: agent.avatar, avatarFarbe: agent.avatarColor, rolle: agent.role, status: agent.status },
      yesterday: yesterdayText,
      today: todayText,
      blockers: blockersText,
      source: (effectiveOR || effectiveAnthropic) ? 'ai' : 'template',
    };
  }));

  res.json({ date: new Date().toISOString(), participants });
});

// =============================================
// WHITEBOARD — shared project state
// =============================================

app.get('/api/projects/:id/whiteboard', authMiddleware, requireResourceAccess("project"), requireResourceAccess("project"), (req, res) => {
  const id = req.params.id as string;
  const projekt = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });
  const state = projekt.whiteboardState ? JSON.parse(projekt.whiteboardState) : { eintraege: [], aktualisiertAm: null };
  res.json(state);
});

function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.put('/api/projects/:id/whiteboard', authMiddleware, requireResourceAccess("project"), requireResourceAccess("project"), (req, res) => {
  const { inhalt, expertId } = req.body;
  if (!inhalt?.trim()) return res.status(400).json({ error: 'inhalt required' });

  const id = req.params.id as string;
  const projekt = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });

  const existing = projekt.whiteboardState ? JSON.parse(projekt.whiteboardState) : { eintraege: [] };
  const sanitizedInhalt = sanitizeHtml(inhalt.trim());
  const neuerEintrag = { id: uuid(), von: expertId ?? 'board', inhalt: sanitizedInhalt, erstelltAm: now() };
  existing.eintraege = [...(existing.eintraege ?? []), neuerEintrag];
  existing.updatedAt = now();

  db.update(projects).set({ whiteboardState: JSON.stringify(existing), updatedAt: now() }).where(eq(projects.id, id)).run();
  broadcastUpdate('whiteboard_update', { projektId: id, eintrag: neuerEintrag });
  res.json(neuerEintrag);
});

app.delete('/api/projects/:id/whiteboard', authMiddleware, requireResourceAccess("project"), requireResourceAccess("project"), (req, res) => {
  const id = req.params.id as string;
  db.update(projects).set({ whiteboardState: JSON.stringify({ entries: [], updatedAt: now() }), updatedAt: now() }).where(eq(projects.id, id)).run();
  broadcastUpdate('whiteboard_cleared', { projektId: req.params.id });
  res.json({ ok: true });
});

// =============================================
// AGENT MEETINGS — moved to ./routes/meetings.ts
// =============================================

// =============================================
// SKILL LIBRARY — moved to ./routes/skills.ts
// (mapSkillToDe + GET/POST/PATCH/DELETE on /api/companies/:id/skills-library
//  and /api/skills-library/:id all live there now, along with the seed handler)
// =============================================
// ── Removed seed marker: replaced by the imported router. ────────────────────
// (POST /api/companies/:id/skills-library/seed moved to ./routes/skills.ts;
//  the bilingual SEED_SKILLS data lives in ./db/seed-skills-data.ts)

// Expert <-> Skill assignment
app.get('/api/agents/:id/skills-library', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  const expertId = req.params.id as string;
  const assigned = db.select({ skill: skillsLibrary }).from(agentSkills)
    .innerJoin(skillsLibrary, eq(agentSkills.skillId, skillsLibrary.id))
    .where(eq(agentSkills.agentId, expertId)).all();
  res.json(assigned.map((r: any) => mapSkillToDe(r.skill)));
});

app.post('/api/agents/:id/skills-library', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  const { skillId } = req.body;
  if (!skillId) return res.status(400).json({ error: 'skillId required' });
  const expertId = req.params.id as string;
  const exists = db.select().from(agentSkills).where(and(eq(agentSkills.agentId, expertId), eq(agentSkills.skillId, skillId))).get();
  if (exists) return res.json({ ok: true, already: true });
  db.insert(agentSkills).values({ id: uuid(), agentId: expertId, skillId, createdAt: now() }).run();
  res.status(201).json({ ok: true });
});

app.delete('/api/agents/:id/skills-library/:skillId', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  const expertId = req.params.id as string;
  const skillId = req.params.skillId as string;
  db.delete(agentSkills).where(and(eq(agentSkills.agentId, expertId), eq(agentSkills.skillId, skillId))).run();
  res.json({ ok: true });
});

// RAG query: get relevant skill chunks for a prompt (keyword-based, no vector DB needed)
app.post('/api/agents/:id/skills-library/query', authMiddleware, requireResourceAccess("agent"), (req, res) => {
  const expertId = req.params.id as string;
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const assignedSkills = db.select({ skill: skillsLibrary }).from(agentSkills)
    .innerJoin(skillsLibrary, eq(agentSkills.skillId, skillsLibrary.id))
    .where(eq(agentSkills.agentId, expertId)).all().map((r: any) => r.skill);

  if (assignedSkills.length === 0) return res.json({ chunks: [] });

  // Keyword scoring: count how many prompt words appear in each skill
  const promptWords = prompt.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
  const scored = assignedSkills.map((skill: any) => {
    const text = `${skill.name} ${skill.description ?? ''} ${skill.content}`.toLowerCase();
    const score = promptWords.reduce((s: number, w: string) => s + (text.includes(w) ? 1 : 0), 0);
    return { skill, score };
  }).filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 3);

  const chunks = scored.map((s: any) => ({
    id: s.skill.id,
    name: s.skill.name,
    relevanzScore: s.score,
    inhalt: s.skill.content.slice(0, 2000), // max 2000 chars per skill
  }));

  res.json({ chunks });
});

// =============================================
// COMPANY PORTABILITY (Import/Export)
// =============================================

import { exportCompany, previewImport, importCompany } from './services/company-portability.js';
import { exportTrainingData } from './services/exportImport.js';

app.get('/api/companies/:id/export', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const manifest = exportCompany(req.params.id as string);
  if (!manifest) return res.status(404).json({ error: 'Company not found' });
  res.json(manifest);
});

app.post('/api/companies/:id/import/preview', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const preview = previewImport(req.params.id as string, req.body);
  res.json(preview);
});

app.post('/api/companies/:id/import', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const { manifest, options } = req.body;
  if (!manifest) return res.status(400).json({ error: 'manifest ist erforderlich' });
  const result = importCompany(req.params.id as string, manifest, options || { collisionStrategy: 'skip' });
  broadcastUpdate('company_imported', { unternehmenId: req.params.id, ...result });
  res.json(result);
});

// GET /api/companies/:id/export/training — fine-tuning JSONL/JSON export
app.get('/api/companies/:id/export/training', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), async (req, res) => {
  const format = (req.query.format as string) === 'json' ? 'json' : 'jsonl';
  const minQuality = (req.query.minQuality as string) === 'all' ? 'all' : 'approved';
  const agentId = req.query.agentId as string | undefined;
  const since = req.query.since as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  try {
    const records = await exportTrainingData(req.params.id as string, { format, minQuality, agentId, since, limit });

    if (format === 'jsonl') {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="training-${req.params.id}.jsonl"`);
      res.send(records.map(r => JSON.stringify(r)).join('\n'));
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="training-${req.params.id}.json"`);
      res.json(records);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// BUDGET POLICIES
// =============================================

import { erstellePolicy, pruefeBudgets, berechneBudgetStatus } from './services/budget-policies.js';

app.get('/api/companies/:id/budget-policies', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const policies = db.select().from(budgetPolicies)
    .where(eq(budgetPolicies.companyId, req.params.id as string)).all();
  const mitStatus = policies.map(p => ({ ...p, status: berechneBudgetStatus(p.id) }));
  res.json(mitStatus);
});

app.post('/api/companies/:id/budget-policies', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const { scope, scopeId, limitCent, fenster, warnProzent, hardStop } = req.body;
  const id = erstellePolicy({
    unternehmenId: req.params.id as string,
    scope, scopeId, limitCent, fenster, warnProzent, hardStop
  });
  res.json({ id });
});

app.get('/api/companies/:id/budget-incidents', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const incidents = db.select().from(budgetIncidents)
    .where(eq(budgetIncidents.companyId, req.params.id as string)).all();
  res.json(incidents);
});

// =============================================
// ISSUE DEPENDENCIES
// =============================================

import { addBlocker, removeBlocker, getBlockers, getBlocked } from './services/issue-dependencies.js';

app.get('/api/tasks/:id/blockers', authMiddleware, requireResourceAccess("task"), (req, res) => {
  res.json(getBlockers(req.params.id as string));
});

app.get('/api/tasks/:id/blocked', authMiddleware, requireResourceAccess("task"), (req, res) => {
  res.json(getBlocked(req.params.id as string));
});

app.post('/api/tasks/:id/blockers', authMiddleware, requireResourceAccess("task"), (req, res) => {
  const { blockerId } = req.body;
  const result = addBlocker(blockerId, req.params.id as string, 'board');
  res.json(result);
});

app.delete('/api/tasks/:id/blockers/:blockerId', authMiddleware, requireResourceAccess("task"), (req, res) => {
  removeBlocker(req.params.blockerId as string, req.params.id as string);
  res.json({ ok: true });
});

// =============================================
// LEARNED SKILLS — moved to ./routes/skills.ts
// =============================================

// All tasks in a company plus their blocking relations — for the dependency-graph UI.
app.get('/api/companies/:unternehmenId/tasks/graph', authMiddleware, requireCompanyAccess(), (req, res) => {
  const companyId = req.params.unternehmenId as string;

  const taskRows = db.select({
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    assignedTo: tasks.assignedTo,
    projectId: tasks.projectId,
  }).from(tasks).where(eq(tasks.companyId, companyId)).all();

  const agentRows = db.select({ id: agents.id, name: agents.name })
    .from(agents).where(eq(agents.companyId, companyId)).all();
  const agentNameById = new Map(agentRows.map(a => [a.id, a.name]));

  const taskIds = taskRows.map(t => t.id);
  const relationRows = taskIds.length > 0
    ? db.select().from(issueRelations).where(
        and(inArray(issueRelations.sourceId, taskIds), inArray(issueRelations.targetId, taskIds)),
      ).all()
    : [];

  res.json({
    tasks: taskRows.map(t => ({
      ...t,
      assignedToName: t.assignedTo ? agentNameById.get(t.assignedTo) || null : null,
    })),
    relations: relationRows.map(r => ({ sourceId: r.sourceId, targetId: r.targetId, type: r.type })),
  });
});

// =============================================
// CLIPMART (Template-Import / Aqua-Hiring)
// =============================================

import { getAvailableTemplates, getTemplateById, getTemplateByName, importTemplate } from './services/clipmart-importer.js';

// Liste aller verfügbaren Templates
app.get('/api/clipmart/templates', authMiddleware, (_req, res) => {
  res.json(getAvailableTemplates());
});

// Template in ein Unternehmen importieren
app.post('/api/companies/:unternehmenId/clipmart/import', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const { unternehmenId } = req.params;
  const { templateName, templateId, config } = req.body;

  const company = db.select().from(companies).where(eq(companies.id, unternehmenId as string)).get();
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const template = templateId ? getTemplateById(templateId) : getTemplateByName(templateName);
  if (!template) return res.status(404).json({ error: `Template nicht gefunden` });

  const result = importTemplate(unternehmenId as string, template, config || {});
  broadcastUpdate('agents_imported', { unternehmenId, ...result });
  res.json(result);
});

// =============================================
// INTELLIGENCE & MEMORY (Memory via SQLite)
// =============================================

// Memory Status für einen Agenten abrufen
app.get('/api/companies/:unternehmenId/intelligence/memory', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), async (req, res) => {
  try {
    const { mcpClient } = await import('./services/mcpClient.js');
    const agentRows = db.select().from(agents)
      .where(eq(agents.companyId, req.params.unternehmenId as string)).all();

    const memories: any[] = [];
    for (const agent of agentRows) {
      const wing = agent.name.toLowerCase().replace(/\s+/g, '_');
      try {
        const searchRes = await mcpClient.callTool('memory_search', { query: '*', wing });
        memories.push({
          id: agent.id,
          expertId: agent.id,
          unternehmenId: agent.companyId,
          wing,
          content: searchRes?.content?.[0]?.text || '',
          letzteAktualisierung: now(),
        });
      } catch {
        memories.push({ id: agent.id, expertId: agent.id, unternehmenId: agent.companyId, wing, content: '', letzteAktualisierung: null });
      }
    }
    res.json(memories);
  } catch (err: any) {
    res.json([]); // Memory nicht verfügbar — leeres Array
  }
});

// Memory Wing eines Agenten löschen
app.delete('/api/intelligence/memory/:expertId', authMiddleware, requireResourceAccess("agent", "expertId"), async (req, res) => {
  const expert = db.select().from(agents).where(eq(agents.id, req.params.agentId as string)).get();
  if (expert) {
    try {
      const { mcpClient } = await import('./services/mcpClient.js');
      const wing = expert.name.toLowerCase().replace(/\s+/g, '_');
      await mcpClient.callTool('memory_add_drawer', { wing, room: '_reset', content: '[CLEARED]' });
    } catch { /* Memory nicht verfügbar */ }
  }
  broadcastUpdate('memory_cleared', { expertId: req.params.agentId as string });
  res.json({ ok: true });
});

// Memory: Eintrag in den Wing eines Agenten schreiben
app.put('/api/intelligence/memory/:expertId', authMiddleware, requireResourceAccess("agent", "expertId"), async (req, res) => {
  const expertId = req.params.agentId as string;
  const { content, room } = req.body;

  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });

  try {
    const { mcpClient } = await import('./services/mcpClient.js');
    const wing = expert.name.toLowerCase().replace(/\s+/g, '_');
    await mcpClient.callTool('memory_add_drawer', { wing, room: room || 'manual', content: content || '' });
    broadcastUpdate('memory_updated', { expertId, wing });
    res.json({ ok: true, wing });
  } catch (err: any) {
    res.status(500).json({ error: `Memory nicht erreichbar: ${err.message}` });
  }
});

// ─── Palace: Rooms eines Agenten (strukturiert nach Rooms) ───────────────
app.get('/api/palace/:expertId/rooms', authMiddleware, requireResourceAccess("agent", "expertId"), (req, res) => {
  const expertId = req.params.agentId as string;
  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });

  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_');
  const wing = db.select().from(palaceWings).where(eq(palaceWings.name, wingName)).get();
  if (!wing) return res.json({ wing: wingName, rooms: [] });

  const drawers = db.select().from(palaceDrawers).where(eq(palaceDrawers.wingId, wing.id)).all();
  const roomNames = [...new Set(drawers.map(d => d.room))];

  const rooms = roomNames.map(room => {
    const entries = drawers
      .filter(d => d.room === room)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
    return { room, count: entries.length, entries };
  });

  res.json({ wing: wingName, aktualisiertAm: wing.updatedAt, rooms });
});

// ─── Palace: Diary-Einträge eines Agenten ────────────────────────────────
app.get('/api/palace/:expertId/diary', authMiddleware, requireResourceAccess("agent", "expertId"), (req, res) => {
  const expertId = req.params.agentId as string;
  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });

  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_');
  const wing = db.select().from(palaceWings).where(eq(palaceWings.name, wingName)).get();
  if (!wing) return res.json([]);

  const entries = db.select().from(palaceDiary)
    .where(eq(palaceDiary.wingId, wing.id))
    .orderBy(desc(palaceDiary.createdAt))
    .limit(50)
    .all();

  res.json(entries);
});

// ─── Palace: Knowledge Graph (company-weit, nur aktive Fakten) ───────────
app.get('/api/palace/kg/:unternehmenId', authMiddleware, requireCompanyAccess(), (req, res) => {
  const uid = req.params.unternehmenId as string;
  const fakten = db.select().from(palaceKg)
    .where(and(eq(palaceKg.companyId, uid), isNull(palaceKg.validUntil)))
    .orderBy(desc(palaceKg.createdAt))
    .limit(100)
    .all();

  res.json(fakten);
});

// ─── Palace: KG — Fakt hinzufügen ────────────────────────────────────────
app.post('/api/palace/kg/:unternehmenId', authMiddleware, requireCompanyAccess(), (req, res) => {
  const uid = req.params.unternehmenId as string;
  const { subject, predicate, object } = req.body as { subject?: string; predicate?: string; object?: string };
  if (!subject?.trim() || !predicate?.trim() || !object?.trim()) {
    return res.status(400).json({ error: 'subject, predicate, object sind erforderlich' });
  }
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  // Invalidate existing fact with same subject+predicate
  const existing = db.select().from(palaceKg)
    .where(and(eq(palaceKg.companyId, uid), eq(palaceKg.subject, subject.trim()), eq(palaceKg.predicate, predicate.trim()), isNull(palaceKg.validUntil)))
    .all();
  for (const f of existing as any[]) {
    db.update(palaceKg).set({ validUntil: today }).where(eq(palaceKg.id, f.id)).run();
  }
  const id = crypto.randomUUID();
  db.insert(palaceKg).values({
    id, companyId: uid,
    subject: subject.trim().slice(0, 200),
    predicate: predicate.trim().slice(0, 100),
    object: object.trim().slice(0, 500),
    validFrom: today, validUntil: null,
    createdBy: 'board', createdAt: now,
  }).run();
  res.json({ id, subject, predicate, object });
});

// ─── Palace: KG — Fakt löschen ───────────────────────────────────────────
app.delete('/api/palace/kg/:factId', authMiddleware, requireResourceAccess("palaceKgFact", "factId"), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.update(palaceKg).set({ validUntil: today }).where(eq(palaceKg.id, req.params.factId as string)).run();
  res.json({ ok: true });
});

// ─── Palace: Summary (Konsolidierungsstatus) ─────────────────────────────
app.get('/api/palace/:expertId/summary', authMiddleware, requireResourceAccess("agent", "expertId"), (req, res) => {
  const { expertId } = req.params as { expertId: string };
  const s = db.select().from(palaceSummaries).where(eq(palaceSummaries.agentId, expertId)).get();
  if (!s) return res.json(null);
  res.json({ version: s.version, komprimierteTurns: s.komprimierteTurns, aktualisiertAm: s.updatedAt, inhalt: s.content });
});

// ─── Palace: Konsolidierung manuell auslösen ─────────────────────────────
app.post('/api/palace/:expertId/consolidate', authMiddleware, requireResourceAccess("agent", "expertId"), async (req, res) => {
  const { expertId } = req.params as { expertId: string };
  try {
    const { consolidateWing } = await import('./services/memory-consolidation.js');
    const ok = await consolidateWing(expertId);
    if (!ok) return res.status(400).json({ error: 'No data to consolidate' });
    const s = db.select().from(palaceSummaries).where(eq(palaceSummaries.agentId, expertId)).get();
    res.json({ ok: true, version: s?.version ?? 1 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Palace: Neuen Drawer-Eintrag direkt schreiben ────────────────────────
app.post('/api/palace/:expertId/rooms', authMiddleware, requireResourceAccess("agent", "expertId"), (req, res) => {
  const { expertId } = req.params as { expertId: string };
  const { room, content } = req.body as { room: string; content: string };
  if (!room || !content) return res.status(400).json({ error: 'room und content erforderlich' });

  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  if (!expert) return res.status(404).json({ error: 'Agent not found' });

  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let wing = db.select().from(palaceWings).where(eq(palaceWings.agentId, expertId)).get();
  if (!wing) {
    const wingId = uuid();
    db.insert(palaceWings).values({ id: wingId, companyId: expert.companyId, agentId: expertId, name: wingName || `agent_${wingId.slice(0, 8)}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
    wing = db.select().from(palaceWings).where(eq(palaceWings.id, wingId)).get()!;
  }

  const entryId = uuid();
  db.insert(palaceDrawers).values({ id: entryId, wingId: wing.id, room: room.slice(0, 50), content: content.slice(0, 2000), createdAt: new Date().toISOString() }).run();
  db.update(palaceWings).set({ updatedAt: new Date().toISOString() }).where(eq(palaceWings.id, wing.id)).run();

  res.json({ ok: true, id: entryId });
});

// ─── Palace: Drawer-Eintrag löschen ──────────────────────────────────────
app.delete('/api/palace/drawer/:entryId', authMiddleware, requireResourceAccess("palaceDrawer", "entryId"), (req, res) => {
  db.delete(palaceDrawers).where(eq(palaceDrawers.id, req.params.entryId as string)).run();
  res.json({ ok: true });
});

// ─── Palace: Diary-Eintrag löschen ───────────────────────────────────────
app.delete('/api/palace/diary/:entryId', authMiddleware, requireResourceAccess("palaceDiary", "entryId"), (req, res) => {
  db.delete(palaceDiary).where(eq(palaceDiary.id, req.params.entryId as string)).run();
  res.json({ ok: true });
});

// =============================================
// CHANNELS & DEVICE NODES STATUS
// =============================================

app.get('/api/channels/status', authMiddleware, (_req, res) => {
  try {
    const { channelRegistry } = require('./channels/index.js');
    res.json(channelRegistry.list());
  } catch {
    res.json([]);
  }
});

app.get('/api/nodes/status', authMiddleware, (_req, res) => {
  const nodes = nodeManager.listNodes();
  res.json(nodes.map(n => ({
    id: n.id,
    capabilities: n.capabilities,
    registeredAt: n.registeredAt,
    lastSeen: n.lastSeen,
  })));
});

// =============================================
// AGENT STATS — moved to ./routes/agents.ts
// =============================================

// =============================================
// HALLUCINATION / QUALITY TRACKING
// =============================================
app.get('/api/companies/:unternehmenId/agent-quality', authMiddleware, requireCompanyAccess(), requireCompanyAccess(), (req, res) => {
  const { unternehmenId } = req.params;
  const daysBack = Number(req.query.days || 30);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  const agentRows = db.select({ id: agents.id, name: agents.name, rolle: agents.role })
    .from(agents)
    .where(eq(agents.companyId, unternehmenId as string))
    .all();

  const HEDGE_WORDS = /\b(ich denke|ich glaube|vielleicht|möglicherweise|könnte sein|wahrscheinlich|vermutlich|i think|maybe|possibly|might be|could be|i believe|not sure|unclear)\b/i;
  const BASH_FAILURE = /command not found|No such file|permission denied|STDERR:.*Error|exit code [^0]|npm ERR|SyntaxError|ModuleNotFoundError/i;

  const result = agentRows.map(agent => {
    // All runs in window
    const runs = db.select({ id: workCycles.id, status: workCycles.status, ausgabe: workCycles.output })
      .from(workCycles)
      .where(and(
        eq(workCycles.agentId, agent.id),
        sql`${workCycles.createdAt} > ${since}`,
        sql`${workCycles.status} != 'queued' AND ${workCycles.status} != 'running'`,
      ))
      .all();

    const totalRuns = runs.length;
    const failedRuns = runs.filter(r => r.status === 'failed').length;

    // Critic signals from comments
    const taskIds = db.select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.assignedTo, agent.id), sql`${tasks.createdAt} > ${since}`))
      .all()
      .map(t => t.id);

    let criticRejections = 0;
    let escalations = 0;
    let emptyActions = 0;
    let bashFailures = 0;
    let hedgingCount = 0;

    if (taskIds.length > 0) {
      const allComments = db.select({ inhalt: comments.content })
        .from(comments)
        .where(and(
          eq(comments.authorType, 'agent'),
          inArray(comments.taskId, taskIds.slice(0, 200)),
        ))
        .all();

      for (const c of allComments) {
        const text = c.content || '';
        if (text.includes('Critic Review — Überarbeitung')) criticRejections++;
        if (text.includes('Manuelle Prüfung')) escalations++;
      }
    }

    // Analyse run ausgaben
    for (const run of runs) {
      const out = run.output || '';
      if (!out) continue;
      const hasBashBlock = out.includes('```') || out.includes('$ ');
      if (!hasBashBlock && run.status === 'succeeded') emptyActions++;
      if (BASH_FAILURE.test(out)) bashFailures++;
      if (HEDGE_WORDS.test(out)) hedgingCount++;
    }

    // Quality score: 0 = perfect, 100 = completely unreliable
    const rawScore = totalRuns === 0 ? 0 :
      Math.min(100, Math.round(
        (criticRejections * 15 + escalations * 30 + emptyActions * 10 + bashFailures * 8 + failedRuns * 5 + hedgingCount * 3) /
        Math.max(totalRuns, 1)
      ));

    // Reliability score: 100 = perfect, 0 = unreliable (inverse of rawScore)
    const reliabilityScore = totalRuns === 0 ? 0 : Math.max(0, 100 - rawScore);

    const approvedRuns = totalRuns - failedRuns - criticRejections;
    const meaningfulRuns = totalRuns - emptyActions;

    return {
      expertId: agent.id,
      name: agent.name,
      rolle: agent.role,
      totalRuns,
      approvedRuns: Math.max(0, approvedRuns),
      meaningfulRuns: Math.max(0, meaningfulRuns),
      failedRuns,
      criticRejections,
      escalations,
      emptyActions,
      bashFailures,
      hedgingCount,
      // Percentages for relative comparison
      emptyActionPct: totalRuns > 0 ? Math.round((emptyActions / totalRuns) * 100) : 0,
      failurePct: totalRuns > 0 ? Math.round((failedRuns / totalRuns) * 100) : 0,
      criticRejectionPct: totalRuns > 0 ? Math.round((criticRejections / totalRuns) * 100) : 0,
      escalationPct: totalRuns > 0 ? Math.round((escalations / totalRuns) * 100) : 0,
      reliabilityScore,  // 100 = perfect, 0 = bad (intuitive!)
      qualityLabel: totalRuns === 0 ? 'Keine_Daten' : rawScore === 0 ? 'Exzellent' : rawScore < 20 ? 'Gut' : rawScore < 40 ? 'Mittel' : 'Kritisch',
    };
  });

  res.json(result);
});

// =============================================
// OLLAMA — Live Model List Proxy
// =============================================
app.get('/api/ollama/models', authMiddleware, async (req, res) => {
  const baseUrl = (req.query.baseUrl as string) || 'http://127.0.0.1:11434';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) return res.status(502).json({ error: 'Ollama unreachable' });
    const data = await r.json() as any;
    const models = (data.models ?? []).map((m: any) => ({
      id: m.name,
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
    }));
    res.json({ models });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout — Ollama unreachable at ' + baseUrl });
    }
    return res.status(502).json({ error: 'Ollama Fehler: ' + err.message });
  }
});

// =============================================
// HEALTH & SYSTEM STATUS — moved to ./routes/system.ts
// (the /api/metrics dashboard endpoint stays here for now)
// =============================================

// ── Metrics Dashboard Endpoint ──────────────────────────────────────────────
app.get('/api/metrics', authMiddleware, async (req, res) => {
  try {
    const unternehmenId = req.query.unternehmenId as string;
    const days = Math.min(parseInt((req.query.days as string) || '30', 10), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const baseFilter = unternehmenId
      ? and(eq(costEntries.companyId, unternehmenId), sql`${costEntries.createdAt} >= ${since}`)
      : sql`${costEntries.createdAt} >= ${since}`;

    // Total token/cost summary
    const totals = db.all(
      sql`SELECT SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens, SUM(kosten_cent) as kostenCent
          FROM kostenbuchungen WHERE ${unternehmenId ? sql`unternehmen_id = ${unternehmenId} AND` : sql``} erstellt_am >= ${since}`
    ) as { inputTokens: number; outputTokens: number; kostenCent: number }[];

    // Cost per agent (top 10)
    const costPerAgent = db.all(
      sql`SELECT k.expert_id as expertId, e.name as expertName,
             SUM(k.kosten_cent) as kostenCent, SUM(k.input_tokens) as inputTokens,
             SUM(k.output_tokens) as outputTokens, COUNT(*) as runs
          FROM kostenbuchungen k LEFT JOIN experten e ON k.expert_id = e.id
          WHERE ${unternehmenId ? sql`k.unternehmen_id = ${unternehmenId} AND` : sql``} k.erstellt_am >= ${since}
          GROUP BY k.expert_id ORDER BY kostenCent DESC LIMIT 10`
    ) as { expertId: string; expertName: string; kostenCent: number; inputTokens: number; outputTokens: number; runs: number }[];

    // Daily cost trend (last N days)
    const dailyCosts = db.all(
      sql`SELECT substr(erstellt_am, 1, 10) as day, SUM(kosten_cent) as kostenCent, COUNT(*) as runs
          FROM kostenbuchungen
          WHERE ${unternehmenId ? sql`unternehmen_id = ${unternehmenId} AND` : sql``} erstellt_am >= ${since}
          GROUP BY day ORDER BY day ASC`
    ) as { day: string; kostenCent: number; runs: number }[];

    // Task completion stats
    const taskStats = db.all(
      sql`SELECT status, COUNT(*) as cnt FROM aufgaben
          WHERE ${unternehmenId ? sql`unternehmen_id = ${unternehmenId} AND` : sql``} erstellt_am >= ${since}
          GROUP BY status`
    ) as { status: string; cnt: number }[];

    // Run status distribution
    const runStats = db.all(
      sql`SELECT status, COUNT(*) as cnt FROM arbeitszyklen
          WHERE ${unternehmenId ? sql`unternehmen_id = ${unternehmenId} AND` : sql``} erstellt_am >= ${since}
          GROUP BY status`
    ) as { status: string; cnt: number }[];

    // Agent activity summary
    const agentActivity = db.all(
      sql`SELECT a.expert_id as expertId, e.name as expertName,
             COUNT(*) as totalRuns,
             SUM(CASE WHEN a.status = 'succeeded' THEN 1 ELSE 0 END) as succeededRuns,
             MAX(a.erstellt_am) as lastActive
          FROM arbeitszyklen a LEFT JOIN experten e ON a.expert_id = e.id
          WHERE ${unternehmenId ? sql`a.unternehmen_id = ${unternehmenId} AND` : sql``} a.erstellt_am >= ${since}
          GROUP BY a.expert_id ORDER BY totalRuns DESC LIMIT 10`
    ) as { expertId: string; expertName: string; totalRuns: number; succeededRuns: number; lastActive: string }[];

    res.json({
      period: { days, since },
      totals: totals[0] || { inputTokens: 0, outputTokens: 0, kostenCent: 0 },
      costPerAgent,
      dailyCosts,
      taskStats,
      runStats,
      agentActivity,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
// (/api/health/agents moved to ./routes/system.ts)

// (system/backups, system/cleanup, system/status moved to ./routes/system.ts)

// GET /api/setup/status — First-run detection based on agent count
// Returns isFirstRun: true if no agents exist for any company
app.get('/api/setup/status', authMiddleware, (_req, res) => {
  const expertenCount = db.select({ value: count(agents.id) }).from(agents).get()?.value ?? 0;
  const unternehmenCount = db.select({ value: count(companies.id) }).from(companies).get()?.value ?? 0;
  res.json({ isFirstRun: expertenCount === 0 || unternehmenCount === 0 });
});

// =============================================
// CEO BOOTSTRAP — AI-Powered Company Setup
// =============================================

// POST /api/bootstrap/plan — CEO analyzes description → returns full company plan
app.post('/api/bootstrap/plan', authMiddleware, async (req, res) => {
  const { businessDescription, workDir, language = 'de', unternehmenId } = req.body;
  if (!businessDescription?.trim()) return res.status(400).json({ error: 'businessDescription required' });
  if (!workDir?.trim() || !path.isAbsolute(workDir.trim())) return res.status(400).json({ error: 'workDir muss ein absoluter Pfad sein' });

  const dir = workDir.trim();
  const opencognitRoot = path.resolve('.');
  if (dir.startsWith(opencognitRoot)) return res.status(400).json({ error: 'workDir darf nicht im OpenCognit-Verzeichnis liegen' });

  // Resolve API key (prefer configured, then env)
  const orKeyRow = unternehmenId
    ? db.select().from(settings).where(and(eq(settings.key, 'openrouter_api_key'), eq(settings.companyId, unternehmenId))).get()
    : null;
  const orKeyGlobal = db.select().from(settings).where(and(eq(settings.key, 'openrouter_api_key'), eq(settings.companyId, ''))).get();
  const anthropicRow = unternehmenId
    ? db.select().from(settings).where(and(eq(settings.key, 'anthropic_api_key'), eq(settings.companyId, unternehmenId))).get()
    : null;
  const anthropicGlobal = db.select().from(settings).where(and(eq(settings.key, 'anthropic_api_key'), eq(settings.companyId, ''))).get();

  const orKey = orKeyRow?.value ? decryptSetting('openrouter_api_key', orKeyRow.value) : (orKeyGlobal?.value ? decryptSetting('openrouter_api_key', orKeyGlobal.value) : '');
  const anthropicKey = anthropicRow?.value ? decryptSetting('anthropic_api_key', anthropicRow.value) : (anthropicGlobal?.value ? decryptSetting('anthropic_api_key', anthropicGlobal.value) : '');

  const isDE = language === 'de';
  const allSkills = await skillsService.getAllSkills();
  const skillIds = allSkills.map((s: any) => s.id).join(', ');

  const systemPrompt = isDE
    ? `Du bist ein erfahrener Unternehmensberater und KI-Architekt. Du analysierst Geschäftsideen und erstellst vollständige KI-Team-Setups.
Antworte NUR mit einem validen JSON-Objekt — kein Text davor oder danach.`
    : `You are an experienced business consultant and AI architect. You analyze business ideas and create complete AI team setups.
Respond ONLY with a valid JSON object — no text before or after.`;

  const userPrompt = isDE
    ? `Analysiere diese Geschäftsidee und erstelle ein vollständiges KI-Team-Setup:

BESCHREIBUNG: "${businessDescription}"
ARBEITSVERZEICHNIS: ${dir}
VERFÜGBARE SKILLS: ${skillIds}

Erstelle folgendes JSON-Objekt:
{
  "companyGoal": "Übergeordnetes Ziel (1 Satz)",
  "projects": [
    {
      "name": "Projektname",
      "beschreibung": "Was dieses Projekt ist und welche Regeln für Agenten gelten — wird direkt als Projekt-Kontext an Agenten gegeben",
      "prioritaet": "critical|high|medium|low",
      "farbe": "#hex",
      "subDir": "ordner-name",
      "startFirst": true
    }
  ],
  "agenten": [
    {
      "name": "Vorname",
      "rolle": "Rollenbezeichnung",
      "faehigkeiten": "Komma-getrennte Skills",
      "systemPrompt": "Vollständiger, detaillierter Charakter-Prompt (min. 3 Sätze): Wer ist dieser Agent, was ist sein Fokus, wie arbeitet er?",
      "soul": "# {{agent.name}} — Soul\\n\\n## Identität\\n[2-3 Sätze wer er/sie ist]\\n\\n## Mission\\n[Was dieser Agent erreichen will]\\n\\n## Arbeitsweise\\n[Wie er/sie vorgeht]\\n\\n## Persönlichkeit\\n[Tonalität, Kommunikationsstil]",
      "skills": ["skill-id-aus-liste"],
      "projektName": "Name des zugehörigen Projekts",
      "zyklusIntervallSek": 300,
      "istOrchestrator": false
    }
  ],
  "tasks": [
    {
      "titel": "Task-Titel (konkret und umsetzbar)",
      "beschreibung": "Detaillierte Beschreibung was getan werden soll",
      "prioritaet": "critical|high|medium|low",
      "projektName": "Projektname",
      "agentName": "Agent der das übernimmt"
    }
  ],
  "routines": [
    {
      "name": "Routinenname",
      "beschreibung": "Was diese Routine tut",
      "cron": "0 9 * * 1-5",
      "agentName": "Zugehöriger Agent"
    }
  ]
}

Regeln:
- 2-4 Projekte, logisch nach Bereichen aufgeteilt
- 3-6 Agenten, jeder klar einem Projekt zugeordnet
- Pro Projekt 2-4 konkrete Start-Tasks
- Pro Agent 1 Routine (sinnvolle Cron-Zeit)
- startFirst: true nur beim wichtigsten Projekt
- Skills NUR aus der verfügbaren Liste wählen
- Soul-Template mit \\n für Zeilenumbrüche`
    : `Analyze this business idea and create a complete AI team setup:

DESCRIPTION: "${businessDescription}"
WORKING DIRECTORY: ${dir}
AVAILABLE SKILLS: ${skillIds}

Create this JSON object:
{
  "companyGoal": "Overarching goal (1 sentence)",
  "projects": [
    {
      "name": "Project name",
      "beschreibung": "What this project is and what rules agents should follow — passed directly as project context to agents",
      "prioritaet": "critical|high|medium|low",
      "farbe": "#hex",
      "subDir": "folder-name",
      "startFirst": true
    }
  ],
  "agenten": [
    {
      "name": "First name",
      "rolle": "Role title",
      "faehigkeiten": "Comma-separated skills",
      "systemPrompt": "Complete, detailed character prompt (min. 3 sentences): Who is this agent, what is their focus, how do they work?",
      "soul": "# {{agent.name}} — Soul\\n\\n## Identity\\n[2-3 sentences who they are]\\n\\n## Mission\\n[What this agent wants to achieve]\\n\\n## Approach\\n[How they go about their work]\\n\\n## Personality\\n[Tone, communication style]",
      "skills": ["skill-id-from-list"],
      "projektName": "Name of the associated project",
      "zyklusIntervallSek": 300,
      "istOrchestrator": false
    }
  ],
  "tasks": [
    {
      "titel": "Task title (concrete and actionable)",
      "beschreibung": "Detailed description of what needs to be done",
      "prioritaet": "critical|high|medium|low",
      "projektName": "Project name",
      "agentName": "Agent who handles this"
    }
  ],
  "routines": [
    {
      "name": "Routine name",
      "beschreibung": "What this routine does",
      "cron": "0 9 * * 1-5",
      "agentName": "Associated agent"
    }
  ]
}

Rules:
- 2-4 projects, logically divided by domain
- 3-6 agents, each clearly assigned to a project
- 2-4 concrete start tasks per project
- 1 routine per agent (sensible cron time)
- startFirst: true only for the most important project
- Skills ONLY from the available list
- Soul template with \\n for line breaks`;

  try {
    let responseText = '';
    let endpoint = '', model = '', headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (orKey) {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
      model = 'openrouter/auto';
      headers['Authorization'] = `Bearer ${orKey}`;
      headers['HTTP-Referer'] = 'https://opencognit.dev';
    } else if (anthropicKey) {
      endpoint = 'https://api.anthropic.com/v1/messages';
      model = 'claude-3-5-haiku-20241022';
      headers['x-api-key'] = anthropicKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      // No API key — return keyword-based fallback plan
      return res.json({ plan: buildFallbackPlan(businessDescription, dir, isDE, allSkills), source: 'default' });
    }

    let body: any;
    if (endpoint.includes('anthropic.com')) {
      body = { model, max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
    } else {
      body = { model, max_tokens: 4096, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] };
    }

    const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const d = await r.json() as any;

    if (endpoint.includes('anthropic.com')) {
      responseText = d.content?.[0]?.text ?? '';
    } else {
      responseText = d.choices?.[0]?.message?.content ?? '';
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const rawPlan = JSON.parse(jsonMatch[0]);

    res.json({ plan: normalizeBootstrapPlan(rawPlan), source: 'ai' });
  } catch (e: any) {
    console.error('[Bootstrap] Plan generation failed:', e.message);
    const allSkillsFallback = await skillsService.getAllSkills();
    res.json({ plan: normalizeBootstrapPlan(buildFallbackPlan(businessDescription, dir, isDE, allSkillsFallback)), source: 'default', warning: e.message });
  }
});

function normalizeBootstrapPlan(plan: any) {
  return {
    companyGoal: plan.companyGoal || '',
    projekte: plan.projekte || plan.projects || [],
    agenten: plan.agenten || plan.agents || [],
    tasks: plan.tasks || [],
    routinen: plan.routinen || plan.routines || [],
  };
}

function buildFallbackPlan(description: string, workDir: string, isDE: boolean, allSkills: any[]) {
  const firstSkill = allSkills[0]?.id || 'javascript';
  return {
    companyGoal: isDE ? `${description.slice(0, 80)} erfolgreich umsetzen` : `Successfully implement: ${description.slice(0, 80)}`,
    projects: [
      { name: isDE ? 'Hauptprojekt' : 'Main Project', beschreibung: description, prioritaet: 'high', farbe: '#23CDCB', subDir: 'main', startFirst: true },
    ],
    agenten: [
      { name: isDE ? 'Max' : 'Max', rolle: isDE ? 'Projektmanager' : 'Project Manager', faehigkeiten: isDE ? 'Planung, Koordination' : 'Planning, Coordination', systemPrompt: isDE ? `Du bist Max, der Projektmanager. Du koordinierst das Team, priorisierst Aufgaben und stellst sicher dass Deadlines eingehalten werden.` : `You are Max, the project manager. You coordinate the team, prioritize tasks and ensure deadlines are met.`, soul: isDE ? `# Max — Soul\n\n## Identität\nIch bin Max, der Projektmanager.\n\n## Mission\nDas Team zum Erfolg führen.\n\n## Arbeitsweise\nStrukturiert und lösungsorientiert.\n\n## Persönlichkeit\nDirekt, motivierend, professionell.` : `# Max — Soul\n\n## Identity\nI am Max, the project manager.\n\n## Mission\nLead the team to success.\n\n## Approach\nStructured and solution-oriented.\n\n## Personality\nDirect, motivating, professional.`, skills: [firstSkill], projektName: isDE ? 'Hauptprojekt' : 'Main Project', zyklusIntervallSek: 300, istOrchestrator: false },
    ],
    tasks: [
      { titel: isDE ? 'Projektplan erstellen' : 'Create project plan', beschreibung: isDE ? 'Erstelle einen detaillierten Projektplan mit Meilensteinen.' : 'Create a detailed project plan with milestones.', prioritaet: 'high', projektName: isDE ? 'Hauptprojekt' : 'Main Project', agentName: 'Max' },
    ],
    routines: [
      { name: isDE ? 'Täglicher Status' : 'Daily Status', beschreibung: isDE ? 'Täglicher Statusbericht' : 'Daily status report', cron: '0 9 * * 1-5', agentName: 'Max' },
    ],
  };
}

// POST /api/bootstrap/execute — Creates everything from the plan (idempotent: skips existing by name)
app.post('/api/bootstrap/execute', authMiddleware, async (req, res) => {
  const { plan, unternehmenId, workDir, startProjektName } = req.body;
  if (!plan || !unternehmenId || !workDir) return res.status(400).json({ error: 'plan, unternehmenId, workDir required' });

  const dir = workDir.trim();
  const opencognitRoot = path.resolve('.');
  if (dir.startsWith(opencognitRoot)) return res.status(400).json({ error: 'workDir darf nicht im OpenCognit-Verzeichnis liegen' });

  const nowStr = now();
  const created: any = { projekte: [], agenten: [], tasks: [], routinen: [], soulFiles: [] };
  const skipped: any = { projekte: [], agenten: [], tasks: [], routinen: [] };
  const projektMap: Record<string, string> = {}; // name → id
  const agentMap: Record<string, string> = {};   // name → id

  // Pre-load existing records for this company (for dedup)
  const existingProjekte = await db.select({ id: projects.id, name: projects.name, workDir: projects.workDir })
    .from(projects).where(eq(projects.companyId, unternehmenId));
  const existingAgenten = await db.select({ id: agents.id, name: agents.name })
    .from(agents).where(eq(agents.companyId, unternehmenId));
  for (const p of existingProjekte) projektMap[p.name] = p.id;
  for (const a of existingAgenten) agentMap[a.name] = a.id;

  // 1. Update company goal + root workDir
  if (plan.companyGoal) {
    db.update(companies).set({ ziel: plan.companyGoal, workDir: dir, updatedAt: nowStr }).where(eq(companies.id, unternehmenId)).run();

    // Auto-create a top-level company goal so the Orchestrator has something to plan against
    const existingTopGoal = db.select({ id: goals.id }).from(goals)
      .where(and(eq(goals.companyId, unternehmenId), eq(goals.level, 'company'), inArray(goals.status, ['active', 'planned'])))
      .get();
    if (!existingTopGoal) {
      db.insert(goals).values({
        id: uuid(),
        companyId: unternehmenId,
        title: plan.companyGoal,
        description: `Automatisch erstellt durch CEO Setup. Arbeitsverzeichnis: ${dir}`,
        level: 'company',
        status: 'active',
        progress: 0,
        parentId: null,
        createdAt: nowStr,
        updatedAt: nowStr,
      }).run();
    }
  }

  // 2. Create projects + subfolders — skip if name already exists for this company
  for (const p of (plan.projects || [])) {
    const subDir = p.subDir ? path.join(dir, p.subDir) : path.join(dir, p.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
    try { fs.mkdirSync(subDir, { recursive: true }); } catch { /* ignore */ }

    if (projektMap[p.name]) {
      skipped.projekte.push({ name: p.name, reason: 'bereits vorhanden' });
      continue;
    }

    const projektId = uuid();
    db.insert(projects).values({
      id: projektId, companyId: unternehmenId,
      name: p.name,
      description: p.description || null,
      priority: (['critical','high','medium','low'].includes(p.priority) ? p.priority : 'medium') as any,
      color: p.farbe || '#23CDCB',
      workDir: subDir,
      progress: 0,
      createdAt: nowStr, updatedAt: nowStr,
    }).run();
    projektMap[p.name] = projektId;
    created.projekte.push({ id: projektId, name: p.name, workDir: subDir });
  }

  // Build workDir lookup across all projects (existing + new)
  const allProjekteNow = await db.select({ id: projects.id, workDir: projects.workDir })
    .from(projects).where(eq(projects.companyId, unternehmenId));
  const projektWorkDirById: Record<string, string> = {};
  for (const p of allProjekteNow) projektWorkDirById[p.id] = p.workDir || dir;

  // 3. Create agents + soul files — skip if name already exists for this company
  const allSkills = await skillsService.getAllSkills();
  const skillIdSet = new Set(allSkills.map((s: any) => s.id));

  for (const a of (plan.agenten || [])) {
    if (agentMap[a.name]) {
      skipped.agenten.push({ name: a.name, reason: 'bereits vorhanden' });
      continue;
    }

    const agentId = uuid();
    const projektId = a.projektName ? projektMap[a.projektName] : null;
    const agentWorkDir = projektId ? (projektWorkDirById[projektId] || dir) : dir;

    // Write SOUL.md file
    let soulPath: string | null = null;
    if (a.soul) {
      const soulFileName = `${a.name.toLowerCase().replace(/\s+/g, '-')}.soul.md`;
      soulPath = path.join(agentWorkDir, soulFileName);
      try { fs.writeFileSync(soulPath, a.soul.replace(/\\n/g, '\n')); } catch { soulPath = null; }
      if (soulPath) created.soulFiles.push(soulPath);
    }

    db.insert(agents).values({
      id: agentId,
      companyId: unternehmenId,
      name: a.name,
      role: a.role || 'Agent',
      skills: a.skills || '',
      systemPrompt: a.systemPrompt || null,
      soulPath,
      connectionType: 'openrouter' as any,
      connectionConfig: JSON.stringify({ model: 'openrouter/auto' }),
      monthlyBudgetCent: 5000,
      autoCycleActive: true,
      autoCycleIntervalSec: a.autoCycleIntervalSec || 300,
      avatarColor: '#23CDCA',
      isOrchestrator: a.istOrchestrator === true,
      status: 'idle' as any,
      createdAt: nowStr, updatedAt: nowStr,
    }).run();

    // Default permissions
    db.insert(agentPermissions).values({
      id: uuid(), agentId: agentId,
      darfAufgabenErstellen: true, darfAufgabenZuweisen: false,
      darfGenehmigungAnfordern: true, darfGenehmigungEntscheiden: false,
      darfExpertenAnwerben: false,
      createdAt: nowStr, updatedAt: nowStr,
    }).run();

    // Assign skills
    for (const skillId of (a.skills || [])) {
      if (skillIdSet.has(skillId)) {
        try {
          db.insert(agentSkills).values({ id: uuid(), agentId: agentId, skillId, proficiency: 80, createdAt: nowStr }).run();
        } catch { /* duplicate */ }
      }
    }

    agentMap[a.name] = agentId;
    created.agenten.push({ id: agentId, name: a.name, rolle: a.role, soulPath });
  }

  // 4. Create tasks — skip if same title already exists in same project
  const existingTaskRows = await db.select({ titel: tasks.title, projektId: tasks.projectId })
    .from(tasks).where(eq(tasks.companyId, unternehmenId));
  const existingTaskKeys = new Set(existingTaskRows.map(t => `${t.projectId ?? ''}::${t.title}`));

  for (const t of (plan.tasks || [])) {
    const projektId = t.projektName ? projektMap[t.projektName] : null;
    const dedupKey = `${projektId ?? ''}::${t.title}`;
    if (existingTaskKeys.has(dedupKey)) {
      skipped.tasks.push({ titel: t.title, reason: 'bereits vorhanden' });
      continue;
    }
    const agentId = t.agentName ? agentMap[t.agentName] : null;
    const taskId = uuid();
    db.insert(tasks).values({
      id: taskId, companyId: unternehmenId,
      title: t.title,
      description: t.description || null,
      status: 'backlog' as any,
      priority: (['critical','high','medium','low'].includes(t.priority) ? t.priority : 'medium') as any,
      projectId: projektId || null,
      assignedTo: agentId || null,
      createdBy: agentId || null,
      createdAt: nowStr, updatedAt: nowStr,
    }).run();
    existingTaskKeys.add(dedupKey);
    created.tasks.push({ id: taskId, titel: t.title, projektName: t.projektName });
  }

  // 5. Create routines — skip if same name already exists for the same agent
  const existingRoutineRows = await db.select({ name: routines.title, agentId: routines.assignedTo })
    .from(routines).where(eq(routines.companyId, unternehmenId as string));
  const existingRoutineKeys = new Set(existingRoutineRows.map(r => `${r.agentId}::${r.name}`));

  for (const r of (plan.routines || [])) {
    const agentId = r.agentName ? agentMap[r.agentName] : null;
    if (!agentId) continue;
    const dedupKey = `${agentId}::${r.name}`;
    if (existingRoutineKeys.has(dedupKey)) {
      skipped.routinen.push({ name: r.name, reason: 'bereits vorhanden' });
      continue;
    }
    const routineId = uuid();
    db.insert(routines).values({
      id: routineId, companyId: unternehmenId,
      name: r.name,
      description: r.description || null,
      assignedTo: agentId,
      active: true,
      createdAt: nowStr, updatedAt: nowStr,
    }).run();
    if (r.cron) {
      db.insert(routineTrigger).values({
        id: uuid(), routineId,
        type: 'cron' as any,
        value: r.cron,
        createdAt: nowStr,
      }).run();
    }
    existingRoutineKeys.add(dedupKey);
    created.routinen.push({ id: routineId, name: r.name, agentName: r.agentName });
  }

  // 6. Set start project to critical priority
  if (startProjektName && projektMap[startProjektName]) {
    db.update(projects).set({ priority: 'critical', updatedAt: nowStr }).where(eq(projects.id, projektMap[startProjektName])).run();
  }

  const totalSkipped = skipped.projekte.length + skipped.agenten.length + skipped.tasks.length + skipped.routinen.length;
  logAktivitaet(unternehmenId, 'system', 'system', 'CEO Bootstrap',
    `hat ${created.agenten.length} Agenten, ${created.projekte.length} Projekte und ${created.tasks.length} Tasks erstellt (${totalSkipped} übersprungen)`,
    'companies', unternehmenId);
  res.json({ success: true, created, skipped });
});

// (CLI status + path-override endpoints moved to ./routes/system.ts)

// =============================================
// PLUGIN-SYSTEM — moved to ./routes/plugins.ts
// =============================================

// =============================================
// START
// =============================================
// ===== Wakeup Processor =====
// Processes pending wakeup requests every 10 seconds
// Cron → wakeupService.wakeup() → agentWakeupRequests table → heartbeatService.processPendingWakeups()
let wakeupProcessorInterval: NodeJS.Timeout | null = null;

// ===== Periodic Zyklus-Checker =====
// Ersetzt den Legacy-Scheduler — prüft alle 30s ob Agenten mit zyklusAktiv=true
// einen Wakeup brauchen basierend auf ihrem zyklusIntervallSek
let zyklusCheckerInterval: NodeJS.Timeout | null = null;

async function checkPeriodicWakeups() {
  try {
    const now = Date.now();
    // Hole alle Agenten mit zyklusAktiv=true die nicht paused/terminated sind
    const agentRows = db.select({
      id: agents.id,
      unternehmenId: agents.companyId,
      name: agents.name,
      letzterZyklus: agents.lastCycle,
      zyklusIntervallSek: agents.autoCycleIntervalSec,
      isOrchestrator: agents.isOrchestrator,
    })
      .from(agents)
      .where(
        and(
          sql`${agents.autoCycleActive} = 1`,
          sql`${agents.status} != 'terminated'`,
          sql`${agents.status} != 'paused'`
        )
      )
      .all();

    let wakeupsCreated = 0;
    for (const agent of agentRows) {
      if (!agent.autoCycleIntervalSec) continue;

      const needsWakeup = !agent.lastCycle ||
        (now - new Date(agent.lastCycle).getTime()) > (agent.autoCycleIntervalSec * 1000);

      if (needsWakeup) {
        await wakeupService.wakeup(agent.id, agent.companyId, {
          source: 'timer',
          triggerDetail: 'cron',
          reason: `Periodischer Zyklus (alle ${agent.autoCycleIntervalSec}s)`,
          contextSnapshot: { source: 'periodic_cycle' },
        });
        wakeupsCreated++;
      }
    }

    // ── CEO/Orchestrator wecken wenn unzugewiesene Tasks vorhanden ────────────
    // Entspricht scheduler.wakeupCEOIfNeeded() für das Heartbeat-System
    try {
      // Finde alle Companies mit unzugewiesenen Tasks
      const unassignedTasks = db.select({
        unternehmenId: tasks.companyId,
      })
        .from(tasks)
        .where(
          and(
            isNull(tasks.assignedTo),
            inArray(tasks.status, ['todo', 'backlog']),
          )
        )
        .all();

      const companiesWithWork = [...new Set(unassignedTasks.map(t => t.companyId as string))];

      for (const unternehmenId of companiesWithWork) {
        // Finde CEO/Orchestrator dieser Company
        const ceo = db.select({ id: agents.id, name: agents.name, letzterZyklus: agents.lastCycle })
          .from(agents)
          .where(
            and(
              eq(agents.companyId, unternehmenId as string),
              eq(agents.isOrchestrator, true),
              sql`${agents.status} != 'terminated'`,
              sql`${agents.status} != 'paused'`,
              sql`${agents.status} != 'running'`,
            )
          )
          .get() as any;

        if (!ceo) continue;

        // Nur wecken wenn CEO nicht gerade erst aktiv war (min. 60s Abstand)
        const ceoIdleSince = ceo.lastCycle
          ? now - new Date(ceo.lastCycle).getTime()
          : Infinity;

        if (ceoIdleSince > 60_000) {
          await wakeupService.wakeup(ceo.id, unternehmenId as string, {
            source: 'assignment',
            triggerDetail: 'callback',
            reason: `Unzugewiesene Tasks warten auf Delegation`,
            contextSnapshot: { source: 'unassigned_tasks' },
          });
          wakeupsCreated++;
          console.log(`🎯 CEO "${ceo.name}" geweckt — unzugewiesene Tasks vorhanden`);
        }
      }
    } catch (e) {
      console.error('CEO-Wakeup-Check fehlgeschlagen:', e);
    }
    // ──────────────────────────────────────────────────────────────────────────

    if (wakeupsCreated > 0) {
      console.log(`⏰ ${wakeupsCreated} periodische Wakeup(s) erstellt`);
    }
  } catch (error) {
    console.error('❌ Fehler im Periodic Zyklus-Checker:', error);
  }
}

async function processAllPendingWakeups() {
  try {
    // Verarbeite Wakeups für alle nicht-terminierten, nicht-pausierten Agenten
    // zyklusAktiv steuert nur ob der Cron-Scheduler automatisch feuert —
    // manuelle Zuweisungen und on-demand Wakeups werden immer verarbeitet
    const activeAgents = db.select({
      id: agents.id,
      unternehmenId: agents.companyId,
      name: agents.name,
    })
      .from(agents)
      .where(
        and(
          sql`${agents.status} != 'terminated'`,
          sql`${agents.status} != 'paused'`
        )
      )
      .all();

    // Run all agent wakeups in parallel — claude-code agents self-serialize via their own lock,
    // API-based agents (anthropic, openrouter, etc.) truly run concurrently
    await Promise.all(activeAgents.map(async (agent) => {
      try {
        const processed = await heartbeatService.processPendingWakeups(agent.id);
        if (processed > 0) {
          console.log(`🤖 Agent "${agent.name}": ${processed} Wakeup(s) verarbeitet`);
          broadcastUpdate('heartbeat', { expertId: agent.id, processed });
        }
      } catch (error: any) {
        console.error(`❌ Wakeup-Verarbeitung fehlgeschlagen für Agent ${agent.name}: ${error.message}`);
      }
    }));
  } catch (error) {
    console.error('❌ Fehler beim Wakeup-Processor:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenClaw Gateway API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/openclaw/token?unternehmenId=...
 * Returns (or creates) the connection token for a company.
 * Admins use this token to share with OpenClaw users.
 */
app.get('/api/openclaw/token', authMiddleware, requireCompanyAccess(), (req: any, res: any) => {
  const unternehmenId = req.companyId as string;
  if (!unternehmenId) return res.status(400).json({ error: 'unternehmenId required' });

  let row = db.select().from(openclawTokens)
    .where(eq(openclawTokens.companyId, unternehmenId))
    .get();

  if (!row) {
    const newToken = uuid();
    db.insert(openclawTokens).values({
      id: uuid(),
      companyId: unternehmenId,
      token: newToken,
      description: 'Auto-generiert',
      createdAt: now(),
    }).run();
    row = db.select().from(openclawTokens).where(eq(openclawTokens.companyId, unternehmenId)).get();
  }

  res.json({ token: row!.token, erstelltAm: row!.createdAt, letzterJoin: row!.letzterJoin });
});

/**
 * POST /api/openclaw/token/regenerate
 * Regenerates the connection token (invalidates old one).
 */
app.post('/api/openclaw/token/regenerate', authMiddleware, requireCompanyAccess(), (req: any, res: any) => {
  const unternehmenId = req.companyId as string;
  if (!unternehmenId) return res.status(400).json({ error: 'unternehmenId required' });

  const newToken = uuid();
  const existing = db.select({ id: openclawTokens.id }).from(openclawTokens)
    .where(eq(openclawTokens.companyId, unternehmenId)).get();

  if (existing) {
    db.update(openclawTokens).set({ token: newToken }).where(eq(openclawTokens.companyId, unternehmenId)).run();
  } else {
    db.insert(openclawTokens).values({ id: uuid(), companyId: unternehmenId, token: newToken, description: 'Auto-generiert', createdAt: now() }).run();
  }

  res.json({ token: newToken });
});

/**
 * POST /api/openclaw/join
 * Called by an OpenClaw instance to register its agent in OpenCognit.
 * Body: { token, agentName, agentRolle, gatewayUrl, openclawAgentId, faehigkeiten? }
 * No auth middleware — the connection token IS the authentication.
 */
app.post('/api/openclaw/join', (req: any, res: any) => {
  const { token, agentName, agentRolle, gatewayUrl, openclawAgentId, faehigkeiten } = req.body;

  if (!token || !agentName || !gatewayUrl) {
    return res.status(400).json({ error: 'token, agentName und gatewayUrl sind Pflichtfelder' });
  }

  // Verify token
  const tokenRow = db.select().from(openclawTokens).where(eq(openclawTokens.token, token)).get();
  if (!tokenRow) return res.status(403).json({ error: 'Ungültiger Token' });

  const unternehmenId = tokenRow.companyId;

  // Check if this OpenClaw agent is already registered (by openclawAgentId or gatewayUrl match)
  const verbindungsConfigPattern = openclawAgentId ?? gatewayUrl;
  const existing = db.select().from(agents)
    .where(and(
      eq(agents.companyId, unternehmenId),
      eq(agents.connectionType, 'openclaw' as any),
    ))
    .all()
    .find((e: any) => {
      try {
        const cfg = JSON.parse(e.connectionConfig || '{}');
        return cfg.openclawAgentId === openclawAgentId || cfg.gatewayUrl === gatewayUrl;
      } catch { return false; }
    });

  const verbindungsConfig = JSON.stringify({
    openclawGateway: true,
    gatewayUrl,
    token,
    openclawAgentId: openclawAgentId ?? null,
  });

  let expertId: string;
  if (existing) {
    // Update existing registration (new gateway URL or token)
    db.update(agents).set({
      name: agentName,
      role: agentRolle || existing.role,
      skills: faehigkeiten || existing.skills,
      connectionConfig: verbindungsConfig,
      updatedAt: now(),
    }).where(eq(agents.id, existing.id)).run();
    expertId = existing.id;
    console.log(`🔗 OpenClaw agent updated: ${agentName} (${expertId})`);
  } else {
    // Create new expert entry
    expertId = uuid();
    db.insert(agents).values({
      id: expertId,
      companyId: unternehmenId,
      name: agentName,
      role: agentRolle || 'Externer Agent',
      connectionType: 'openclaw' as any,
      connectionConfig: verbindungsConfig,
      skills: faehigkeiten || null,
      status: 'idle',
      createdAt: now(),
      updatedAt: now(),
    }).run();
    console.log(`🔗 OpenClaw agent registered: ${agentName} (${expertId})`);
  }

  // Update letzterJoin timestamp
  db.update(openclawTokens).set({ letzterJoin: now() }).where(eq(openclawTokens.token, token)).run();

  const agent = db.select().from(agents).where(eq(agents.id, expertId as string)).get();

  // Notify all open browser sessions about the new/updated connection
  broadcastUpdate('openclaw_agent_joined', {
    expertId,
    agentName,
    agentRolle: agentRolle || 'Externer Agent',
    unternehmenId,
    isNew: !existing,
  });

  res.status(201).json({ expertId, agent, message: `Agent "${agentName}" erfolgreich in OpenCognit registriert` });
});

/**
 * GET /api/openclaw/agents?unternehmenId=...
 * Lists all OpenClaw agents for a company.
 */
app.get('/api/openclaw/agents', authMiddleware, requireCompanyAccess(), (req: any, res: any) => {
  const unternehmenId = req.companyId as string;
  if (!unternehmenId) return res.status(400).json({ error: 'unternehmenId required' });

  const agentRows = db.select().from(agents)
    .where(and(
      eq(agents.companyId, unternehmenId),
      eq(agents.connectionType, 'openclaw' as any),
    ))
    .all()
    .map((a: any) => {
      let cfg: any = {};
      try { cfg = JSON.parse(a.connectionConfig || '{}'); } catch {}
      return { ...a, gatewayUrl: cfg.gatewayUrl, openclawAgentId: cfg.openclawAgentId };
    });

  res.json(agentRows);
});

// ── Global error middleware ───────────────────────────────────────────────────
// Catches any thrown/unhandled error from API routes and returns a structured,
// user-friendly JSON response instead of Express' default HTML stack trace.
app.use('/api', (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const status = typeof err?.status === 'number' ? err.status : 500;
  const code = err?.code || (status === 500 ? 'internal_error' : 'request_error');
  const message = status >= 500
    ? 'Ein interner Fehler ist aufgetreten. Versuche es in einem Moment erneut.'
    : (err?.message || 'Anfrage konnte nicht verarbeitet werden.');

  console.error(`[API ERROR] ${req.method} ${req.path} →`, err?.stack || err);

  res.status(status).json({
    error: message,
    code,
    path: req.path,
    ...(process.env.NODE_ENV !== 'production' && err?.stack ? { stack: String(err.stack).split('\n').slice(0, 5) } : {}),
  });
});

// ── Production: serve built frontend ──────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve('dist');

  // Hashed assets (JS/CSS with content-hash in filename) — cache 1 year immutable
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res: any) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  // Static files without content-hash (favicons, manifest, sw.js) — cache 1 day, must-revalidate
  app.use(express.static(distPath, {
    maxAge: '1d',
    setHeaders: (res: any, filePath: string) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA fallback — all non-API routes return index.html
  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
// ──────────────────────────────────────────────────────────────────────────────

async function start() {
  await initializeDatabase();

  // ── Load CLI path overrides from settings ───────────────────────────────────
  try {
    const cliPathSettings = db.select().from(settings)
      .where(and(
        eq(settings.companyId, ''),
        inArray(settings.key, ['cli_path_kimi', 'cli_path_claude', 'cli_path_codex', 'cli_path_gemini'])
      )).all();
    for (const s of cliPathSettings) {
      const tool = s.key.replace('cli_path_', '');
      try {
        const decrypted = decryptSetting(s.key, s.value);
        if (decrypted) setCliPath(tool, decrypted);
      } catch {
        if (s.value) setCliPath(tool, s.value);
      }
    }
    const loaded = getAllCliPaths();
    if (Object.keys(loaded).length > 0) {
      console.log(`🔧 CLI path overrides loaded: ${Object.entries(loaded).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  } catch (e: any) {
    console.warn('⚠️ Could not load CLI path overrides:', e.message);
  }

  // ── Startup cleanup: release all stale locks from previous server crash ──────
  try {
    // 1. Reset agents stuck in 'running' → 'idle'
    const stuckAgents = db.select({ id: agents.id, name: agents.name })
      .from(agents).where(eq(agents.status, 'running' as any)).all();
    if (stuckAgents.length > 0) {
      db.update(agents).set({ status: 'idle', updatedAt: now() })
        .where(eq(agents.status, 'running' as any)).run();
      console.log(`🔧 ${stuckAgents.length} Agent(en) von 'running' → 'idle' zurückgesetzt: ${(stuckAgents as any[]).map((a: any) => a.name).join(', ')}`);
    }

    // 2. Release all task execution locks (executionLockedAt → null)
    const lockedTasks = db.select({ id: tasks.id })
      .from(tasks).where(isNotNull(tasks.executionLockedAt as any)).all();
    if (lockedTasks.length > 0) {
      db.update(tasks).set({
        executionLockedAt: null as any,
        executionRunId: null as any,
      }).where(isNotNull(tasks.executionLockedAt as any)).run();
      console.log(`🔧 ${lockedTasks.length} Task-Lock(s) beim Start freigegeben`);
    }

    // 3. Mark all open workCycles as timed_out (they'll never finish now)
    const openRuns = db.select({ id: workCycles.id })
      .from(workCycles).where(eq(workCycles.status, 'running')).all();
    if (openRuns.length > 0) {
      db.update(workCycles).set({
        status: 'timed_out',
        endedAt: now(),
        error: 'Server restarted — execution interrupted',
      }).where(eq(workCycles.status, 'running')).run();
      console.log(`🔧 ${openRuns.length} offene Arbeitszyklen auf 'timed_out' gesetzt`);
    }
  } catch (e) {
    console.warn('Startup-Cleanup fehlgeschlagen:', e);
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Start cron scheduler — prüft alle 30s auf fällige Routine-Trigger
  cronService.start();
  console.log('🕐 Cron Scheduler gestartet (prüft alle 30s)\n');

  // Start cleanup service — removes stale data every 6 hours
  cleanupService.start();
  console.log('🧹 Cleanup-Service gestartet (alle 6h)\n');

  // Start backup service — daily SQLite snapshots to data/backups/
  backupService.start();
  console.log('💾 Backup-Service gestartet (täglich)\n');

  // Start wakeup processor — verarbeitet pending Wakeups alle 10s
  wakeupProcessorInterval = setInterval(processAllPendingWakeups, 10000);
  console.log('🔄 Wakeup-Processor gestartet (verarbeitet alle 10s)\n');

  // Start periodic zyklus checker — erstellt Wakeups basierend auf zyklusIntervallSek alle 30s
  zyklusCheckerInterval = setInterval(checkPeriodicWakeups, 30000);
  console.log('⏱️ Periodic Zyklus-Checker gestartet (prüft alle 30s)\n');

  // Start stuck-agent watchdog — resets agents stuck in 'running' for >5 minutes
  setInterval(() => {
    try {
      const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const stuckAgents = db.select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(
          eq(agents.status, 'running' as any),
          sql`${agents.lastCycle} < ${stuckCutoff}`
        )).all() as any[];
      if (stuckAgents.length > 0) {
        db.update(agents).set({ status: 'idle', updatedAt: new Date().toISOString() })
          .where(and(
            eq(agents.status, 'running' as any),
            sql`${agents.lastCycle} < ${stuckCutoff}`
          )).run();
        db.update(tasks).set({ executionLockedAt: null as any, executionRunId: null as any })
          .where(isNotNull(tasks.executionLockedAt as any)).run();
        console.log(`🛡️ Watchdog: ${stuckAgents.length} Agent(en) von 'running' → 'idle' zurückgesetzt: ${stuckAgents.map((a: any) => a.name).join(', ')}`);
      }
    } catch (e: any) {
      console.warn('🛡️ Stuck-agent watchdog error:', e.message);
    }
  }, 60_000);
  console.log('🛡️ Stuck-Agent Watchdog gestartet (prüft alle 60s)\n');

  // Initialize plugin system (Phase 4)
  try {
    await initializePluginSystem();
    console.log('🔌 Plugin-System initialisiert\n');
  } catch (error) {
    console.error('⚠️ Fehler bei der Initialisierung des Plugin-Systems:', error);
  }

  // Load external adapter plugins from plugins/adapters/*
  try {
    const n = await adapterRegistry.loadPlugins();
    if (n > 0) console.log(`🧩 ${n} externe Adapter-Plugin(s) aktiv\n`);
  } catch (error) {
    console.error('⚠️ Fehler beim Laden der Adapter-Plugins:', error);
  }

  // Start Telegram Polling (Gateway Mode)
  messagingService.startPolling().catch(console.error);

  // Initialize Discord Bot (if configured)
  try {
    await discordBotService.initialize();
  } catch (e: any) {
    console.warn('⚠️ Discord Bot konnte nicht gestartet werden:', e.message);
  }

  // Wire channelRegistry inbound handler → messagingService
  // Without this, webhook-based Telegram messages are silently dropped
  try {
    const { channelRegistry } = await import('./channels/index.js');
    channelRegistry.setInboundHandler(async (unternehmenId: string, message: any) => {
      await messagingService.handleInboundMessage(unternehmenId, message, '');
    });
    console.log('📡 Channel-Registry Inbound-Handler verdrahtet');
  } catch (e: any) {
    console.warn('⚠️ Channel-Registry konnte nicht initialisiert werden:', e.message);
  }

  try {
    const { startApprovalNotifier } = await import('./services/approval-notifier.js');
    startApprovalNotifier();
  } catch (e: any) {
    console.warn('⚠️ Approval notifier konnte nicht gestartet werden:', e.message);
  }

  server.listen(PORT, () => {
    const G = '\x1b[1;33m'; const R = '\x1b[0m';
    console.log(`${G} ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗██╗████████╗${R}`);
    console.log(`${G}██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔═══██╗██╔════╝ ████╗  ██║██║╚══██╔══╝${R}`);
    console.log(`${G}██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║   ██║██║  ███╗██╔██╗ ██║██║   ██║   ${R}`);
    console.log(`${G}██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║   ██║██║   ██║██║╚██╗██║██║   ██║   ${R}`);
    console.log(`${G}╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║██║   ██║   ${R}`);
    console.log(`${G} ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝  ${R}`);
    console.log(`\x1b[1;33m  🚀 API        \x1b[0m http://localhost:${PORT}`);
    console.log(`\x1b[1;33m  📡 WebSocket  \x1b[0m ws://localhost:${PORT}/ws`);
    console.log(`\x1b[1;33m  📊 Health     \x1b[0m http://localhost:${PORT}/api/health`);
    console.log(`\x1b[90m\n  Cron → Wakeup → Heartbeat → Adapter → Done\x1b[0m\n`);
  });
}

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 OpenCognit Server fährt herunter...');
  
  // Emergency timeout: Force exit if cleanup takes too long
  setTimeout(() => {
    console.error('⚠️ Shutdown Timeout erreicht. Forciere Beendung...');
    process.exit(1);
  }, 2000).unref();

  messagingService.stopPolling();
  cronService.stop();
  cleanupService.stop();
  backupService.stop();
  if (wakeupProcessorInterval) {
    clearInterval(wakeupProcessorInterval);
    wakeupProcessorInterval = null;
  }
  if (zyklusCheckerInterval) {
    clearInterval(zyklusCheckerInterval);
    zyklusCheckerInterval = null;
  }
  try {
    await discordBotService.shutdown();
  } catch (e: any) {
    console.warn('⚠️ Discord Bot Shutdown-Fehler:', e.message);
  }
  try {
    await shutdownPluginSystem();
  } catch (error) {
    console.error('Fehler beim Herunterfahren des Plugin-Systems:', error);
  }

  console.log('Schließe Sockets und Datenbank...');
  wss.clients.forEach(client => client.close());
  wss.close();
  server.close(() => {
    if (sqlite) {
      try {
        sqlite.close();
      } catch (e) {}
    }
    console.log('✅ Server erfolgreich beendet.');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch(console.error);

// Advisor Framework Integration - System Recovery Success Trigger [Port Cleared]
// =============================================
// TELEGRAM WEBHOOK
// =============================================
app.post('/api/webhooks/telegram/:unternehmenId', async (req, res) => {
  const { unternehmenId } = req.params;
  const { message } = req.body;

  // Validate company exists before processing
  const company = db.select({ id: companies.id }).from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  if (message) {
    await messagingService.handleInboundMessage(unternehmenId, message, '');
  }

  res.sendStatus(200);
});

app.post('/api/test/telegram', async (req, res) => {
  const { unternehmenId } = req.body;
  if (!unternehmenId) return res.status(400).json({ error: 'unternehmenId fehlt' });

  try {
    await messagingService.notify(unternehmenId, '🚀 OpenCognit Telegram Test', 'Deine Bot-Verbindung ist aktiv und bereit für die Zero-Human Company!');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

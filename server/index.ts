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
import { companies, agents, tasks, comments, approvals, activityLog, costEntries, workCycles, workCyclesArchive, goals, settings, chatMessages, users, routines, routineTrigger, routineRuns, workProducts, projects, agentPermissions, traceEvents, skillsLibrary, agentSkills, agentWakeupRequests, palaceWings, palaceDrawers, palaceDiary, palaceKg, palaceSummaries, budgetPolicies, budgetIncidents, executionWorkspaces, issueRelations, agentMeetings, openclawTokens, agentConfigHistory, ceoDecisionLog, agentTrustScores, agentVotes, agentCapabilities, contractNetBids } from './db/schema.js';
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
import { appEvents } from './events.js';
import { autoSaveInsights, loadRelevantMemory } from './services/memory-auto.js';
import { nodeManager } from './services/nodeManager.js';
import webhooksRouter from './routes/webhooks.js';
import semanticMemoryRouter from './routes/semantic-memory.js';

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

const zAgent = z.object({
  name: z.string().min(1).max(100),
  rolle: z.string().min(1).max(100),
  titel: z.string().max(100).optional(),
  faehigkeiten: z.string().max(2000).optional(),
  verbindungsTyp: z.string().max(50).optional(),
  budgetMonatCent: z.number().int().min(0).max(10_000_000).optional(),
  systemPrompt: z.string().max(10_000).optional(),
}).passthrough(); // allow extra fields (verbindungsConfig etc.)

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

app.use('/api/webhooks', webhooksRouter);
app.use('/api/semantic-memory', semanticMemoryRouter);

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
appEvents.on('trace', ({ expertId, unternehmenId, typ, titel, details, runId }: any) => {
  emitTrace(expertId, unternehmenId, typ, titel, details, runId);
});

// Wire up scheduler broadcast + trace functions (these were imported but never registered)
setBroadcastUpdate(broadcastUpdate);
setEmitTrace(emitTrace);

// ===== Auth Middleware =====
export async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
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
  } catch (e: any) {
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
    if (!token) throw new Error('Kein Token');
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; rolle: string };
    // Verify user still exists in DB (prevents stale tokens after user deletion)
    const user = db.select({ id: users.id }).from(users).where(eq(users.id, payload.userId)).get();
    if (!user) return res.status(401).json({ error: 'User not found.' });
    (req as any).users = payload;
    next();
  } catch (err: any) {
    console.error('[Auth] Validierung fehlgeschlagen:', err?.message);
    return res.status(401).json({ error: 'Token invalid or expired.' });
  }
}

// ===== Helper: Aktivität loggen =====
function logAktivitaet(unternehmenId: string, akteurTyp: 'agent' | 'board' | 'system', akteurId: string, akteurName: string, aktion: string, entitaetTyp: string, entitaetId: string, details?: any) {
  const activity = {
    id: uuid(),
    companyId: unternehmenId,
    actorType: akteurTyp,
    actorId: akteurId,
    actorName: akteurName,
    action: aktion,
    entityType: entitaetTyp,
    entityId: entitaetId,
    details: details ? JSON.stringify(details) : null,
    createdAt: now(),
  };
  db.insert(activityLog).values(activity).run();
  broadcastUpdate('activity', activity);
}

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

// =============================================
// UNTERNEHMEN
// =============================================
app.get('/api/companies', (_req, res) => {
  const result = db.select().from(companies).orderBy(desc(companies.createdAt)).all();
  res.json(result);
});

app.post('/api/companies', (req, res) => {
  const body = validate(zCompany, req, res);
  if (!body) return;
  const { name, beschreibung, ziel } = body;

  const id = uuid();
  db.insert(companies).values({
    id, name, description: beschreibung, goal: ziel,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const data = db.select().from(companies).where(eq(companies.id, id)).get();
  logAktivitaet(id, 'board', 'board', 'Board', `hat Unternehmen „${name}" erstellt`, 'companies', id);
  res.status(201).json(data);
});

app.get('/api/companies/:id', (req, res) => {
  const data = db.select().from(companies).where(eq(companies.id, req.params.id as string)).get();
  if (!data) return res.status(404).json({ error: 'Company not found' });
  res.json(data);
});

app.patch('/api/companies/:id', (req, res) => {
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

// Workspace directory check
app.get('/api/companies/:id/workspace/check', (req, res) => {
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

// Filesystem directory browser — lists subdirectories of a given path
app.get('/api/fs/dirs', (req: any, res) => {
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
app.post('/api/fs/mkdir', (req: any, res) => {
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

// Open company work directory in system file manager
app.post('/api/companies/:id/open-folder', (req, res) => {
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
// MITARBEITER
// =============================================
app.get('/api/companies/:unternehmenId/agents', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const rows = db.select().from(agents)
    .where(eq(agents.companyId, req.params.unternehmenId))
    .orderBy(agents.name)
    .limit(limit)
    .offset(offset)
    .all();
  res.json(rows.map((a: any) => ({
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
  })));
});

function checkFreeModel(verbindungsConfig: any): string | null {
  try {
    const cfg = typeof verbindungsConfig === 'string' ? JSON.parse(verbindungsConfig) : verbindungsConfig;
    const model: string = cfg?.model || '';
    if (model.endsWith(':free') || model === 'auto:free') return model;
  } catch {}
  return null;
}

app.post('/api/companies/:unternehmenId/agents', (req, res) => {
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
  broadcastUpdate('expert_created', { unternehmenId, id, name, rolle });
  res.status(201).json(agent);
});

app.get('/api/agents/:id', (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

// GET /api/agents/:id/token — returns the HMAC-derived API key for this agent
// Protected by user session so only the logged-in user can retrieve it
app.get('/api/agents/:id/token', authMiddleware, (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ token: deriveAgentToken(agent.id, agent.companyId) });
});

app.patch('/api/agents/:id', (req, res) => {
  if (req.body.connectionConfig !== undefined) {
    const freeModel = checkFreeModel(req.body.connectionConfig);
    if (freeModel) return res.status(400).json({ error: `Free model "${freeModel}" not allowed. Use a paid model.` });
  }
  const updates: any = { updatedAt: now() };
  const allowed = ['name', 'rolle', 'titel', 'faehigkeiten', 'verbindungsTyp', 'verbindungsConfig', 'reportsTo', 'avatar', 'avatarFarbe', 'budgetMonatCent', 'zyklusIntervallSek', 'zyklusAktiv', 'status', 'systemPrompt', 'advisorId', 'advisorStrategy', 'advisorConfig', 'isOrchestrator'];
  const keyMap: Record<string, string> = {
    rolle: 'role', titel: 'title', faehigkeiten: 'skills',
    verbindungsTyp: 'connectionType', verbindungsConfig: 'connectionConfig',
    avatarFarbe: 'avatarColor', budgetMonatCent: 'monthlyBudgetCent',
    zyklusIntervallSek: 'autoCycleIntervalSec', zyklusAktiv: 'autoCycleActive',
  };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const outKey = keyMap[key] || key;
      if ((key === 'verbindungsConfig' || key === 'advisorConfig') && typeof req.body[key] === 'object' && req.body[key] !== null) {
        updates[outKey] = JSON.stringify(req.body[key]);
      } else {
        updates[outKey] = req.body[key];
      }
    }
  }

  db.update(agents).set(updates).where(eq(agents.id, req.params.id as string)).run();
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  res.json(agent);
});

// Alias: ExpertChatDrawer uses /api/agents/:id for PATCH (e.g. soul editor)
app.patch('/api/agents/:id', (req, res) => {
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
  res.json(agent);
});

// GET /api/agents/:id/config-history — last N snapshots (default 20)
app.get('/api/agents/:id/config-history', authMiddleware, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.select().from(agentConfigHistory)
    .where(eq(agentConfigHistory.agentId, req.params.id as string))
    .orderBy(desc(agentConfigHistory.changedAt))
    .limit(limit)
    .all();
  res.json(rows);
});

// POST /api/agents/:id/config-history/:historyId/restore — restore a snapshot
app.post('/api/agents/:id/config-history/:historyId/restore', authMiddleware, (req, res) => {
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

app.post('/api/agents/:id/pause', (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Not found' });

  db.update(agents).set({ status: 'paused', updatedAt: now() }).where(eq(agents.id, req.params.id as string)).run();
  logAktivitaet(agent.companyId, 'board', 'board', 'Board', `hat „${agent.name}" pausiert`, 'agents', agent.id);
  res.json({ success: true });
});

app.post('/api/agents/:id/resume', (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id as string)).get();
  if (!agent) return res.status(404).json({ error: 'Not found' });

  db.update(agents).set({ status: 'idle', updatedAt: now() }).where(eq(agents.id, req.params.id as string)).run();
  logAktivitaet(agent.companyId, 'board', 'board', 'Board', `hat „${agent.name}" fortgesetzt`, 'agents', agent.id);
  res.json({ success: true });
});

app.delete('/api/agents/:id', (req, res) => {
  const agentId = req.params.id;
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) return res.status(404).json({ error: 'Not found' });

  try {
    // 1. Identify all execution runs for this agent to clear potential cross-references
    const runIds = db.select({ id: workCycles.id })
      .from(workCycles)
      .where(eq(workCycles.agentId, agentId))
      .all()
      .map(r => r.id);

    // 2. Clear references to these runs in all possible tables (FK cleanup)
    if (runIds.length > 0) {
      db.update(workCycles).set({ retryOfRunId: null }).where(inArray(workCycles.retryOfRunId, runIds)).run();
      db.update(agentWakeupRequests).set({ runId: null }).where(inArray(agentWakeupRequests.runId, runIds)).run();
      db.update(workProducts).set({ runId: null }).where(inArray(workProducts.runId, runIds)).run();
      db.update(tasks).set({ executionRunId: null }).where(inArray(tasks.executionRunId, runIds)).run();
    }

    // 3. Nullify direct agent references (Keep records but remove connection)
    db.update(comments).set({ authorAgentId: null }).where(eq(comments.authorAgentId, agentId)).run();
    db.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, agentId)).run();
    db.update(agents).set({ advisorId: null }).where(eq(agents.advisorId, agentId)).run();
    db.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, agentId)).run();
    db.update(goals).set({ ownerAgentId: null }).where(eq(goals.ownerAgentId, agentId)).run();
    db.update(routines).set({ assignedTo: null }).where(eq(routines.assignedTo, agentId)).run();
    db.update(projects).set({ ownerAgentId: null }).where(eq(projects.ownerAgentId, agentId)).run();
    db.update(comments).set({ authorAgentId: null }).where(eq(comments.authorAgentId, agentId)).run();
    db.update(issueRelations).set({ createdBy: null }).where(eq(issueRelations.createdBy, agentId)).run();
    db.delete(workProducts).where(eq(workProducts.agentId, agentId)).run();
    db.update(tasks).set({ assignedTo: null }).where(eq(tasks.assignedTo, agentId)).run();
    // Delete agent meetings where this agent is the organizer (veranstalterExpertId is NOT NULL)
    db.delete(agentMeetings).where(eq(agentMeetings.organizerAgentId, agentId)).run();

    // 4. Delete agent-owned coupled data
    db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, agentId)).run();
    db.delete(agentTrustScores).where(eq(agentTrustScores.subjectAgentId, agentId)).run();
    db.delete(agentVotes).where(eq(agentVotes.agentId, agentId)).run();
    db.delete(agentCapabilities).where(eq(agentCapabilities.agentId, agentId)).run();
    db.delete(contractNetBids).where(eq(contractNetBids.bidderAgentId, agentId)).run();
    db.delete(traceEvents).where(eq(traceEvents.agentId, agentId)).run();
    db.delete(workCycles).where(eq(workCycles.agentId, agentId)).run();
    db.delete(chatMessages).where(eq(chatMessages.agentId, agentId)).run();
    db.delete(costEntries).where(eq(costEntries.agentId, agentId)).run();
    db.delete(agentSkills).where(eq(agentSkills.agentId, agentId)).run();
    db.delete(agentPermissions).where(eq(agentPermissions.agentId, agentId)).run();
    db.update(approvals).set({ requestedBy: null }).where(eq(approvals.requestedBy, agentId)).run();

    // 4b. Memory data (palace_wings → palace_drawers + palace_diary, palace_summaries)
    const wings = db.select({ id: palaceWings.id }).from(palaceWings).where(eq(palaceWings.agentId, agentId)).all();
    if (wings.length > 0) {
      const wingIds = wings.map(w => w.id);
      db.delete(palaceDrawers).where(inArray(palaceDrawers.wingId, wingIds)).run();
      db.delete(palaceDiary).where(inArray(palaceDiary.wingId, wingIds)).run();
      db.delete(palaceWings).where(eq(palaceWings.agentId, agentId)).run();
    }
    db.delete(palaceSummaries).where(eq(palaceSummaries.agentId, agentId)).run();

    // 4c. Execution workspaces (expertId nullable — just nullify)
    db.update(executionWorkspaces).set({ agentId: null }).where(eq(executionWorkspaces.agentId, agentId)).run();

    // 4d. Knowledge graph — remove all triples that mention this agent by name
    db.delete(palaceKg)
      .where(and(
        eq(palaceKg.companyId, agent.companyId),
        or(eq(palaceKg.subject, agent.name), eq(palaceKg.object, agent.name))
      ))
      .run();

    // 4e. Archiv, CEO decision log, config history
    db.delete(workCyclesArchive).where(eq(workCyclesArchive.agentId, agentId)).run();
    db.delete(ceoDecisionLog).where(eq(ceoDecisionLog.agentId, agentId)).run();
    db.delete(agentConfigHistory).where(eq(agentConfigHistory.agentId, agentId)).run();

    // Count unassigned tasks (from this agent's former assignments) for CEO briefing
    const freedTaskCount = db.select({ count: count() }).from(tasks)
      .where(and(eq(tasks.companyId, agent.companyId), isNull(tasks.assignedTo)))
      .get()?.count ?? 0;

    // 5. Finally delete the agent
    db.delete(agents).where(eq(agents.id, agentId)).run();

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
        broadcastUpdate('chat_message', { id: msgId, unternehmenId: agent.companyId, expertId: ceo.id, nachricht: briefing });
        // Also notify via Telegram
        messagingService.sendTelegram(agent.companyId,
          `🔴 *${agent.name}* (${agent.role}) wurde entlassen.\n${freedTaskCount} Aufgaben sind jetzt unzugewiesen.`
        ).catch(() => {});
      }
    } catch { /* non-critical */ }

    logAktivitaet(agent.companyId, 'board', 'board', 'Board', `hat „${agent.name}" entlassen`, 'agents', agent.id);
    broadcastUpdate('expert_deleted', { id: agentId, name: agent.name, unternehmenId: agent.companyId });
    res.json({ success: true });
  } catch (error) {
    console.error(`Fehler beim Löschen des Agenten ${agentId}:`, error);
    res.status(500).json({ error: 'Failed to delete agent (Foreign Key / Constraints).' });
  }
});

app.get('/api/agents/:id/activity', (req, res) => {
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
// AUFGABEN
// =============================================
app.get('/api/companies/:unternehmenId/tasks', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string | undefined;
  const zugewiesenAn = req.query.assignedTo as string | undefined;

  let query = db.select().from(tasks)
    .where(and(
      eq(tasks.companyId, req.params.unternehmenId),
      ...(status ? [eq(tasks.status, status as any)] : []),
      ...(zugewiesenAn ? [eq(tasks.assignedTo, zugewiesenAn)] : []),
    ))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .offset(offset);

  const result = query.all();
  res.json(result);
});

app.post('/api/companies/:unternehmenId/tasks', (req, res) => {
  const body = validate(zTask.refine(d => d.titel || d.title, { message: 'Title required', path: ['titel'] }), req, res);
  if (!body) return;
  const b = body as any;
  const titel = b.titel || b.title;
  const beschreibung = b.beschreibung || b.description;
  const prioritaet = b.prioritaet || b.priority;
  const zugewiesenAn = b.zugewiesenAn || b.assignedTo;
  const { erstelltVon, parentId, projektId, zielId } = b;

  const unternehmenId = req.params.unternehmenId;

  // Dedup: reject if an open task with the same title already exists
  const existing = db.select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.companyId, unternehmenId),
      sql`LOWER(TRIM(${tasks.title})) = LOWER(TRIM(${titel}))`,
      sql`${tasks.status} != 'done'`,
    ))
    .limit(1)
    .all();
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Duplicate: task with this title already exists', existingId: existing[0].id });
  }

  const id = uuid();

  db.insert(tasks).values({
    id, companyId: unternehmenId, title: titel, description: beschreibung,
    status: 'backlog',
    priority: prioritaet || 'medium',
    assignedTo: zugewiesenAn || null,
    createdBy: erstelltVon || 'board',
    parentId: parentId || null,
    projectId: projektId || null,
    goalId: zielId || null,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, id)).get();
  logAktivitaet(unternehmenId, 'board', 'board', 'Board', `hat Aufgabe „${titel}" erstellt`, 'aufgabe', id);
  // Wake CEO if task has no assignee yet
  if (!zugewiesenAn) scheduler.triggerCEOForCompany(unternehmenId);
  res.status(201).json(aufgabe);
});

app.get('/api/tasks/:id', (req, res) => {
  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });
  res.json(aufgabe);
});

app.patch('/api/tasks/:id', (req, res) => {
  const existing = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const updates: any = { updatedAt: now() };
  // Accept both German (legacy) and English field names
  const aliases: Record<string, string> = {
    titel: 'title', title: 'title',
    beschreibung: 'description', description: 'description',
    prioritaet: 'priority', priority: 'priority',
    zugewiesenAn: 'assignedTo', assignedTo: 'assignedTo',
    projektId: 'projectId', projectId: 'projectId',
    zielId: 'goalId', goalId: 'goalId',
  };
  const passthrough = ['status', 'parentId', 'isMaximizerMode'];
  for (const [key, col] of Object.entries(aliases)) {
    if (req.body[key] !== undefined) updates[col] = req.body[key];
  }
  for (const key of passthrough) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  // Side effects for status transitions
  if (updates.status === 'in_progress' && !existing.startedAt) {
    updates.startedAt = now();
  }
  if (updates.status === 'done') {
    updates.completedAt = now();
  }
  if (updates.status === 'cancelled') {
    updates.cancelledAt = now();
  }

  db.update(tasks).set(updates).where(eq(tasks.id, req.params.id as string)).run();
  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();

  // Wenn Aufgabe einem Agenten zugewiesen wird → sofort Wakeup auslösen
  if (updates.assignedTo && updates.assignedTo !== existing.assignedTo) {
    wakeupService.wakeupForAssignment(updates.assignedTo, existing.companyId, req.params.id as string)
      .catch(err => console.error('Wakeup bei Zuweisung fehlgeschlagen:', err));
  }

  // Wenn Task auf 'done' → blockierte Tasks automatisch entblocken + notify
  if (updates.status === 'done' && existing.status !== 'done') {
    import('./services/issue-dependencies.js').then(({ pruefeUndEntblocke }) => {
      const entblockt = pruefeUndEntblocke(req.params.id as string);
      if (entblockt.length > 0) {
        broadcastUpdate('tasks_unblocked', { taskIds: entblockt, unternehmenId: existing.companyId });
      }
    }).catch(() => {});
    // Broadcast task_completed event for real-time notifications
    const agentName = existing.assignedTo
      ? (db.select({ name: agents.name }).from(agents).where(eq(agents.id, existing.assignedTo)).get()?.name ?? '')
      : '';
    broadcastUpdate('task_completed', {
      unternehmenId: existing.companyId,
      taskId: req.params.id,
      taskTitel: existing.title,
      agentName,
      agentId: existing.assignedTo ?? null,
    });

    // Auto-advance goal to 'achieved' when all linked tasks are done
    const zielId = updates.goalId ?? existing.goalId;
    if (zielId) {
      const ziel = db.select().from(goals).where(eq(goals.id, zielId)).get();
      if (ziel && ziel.status !== 'achieved' && ziel.status !== 'cancelled') {
        const allTasks = db.select({ status: tasks.status }).from(tasks)
          .where(eq(tasks.goalId, zielId)).all();
        if (allTasks.length > 0 && allTasks.every(t => t.status === 'done' || t.status === 'cancelled')) {
          db.update(goals).set({ status: 'achieved', updatedAt: now() }).where(eq(goals.id, zielId)).run();
          broadcastUpdate('goal_achieved', { unternehmenId: existing.companyId, zielId, zielTitel: ziel.title });
        }
      }
    }
  }

  // task_started notification
  if (updates.status === 'in_progress' && existing.status !== 'in_progress') {
    const agentName = (updates.assignedTo || existing.assignedTo)
      ? (db.select({ name: agents.name }).from(agents).where(eq(agents.id, updates.assignedTo || existing.assignedTo)).get()?.name ?? '')
      : '';
    const agentIdStarted = updates.assignedTo || existing.assignedTo;
    broadcastUpdate('task_started', {
      unternehmenId: existing.companyId,
      taskId: req.params.id,
      taskTitel: existing.title,
      agentName,
      agentId: agentIdStarted ?? null,
    });
  }

  res.json(aufgabe);
});

// Delete a task (removes comments + issue relations too)
app.delete('/api/tasks/:id', authMiddleware, (req, res) => {
  const existing = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  // Remove related data first
  db.delete(comments).where(eq(comments.taskId, req.params.id as string)).run();
  db.delete(issueRelations).where(
    or(eq(issueRelations.sourceId, req.params.id as string), eq(issueRelations.targetId, req.params.id as string))
  ).run();
  db.delete(tasks).where(eq(tasks.id, req.params.id as string)).run();

  broadcastUpdate('task_deleted', { unternehmenId: existing.companyId, taskId: req.params.id });
  res.json({ ok: true });
});

// Atomic Task Checkout (with execution locking)
app.post('/api/tasks/:id/checkout', (req, res) => {
  const { expertId, runId } = req.body;
  if (!expertId) return res.status(400).json({ error: 'expertId ist erforderlich' });

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  // Check if task is already assigned to different expert
  if (aufgabe.assignedTo && aufgabe.assignedTo !== expertId) {
    return res.status(409).json({ error: 'Task already assigned', aktuellZugewiesen: aufgabe.assignedTo });
  }

  // Check if task is locked by another run (atomic lock check)
  if (aufgabe.executionLockedAt && aufgabe.executionRunId && aufgabe.executionRunId !== runId) {
    const lockAge = Date.now() - new Date(aufgabe.executionLockedAt).getTime();
    const lockTimeout = 30 * 60 * 1000; // 30 minutes

    if (lockAge < lockTimeout) {
      return res.status(409).json({
        error: 'Task locked by another run',
        lockedBy: aufgabe.executionRunId,
        lockedAt: aufgabe.executionLockedAt,
      });
    }

    // Lock expired - reclaim task
    console.log(`⏰ Task ${aufgabe.id} lock expired, reclaiming`);
  }

  // Check valid checkout statuses
  if (!['backlog', 'todo', 'blocked', 'in_progress'].includes(aufgabe.status)) {
    return res.status(409).json({ error: 'Task cannot be checked out in this status', status: aufgabe.status });
  }

  // Atomic checkout with execution lock
  const nowStr = now();
  db.update(tasks).set({
    assignedTo: expertId,
    executionRunId: runId || null,
    executionAgentNameKey: `expert-${expertId}`,
    executionLockedAt: nowStr,
    status: aufgabe.status === 'backlog' ? 'todo' : 'in_progress',
    startedAt: aufgabe.startedAt || nowStr,
    updatedAt: nowStr,
  }).where(eq(tasks.id, req.params.id as string)).run();

  const expert = db.select().from(agents).where(eq(agents.id, expertId as string)).get();
  logAktivitaet(aufgabe.companyId, 'agent', expertId, expert?.name || expertId, `hat „${aufgabe.title}" ausgecheckt`, 'aufgabe', aufgabe.id);

  const updated = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  res.json(updated);
});

// Release task lock (when task is completed or agent releases it)
app.post('/api/tasks/:id/release', (req, res) => {
  const { expertId, runId, status, abgebrochenAm } = req.body;

  if (!expertId || !runId) {
    return res.status(400).json({ error: 'expertId und runId sind erforderlich' });
  }

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  // Verify lock ownership
  if (aufgabe.executionRunId !== runId) {
    return res.status(409).json({ error: 'Task locked by another run' });
  }

  const updates: any = {
    executionLockedAt: null,
    executionRunId: null,
    updatedAt: now(),
  };

  if (status) updates.status = status;
  if (abgebrochenAm) updates.cancelledAt = abgebrochenAm;
  if (status === 'done') updates.completedAt = now();

  db.update(tasks).set(updates).where(eq(tasks.id, req.params.id as string)).run();

  const updated = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  res.json(updated);
});

// ===== Kommentare =====
app.get('/api/tasks/:id/comments', (req, res) => {
  const result = db.select().from(comments).where(eq(comments.taskId, req.params.id as string)).orderBy(comments.createdAt).all();
  res.json(result);
});

app.post('/api/tasks/:id/comments', (req, res) => {
  const inhalt = req.body.inhalt || req.body.content;
  const { authorAgentId, authorType } = req.body;
  if (!inhalt) return res.status(400).json({ error: 'Content required' });

  const aufgabe = db.select().from(tasks).where(eq(tasks.id, req.params.id as string)).get();
  if (!aufgabe) return res.status(404).json({ error: 'Task not found' });

  const id = uuid();
  db.insert(comments).values({
    id,
    companyId: aufgabe.companyId,
    taskId: aufgabe.id,
    authorAgentId: authorAgentId || null,
    authorType: authorType || 'board',
    content: inhalt,
    createdAt: now(),
  }).run();

  const kommentar = db.select().from(comments).where(eq(comments.id, id)).get();
  res.status(201).json(kommentar);
});

// ===== Work Products =====
app.get('/api/tasks/:id/work-products', (req, res) => {
  const products = db.select().from(workProducts)
    .where(eq(workProducts.taskId, req.params.id as string))
    .orderBy(workProducts.createdAt)
    .all();
  res.json(products);
});

// ===== Timeline (Time-Travel-View) =====
// Unified chronological timeline for a task: creation, status changes, comments,
// workCycles (work cycles), trace events, approvals, cost bookings, activity log.
app.get('/api/tasks/:id/timeline', (req, res) => {
  const taskId = req.params.id;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  type TimelineEvent = {
    id: string;
    at: string;
    kind: string;
    title: string;
    actor?: string | null;
    runId?: string | null;
    data?: any;
  };
  const events: TimelineEvent[] = [];

  // Task lifecycle
  events.push({
    id: `task-created-${task.id}`,
    at: task.createdAt,
    kind: 'task_created',
    title: 'Task created',
    actor: task.createdBy || null,
    data: { titel: task.title, prioritaet: task.priority, typ: task.type },
  });
  if (task.startedAt) {
    events.push({ id: `task-started-${task.id}`, at: task.startedAt, kind: 'task_started', title: 'Task started', actor: task.assignedTo || null });
  }
  if (task.completedAt) {
    events.push({ id: `task-completed-${task.id}`, at: task.completedAt, kind: 'task_completed', title: 'Task completed', actor: task.assignedTo || null, data: { status: task.status } });
  }
  if (task.cancelledAt) {
    events.push({ id: `task-cancelled-${task.id}`, at: task.cancelledAt, kind: 'task_cancelled', title: 'Task cancelled' });
  }

  // Kommentare
  const commentRows = db.select().from(comments).where(eq(comments.taskId, taskId)).all();
  for (const c of commentRows) {
    events.push({
      id: `comment-${c.id}`,
      at: c.createdAt,
      kind: 'comment',
      title: c.authorType === 'agent' ? 'Agent output' : 'Comment',
      actor: c.authorAgentId || c.authorType,
      data: { inhalt: c.content, authorType: c.authorType },
    });
  }

  // Kostenbuchungen (also source for runIds)
  const kb = db.select().from(costEntries).where(eq(costEntries.taskId, taskId)).all();
  for (const k of kb) {
    events.push({
      id: `cost-${k.id}`,
      at: k.timestamp || k.createdAt,
      kind: 'cost',
      title: `Cost: ${k.model}`,
      actor: k.agentId,
      data: { anbieter: k.provider, modell: k.model, inputTokens: k.inputTokens, outputTokens: k.outputTokens, kostenCent: k.costCent },
    });
  }

  // Arbeitszyklen for this task — match via context_snapshot (JSON) containing taskId/issueId
  const allRuns = db.select().from(workCycles)
    .where(eq(workCycles.companyId, task.companyId))
    .all();
  const runs = allRuns.filter(r => {
    if (!r.contextSnapshot) return false;
    try {
      const ctx = JSON.parse(r.contextSnapshot);
      return ctx.taskId === taskId || ctx.issueId === taskId || ctx.taskId === taskId;
    } catch { return false; }
  });
  const runIds = new Set<string>(runs.map(r => r.id));
  for (const r of runs) {
    if (r.startedAt) {
      events.push({
        id: `run-start-${r.id}`,
        at: r.startedAt,
        kind: 'run_started',
        title: 'Work cycle started',
        actor: r.agentId,
        runId: r.id,
        data: { quelle: r.source, invocationSource: r.invocationSource, triggerDetail: r.triggerDetail },
      });
    }
    if (r.endedAt) {
      let usage: any = null;
      try { usage = r.usageJson ? JSON.parse(r.usageJson) : null; } catch {}
      events.push({
        id: `run-end-${r.id}`,
        at: r.endedAt,
        kind: r.status === 'succeeded' ? 'run_succeeded' : 'run_failed',
        title: r.status === 'succeeded' ? 'Work cycle succeeded' : `Work cycle ${r.status}`,
        actor: r.agentId,
        runId: r.id,
        data: { status: r.status, exitCode: r.exitCode, fehler: r.error, usage, resultJson: r.resultJson },
      });
    }
  }

  // Trace events for these runs (+ fallback: trace with aufgabeId in details JSON)
  if (runIds.size > 0) {
    const traces = db.select().from(traceEvents)
      .where(inArray(traceEvents.runId, Array.from(runIds)))
      .all();
    for (const t of traces) {
      events.push({
        id: `trace-${t.id}`,
        at: t.createdAt,
        kind: `trace_${t.type}`,
        title: t.title,
        actor: t.agentId || null,
        runId: t.runId || null,
        data: t.details ? safeParse(t.details) : null,
      });
    }
  }

  // Genehmigungen referencing this task (best-effort: payload contains taskId)
  const approvalRows = db.select().from(approvals)
    .where(eq(approvals.companyId, task.companyId))
    .all();
  for (const g of approvalRows) {
    let matches = false;
    try {
      if (g.payload) {
        const p = JSON.parse(g.payload);
        if (p.taskId === taskId || p.taskId === taskId || p.issueId === taskId) matches = true;
      }
    } catch {}
    if (!matches) continue;
    events.push({
      id: `approval-${g.id}`,
      at: g.createdAt,
      kind: 'approval_requested',
      title: `Approval requested: ${g.title}`,
      actor: g.requestedBy,
      data: { typ: g.type, status: g.status, beschreibung: g.description },
    });
    if (g.decidedAt) {
      events.push({
        id: `approval-decided-${g.id}`,
        at: g.decidedAt,
        kind: `approval_${g.status}`,
        title: `Approval ${g.status}`,
        data: { entscheidungsnotiz: g.decisionNote },
      });
    }
  }

  // Aktivitätslog for this task entity
  const logs = db.select().from(activityLog)
    .where(and(eq(activityLog.entityType, 'aufgabe'), eq(activityLog.entityId, taskId)))
    .all();
  for (const l of logs) {
    events.push({
      id: `log-${l.id}`,
      at: l.createdAt,
      kind: `log_${l.action}`,
      title: l.action,
      actor: l.actorName || l.actorId,
      data: l.details ? safeParse(l.details) : null,
    });
  }

  events.sort((a, b) => (a.at || '').localeCompare(b.at || ''));

  res.json({
    task: { id: task.id, titel: task.title, status: task.status, unternehmenId: task.companyId, zugewiesenAn: task.assignedTo },
    events,
    runs: runs.map(r => ({ id: r.id, status: r.status, gestartetAm: r.startedAt, beendetAm: r.endedAt })),
  });
});

function safeParse(s: string) { try { return JSON.parse(s); } catch { return s; } }

// Company-level work products gallery
app.get('/api/companies/:id/work-products', authMiddleware, (req, res) => {
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
app.get('/api/tasks/:id/workspace', (req, res) => {
  const info = getWorkspaceInfo(req.params.id as string);
  res.json(info);
});

// Read single workspace file (for preview in UI)
app.get('/api/tasks/:id/workspace/file', (req, res) => {
  const filename = req.query.path as string;
  if (!filename) return res.status(400).json({ error: 'path query parameter required' });

  const content = readWorkspaceFile(req.params.id, filename);
  if (content === null) return res.status(404).json({ error: 'File not found' });

  res.type('text/plain').send(content);
});

// =============================================
// COMPANY WORKDIR FILE READ (for chat [FILE] cards)
// =============================================
app.get('/api/files/read', (req, res) => {
  const unternehmenId = (req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
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
// GENEHMIGUNGEN
// =============================================
app.get('/api/companies/:unternehmenId/approvals', (req, res) => {
  const result = db.select().from(approvals).where(eq(approvals.companyId, req.params.unternehmenId)).orderBy(desc(approvals.createdAt)).all();
  // Parse payload JSON
  res.json(result.map((g: any) => ({
    ...g,
    payload: g.payload ? JSON.parse(g.payload) : null,
  })));
});

app.post('/api/approvals/:id/approve', async (req, res) => {
  const { notiz } = req.body;
  const genehm = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  if (!genehm) return res.status(404).json({ error: 'Approval not found' });
  if (genehm.status !== 'pending') return res.status(409).json({ error: 'Approval no longer pending' });

  // --- SPEZIAL-HANDLING FÜR AGENT-AKTIONEN ---
  if (genehm.type === 'agent_action' && genehm.payload) {
    try {
      const { action, params } = JSON.parse(genehm.payload);
      const expertId = genehm.requestedBy;
      if (expertId) {
        console.log(`🚀 Führe genehmigte Aktion aus: ${action} für Agent ${expertId}`);
        // Führe die Aktion über den Scheduler aus (skipAutonomyCheck = true!)
        await scheduler.executeAgentAction(genehm.companyId, expertId, action, params, true);
      }
    } catch (e) {
      console.error('Fehler beim Ausführen der genehmigten Agent-Aktion:', e);
      return res.status(500).json({ error: 'Action could not be executed' });
    }
  }

  db.update(approvals).set({
    status: 'approved',
    decisionNote: notiz || null,
    decidedAt: now(),
    updatedAt: now(),
  }).where(eq(approvals.id, req.params.id as string)).run();

  logAktivitaet(genehm.companyId, 'board', 'board', 'Board', `hat „${genehm.title}" genehmigt`, 'genehmigung', genehm.id);
  broadcastUpdate('approval_updated', { unternehmenId: genehm.companyId, id: genehm.id, status: 'approved' });
  const updated = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  res.json(updated);
});

app.post('/api/approvals/:id/reject', (req, res) => {
  const { notiz } = req.body;
  const genehm = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  if (!genehm) return res.status(404).json({ error: 'Approval not found' });

  db.update(approvals).set({
    status: 'rejected',
    decisionNote: notiz || null,
    decidedAt: now(),
    updatedAt: now(),
  }).where(eq(approvals.id, req.params.id as string)).run();

  logAktivitaet(genehm.companyId, 'board', 'board', 'Board', `hat „${genehm.title}" abgelehnt`, 'genehmigung', genehm.id);
  broadcastUpdate('approval_updated', { unternehmenId: genehm.companyId, id: genehm.id, status: 'rejected' });
  const updated = db.select().from(approvals).where(eq(approvals.id, req.params.id as string)).get();
  res.json(updated);
});

// =============================================
// KOSTEN
// =============================================

// Budget forecast — projected spend trajectory per active policy
app.get('/api/companies/:unternehmenId/budget/forecast', async (req, res) => {
  try {
    const { getForecasts } = await import('./services/budget-forecast.js');
    res.json({ forecasts: getForecasts(req.params.unternehmenId) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/companies/:unternehmenId/costs/summary', (req, res) => {
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
app.get('/api/companies/:unternehmenId/costs/by-provider', (req, res) => {
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
app.get('/api/companies/:unternehmenId/costs/timeline', (req, res) => {
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

app.post('/api/companies/:unternehmenId/costEntries', (req, res) => {
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
// PROJEKTE
// =============================================
app.get('/api/companies/:unternehmenId/projects', (req, res) => {
  const result = db.select().from(projects)
    .where(eq(projects.companyId, req.params.unternehmenId))
    .orderBy(desc(projects.createdAt))
    .all();
  res.json(result);
});

app.post('/api/companies/:unternehmenId/projects', (req, res) => {
  const { name, beschreibung, prioritaet, zielId, eigentuemerId, farbe, deadline, workDir } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const unternehmenId = req.params.unternehmenId;
  const id = uuid();
  db.insert(projects).values({
    id, companyId: unternehmenId, name,
    description: beschreibung || null,
    priority: prioritaet || 'medium',
    goalId: zielId || null,
    ownerAgentId: eigentuemerId || null,
    color: farbe || '#23CDCB',
    deadline: deadline || null,
    workDir: workDir?.trim() || null,
    progress: 0,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const projekt = db.select().from(projects).where(eq(projects.id, id)).get();
  logAktivitaet(unternehmenId, 'board', 'board', 'Board', `hat Projekt „${name}" erstellt`, 'projekt', id);
  res.status(201).json(projekt);
});

app.get('/api/projects/:id', (req, res) => {
  const projekt = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });

  // Aufgaben für dieses Projekt
  const projectTasks = db.select().from(tasks)
    .where(eq(tasks.projectId, req.params.id as string))
    .orderBy(desc(tasks.createdAt))
    .all();

  res.json({ ...projekt, tasks: projectTasks });
});

app.patch('/api/projects/:id', (req, res) => {
  const existing = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  const updates: any = { updatedAt: now() };
  const allowed = ['name', 'beschreibung', 'status', 'prioritaet', 'zielId', 'eigentuemerId', 'farbe', 'deadline', 'fortschritt', 'workDir'];
  const keyMap: Record<string, string> = {
    beschreibung: 'description', prioritaet: 'priority', zielId: 'goalId',
    eigentuemerId: 'ownerAgentId', farbe: 'color', fortschritt: 'progress',
  };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[keyMap[key] || key] = req.body[key];
    }
  }

  db.update(projects).set(updates).where(eq(projects.id, req.params.id as string)).run();
  res.json(db.select().from(projects).where(eq(projects.id, req.params.id as string)).get());
});

app.delete('/api/projects/:id', (req, res) => {
  const existing = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!existing) return res.status(404).json({ error: 'Project not found' });

  // Tasks des Projekts: projektId auf null setzen (Tasks nicht löschen)
  db.update(tasks).set({ projectId: null, updatedAt: now() })
    .where(eq(tasks.projectId, req.params.id as string)).run();

  db.delete(projects).where(eq(projects.id, req.params.id as string)).run();
  logAktivitaet(existing.companyId, 'board', 'board', 'Board', `hat Projekt „${existing.name}" gelöscht`, 'projekt', req.params.id as string);
  res.json({ success: true });
});

// Fortschritt automatisch berechnen (% done Tasks)
app.post('/api/projects/:id/fortschritt-aktualisieren', (req, res) => {
  const projekt = db.select().from(projects).where(eq(projects.id, req.params.id as string)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });

  const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, req.params.id as string)).all();
  const total = projectTasks.length;
  const done = projectTasks.filter((t: any) => t.status === 'done').length;
  const fortschritt = total > 0 ? Math.round((done / total) * 100) : 0;

  db.update(projects).set({ progress: fortschritt, updatedAt: now() })
    .where(eq(projects.id, req.params.id as string)).run();

  res.json({ fortschritt, done, total });
});

// =============================================
// AGENT PERMISSIONS
// =============================================
app.get('/api/agents/:id/permissions', (req, res) => {
  const perms = db.select().from(agentPermissions)
    .where(eq(agentPermissions.agentId, req.params.id as string)).get();

  if (!perms) {
    // Standard-Permissions zurückgeben (nicht gespeichert)
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

app.put('/api/agents/:id/permissions', (req, res) => {
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
// AKTIVITÄT
// =============================================
app.get('/api/companies/:unternehmenId/activity', (req, res) => {
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

// Derives a deterministic, secret-backed token for an agent.
// Token = "ak_" + HMAC-SHA256(JWT_SECRET, agentId:companyId)[0..31]
function deriveAgentToken(agentId: string, companyId: string): string {
  return 'ak_' + crypto.createHmac('sha256', JWT_SECRET).update(`${agentId}:${companyId}`).digest('hex').slice(0, 32);
}
// Expose token generation for use in GET /api/agents/:id/token
(global as any).__deriveAgentToken = deriveAgentToken;

// Middleware für Experten-Authentifizierung
const agentAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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
  const providedToken = authHeader.slice(7); // strip "Bearer "
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

  // Attach verified agent info to request
  (req as any).expert = expert;
  req.body.agentId = expertId;
  req.body.companyId = unternehmenId;
  next();
};

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

// ===== On-Demand Wakeup Endpoint =====
// Manuelles Aufwecken eines Agenten über das Dashboard
app.post('/api/agents/:id/wakeup', async (req, res) => {
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

// ===== Agent Performance (Self-Evolving Agents) =====
app.get('/api/agents/:id/performance', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days as string) || 30));
    const { getAgentPerformance } = await import('./services/agent-performance.js');
    const result = getAgentPerformance(req.params.id, days);
    if (!result) return res.status(404).json({ error: 'Agent not found' });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/companies/:id/performance/leaderboard', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days as string) || 30));
    const { getCompanyLeaderboard } = await import('./services/agent-performance.js');
    res.json({ days, agents: getCompanyLeaderboard(req.params.id, days) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Inbox Endpoint - Agent fetches assigned tasks =====
app.get('/api/agents/:id/inbox', (req, res) => {
  const expertId = req.params.id as string;
  const unternehmenId = req.query.unternehmenId as string;

  if (!unternehmenId) {
    return res.status(400).json({ error: 'unternehmenId query parameter is required' });
  }

  // Verify expert exists and belongs to company
  const expert = db.select()
    .from(agents)
    .where(and(eq(agents.id, expertId), eq(agents.companyId, unternehmenId)))
    .get();

  if (!expert) {
    return res.status(404).json({ error: 'Expert not found or does not belong to company' });
  }

  // Check if expert is paused or terminated
  if (expert.status === 'paused' || expert.status === 'terminated') {
    return res.status(403).json({ error: 'Expert is paused or terminated', status: expert.status });
  }

  // Get assigned tasks that are not done
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
        inArray(tasks.status, ['backlog', 'todo', 'in_progress', 'blocked'])
      )
    )
    .all();

  res.json({
    expertId,
    unternehmenId,
    inbox: assignedTasks,
    count: assignedTasks.length,
  });
});

// ===== Team Status Endpoint - Orchestrator fetches team overview =====
app.get('/api/agents/:id/team-status', authMiddleware, (req, res) => {
  const expertId = req.params.id as string;
  const unternehmenId = (req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;

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
app.get('/api/companies/:unternehmenId/dashboard', (req, res) => {
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
// ZIELE (Goals)
// =============================================
app.get('/api/companies/:unternehmenId/goals', authMiddleware, (req, res) => {
  const result = db.select().from(goals)
    .where(eq(goals.companyId, req.params.unternehmenId as string))
    .orderBy(asc(goals.createdAt))
    .all();
  res.json(result);
});

app.post('/api/companies/:unternehmenId/goals', authMiddleware, (req, res) => {
  const uid = req.params.unternehmenId as string;
  const b = req.body as any;
  const titel = b.titel || b.title;
  const { ebene, parentId, status, fortschritt } = b;
  const beschreibung = b.beschreibung || b.description;
  if (!titel?.trim()) return res.status(400).json({ error: 'Title missing' });
  const id = uuid();
  const ts = now();
  db.insert(goals).values({
    id, companyId: uid,
    title: titel.trim(),
    description: beschreibung || null,
    level: (ebene || 'company') as any,
    parentId: parentId || null,
    status: (status || 'planned') as any,
    progress: Math.max(0, Math.min(100, Number(fortschritt ?? 0))),
    createdAt: ts, updatedAt: ts,
  }).run();
  logAktivitaet(uid, 'board', 'board', 'Board', `Ziel erstellt: "${titel.trim()}"`, 'companies', uid);
  res.status(201).json(db.select().from(goals).where(eq(goals.id, id)).get());
});

app.patch('/api/goals/:id', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const goal = db.select().from(goals).where(eq(goals.id, id)).get() as any;
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const { titel, beschreibung, status, ebene, fortschritt } = req.body;
  db.update(goals).set({
    ...(titel !== undefined ? { title: titel } : {}),
    ...(beschreibung !== undefined ? { description: beschreibung } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(ebene !== undefined ? { level: ebene } : {}),
    ...(fortschritt !== undefined ? { progress: Math.max(0, Math.min(100, Number(fortschritt))) } : {}),
    updatedAt: now(),
  }).where(eq(goals.id, id)).run();
  res.json(db.select().from(goals).where(eq(goals.id, id)).get());
});

app.delete('/api/goals/:id', authMiddleware, (req, res) => {
  db.delete(goals).where(eq(goals.id, req.params.id as string)).run();
  res.json({ ok: true });
});

// =============================================
// ROUTINEN (Autonomous Agents Phase 1)
// =============================================
app.get('/api/companies/:unternehmenId/routines', (req, res) => {
  const result = db.select().from(routines)
    .where(eq(routines.companyId, req.params.unternehmenId))
    .all();
  res.json(result);
});

app.post('/api/companies/:unternehmenId/routines', (req, res) => {
  const b = req.body as any;
  const titel = b.titel || b.title;
  const beschreibung = b.beschreibung || b.description;
  const { zugewiesenAn, prioritaet, variablen } = b;
  if (!titel) return res.status(400).json({ error: 'Title required' });

  const id = uuid();
  db.insert(routines).values({
    id,
    companyId: req.params.unternehmenId,
    title: titel,
    description: beschreibung,
    assignedTo: zugewiesenAn || null,
    priority: prioritaet || 'medium',
    status: 'active',
    variables: variablen ? JSON.stringify(variablen) : null,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  const routine = db.select().from(routines).where(eq(routines.id, id)).get();
  logAktivitaet(req.params.unternehmenId, 'board', 'board', 'Board', `hat Routine „${titel}" erstellt`, 'routine', id);
  res.status(201).json(routine);
});

app.get('/api/routines/:id', (req, res) => {
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  res.json(routine);
});

app.patch('/api/routines/:id', (req, res) => {
  const updates: any = { updatedAt: now() };
  const allowed: [string, string][] = [
    ['titel', 'title'],
    ['beschreibung', 'description'],
    ['zugewiesenAn', 'assignedTo'],
    ['prioritaet', 'priority'],
    ['status', 'status'],
    ['variablen', 'variables'],
  ];
  for (const [bodyKey, dbKey] of allowed) {
    if (req.body[bodyKey] !== undefined) updates[dbKey] = req.body[bodyKey];
  }

  db.update(routines).set(updates).where(eq(routines.id, req.params.id as string)).run();
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  res.json(routine);
});

app.delete('/api/routines/:id', (req, res) => {
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });
  db.delete(routines).where(eq(routines.id, req.params.id as string)).run();
  logAktivitaet(routine.companyId, 'board', 'board', 'Board', `hat Routine „${routine.title}" gelöscht`, 'routine', routine.id);
  res.json({ success: true });
});

// =============================================
// ROUTINE TRIGGER
// =============================================
app.get('/api/routines/:routineId/triggers', (req, res) => {
  const result = db.select().from(routineTrigger)
    .where(eq(routineTrigger.routineId, req.params.routineId))
    .all();
  res.json(result);
});

app.post('/api/routines/:routineId/triggers', (req, res) => {
  const { kind, cronExpression, timezone, aktiv } = req.body;
  if (!kind) return res.status(400).json({ error: 'Trigger type required' });
  if (kind === 'schedule' && !cronExpression) {
    return res.status(400).json({ error: 'Cron expression required' });
  }

  const routine = db.select().from(routines).where(eq(routines.id, req.params.routineId)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });

  const id = uuid();
  const publicId = kind === 'webhook' ? uuid() : null;
  const secretId = kind === 'webhook' ? uuid() : null;

  db.insert(routineTrigger).values({
    id,
    companyId: routine.companyId,
    routineId: req.params.routineId,
    kind,
    cronExpression: cronExpression || null,
    timezone: timezone || 'UTC',
    active: aktiv !== false,
    publicId,
    secretId,
    createdAt: now(),
  }).run();

  // Calculate next run time for schedule triggers
  if (kind === 'schedule' && cronExpression) {
    const nextRun = cronService.nextCronTick(cronExpression);
    if (nextRun) {
      db.update(routineTrigger).set({ nextExecutionAt: nextRun.toISOString() })
        .where(eq(routineTrigger.id, id)).run();
    }
  }

  const trigger = db.select().from(routineTrigger).where(eq(routineTrigger.id, id)).get();
  logAktivitaet(routine.companyId, 'board', 'board', 'Board', `hat Trigger für Routine „${routine.title}" erstellt`, 'routine_trigger', id);
  res.status(201).json(trigger);
});

app.patch('/api/triggers/:id', (req, res) => {
  const updates: any = { updatedAt: now() };
  const allowed: [string, string][] = [
    ['aktiv', 'active'],
    ['cronExpression', 'cronExpression'],
    ['timezone', 'timezone'],
  ];
  for (const [bodyKey, dbKey] of allowed) {
    if (req.body[bodyKey] !== undefined) updates[dbKey] = req.body[bodyKey];
  }

  const trigger = db.select().from(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).get();
  if (!trigger) return res.status(404).json({ error: 'Trigger not found' });

  // Recalculate next run time if cron expression changed
  if (updates.cronExpression && trigger.kind === 'schedule') {
    const nextRun = cronService.nextCronTick(updates.cronExpression);
    updates.nextExecutionAt = nextRun?.toISOString() || null;
  }

  db.update(routineTrigger).set(updates).where(eq(routineTrigger.id, req.params.id as string)).run();
  const updated = db.select().from(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).get();
  res.json(updated);
});

app.delete('/api/triggers/:id', (req, res) => {
  const trigger = db.select().from(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).get();
  if (!trigger) return res.status(404).json({ error: 'Trigger not found' });
  db.delete(routineTrigger).where(eq(routineTrigger.id, req.params.id as string)).run();
  res.json({ success: true });
});

// =============================================
// ROUTINE AUSFÜHRUNGEN
// =============================================
app.get('/api/routines/:routineId/ausfuehrungen', (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const result = db.select().from(routineRuns)
    .where(eq(routineRuns.routineId, req.params.routineId))
    .orderBy(desc(routineRuns.createdAt))
    .limit(limit)
    .all();
  res.json(result);
});

app.post('/api/routines/:id/trigger', (req, res) => {
  // Manual trigger for a routine
  const routine = db.select().from(routines).where(eq(routines.id, req.params.id as string)).get();
  if (!routine) return res.status(404).json({ error: 'Routine not found' });

  const executionId = uuid();
  db.insert(routineRuns).values({
    id: executionId,
    companyId: routine.companyId,
    routineId: req.params.id,
    source: 'manual',
    status: 'enqueued',
    payload: req.body.payload ? JSON.stringify(req.body.payload) : null,
    createdAt: now(),
  }).run();

  // Queue wakeup for assigned agent
  if (routine.assignedTo) {
    wakeupService.wakeup(routine.assignedTo, routine.companyId, {
      source: 'on_demand',
      triggerDetail: 'manual',
      reason: `Manuelle Ausführung: ${routine.title}`,
      payload: { routineId: req.params.id, executionId },
      contextSnapshot: { source: 'manual_routine_trigger', routineId: req.params.id, executionId },
    }).catch(console.error);
  }

  const execution = db.select().from(routineRuns).where(eq(routineRuns.id, executionId)).get();
  res.status(201).json(execution);
});

// =============================================
// WORKSPACES (Isolation via git worktree)
// =============================================
app.get('/api/companies/:id/workspaces', (req, res) => {
  try {
    res.json(listeWorkspaces(req.params.id as string));
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.post('/api/tasks/:id/workspace', (req, res) => {
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

app.post('/api/workspaces/:id/close', (req, res) => {
  try {
    schliesseWorkspace(req.params.id as string);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

app.delete('/api/workspaces/:id', (req, res) => {
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

// Plugin Registry — browse, install, uninstall
app.get('/api/plugin-registry', authMiddleware, async (req, res) => {
  try {
    const { fetchRegistry, listInstalled } = await import('./services/plugin-registry.js');
    const url = (req.query.url as string) || undefined;
    const manifest = await fetchRegistry(url);
    const installed = new Set(listInstalled().map(x => x.id));
    res.json({
      plugins: manifest.plugins.map(p => ({ ...p, installed: installed.has(p.id) })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/plugin-registry/installed', authMiddleware, async (_req, res) => {
  try {
    const { listInstalled } = await import('./services/plugin-registry.js');
    res.json({ installed: listInstalled() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/plugin-registry/install', authMiddleware, async (req, res) => {
  try {
    const entry = req.body;
    if (!entry || !entry.id || !entry.source) {
      return res.status(400).json({ error: 'entry with id and source required' });
    }
    const { installPlugin } = await import('./services/plugin-registry.js');
    const result = await installPlugin(entry);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/plugin-registry/uninstall', authMiddleware, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { uninstallPlugin } = await import('./services/plugin-registry.js');
    await uninstallPlugin(id);
    res.json({ uninstalled: id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

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
// SKILLS (Phase 3)
// =============================================
app.get('/api/skills', async (_req, res) => {
  try {
    const skills = await skillsService.getAllSkills();
    res.json(skills);
  } catch (error) {
    console.error('Failed to get skills:', error);
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

app.get('/api/skills/categories', (_req, res) => {
  res.json(skillsService.getSkillCategories());
});

app.get('/api/agents/:id/skills', async (req, res) => {
  try {
    const skills = await skillsService.getAgentSkills(req.params.id as string);
    res.json(skills);
  } catch (error) {
    console.error('Failed to get agent skills:', error);
    res.status(500).json({ error: 'Failed to get agent skills' });
  }
});

app.post('/api/agents/:id/skills', async (req, res) => {
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

app.delete('/api/agents/:id/skills/:skillId', async (req, res) => {
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
app.post('/api/agents/:id/export-soul', authMiddleware, async (req, res) => {
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
app.get('/api/agents/:id/soul', authMiddleware, (req, res) => {
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
app.put('/api/agents/:id/soul', authMiddleware, (req, res) => {
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
app.post('/api/agents/:id/soul/generate', authMiddleware, async (req, res) => {
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

// Skill-based agent matching for tasks
app.post('/api/tasks/match-agent', async (req, res) => {
  const { unternehmenId, titel, beschreibung } = req.body;
  if (!unternehmenId || !titel) {
    return res.status(400).json({ error: 'unternehmenId and titel are required' });
  }

  try {
    const match = await skillsService.findBestAgentForTask(
      unternehmenId,
      titel,
      beschreibung || null
    );
    res.json({
      match,
      message: match
        ? `Best match: ${match.agentName} (${match.matchScore}% match)`
        : 'No matching agent found',
    });
  } catch (error) {
    console.error('Failed to match agent:', error);
    res.status(500).json({ error: 'Failed to match agent' });
  }
});

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
  const wert = (req.body.value ?? '') as string;

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
// R E S E T  E N D P O I N T S
// =============================================

// DELETE /api/companies/:id — löscht ein Unternehmen inkl. aller abhängigen Daten
app.delete('/api/companies/:id', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const company = db.select().from(companies).where(eq(companies.id, id)).get();
  if (!company) return res.status(404).json({ error: 'Company not found' });
 
  // Get all experts for this company to cleanup expert-specific mappings
  const expertIds = db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, id)).all().map((e: any) => e.id);

  // Da wir zirkuläre Abhängigkeiten haben (z.B. Experten -> reportsTo -> Experten) 
  // und die manuelle Sortierung der Löschvorgänge extrem fehleranfällig ist,
  // schalten wir die Foreign-Key-Checks kurzzeitig aus (AUSSERHALB der Transaktion).
  try {
    sqlite.exec('PRAGMA foreign_keys = OFF');
    
    const runPurge = sqlite.transaction(() => {
      // 1. Zuerst Tabellen löschen, die auf andere Tabellen (außer Unternehmen) verweisen
      db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, id)).run();
      db.delete(workProducts).where(eq(workProducts.companyId, id)).run();
      db.delete(traceEvents).where(eq(traceEvents.companyId, id)).run();
      db.delete(routineRuns).where(eq(routineRuns.companyId, id)).run();
      db.delete(costEntries).where(eq(costEntries.companyId, id)).run();
      db.delete(comments).where(eq(comments.companyId, id)).run();
      
      // 2. Dann Tabellen, die die obigen referenzieren könnten
      db.delete(workCycles).where(eq(workCycles.companyId, id)).run();
      db.delete(approvals).where(eq(approvals.companyId, id)).run();
      db.delete(routineTrigger).where(eq(routineTrigger.companyId, id)).run();
      db.delete(routines).where(eq(routines.companyId, id)).run();
      db.delete(tasks).where(eq(tasks.companyId, id)).run();
      db.delete(projects).where(eq(projects.companyId, id)).run();
      db.delete(goals).where(eq(goals.companyId, id)).run();
      
      // 3. Dann die restlichen Unternehmens-Daten
      // agentGedaechtnis (PARA) entfernt — Memory ist jetzt nativ in SQLite gespeichert
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

// DELETE /api/companies/:id/reset — löscht alle Daten des Unternehmens außer dem Unternehmen selbst
app.delete('/api/companies/:id/reset', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const company = db.select().from(companies).where(eq(companies.id, id)).get();
  if (!company) return res.status(404).json({ error: 'Company not found' });

  // Delete in correct FK order — leaf tables first, then parents.
  // SQLite FK enforcement is ON so order matters.
  // sqlite is the raw better-sqlite3 instance — always use ? params, never interpolate.
  const execRaw = (sql: string, params: unknown[] = []) => {
    try { sqlite?.prepare(sql).run(...params); } catch { /* ignore missing tables on older DBs */ }
  };

  // Leaf tables referencing agents (must go before agents)
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

// DELETE /api/system/factory-reset — alles löschen (außer Benutzer-Account bleibt, aber Unternehmen + alles weg)
app.delete('/api/system/factory-reset', authMiddleware, (req, res) => {
  const execAll = (sql: string) => { try { sqlite?.prepare(sql).run(); } catch { /* ignore */ } };
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

  console.log('🔴 Factory Reset durchgeführt');
  res.json({ ok: true });
});

// =============================================
// M I T A R B E I T E R - C H A T  (CEOs -> Agent)
// =============================================
function handleChatGet(req: express.Request, res: express.Response) {
  const id = req.params.id as string;
  const unternehmenId = (req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
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
  const unternehmenId = (req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id'] || req.body.unternehmenId || req.body.companyId) as string;
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
app.get('/api/agents/:id/chat', handleChatGet);
app.post('/api/agents/:id/chat', handleChatPost);

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

app.post('/api/agents/:id/chat/direct', async (req: express.Request, res: express.Response) => {
  const expertId = req.params.id as string;
  const unternehmenId = (req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
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
      provider = 'openai'; // Poe is OpenAI-compatible
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
app.post('/api/agents/:id/chat/stream', authMiddleware, async (req: express.Request, res: express.Response) => {
  const expertId = req.params.id as string;
  const unternehmenId = (req.headers['x-company-id'] || req.headers['x-unternehmen-id'] || req.headers['x-firma-id']) as string;
  const { nachricht, image } = req.body; // image: { data: string (base64), mimeType: string }
  if (!unternehmenId || !nachricht) return res.status(400).json({ error: 'Missing parameters' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (type: string, payload: Record<string, unknown>) => {
    try { res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); } catch {}
  };

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
    provider = 'openai'; // Poe is OpenAI-compatible
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

  const systemPrompt = `${expert.systemPrompt ? expert.systemPrompt + '\n\n' : ''}${isEn ? `You are ${expert.name}, ${expert.role} at ${unternehmenData.name}.` : `Du bist ${expert.name}, ${expert.role} bei ${unternehmenData.name}.`}
${unternehmenData.goal ? (isEn ? `Company goal: ${unternehmenData.goal}` : `Unternehmensziel: ${unternehmenData.goal}`) : ''}
${teamMembers.length > 0 ? (isEn ? `Direct reports: ${teamMembers.map(m => m.name).join(', ')}` : `Direkte Berichte: ${teamMembers.map(m => m.name).join(', ')}`) : ''}
${supervisor ? (isEn ? `Supervisor: ${supervisor.name}` : `Vorgesetzter: ${supervisor.name}`) : ''}
${openTasks.length > 0 ? (isEn ? `Active tasks: ${openTasks.map(t => t.title).join(', ')}` : `Aktive Tasks: ${openTasks.map(t => t.title).join(', ')}`) : ''}
${memoryContext}${configCtx}
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

  try {
    if (provider === 'anthropic') {
      // Build user content (text + optional image)
      const userContent: any[] = [];
      if (image?.data && image?.mimeType) {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } });
      }
      userContent.push({ type: 'text', text: nachricht });

      const msgs = [...history, { role: 'user' as const, content: userContent }];
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
                emit('thinking_delta', { text: ev.delta.thinking });
              } else if (ev.delta?.type === 'text_delta') {
                fullReply += ev.delta.text;
                emit('text_delta', { text: ev.delta.text });
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

      const msgs = [...history, { role: 'user', content: image ? userContent : nachricht }];
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
            if (token) { fullReply += token; emit('text_delta', { text: token }); }
          } catch {}
        }
      }
    }
  } catch (err: any) {
    emit('error', { message: err.message || 'LLM error' });
    return res.end();
  }

  // Execute [ACTION] blocks and replace them inline with their results
  let finalReply = fullReply;
  if (fullReply) {
    finalReply = fullReply.replace(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/g, (_m, json) => {
      try {
        const a = JSON.parse(json);
        const r = executeConfigAction(a, unternehmenId);
        return r || '';
      } catch (e: any) {
        return `❌ Action-Parse-Fehler: ${e.message?.slice(0, 80) || 'invalid JSON'}`;
      }
    }).trim();

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

  emit('done', { fullReply: finalReply });
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
  if (['error', 'warning'].includes(typ) || titel.includes('Genehmigung')) {
    messagingService.notify(unternehmenId, titel, details, typ).catch(console.error);
  }
}

// Expose emitTrace for scheduler
export { emitTrace };

// SSE stream endpoint — accepts token as query param (EventSource limitation)
app.get('/api/agents/:id/trace', authMiddleware, (req, res) => {
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
app.get('/api/agents/:id/trace/history', async (req, res) => {
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

app.post('/api/companies/:id/briefing', authMiddleware, async (req, res) => {
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

app.post('/api/tasks/:id/decompose', authMiddleware, async (req, res) => {
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

app.get('/api/companies/:id/focus', authMiddleware, (req, res) => {
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
app.get('/api/companies/:id/focus-mode', authMiddleware, (req, res) => {
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
app.put('/api/companies/:id/focus-mode', authMiddleware, (req, res) => {
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

app.get('/api/companies/:id/weekly-report', authMiddleware, async (req, res) => {
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

app.post('/api/companies/:id/ask', authMiddleware, async (req, res) => {
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

app.post('/api/companies/:id/standup', authMiddleware, async (req, res) => {
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

app.get('/api/projects/:id/whiteboard', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const projekt = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });
  const state = projekt.whiteboardState ? JSON.parse(projekt.whiteboardState) : { eintraege: [], aktualisiertAm: null };
  res.json(state);
});

app.put('/api/projects/:id/whiteboard', authMiddleware, (req, res) => {
  const { inhalt, expertId } = req.body;
  if (!inhalt?.trim()) return res.status(400).json({ error: 'inhalt required' });

  const id = req.params.id as string;
  const projekt = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!projekt) return res.status(404).json({ error: 'Project not found' });

  const existing = projekt.whiteboardState ? JSON.parse(projekt.whiteboardState) : { eintraege: [] };
  const neuerEintrag = { id: uuid(), von: expertId ?? 'board', inhalt, erstelltAm: now() };
  existing.eintraege = [...(existing.eintraege ?? []), neuerEintrag];
  existing.updatedAt = now();

  db.update(projects).set({ whiteboardState: JSON.stringify(existing), updatedAt: now() }).where(eq(projects.id, id)).run();
  broadcastUpdate('whiteboard_update', { projektId: id, eintrag: neuerEintrag });
  res.json(neuerEintrag);
});

app.delete('/api/projects/:id/whiteboard', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  db.update(projects).set({ whiteboardState: JSON.stringify({ entries: [], updatedAt: now() }), updatedAt: now() }).where(eq(projects.id, id)).run();
  broadcastUpdate('whiteboard_cleared', { projektId: req.params.id });
  res.json({ ok: true });
});

// =============================================
// AGENT MEETINGS — Multi-Agent Coordination
// =============================================

app.get('/api/companies/:id/meetings', authMiddleware, (req, res) => {
  try {
    const meetings = db.select().from(agentMeetings)
      .where(eq(agentMeetings.companyId, req.params.id as string))
      .all()
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));

    // Enrich with participant names
    const all_agents = db.select({ id: agents.id, name: agents.name, avatarFarbe: agents.avatarColor, verbindungsTyp: agents.connectionType, verbindungsConfig: agents.connectionConfig })
      .from(agents).where(eq(agents.companyId, req.params.id as string)).all();

    function deriveModelLabel(verbindungsTyp: string, verbindungsConfig: string | null): string {
      try {
        const cfg = JSON.parse(verbindungsConfig || '{}');
        if (cfg.model) return cfg.model.split('/').pop()?.split(':')[0] || cfg.model;
      } catch {}
      const labels: Record<string, string> = {
        anthropic: 'Claude', openai: 'GPT-4o', openrouter: 'OpenRouter',
        ollama: 'Ollama', groq: 'Groq', gemini: 'Gemini', custom: 'Custom',
        ceo: 'CEO', 'claude-code': 'Claude Code',
      };
      return labels[verbindungsTyp] || verbindungsTyp;
    }

    const agentMap = Object.fromEntries((all_agents as any[]).map(a => [a.id, {
      ...a,
      modellLabel: deriveModelLabel(a.connectionType, a.connectionConfig),
    }]));

    const enriched = meetings.map((m: any) => {
      let teilnehmerIds: string[] = [];
      let antworten: Record<string, string> = {};
      try { teilnehmerIds = JSON.parse(m.participantIds || '[]'); } catch {}
      try { antworten = JSON.parse(m.responses || '{}'); } catch {}
      return {
        ...m,
        veranstalter: agentMap[m.organizerAgentId] || null,
        teilnehmer: teilnehmerIds.map(id => {
          if (id === '__board__') return {
            id: '__board__', name: 'Du (Board)', avatarFarbe: '#6366f1', isBoard: true,
            hatGeantwortet: !!antworten[id], antwort: antworten[id] || null,
          };
          const agent = agentMap[id] || { id, name: id };
          return { ...agent, hatGeantwortet: !!antworten[id], antwort: antworten[id] || null };
        }),
      };
    });

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meetings/:id', authMiddleware, (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const all_agents = db.select({ id: agents.id, name: agents.name, avatarFarbe: agents.avatarColor })
      .from(agents).where(eq(agents.companyId, meeting.companyId)).all();
    const agentMap = Object.fromEntries((all_agents as any[]).map(a => [a.id, a]));
    let teilnehmerIds: string[] = [];
    let antworten: Record<string, string> = {};
    try { teilnehmerIds = JSON.parse(meeting.participantIds || '[]'); } catch {}
    try { antworten = JSON.parse(meeting.responses || '{}'); } catch {}

    res.json({
      ...meeting,
      veranstalter: agentMap[meeting.organizerAgentId] || null,
      teilnehmer: teilnehmerIds.map(id => {
        if (id === '__board__') return {
          id: '__board__', name: 'Du (Board)', avatarFarbe: '#6366f1', isBoard: true,
          hatGeantwortet: !!antworten[id], antwort: antworten[id] || null,
        };
        return { ...(agentMap[id] || { id, name: id }), hatGeantwortet: !!antworten[id], antwort: antworten[id] || null };
      }),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/meetings/:id/message', authMiddleware, async (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status !== 'running') return res.status(400).json({ error: 'Meeting is not active' });

    const { nachricht } = req.body;
    if (!nachricht?.trim()) return res.status(400).json({ error: 'Message missing' });

    const BOARD_KEY = '__board__';
    let teilnehmerIds: string[] = [];
    let antworten: Record<string, string> = {};
    try { teilnehmerIds = JSON.parse(meeting.participantIds || '[]'); } catch {}
    try { antworten = JSON.parse(meeting.responses || '{}'); } catch {}

    // Append board message (allow multiple messages via timestamp key)
    const boardMsgKey = `${BOARD_KEY}_${Date.now()}`;
    if (!teilnehmerIds.includes(BOARD_KEY)) teilnehmerIds.push(BOARD_KEY);
    antworten[boardMsgKey] = nachricht.trim();
    antworten[BOARD_KEY] = nachricht.trim(); // latest board message always at __board__

    db.update(agentMeetings).set({
      participantIds: JSON.stringify(teilnehmerIds),
      responses: JSON.stringify(antworten),
    }).where(eq(agentMeetings.id, req.params.id as string)).run();

    broadcastUpdate('meeting_updated', { unternehmenId: meeting.companyId, meetingId: req.params.id });
    res.json({ success: true });

    // ── Trigger @mentioned agents, or all unanswered participants ─────────
    const agentParticipants = teilnehmerIds
      .filter(id => id !== BOARD_KEY && !id.startsWith('__board__'))
      .map(id => db.select().from(agents).where(eq(agents.id, id)).get())
      .filter(Boolean) as any[];

    // Detect @mentions: "@Name" anywhere in message
    const mentioned = agentParticipants.filter(a =>
      new RegExp(`@${a.name.split(' ')[0]}`, 'i').test(nachricht)
    );
    const toTrigger = mentioned.length > 0
      ? mentioned
      : agentParticipants.filter(a => !antworten[a.id]); // unanswered only

    console.log(`[Meeting] Board message → waking ${toTrigger.length} agents: ${toTrigger.map((a: any) => a.name).join(', ')}`);
    toTrigger.forEach((agent: any, idx: number) => {
      setTimeout(async () => {
        try {
          console.log(`[Meeting] Triggering ${agent.name} (${agent.id}) for meeting ${req.params.id}`);
          // Send board message into this agent's chat
          const boardMsg = {
            id: uuid(), companyId: meeting.companyId,
            agentId: agent.id, vonExpertId: null, threadId: req.params.id,
            senderType: 'board' as const,
            message: `[Meeting Board]: ${nachricht.trim()}`,
            read: false, createdAt: now(),
          };
          db.insert(chatMessages).values(boardMsg).run();
          broadcastUpdate('chat_message', boardMsg);
          await scheduler.triggerZyklus(agent.id, meeting.companyId, 'manual', undefined, req.params.id as string);
          console.log(`[Meeting] ${agent.name} cycle done`);
        } catch (e: any) {
          console.error(`[Meeting] triggerZyklus error for agent ${agent.id} (${agent.name}):`, e?.message);
        }
      }, idx * 600);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/meetings/:id/cancel', authMiddleware, (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status !== 'running') return res.status(400).json({ error: 'Meeting is not active' });
    db.update(agentMeetings).set({ status: 'cancelled', completedAt: now() }).where(eq(agentMeetings.id, req.params.id as string)).run();
    broadcastUpdate('meeting_updated', { unternehmenId: meeting.companyId, meetingId: req.params.id, status: 'cancelled' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Create a new meeting ─────────────────────────────────────────────────────
app.post('/api/companies/:id/meetings', authMiddleware, (req, res) => {
  try {
    const unternehmenId = req.params.id as string;
    const { titel, veranstalterExpertId, teilnehmerIds } = req.body as {
      titel: string; veranstalterExpertId: string; teilnehmerIds: string[];
    };

    if (!titel?.trim()) return res.status(400).json({ error: 'Title missing' });
    if (!veranstalterExpertId) return res.status(400).json({ error: 'Organizer missing' });
    if (!Array.isArray(teilnehmerIds) || teilnehmerIds.length === 0) {
      return res.status(400).json({ error: 'At least one participant required' });
    }

    // Validate veranstalter belongs to company
    const veranstalter = db.select().from(agents)
      .where(and(eq(agents.id, veranstalterExpertId), eq(agents.companyId, unternehmenId))).get();
    if (!veranstalter) return res.status(404).json({ error: 'Organizer agent not found' });

    const meetingId = uuid();
    // Always include __board__ as a participant so the board can reply
    const alleTeilnehmer = [...new Set([...teilnehmerIds.filter(id => id !== veranstalterExpertId), '__board__'])];

    db.insert(agentMeetings).values({
      id: meetingId,
      companyId: unternehmenId,
      title: titel.trim(),
      organizerAgentId: veranstalterExpertId,
      participantIds: JSON.stringify(alleTeilnehmer),
      responses: '{}',
      status: 'running',
      createdAt: now(),
    }).run();

    logAktivitaet(unternehmenId, 'agent', veranstalterExpertId, (veranstalter as any).name, `hat ein Meeting gestartet: "${titel.trim()}"`, 'experte', meetingId);
    broadcastUpdate('meeting_created', { unternehmenId, meetingId });
    res.status(201).json({ id: meetingId });

    // ── Wake up each agent participant (non-blocking, staggered) ──────────
    const agentTeilnehmer = alleTeilnehmer.filter(id => id !== '__board__');
    agentTeilnehmer.forEach((teilnehmerId, idx) => {
      setTimeout(async () => {
        try {
          // Send the meeting question as a chat message to this agent
          const frageMsg = {
            id: uuid(), companyId: unternehmenId,
            agentId: teilnehmerId,
            vonExpertId: veranstalterExpertId,
            threadId: meetingId,
            senderType: 'agent' as const,
            absenderName: (veranstalter as any).name,
            message: `📋 **Meeting einberufen**\n\nThema: "${titel.trim()}"\n\nBitte antworte kurz und direkt.`,
            read: false, createdAt: now(),
          };
          db.insert(chatMessages).values(frageMsg).run();
          broadcastUpdate('chat_message', frageMsg);
          await scheduler.triggerZyklus(teilnehmerId, unternehmenId, 'manual', veranstalterExpertId, meetingId);
        } catch (e) {
          console.error(`[Meeting] Fehler beim Starten von Agent ${teilnehmerId}:`, e);
        }
      }, idx * 800);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Close a meeting with synthesis ──────────────────────────────────────────
app.post('/api/meetings/:id/complete', authMiddleware, (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const { ergebnis } = req.body as { ergebnis: string };
    db.update(agentMeetings).set({
      status: 'completed',
      result: ergebnis?.trim() || null,
      completedAt: now(),
    }).where(eq(agentMeetings.id, req.params.id as string)).run();
    broadcastUpdate('meeting_updated', { unternehmenId: meeting.companyId, meetingId: req.params.id, status: 'completed' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/meetings/:id', authMiddleware, (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status === 'running') return res.status(400).json({ error: 'Running meetings cannot be deleted' });
    db.delete(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).run();
    broadcastUpdate('meeting_deleted', { unternehmenId: meeting.companyId, meetingId: req.params.id });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =============================================
// SKILL LIBRARY — markdown knowledge base
// =============================================

function mapSkillToDe(skill: any) {
  return {
    id: skill.id,
    unternehmenId: skill.companyId,
    name: skill.name,
    beschreibung: skill.description,
    inhalt: skill.content,
    tags: skill.tags,
    erstelltVon: skill.createdBy,
    konfidenz: skill.confidence,
    nutzungen: skill.uses,
    erfolge: skill.successes,
    quelle: skill.source,
    remoteRef: skill.remoteRef,
    erstelltAm: skill.createdAt,
    aktualisiertAm: skill.updatedAt,
  };
}

app.get('/api/companies/:unternehmenId/skills-library', authMiddleware, (req, res) => {
  const unternehmenId = req.params.unternehmenId as string;
  const skills = db.select().from(skillsLibrary)
    .where(eq(skillsLibrary.companyId, unternehmenId))
    .orderBy(desc(skillsLibrary.createdAt)).all();
  res.json(skills.map(mapSkillToDe));
});

app.post('/api/companies/:unternehmenId/skills-library', authMiddleware, (req, res) => {
  const { name, beschreibung, inhalt, tags } = req.body;
  if (!name?.trim() || !inhalt?.trim()) return res.status(400).json({ error: 'name and inhalt required' });
  const id = uuid();
  const n = now();
  const companyId = req.params.unternehmenId as string;
  db.insert(skillsLibrary).values({
    id, companyId, name, description: beschreibung ?? null,
    content: inhalt, tags: tags ? JSON.stringify(tags) : null,
    createdBy: (req as any).user?.userId ?? null, createdAt: n, updatedAt: n,
  }).run();
  res.status(201).json({ id, name });
});

app.get('/api/skills-library/:id', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const skill = db.select().from(skillsLibrary).where(eq(skillsLibrary.id, id)).get();
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  res.json(mapSkillToDe(skill));
});

app.patch('/api/skills-library/:id', authMiddleware, (req, res) => {
  const { name, beschreibung, inhalt, tags } = req.body;
  const updates: any = { updatedAt: now() };
  if (name !== undefined) updates.name = name;
  if (beschreibung !== undefined) updates.description = beschreibung;
  if (inhalt !== undefined) updates.content = inhalt;
  if (tags !== undefined) updates.tags = JSON.stringify(tags);
  const id = req.params.id as string;
  db.update(skillsLibrary).set(updates).where(eq(skillsLibrary.id, id)).run();
  res.json({ ok: true });
});

app.delete('/api/skills-library/:id', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  db.delete(agentSkills).where(eq(agentSkills.skillId, id)).run();
  db.delete(skillsLibrary).where(eq(skillsLibrary.id, id)).run();
  res.json({ ok: true });
});

// ── Seed Standard Skill Library ──────────────────────────────────────────────
app.post('/api/companies/:unternehmenId/skills-library/seed', authMiddleware, (req, res) => {
  const unternehmenId = req.params.unternehmenId as string;
  const n = now();

  const SEED_SKILLS: Array<{ name: string; beschreibung: string; inhalt: string; tags: string[] }> = [
    // Development
    { name: 'JavaScript / TypeScript', beschreibung: 'JS & TS Entwicklung, Node.js, moderne ES-Features', inhalt: `# JavaScript / TypeScript\n\n## Fähigkeiten\n- Moderne JS/TS Entwicklung (ES2023+, async/await, Decorators)\n- Node.js Backend-Services, REST APIs\n- Typsichere Codebases mit TypeScript\n- Bundling mit Vite, esbuild, webpack\n- Package Management mit npm/pnpm/yarn\n\n## Typische Aufgaben\n- API-Endpunkte implementieren\n- Bibliotheken und Module erstellen\n- TypeScript-Typen definieren und refactoren\n- Performance-Optimierungen\n\n## Tools\ntsc, ts-node, tsx, eslint, prettier`, tags: ['javascript', 'typescript', 'nodejs', 'js', 'ts'] },
    { name: 'Python', beschreibung: 'Python Entwicklung, Scripting, Automatisierung', inhalt: `# Python\n\n## Fähigkeiten\n- Python 3.x Entwicklung\n- Scripting und Automatisierung\n- Frameworks: FastAPI, Flask, Django\n- Datenverarbeitung mit pandas, numpy\n- Async-Programmierung (asyncio)\n\n## Typische Aufgaben\n- CLI-Tools und Skripte schreiben\n- REST APIs mit FastAPI bauen\n- Daten verarbeiten und transformieren\n- Automatisierungen erstellen\n\n## Tools\npip, poetry, pytest, black, mypy`, tags: ['python', 'fastapi', 'scripting', 'automation'] },
    { name: 'Go (Golang)', beschreibung: 'Performante Backend-Services und CLI-Tools mit Go', inhalt: `# Go (Golang)\n\n## Fähigkeiten\n- Go für hochperformante Backend-Services\n- Goroutines und Channels für Concurrency\n- gRPC und Protocol Buffers\n- CLI-Tools mit cobra/urfave\n- Interfaces und Typsystem\n\n## Typische Aufgaben\n- Microservices entwickeln\n- CLI-Tools bauen\n- Concurrent Systeme entwerfen\n\n## Tools\ngo build, go test, golangci-lint, air`, tags: ['go', 'golang', 'backend', 'microservice'] },
    { name: 'Rust', beschreibung: 'Systemnahe, sichere Hochleistungs-Programmierung', inhalt: `# Rust\n\n## Fähigkeiten\n- Memory-sicheres Systems Programming\n- WebAssembly (WASM) Kompilierung\n- Async mit tokio\n- FFI und native Bindings\n- Zero-Cost Abstraktionen\n\n## Typische Aufgaben\n- Performance-kritische Komponenten\n- WASM-Module für Browser\n- CLI-Tools und native Apps\n\n## Tools\ncargo, rustfmt, clippy, wasm-pack`, tags: ['rust', 'wasm', 'systems', 'performance'] },
    { name: 'API Design', beschreibung: 'REST, GraphQL und gRPC API-Architektur', inhalt: `# API Design\n\n## Fähigkeiten\n- RESTful API Design nach OpenAPI 3.x\n- GraphQL Schema Design, Resolver, Subscriptions\n- gRPC mit Protocol Buffers\n- API-Versionierung und Deprecation\n- Rate Limiting, Auth, Pagination\n\n## Best Practices\n- Resource-orientiertes Design\n- Konsistente Fehlerformate\n- Dokumentation mit Swagger/Redoc\n- Backward Compatibility\n\n## Tools\nOpenAPI, Swagger, Postman, Insomnia, GraphQL Playground`, tags: ['api', 'rest', 'graphql', 'openapi', 'swagger'] },
    { name: 'Testing & QA', beschreibung: 'Unit, Integration und E2E Tests, TDD', inhalt: `# Testing & QA\n\n## Fähigkeiten\n- Unit Tests (Jest, Vitest, pytest, go test)\n- Integration Tests mit echten DBs\n- E2E Tests mit Playwright/Cypress\n- TDD und BDD Ansätze\n- Test Coverage und Reporting\n\n## Typische Aufgaben\n- Testsuiten aufbauen\n- Flaky Tests debuggen\n- CI-Integration von Tests\n- Code Coverage erhöhen\n\n## Tools\nJest, Vitest, Playwright, pytest, supertest`, tags: ['testing', 'qa', 'tdd', 'playwright', 'jest'] },
    { name: 'Code Refactoring', beschreibung: 'Clean Code, technische Schulden abbauen', inhalt: `# Code Refactoring\n\n## Fähigkeiten\n- Design Pattern anwenden (SOLID, DRY, KISS)\n- Legacy Code modernisieren\n- Komplexität reduzieren\n- Typsicherheit einführen\n- Abhängigkeiten entwirren\n\n## Typische Aufgaben\n- Code Reviews durchführen\n- Spaghetti-Code strukturieren\n- Technische Schulden dokumentieren und abbauen\n\n## Metriken\nCyclomatic Complexity, Coupling, Cohesion, DRY-Score`, tags: ['refactoring', 'clean code', 'code quality', 'review'] },
    // Frontend
    { name: 'React / Next.js', beschreibung: 'React Entwicklung, Hooks, Next.js App Router', inhalt: `# React / Next.js\n\n## Fähigkeiten\n- React 19, Server Components, Client Components\n- Next.js App Router, Server Actions\n- State Management: Zustand, Jotai, Redux Toolkit\n- React Query / SWR für Data Fetching\n- Performance: memo, useMemo, useCallback, lazy\n\n## Typische Aufgaben\n- Komponentenbibliotheken bauen\n- SSR/SSG Seiten implementieren\n- State-Architekturen designen\n\n## Tools\ncreate-next-app, Turbopack, React DevTools`, tags: ['react', 'nextjs', 'jsx', 'hooks', 'ssr'] },
    { name: 'Vue.js / Nuxt', beschreibung: 'Vue 3 Composition API, Nuxt.js', inhalt: `# Vue.js / Nuxt\n\n## Fähigkeiten\n- Vue 3 mit Composition API und \`<script setup>\`\n- Nuxt 3 für SSR/SSG\n- Pinia State Management\n- Vue Router\n- Vite als Build-Tool\n\n## Typische Aufgaben\n- SPAs und SSR-Apps bauen\n- Reactive Data Flows designen\n- Performance-Optimierung\n\n## Tools\nVue DevTools, Vite, Vitest, Nuxt Devtools`, tags: ['vue', 'nuxt', 'pinia', 'composition api'] },
    { name: 'React Native / Expo', beschreibung: 'Cross-Platform Mobile Apps', inhalt: `# React Native / Expo\n\n## Fähigkeiten\n- Expo SDK und Expo Router\n- Native Module und APIs (Kamera, GPS, Push)\n- React Native Animations (Reanimated 3)\n- OTA Updates mit EAS Update\n- App Store / Play Store Deployment\n\n## Typische Aufgaben\n- Mobile Apps von Grund auf bauen\n- Web-Code für Mobile portieren\n- Native Performance-Issues lösen\n\n## Tools\nExpo CLI, EAS CLI, Flipper, Metro`, tags: ['react native', 'expo', 'mobile', 'ios', 'android'] },
    { name: 'CSS & Tailwind', beschreibung: 'Modern CSS, Tailwind, Animationen, Responsive Design', inhalt: `# CSS & Tailwind\n\n## Fähigkeiten\n- Tailwind CSS v4 Utility-First\n- CSS Custom Properties und Themes\n- Glassmorphism, Neumorphism, moderne UI-Trends\n- Framer Motion Animationen\n- Container Queries, Grid, Flexbox\n- Dark Mode und Theme-Switching\n\n## Typische Aufgaben\n- Design-System implementieren\n- Responsive Layouts bauen\n- Animationen und Micro-Interactions\n\n## Tools\nTailwind CSS, PostCSS, shadcn/ui, Radix UI`, tags: ['css', 'tailwind', 'styling', 'animation', 'responsive'] },
    { name: 'Web Performance', beschreibung: 'Core Web Vitals, Bundle-Optimierung, Lighthouse', inhalt: `# Web Performance\n\n## Fähigkeiten\n- Core Web Vitals (LCP, INP, CLS)\n- Bundle Size Analyse und Reduction\n- Image Optimization (AVIF, WebP, lazy loading)\n- Code Splitting und Dynamic Imports\n- Edge Caching und CDN-Strategien\n\n## Typische Aufgaben\n- Lighthouse Score verbessern\n- Bundle analysieren und optimieren\n- Critical Rendering Path optimieren\n\n## Tools\nLighthouse, WebPageTest, Bundle Analyzer, Sentry Performance`, tags: ['performance', 'lighthouse', 'core web vitals', 'optimization'] },
    // DevOps
    { name: 'Docker & Container', beschreibung: 'Docker, Docker Compose, Multi-Stage Builds', inhalt: `# Docker & Container\n\n## Fähigkeiten\n- Dockerfile schreiben (Multi-Stage, Layer-Caching)\n- Docker Compose für lokale Entwicklung\n- Container Security (rootless, scan)\n- Registry Management (Docker Hub, GHCR, ECR)\n- Health Checks und Graceful Shutdown\n\n## Typische Aufgaben\n- Services containerisieren\n- Compose-Stacks aufsetzen\n- Images optimieren (Größe, Security)\n\n## Tools\nDocker CLI, Docker Desktop, Dive, Trivy`, tags: ['docker', 'container', 'compose', 'dockerfile'] },
    { name: 'Kubernetes (K8s)', beschreibung: 'K8s Orchestrierung, Helm, Deployment-Strategien', inhalt: `# Kubernetes\n\n## Fähigkeiten\n- Deployments, Services, Ingress, ConfigMaps, Secrets\n- Helm Charts erstellen und verwalten\n- Horizontal Pod Autoscaler (HPA)\n- Rolling Updates und Canary Deployments\n- RBAC und Namespace-Isolation\n\n## Typische Aufgaben\n- Cluster aufsetzen und warten\n- Helm Charts schreiben\n- Debugging mit kubectl logs/exec\n\n## Tools\nkubectl, Helm, k9s, Lens, ArgoCD`, tags: ['kubernetes', 'k8s', 'helm', 'kubectl', 'deployment'] },
    { name: 'CI/CD Pipelines', beschreibung: 'GitHub Actions, GitLab CI, automatisiertes Deployment', inhalt: `# CI/CD Pipelines\n\n## Fähigkeiten\n- GitHub Actions Workflows (matrix, cache, reusable)\n- GitLab CI/CD Pipelines\n- Test → Build → Deploy Automation\n- Secrets Management in Pipelines\n- Branch Strategies (GitFlow, trunk-based)\n\n## Typische Aufgaben\n- Pipeline für neues Projekt aufsetzen\n- Deployment-Prozess automatisieren\n- Pipeline-Performance optimieren\n\n## Tools\nGitHub Actions, GitLab CI, CircleCI, ArgoCD, Flux`, tags: ['ci/cd', 'github actions', 'gitlab ci', 'pipeline', 'automation'] },
    { name: 'AWS Cloud', beschreibung: 'Amazon Web Services: EC2, S3, Lambda, ECS, RDS', inhalt: `# AWS Cloud\n\n## Fähigkeiten\n- EC2, ECS, Lambda für Compute\n- S3, CloudFront für Storage/CDN\n- RDS, DynamoDB für Datenbanken\n- IAM, VPC, Security Groups\n- CloudFormation / CDK für Infrastructure as Code\n\n## Typische Aufgaben\n- Serverless Architekturen entwerfen\n- Kosten optimieren\n- Multi-Region Setups planen\n\n## Tools\nAWS CLI, CDK, SAM, Terraform`, tags: ['aws', 'amazon', 'ec2', 's3', 'lambda', 'cloud'] },
    { name: 'Monitoring & Observability', beschreibung: 'Logs, Metrics, Tracing, Grafana, Sentry', inhalt: `# Monitoring & Observability\n\n## Fähigkeiten\n- Strukturiertes Logging (JSON, Correlation IDs)\n- Metrics mit Prometheus + Grafana\n- Distributed Tracing (OpenTelemetry, Jaeger)\n- Error Tracking mit Sentry\n- Alerting und On-Call Runbooks\n\n## Typische Aufgaben\n- Observability-Stack aufsetzen\n- Dashboards für kritische Metriken bauen\n- SLOs und Alerting definieren\n\n## Tools\nGrafana, Prometheus, Sentry, Datadog, Loki`, tags: ['monitoring', 'observability', 'grafana', 'sentry', 'logging', 'tracing'] },
    // Database
    { name: 'PostgreSQL', beschreibung: 'PostgreSQL Design, komplexe Queries, Performance', inhalt: `# PostgreSQL\n\n## Fähigkeiten\n- Schema Design und Normalisierung\n- Komplexe Queries (CTEs, Window Functions, JSONB)\n- Index-Strategien (B-Tree, GIN, Partial)\n- Query Plan Analyse mit EXPLAIN ANALYZE\n- Migrations mit Drizzle, Prisma, Flyway\n\n## Typische Aufgaben\n- Schema entwerfen und migrieren\n- Langsame Queries optimieren\n- Row-Level Security implementieren\n\n## Tools\npsql, pgAdmin, EXPLAIN, Drizzle ORM, Prisma`, tags: ['postgresql', 'postgres', 'sql', 'database', 'query'] },
    { name: 'Supabase', beschreibung: 'Supabase BaaS: Auth, Realtime, Storage, Edge Functions', inhalt: `# Supabase\n\n## Fähigkeiten\n- Supabase Auth (Social Login, Magic Link, MFA)\n- Row-Level Security (RLS) Policies\n- Realtime Subscriptions\n- Edge Functions (Deno)\n- Storage mit Buckets und Policies\n\n## Typische Aufgaben\n- Auth-System implementieren\n- RLS-Policies schreiben\n- Realtime Features bauen\n\n## Tools\nSupabase CLI, Supabase Studio, pg_graphql`, tags: ['supabase', 'postgres', 'auth', 'realtime', 'baas'] },
    { name: 'Redis / Caching', beschreibung: 'Redis für Caching, Sessions, Rate Limiting, Pub/Sub', inhalt: `# Redis\n\n## Fähigkeiten\n- Caching-Strategien (Cache-Aside, Write-Through)\n- Session Storage\n- Rate Limiting mit Sliding Window\n- Pub/Sub und Message Queues\n- Redis Streams für Event Sourcing\n\n## Typische Aufgaben\n- API-Caching implementieren\n- Rate Limiter bauen\n- Pub/Sub für Notifications\n\n## Tools\nredis-cli, ioredis, BullMQ, Upstash`, tags: ['redis', 'cache', 'session', 'rate limiting', 'pubsub'] },
    // AI/ML
    { name: 'Prompt Engineering', beschreibung: 'Effektive Prompts für LLMs, Chain-of-Thought, Few-Shot', inhalt: `# Prompt Engineering\n\n## Fähigkeiten\n- System Prompts und User Prompts strukturieren\n- Chain-of-Thought (CoT) Reasoning\n- Few-Shot und Zero-Shot Learning\n- Prompt-Templates und Variablen\n- Output-Formatierung (JSON, Markdown)\n- Jailbreak-Prävention und Safety\n\n## Typische Aufgaben\n- System Prompts für Agenten optimieren\n- Strukturierte Outputs erzwingen\n- Prompts für verschiedene LLMs anpassen\n\n## Models\nClaude (Anthropic), GPT-4o (OpenAI), Gemini (Google), Llama (Meta)`, tags: ['prompt engineering', 'llm', 'claude', 'gpt', 'ai', 'chain of thought'] },
    { name: 'RAG & Vector Search', beschreibung: 'Retrieval-Augmented Generation, Embeddings, Vektordatenbanken', inhalt: `# RAG & Vector Search\n\n## Fähigkeiten\n- Embedding-Modelle (text-embedding-3, nomic-embed)\n- Vektordatenbanken: Pinecone, Weaviate, pgvector, Chroma\n- Chunking-Strategien für Dokumente\n- Hybrid Search (BM25 + Vector)\n- Reranking mit Cross-Encoder\n\n## Typische Aufgaben\n- Knowledge Base aus Dokumenten bauen\n- Semantische Suche implementieren\n- RAG-Pipeline optimieren (Precision/Recall)\n\n## Tools\nLangChain, LlamaIndex, pgvector, Chroma`, tags: ['rag', 'vector search', 'embeddings', 'pinecone', 'semantic search'] },
    { name: 'AI Agent Development', beschreibung: 'Autonome Agenten, Tool-Use, Multi-Agent-Systeme', inhalt: `# AI Agent Development\n\n## Fähigkeiten\n- Tool-Use / Function Calling implementieren\n- Multi-Agent-Orchestrierung (CrewAI, AutoGen, LangGraph)\n- MCP (Model Context Protocol) Server bauen\n- Memory: Short-term, Long-term, Episodic\n- Agent Loops und Reflection\n\n## Typische Aufgaben\n- Autonome Agenten mit Tools ausstatten\n- Multi-Agent-Workflows designen\n- Agenten-Outputs evaluieren und verbessern\n\n## Frameworks\nLangGraph, CrewAI, AutoGen, Claude Code SDK, OpenAI Assistants`, tags: ['agent', 'autonomous', 'tool use', 'multi-agent', 'mcp', 'langchain'] },
    { name: 'AI Image Generation', beschreibung: 'Stable Diffusion, DALL-E, Midjourney, Flux', inhalt: `# AI Image Generation\n\n## Fähigkeiten\n- Prompt-Engineering für Bildgenerierung\n- Stable Diffusion (SDXL, SD3, Flux)\n- ControlNet, LoRA, IP-Adapter\n- Inpainting und Outpainting\n- Batch-Generierung über API\n\n## Typische Aufgaben\n- Marketing-Assets generieren\n- Konzeptbilder und Mockups erstellen\n- Style-konsistente Bildserien produzieren\n\n## Tools\nComfyUI, A1111, Replicate API, DALL-E API, Midjourney`, tags: ['image generation', 'stable diffusion', 'dalle', 'midjourney', 'flux', 'comfyui'] },
    { name: 'Data Science & ML', beschreibung: 'Machine Learning, Pandas, scikit-learn, PyTorch', inhalt: `# Data Science & Machine Learning\n\n## Fähigkeiten\n- Explorative Datenanalyse (EDA)\n- Feature Engineering\n- Klassifikation, Regression, Clustering\n- Deep Learning mit PyTorch/Keras\n- Modell-Evaluation und Hyperparameter-Tuning\n\n## Typische Aufgaben\n- Datensätze analysieren und visualisieren\n- ML-Modelle trainieren und evaluieren\n- Insights aus Daten extrahieren\n\n## Tools\npandas, numpy, scikit-learn, PyTorch, Jupyter, MLflow`, tags: ['machine learning', 'data science', 'pandas', 'pytorch', 'sklearn', 'ml'] },
    // Security
    { name: 'Security Audit', beschreibung: 'OWASP Top 10, Code-Reviews, Vulnerability Assessment', inhalt: `# Security Audit\n\n## Fähigkeiten\n- OWASP Top 10 Analyse und Behebung\n- Static Code Analysis (SAST)\n- Dependency Vulnerability Scanning\n- SQL Injection, XSS, CSRF Prevention\n- Secret Scanning und Leakage Prevention\n\n## Typische Aufgaben\n- Code auf Sicherheitslücken prüfen\n- Dependency-Report erstellen\n- Security-Checkliste abarbeiten\n\n## Tools\nSnyk, Semgrep, OWASP ZAP, Trivy, Bandit`, tags: ['security', 'audit', 'owasp', 'vulnerability', 'sast'] },
    { name: 'Auth & Authorization', beschreibung: 'OAuth2, JWT, RBAC, SSO, better-auth', inhalt: `# Authentication & Authorization\n\n## Fähigkeiten\n- OAuth2 / OIDC Flows (Authorization Code, PKCE)\n- JWT Handling (Signing, Expiry, Rotation)\n- RBAC und ABAC Implementierung\n- Session Management und Cookie Security\n- MFA (TOTP, WebAuthn/Passkeys)\n\n## Typische Aufgaben\n- Auth-System von Grund auf bauen\n- SSO integrieren (Google, GitHub, Microsoft)\n- Berechtigungssystem designen\n\n## Libraries\nbetter-auth, NextAuth.js, Clerk, Auth0, Supabase Auth`, tags: ['auth', 'oauth', 'jwt', 'rbac', 'authentication', 'sso', 'better-auth'] },
    { name: 'DSGVO & Compliance', beschreibung: 'Datenschutz, GDPR, SOC2, Datenschutz-by-Design', inhalt: `# DSGVO & Compliance\n\n## Fähigkeiten\n- DSGVO/GDPR Anforderungen umsetzen\n- Privacy-by-Design und Privacy-by-Default\n- Data Processing Agreements (DPA)\n- Cookie Consent und Opt-Out\n- Datenschutz-Folgenabschätzung (DSFA)\n\n## Typische Aufgaben\n- Datenschutzerklärung prüfen/erstellen\n- Cookie-Banner implementieren\n- Datenlöschprozesse einrichten\n\n## Tools\nCookiebot, OneTrust, iubenda`, tags: ['dsgvo', 'gdpr', 'compliance', 'datenschutz', 'privacy', 'cookies'] },
    // Design
    { name: 'UI/UX Design', beschreibung: 'User Interface Design, Wireframing, Usability', inhalt: `# UI/UX Design\n\n## Fähigkeiten\n- User Research und Personas\n- Wireframing und Prototyping (Figma)\n- Usability Testing und Heuristic Evaluation\n- Information Architecture\n- Design Handoff und Developer Collaboration\n\n## Typische Aufgaben\n- UX für neue Features konzipieren\n- Bestehende Flows optimieren\n- Design-Feedback strukturieren\n\n## Tools\nFigma, FigJam, Maze, Hotjar, FullStory`, tags: ['ui', 'ux', 'figma', 'design', 'wireframe', 'usability'] },
    { name: 'Design Systems', beschreibung: 'Komponentenbibliotheken, Tokens, shadcn/ui, Storybook', inhalt: `# Design Systems\n\n## Fähigkeiten\n- Design Token Architektur (Farbe, Spacing, Typo)\n- Komponentenbibliotheken in React/Vue\n- Storybook für Dokumentation\n- shadcn/ui, Radix UI als Basis\n- Theme-System und Dark Mode\n\n## Typische Aufgaben\n- Komponentensystem aufbauen\n- Design Tokens definieren\n- Storybook-Stories schreiben\n\n## Tools\nStorybook, shadcn/ui, Radix UI, Tailwind CSS, Style Dictionary`, tags: ['design system', 'component library', 'storybook', 'shadcn', 'tokens'] },
    { name: 'Brand Design', beschreibung: 'Corporate Identity, Logo, Farb- und Typografie-Systeme', inhalt: `# Brand Design\n\n## Fähigkeiten\n- Brand Identity Entwicklung\n- Logo Design und Varianten\n- Farbpaletten und Typografie-Systeme\n- Brand Guidelines erstellen\n- Anwendungsbeispiele (Mockups, Templates)\n\n## Typische Aufgaben\n- Brand-Refresh konzipieren\n- Style Guide dokumentieren\n- Assets für Web und Print erstellen\n\n## Tools\nFigma, Adobe Illustrator, Canva`, tags: ['brand', 'logo', 'corporate identity', 'style guide', 'brand guidelines'] },
    // Marketing
    { name: 'SEO Optimierung', beschreibung: 'On-Page SEO, technisches SEO, Keyword-Recherche', inhalt: `# SEO Optimierung\n\n## Fähigkeiten\n- Technisches SEO (Core Web Vitals, Crawlbarkeit)\n- On-Page Optimierung (Meta, Headings, Schema.org)\n- Keyword-Recherche und Wettbewerbsanalyse\n- Backlink-Aufbau und Linkable Assets\n- Local SEO und Google Business Profile\n\n## Typische Aufgaben\n- SEO-Audit durchführen\n- Content für Target-Keywords optimieren\n- Technische Probleme beheben\n\n## Tools\nSemrush, Ahrefs, Google Search Console, Screaming Frog`, tags: ['seo', 'search engine', 'keyword', 'google', 'ranking'] },
    { name: 'Copywriting', beschreibung: 'Verkaufstexte, Headlines, CTAs, Landing Pages', inhalt: `# Copywriting\n\n## Fähigkeiten\n- Persuasive Headlines und Hooks\n- AIDA und PAS Frameworks\n- Value Propositions formulieren\n- CTAs und Conversion-Optimierung\n- Tone of Voice entwickeln\n\n## Typische Aufgaben\n- Landing Page texten\n- Email-Sequenzen schreiben\n- Ad-Copy für Meta/Google entwickeln\n- Produktbeschreibungen optimieren\n\n## Frameworks\nAIDA, PAS, BAB, StoryBrand`, tags: ['copywriting', 'conversion', 'landing page', 'cta', 'sales'] },
    { name: 'Content Strategy', beschreibung: 'Content-Planung, Redaktionsplan, Blog, Newsletter', inhalt: `# Content Strategy\n\n## Fähigkeiten\n- Content-Audit und Gap-Analyse\n- Redaktionsplan und Content-Kalender\n- Blog und Long-Form Content\n- Newsletter-Strategie\n- Thought Leadership und Personal Branding\n\n## Typische Aufgaben\n- Content-Strategie entwickeln\n- Artikel-Briefings erstellen\n- Content-Performance analysieren\n\n## Metriken\nOrganischer Traffic, Time on Page, Email-Öffnungsrate, Conversion Rate`, tags: ['content strategy', 'blog', 'newsletter', 'editorial', 'content'] },
    { name: 'Social Media Marketing', beschreibung: 'LinkedIn, Instagram, X, TikTok Content und Growth', inhalt: `# Social Media Marketing\n\n## Fähigkeiten\n- Plattform-spezifische Content-Strategien\n- LinkedIn B2B Content und Thought Leadership\n- Instagram und TikTok Visual Storytelling\n- Community Building und Engagement\n- Social Media Ads (Meta, LinkedIn)\n\n## Typische Aufgaben\n- Content-Kalender erstellen\n- Posts für verschiedene Plattformen texten\n- Hashtag-Strategien entwickeln\n- Performance-Reports erstellen\n\n## Tools\nBuffer, Hootsuite, Later, Canva, Capcut`, tags: ['social media', 'linkedin', 'instagram', 'tiktok', 'community'] },
    { name: 'Email Marketing', beschreibung: 'Newsletter, Cold Email, Sequenzen, Deliverability', inhalt: `# Email Marketing\n\n## Fähigkeiten\n- Cold Email Campaigns und Personalisierung\n- Newsletter-Design und Copywriting\n- Drip-Sequenzen und Automation\n- Deliverability-Optimierung (SPF, DKIM, DMARC)\n- A/B Testing von Subject Lines und Content\n\n## Typische Aufgaben\n- Email-Sequenz schreiben\n- Newsletter-Template gestalten\n- Open- und Click-Rates verbessern\n\n## Tools\nMailchimp, Brevo, ConvertKit, Instantly, Apollo`, tags: ['email', 'newsletter', 'cold email', 'drip', 'deliverability'] },
    { name: 'Paid Advertising', beschreibung: 'Google Ads, Meta Ads, LinkedIn Ads, ROAS-Optimierung', inhalt: `# Paid Advertising\n\n## Fähigkeiten\n- Google Ads (Search, Display, Performance Max)\n- Meta Ads (Facebook, Instagram Campaigns)\n- LinkedIn Ads für B2B\n- Audience-Segmentierung und Retargeting\n- ROAS-Optimierung und Budget-Allokation\n\n## Typische Aufgaben\n- Kampagnen aufsetzen und optimieren\n- Ad Creative und Copy entwickeln\n- Conversion Tracking einrichten\n\n## Tools\nGoogle Ads Manager, Meta Business Suite, LinkedIn Campaign Manager`, tags: ['ads', 'google ads', 'meta ads', 'linkedin ads', 'roas', 'paid'] },
    // Research
    { name: 'Web Research', beschreibung: 'Tiefgehende Online-Recherche, Quellenvalidierung', inhalt: `# Web Research\n\n## Fähigkeiten\n- Fortgeschrittene Google-Suche (Operatoren, Boolean)\n- Quellenvalidierung und Fact-Checking\n- Competitive Intelligence\n- Deep Web und Fachdatenbanken\n- Zusammenfassen und Strukturieren\n\n## Typische Aufgaben\n- Markt- und Wettbewerbsrecherche\n- Branchentrends identifizieren\n- Technologievergleiche erstellen\n- Fakten-Checks durchführen\n\n## Tools\nGoogle (Advanced), Perplexity, Consensus, Scholar, Statista`, tags: ['research', 'web research', 'competitive intelligence', 'fact check'] },
    { name: 'Market Research', beschreibung: 'Marktanalyse, Wettbewerbsanalyse, TAM/SAM/SOM', inhalt: `# Market Research\n\n## Fähigkeiten\n- TAM/SAM/SOM Berechnung\n- Wettbewerbsmatrix und -analyse\n- Kundeninterviews und Surveys\n- Buyer Personas entwickeln\n- Preisstrategien und Benchmarking\n\n## Typische Aufgaben\n- Marktgröße schätzen\n- Wettbewerber analysieren\n- Zielgruppen-Interviews auswerten\n\n## Frameworks\nPorters Five Forces, SWOT, Jobs-to-be-Done, Blue Ocean`, tags: ['market research', 'competitor analysis', 'tam', 'buyer persona'] },
    { name: 'Web Scraping', beschreibung: 'Datenextraktion mit Playwright, Firecrawl', inhalt: `# Web Scraping\n\n## Fähigkeiten\n- Browser Automation mit Playwright\n- API-basiertes Scraping mit Firecrawl\n- JavaScript-Rendering und Dynamic Content\n- Rate Limiting und Politeness\n- Daten-Pipeline und Strukturierung\n\n## Typische Aufgaben\n- Preise und Produkte tracken\n- Leads und Kontakte sammeln\n- Content für RAG extrahieren\n\n## Tools\nPlaywright, Puppeteer, Firecrawl, BeautifulSoup, Scrapy`, tags: ['scraping', 'playwright', 'firecrawl', 'data extraction', 'crawl'] },
    // Automation
    { name: 'Browser Automation', beschreibung: 'Playwright, Puppeteer für Test und Prozessautomatisierung', inhalt: `# Browser Automation\n\n## Fähigkeiten\n- Playwright für Cross-Browser-Tests\n- Puppeteer für Chrome Automation\n- Screenshot und PDF-Generierung\n- Form-Filling und Navigation-Automation\n- Selector-Strategien (CSS, XPath, Role)\n\n## Typische Aufgaben\n- E2E-Testsuiten schreiben\n- Web-Workflows automatisieren\n- Screenshots für Monitoring\n\n## Tools\nPlaywright, Puppeteer, Selenium, browser-use`, tags: ['playwright', 'puppeteer', 'browser automation', 'e2e', 'headless'] },
    { name: 'Workflow Automation (n8n / Make)', beschreibung: 'No-Code Automatisierung, n8n, Zapier, Make', inhalt: `# Workflow Automation\n\n## Fähigkeiten\n- n8n Self-Hosted Workflows\n- Zapier und Make (Integromat) Flows\n- Webhook-basierte Trigger\n- API-Integrationen ohne Code\n- Error Handling und Retry-Logik\n\n## Typische Aufgaben\n- Manuelle Prozesse automatisieren\n- App-Integrationen bauen\n- Notifications und Alerts einrichten\n\n## Tools\nn8n, Zapier, Make (Integromat), Pipedream, Activepieces`, tags: ['n8n', 'zapier', 'make', 'no-code', 'workflow', 'automation'] },
    { name: 'Shell Scripting & Bash', beschreibung: 'Bash, Linux-Administration, Cron-Jobs', inhalt: `# Shell Scripting & Bash\n\n## Fähigkeiten\n- Bash-Scripting (Variablen, Loops, Conditionals)\n- Linux System Administration\n- Cron-Jobs und scheduled Tasks\n- File und Prozess-Management\n- Pipe-Chains und Textverarbeitung (awk, sed, grep)\n\n## Typische Aufgaben\n- Deployment-Skripte schreiben\n- Cron-Jobs einrichten\n- Log-Analyse automatisieren\n\n## Tools\nbash, zsh, tmux, systemd, cron`, tags: ['bash', 'shell', 'scripting', 'linux', 'cron', 'cli'] },
    // Productivity
    { name: 'Google Workspace', beschreibung: 'Google Docs, Sheets, Gmail, Calendar via API', inhalt: `# Google Workspace\n\n## Fähigkeiten\n- Google Sheets: komplexe Formeln, Apps Script\n- Google Docs: Templates und Mail Merge\n- Gmail API: Emails automatisiert senden/lesen\n- Google Calendar API: Events managen\n- Drive API: Dateien organisieren\n\n## Typische Aufgaben\n- Reporting-Dashboards in Sheets bauen\n- Email-Automatisierung mit Gmail API\n- Docs-Templates für Dokumentation\n\n## Tools\nGoogle Apps Script, Google Workspace API, gspread (Python)`, tags: ['google workspace', 'google sheets', 'gmail', 'google docs', 'calendar'] },
    { name: 'Project Management', beschreibung: 'Agile, Scrum, Kanban, Jira, Linear', inhalt: `# Project Management\n\n## Fähigkeiten\n- Agile Methodik (Scrum, Kanban, SAFe)\n- Sprint Planning und Backlog Grooming\n- OKR Planung und Tracking\n- Stakeholder Management\n- Risk Assessment und Mitigation\n\n## Typische Aufgaben\n- Projektplan erstellen\n- Sprint planen und retrospektieren\n- Team-Koordination und Kommunikation\n\n## Tools\nLinear, Jira, Notion, Asana, ClickUp`, tags: ['project management', 'agile', 'scrum', 'kanban', 'sprint', 'okr'] },
    // Business
    { name: 'Business Strategy', beschreibung: 'Strategieentwicklung, Business Model, OKRs, Go-to-Market', inhalt: `# Business Strategy\n\n## Fähigkeiten\n- Business Model Canvas und Value Proposition\n- Go-to-Market Strategien\n- OKR Frameworks definieren\n- SWOT und Wettbewerbspositionierung\n- Pivot-Entscheidungen und Szenario-Planung\n\n## Typische Aufgaben\n- Strategiepapiere erstellen\n- OKRs formulieren\n- Business Case kalkulieren\n\n## Frameworks\nBusiness Model Canvas, Jobs-to-be-Done, Blue Ocean, OKRs`, tags: ['strategy', 'business model', 'okr', 'go-to-market', 'positioning'] },
    { name: 'Financial Analysis', beschreibung: 'P&L, Budget, SaaS-Metriken, Unit Economics', inhalt: `# Financial Analysis\n\n## Fähigkeiten\n- P&L Analyse und Reporting\n- SaaS-Metriken: MRR, ARR, Churn, LTV, CAC\n- Unit Economics und Break-Even-Analyse\n- Cashflow-Planung und Forecasting\n- Investitionsrechnung und ROI\n\n## Typische Aufgaben\n- Finanz-Dashboard erstellen\n- SaaS-Metriken tracken\n- Budget-Planungen entwickeln\n\n## Tools\nGoogle Sheets, Excel, Stripe Dashboard, Baremetrics`, tags: ['finance', 'financial', 'mrr', 'arr', 'saas metrics', 'unit economics'] },
    { name: 'Customer Success', beschreibung: 'Kundenbindung, Support, Churn-Reduktion, NPS', inhalt: `# Customer Success\n\n## Fähigkeiten\n- Onboarding-Prozesse designen\n- Churn-Prävention und Early Warning Signs\n- NPS-Befragungen und Feedback-Analyse\n- Eskalations-Management\n- QBRs (Quarterly Business Reviews)\n\n## Typische Aufgaben\n- Onboarding-Materialien erstellen\n- Churning Customers identifizieren\n- Support-Prozesse verbessern\n\n## Tools\nIntercom, HubSpot, Gainsight, Zendesk`, tags: ['customer success', 'churn', 'nps', 'onboarding', 'retention', 'support'] },
  ];

  const existing = db.select({ name: skillsLibrary.name })
    .from(skillsLibrary)
    .where(eq(skillsLibrary.companyId, unternehmenId))
    .all()
    .map((r: any) => r.name.toLowerCase());

  let added = 0;
  for (const skill of SEED_SKILLS) {
    if (existing.includes(skill.name.toLowerCase())) continue;
    db.insert(skillsLibrary).values({
      id: uuid(),
      companyId: unternehmenId,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      tags: JSON.stringify(skill.tags),
      source: 'manuell' as const,
      confidence: 80,
      uses: 0,
      successes: 0,
      createdBy: null,
      createdAt: n,
      updatedAt: n,
    }).run();
    added++;
  }

  res.json({ ok: true, added, total: SEED_SKILLS.length });
});

// Expert <-> Skill assignment
app.get('/api/agents/:id/skills-library', authMiddleware, (req, res) => {
  const expertId = req.params.id as string;
  const assigned = db.select({ skill: skillsLibrary }).from(agentSkills)
    .innerJoin(skillsLibrary, eq(agentSkills.skillId, skillsLibrary.id))
    .where(eq(agentSkills.agentId, expertId)).all();
  res.json(assigned.map((r: any) => mapSkillToDe(r.skill)));
});

app.post('/api/agents/:id/skills-library', authMiddleware, (req, res) => {
  const { skillId } = req.body;
  if (!skillId) return res.status(400).json({ error: 'skillId required' });
  const expertId = req.params.id as string;
  const exists = db.select().from(agentSkills).where(and(eq(agentSkills.agentId, expertId), eq(agentSkills.skillId, skillId))).get();
  if (exists) return res.json({ ok: true, already: true });
  db.insert(agentSkills).values({ id: uuid(), agentId: expertId, skillId, createdAt: now() }).run();
  res.status(201).json({ ok: true });
});

app.delete('/api/agents/:id/skills-library/:skillId', authMiddleware, (req, res) => {
  const expertId = req.params.id as string;
  const skillId = req.params.skillId as string;
  db.delete(agentSkills).where(and(eq(agentSkills.agentId, expertId), eq(agentSkills.skillId, skillId))).run();
  res.json({ ok: true });
});

// RAG query: get relevant skill chunks for a prompt (keyword-based, no vector DB needed)
app.post('/api/agents/:id/skills-library/query', authMiddleware, (req, res) => {
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

app.get('/api/companies/:id/export', authMiddleware, (req, res) => {
  const manifest = exportCompany(req.params.id as string);
  if (!manifest) return res.status(404).json({ error: 'Company not found' });
  res.json(manifest);
});

app.post('/api/companies/:id/import/preview', authMiddleware, (req, res) => {
  const preview = previewImport(req.params.id as string, req.body);
  res.json(preview);
});

app.post('/api/companies/:id/import', authMiddleware, (req, res) => {
  const { manifest, options } = req.body;
  if (!manifest) return res.status(400).json({ error: 'manifest ist erforderlich' });
  const result = importCompany(req.params.id as string, manifest, options || { collisionStrategy: 'skip' });
  broadcastUpdate('company_imported', { unternehmenId: req.params.id, ...result });
  res.json(result);
});

// GET /api/companies/:id/export/training — fine-tuning JSONL/JSON export
app.get('/api/companies/:id/export/training', authMiddleware, async (req, res) => {
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

app.get('/api/companies/:id/budget-policies', authMiddleware, (req, res) => {
  const policies = db.select().from(budgetPolicies)
    .where(eq(budgetPolicies.companyId, req.params.id as string)).all();
  const mitStatus = policies.map(p => ({ ...p, status: berechneBudgetStatus(p.id) }));
  res.json(mitStatus);
});

app.post('/api/companies/:id/budget-policies', authMiddleware, (req, res) => {
  const { scope, scopeId, limitCent, fenster, warnProzent, hardStop } = req.body;
  const id = erstellePolicy({
    unternehmenId: req.params.id as string,
    scope, scopeId, limitCent, fenster, warnProzent, hardStop
  });
  res.json({ id });
});

app.get('/api/companies/:id/budget-incidents', authMiddleware, (req, res) => {
  const incidents = db.select().from(budgetIncidents)
    .where(eq(budgetIncidents.companyId, req.params.id as string)).all();
  res.json(incidents);
});

// =============================================
// ISSUE DEPENDENCIES
// =============================================

import { erstelleAbhaengigkeit, entferneAbhaengigkeit, getBlocker, getBlockiert } from './services/issue-dependencies.js';

app.get('/api/tasks/:id/blocker', authMiddleware, (req, res) => {
  res.json(getBlocker(req.params.id as string));
});

app.get('/api/tasks/:id/blockiert', authMiddleware, (req, res) => {
  res.json(getBlockiert(req.params.id as string));
});

app.post('/api/tasks/:id/blocker', authMiddleware, (req, res) => {
  const { blockerId } = req.body;
  const result = erstelleAbhaengigkeit(blockerId, req.params.id as string, 'board');
  res.json(result);
});

app.delete('/api/tasks/:id/blocker/:blockerId', authMiddleware, (req, res) => {
  entferneAbhaengigkeit(req.params.blockerId as string, req.params.id as string);
  res.json({ ok: true });
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
app.post('/api/companies/:unternehmenId/clipmart/import', authMiddleware, (req, res) => {
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
app.get('/api/companies/:unternehmenId/intelligence/memory', authMiddleware, async (req, res) => {
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
app.delete('/api/intelligence/memory/:expertId', authMiddleware, async (req, res) => {
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
app.put('/api/intelligence/memory/:expertId', authMiddleware, async (req, res) => {
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
app.get('/api/palace/:expertId/rooms', authMiddleware, (req, res) => {
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
app.get('/api/palace/:expertId/diary', authMiddleware, (req, res) => {
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
app.get('/api/palace/kg/:unternehmenId', authMiddleware, (req, res) => {
  const uid = req.params.unternehmenId as string;
  const fakten = db.select().from(palaceKg)
    .where(and(eq(palaceKg.companyId, uid), isNull(palaceKg.validUntil)))
    .orderBy(desc(palaceKg.createdAt))
    .limit(100)
    .all();

  res.json(fakten);
});

// ─── Palace: KG — Fakt hinzufügen ────────────────────────────────────────
app.post('/api/palace/kg/:unternehmenId', authMiddleware, (req, res) => {
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
app.delete('/api/palace/kg/:factId', authMiddleware, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.update(palaceKg).set({ validUntil: today }).where(eq(palaceKg.id, req.params.factId as string)).run();
  res.json({ ok: true });
});

// ─── Palace: Summary (Konsolidierungsstatus) ─────────────────────────────
app.get('/api/palace/:expertId/summary', authMiddleware, (req, res) => {
  const { expertId } = req.params as { expertId: string };
  const s = db.select().from(palaceSummaries).where(eq(palaceSummaries.agentId, expertId)).get();
  if (!s) return res.json(null);
  res.json({ version: s.version, komprimierteTurns: s.komprimierteTurns, aktualisiertAm: s.updatedAt, inhalt: s.content });
});

// ─── Palace: Konsolidierung manuell auslösen ─────────────────────────────
app.post('/api/palace/:expertId/consolidate', authMiddleware, async (req, res) => {
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
app.post('/api/palace/:expertId/rooms', authMiddleware, (req, res) => {
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
app.delete('/api/palace/drawer/:entryId', authMiddleware, (req, res) => {
  db.delete(palaceDrawers).where(eq(palaceDrawers.id, req.params.entryId as string)).run();
  res.json({ ok: true });
});

// ─── Palace: Diary-Eintrag löschen ───────────────────────────────────────
app.delete('/api/palace/diary/:entryId', authMiddleware, (req, res) => {
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

app.get('/api/agents/:id/stats', authMiddleware, (req, res) => {
  const expertId = req.params.id as string;

  // 30 days window for stats
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const zyklen = db.select({
    status: workCycles.status,
    erstelltAm: workCycles.createdAt
  }).from(workCycles)
    .where(and(eq(workCycles.agentId, expertId), sql`${workCycles.createdAt} > ${thirtyDaysAgo}`))
    .orderBy(desc(workCycles.createdAt))
    .all();

  const agentTasks = db.select({
    status: tasks.status,
    prioritaet: tasks.priority,
    erstelltAm: tasks.createdAt
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
    recentTasks
  });
});

// =============================================
// HALLUCINATION / QUALITY TRACKING
// =============================================
app.get('/api/companies/:unternehmenId/agent-quality', authMiddleware, (req, res) => {
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
// HEALTH & SYSTEM STATUS
// =============================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.9.0', name: 'OpenCognit' });
});

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

// ── Agent Health Monitor Endpoint ───────────────────────────────────────────
app.get('/api/health/agents', authMiddleware, async (req, res) => {
  try {
    const unternehmenId = req.query.unternehmenId as string;

    // Agents currently stuck in 'running' for >5 minutes
    const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const stuckAgents = db.all(
      sql`SELECT id, name, status, letzter_zyklus as letzterZyklus FROM experten
          WHERE status = 'running' AND letzter_zyklus < ${stuckCutoff}
          ${unternehmenId ? sql`AND unternehmen_id = ${unternehmenId}` : sql``}`
    );

    // Agents with high wakeup coalescedCount (potential loop detection)
    const loopyWakeups = db.all(
      sql`SELECT w.expert_id as expertId, e.name as expertName,
             w.coalesced_count as coalescedCount, w.reason, w.requested_at as requestedAt
          FROM agent_wakeup_requests w LEFT JOIN experten e ON w.expert_id = e.id
          WHERE w.status = 'queued' AND w.coalesced_count >= 10
          ${unternehmenId ? sql`AND w.unternehmen_id = ${unternehmenId}` : sql``}
          ORDER BY w.coalesced_count DESC LIMIT 20`
    );

    // Agents in error state
    const errorAgents = db.all(
      sql`SELECT id, name, letzter_zyklus as letzterZyklus FROM experten
          WHERE status = 'error'
          ${unternehmenId ? sql`AND unternehmen_id = ${unternehmenId}` : sql``}`
    );

    // Recent failed runs (last 24h)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentFailures = db.all(
      sql`SELECT a.expert_id as expertId, e.name as expertName, COUNT(*) as failCount
          FROM arbeitszyklen a LEFT JOIN experten e ON a.expert_id = e.id
          WHERE a.status IN ('failed', 'timed_out') AND a.erstellt_am >= ${since24h}
          ${unternehmenId ? sql`AND a.unternehmen_id = ${unternehmenId}` : sql``}
          GROUP BY a.expert_id HAVING failCount >= 3
          ORDER BY failCount DESC`
    );

    // Stale queued wakeups (>2h old, still queued)
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const staleWakeups = db.all(
      sql`SELECT w.expert_id as expertId, e.name as expertName, COUNT(*) as count
          FROM agent_wakeup_requests w LEFT JOIN experten e ON w.expert_id = e.id
          WHERE w.status = 'queued' AND w.requested_at < ${staleCutoff}
          ${unternehmenId ? sql`AND w.unternehmen_id = ${unternehmenId}` : sql``}
          GROUP BY w.expert_id`
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

// ── Backup Management Endpoints ─────────────────────────────────────────────
app.get('/api/system/backups', authMiddleware, (_req, res) => {
  try {
    const backups = backupService.listBackups();
    res.json({ backups });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/system/backups', authMiddleware, async (_req, res) => {
  try {
    const result = await backupService.runBackup();
    res.json({ success: true, backup: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/system/cleanup', authMiddleware, async (_req, res) => {
  try {
    const stats = await cleanupService.runCleanup();
    res.json({ success: true, stats });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/system/status', (_req, res) => {
  const unternehmenCount = db.select({ value: count(companies.id) }).from(companies).get()?.value ?? 0;
  const benutzerCount = db.select({ value: count(users.id) }).from(users).get()?.value ?? 0;
  res.json({ needsSetup: unternehmenCount === 0, brauchtRegistrierung: benutzerCount === 0 });
});

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
    const plan = JSON.parse(jsonMatch[0]);

    res.json({ plan, source: 'ai' });
  } catch (e: any) {
    console.error('[Bootstrap] Plan generation failed:', e.message);
    const allSkillsFallback = await skillsService.getAllSkills();
    res.json({ plan: buildFallbackPlan(businessDescription, dir, isDE, allSkillsFallback), source: 'default', warning: e.message });
  }
});

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
  const created: any = { projects: [], agenten: [], tasks: [], routines: [], soulFiles: [] };
  const skipped: any = { projects: [], agenten: [], tasks: [], routines: [] };
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
      skipped.projects.push({ name: p.name, reason: 'bereits vorhanden' });
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
    created.projects.push({ id: projektId, name: p.name, workDir: subDir });
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
      skipped.routines.push({ name: r.name, reason: 'bereits vorhanden' });
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
    created.routines.push({ id: routineId, name: r.name, agentName: r.agentName });
  }

  // 6. Set start project to critical priority
  if (startProjektName && projektMap[startProjektName]) {
    db.update(projects).set({ priority: 'critical', updatedAt: nowStr }).where(eq(projects.id, projektMap[startProjektName])).run();
  }

  const totalSkipped = skipped.projects.length + skipped.agenten.length + skipped.tasks.length + skipped.routines.length;
  logAktivitaet(unternehmenId, 'system', 'system', 'CEO Bootstrap',
    `hat ${created.agenten.length} Agenten, ${created.projects.length} Projekte und ${created.tasks.length} Tasks erstellt (${totalSkipped} übersprungen)`,
    'companies', unternehmenId);
  res.json({ success: true, created, skipped });
});

// GET /api/system/claude-status — Claude Code CLI Auth-Status prüfen
app.get('/api/system/claude-status', authMiddleware, async (_req, res) => {
  try {
    // 1. Prüfen ob claude CLI installiert ist
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

    // 2. Credentials-Datei lesen (~/.claude/.credentials.json)
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

// GET /api/system/cli-status — Gemini CLI + Codex CLI Installations-Check (legacy, still works)
app.get('/api/system/cli-status', authMiddleware, async (_req, res) => {
  const checkCli = async (cmd: string): Promise<{ installed: boolean; version: string }> => {
    try {
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
        const proc = spawn(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('error', () => reject(new Error('not found'))); // ENOENT guard
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

// GET /api/system/cli-detect — Generic auto-detection for ALL supported CLI tools
// Scans PATH for: claude, gemini, codex, kimi, and any future CLI adapters
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

app.get('/api/system/cli-detect', authMiddleware, async (_req, res) => {
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
        // The access token auto-refreshes on each kimi invocation; the refresh token
        // represents the real session lifetime.
        if (raw?.refresh_token) {
          try {
            const payload = JSON.parse(Buffer.from(raw.refresh_token.split('.')[1], 'base64').toString());
            const refreshExpired = payload.exp ? Date.now() > payload.exp * 1000 : false;
            kimiResult.authenticated = !refreshExpired;
          } catch {
            // Fallback: access token check
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

// GET /api/system/cli-paths — return currently configured CLI path overrides
app.get('/api/system/cli-paths', authMiddleware, (_req, res) => {
  res.json(getAllCliPaths());
});

// PUT /api/system/cli-paths — update a CLI path override (global, not per-company)
app.put('/api/system/cli-paths/:tool', authMiddleware, async (req, res) => {
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

  // Update in-memory map immediately
  setCliPath(tool, pathValue);

  console.log(`🔧 CLI path override updated: ${tool} = ${pathValue || '(cleared)'}`);
  res.json({ ok: true, tool, path: pathValue });
});

// =============================================
// PLUGIN-SYSTEM (Phase 4)
// =============================================

// Alle verfügbaren Plugins auflisten
app.get('/api/plugins', async (_req, res) => {
  try {
    const plugins = await pluginManager.listPlugins();
    res.json(plugins);
  } catch (error) {
    console.error('Fehler beim Abrufen der Plugins:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen der Plugins' });
  }
});

// Plugin-Details abrufen
app.get('/api/plugins/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const plugin = pluginManager.getPlugin(id);

    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }

    // Plugin-Konfigurationsschema abrufen
    let configSchema = {};
    if (plugin.getConfigSchema) {
      configSchema = plugin.getConfigSchema();
    }

    // UI-Komponenten abrufen
    let uiComponents = {};
    if (plugin.getUiComponents) {
      uiComponents = plugin.getUiComponents();
    }

    // Assets abrufen
    let assets: any[] = [];
    if (plugin.getAssets) {
      assets = plugin.getAssets();
    }

    res.json({
      metadata: plugin.metadata,
      configSchema,
      uiComponents,
      assets
    });
  } catch (error) {
    console.error(`Fehler beim Abrufen des Plugins ${id}:`, error);
    res.status(500).json({ error: 'Fehler beim Abrufen des Plugins' });
  }
});

// Plugin aktivieren
app.post('/api/plugins/:id/enable', async (req, res) => {
  const { id } = req.params;

  try {
    await pluginManager.enablePlugin(id);
    res.json({ success: true, message: `Plugin ${id} wurde aktiviert` });
  } catch (error) {
    console.error(`Fehler beim Aktivieren des Plugins ${id}:`, error);
    res.status(500).json({ error: 'Fehler beim Aktivieren des Plugins' });
  }
});

// Plugin deaktivieren
app.post('/api/plugins/:id/disable', async (req, res) => {
  const { id } = req.params;

  try {
    await pluginManager.disablePlugin(id);
    res.json({ success: true, message: `Plugin ${id} wurde deaktiviert` });
  } catch (error) {
    console.error(`Fehler beim Deaktivieren des Plugins ${id}:`, error);
    res.status(500).json({ error: 'Fehler beim Deaktivieren des Plugins' });
  }
});

// Plugin installieren
app.post('/api/plugins/install', async (req, res) => {
  const { source, location, version, force } = req.body;

  if (!source || !location) {
    return res.status(400).json({ error: 'source und location sind erforderlich' });
  }

  try {
    const pluginId = await pluginManager.installPlugin(source, location, { version, force });
    res.json({ success: true, pluginId, message: 'Plugin wurde installiert' });
  } catch (error) {
    console.error('Fehler bei der Plugin-Installation:', error);
    res.status(500).json({ error: 'Fehler bei der Plugin-Installation' });
  }
});

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
app.get('/api/openclaw/token', (req: any, res: any) => {
  const unternehmenId = req.query.unternehmenId as string;
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
app.post('/api/openclaw/token/regenerate', (req: any, res: any) => {
  const { unternehmenId } = req.body;
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
app.get('/api/openclaw/agents', (req: any, res: any) => {
  const unternehmenId = req.query.unternehmenId as string;
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
    console.log('\x1b[36m'); // cyan
    console.log(' ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗██╗████████╗');
    console.log('██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔═══██╗██╔════╝ ████╗  ██║██║╚══██╔══╝');
    console.log('██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║   ██║██║  ███╗██╔██╗ ██║██║   ██║   ');
    console.log('██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║   ██║██║   ██║██║╚██╗██║██║   ██║   ');
    console.log('╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║██║   ██║   ');
    console.log(' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝  ');
    console.log('\x1b[0m'); // reset
    console.log(`\x1b[36m  🚀 API        \x1b[0m http://localhost:${PORT}`);
    console.log(`\x1b[36m  📡 WebSocket  \x1b[0m ws://localhost:${PORT}/ws`);
    console.log(`\x1b[36m  📊 Health     \x1b[0m http://localhost:${PORT}/api/health`);
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

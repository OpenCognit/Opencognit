// Multi-Node Worker Pool
//
// Persistent registry of remote agent workers. Workers register once, then
// heartbeat and claim queued work. Capabilities filter decides which worker
// can run which agent (e.g. only a worker with `claude-code` capability can
// execute a claude-code agent).
//
// Security: each worker has a shared-secret token; the SHA-256 hash is stored.
// Workers authenticate by sending the raw token, which is hashed and compared.

import crypto from 'crypto';
import os from 'os';
import { db } from '../db/client.js';
import { workerNodes, agentWakeupRequests } from '../db/schema.js';
import { eq, and, sql, lt, desc } from 'drizzle-orm';

const HEARTBEAT_OFFLINE_MS = 90_000; // consider worker offline after 90s silence

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface RegisteredWorker {
  id: string;
  name: string;
  token: string;          // only returned on registration — never stored plaintext
  capabilities: string[];
}

export function registerWorker(input: {
  name: string;
  hostname?: string;
  capabilities: string[];
  maxConcurrency?: number;
  id?: string;
  token?: string;          // optional: worker can supply its own token to re-register
}): RegisteredWorker {
  const id = input.id || crypto.randomUUID();
  const token = input.token || crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const existing = db.select().from(workerNodes).where(eq(workerNodes.id, id)).get();
  if (existing) {
    db.update(workerNodes).set({
      name: input.name,
      hostname: input.hostname || os.hostname(),
      capabilities: JSON.stringify(input.capabilities),
      tokenHash,
      status: 'online',
      maxConcurrency: input.maxConcurrency ?? existing.maxConcurrency,
      lastHeartbeatAt: now,
      updatedAt: now,
    }).where(eq(workerNodes.id, id)).run();
  } else {
    db.insert(workerNodes).values({
      id,
      name: input.name,
      hostname: input.hostname || null,
      capabilities: JSON.stringify(input.capabilities),
      tokenHash,
      status: 'online',
      maxConcurrency: input.maxConcurrency ?? 1,
      activeRuns: 0,
      totalRuns: 0,
      lastHeartbeatAt: now,
      registriertAm: now,
      updatedAt: now,
    }).run();
  }

  return { id, name: input.name, token, capabilities: input.capabilities };
}

export function authenticateWorker(id: string, token: string): boolean {
  const row = db.select().from(workerNodes).where(eq(workerNodes.id, id)).get();
  if (!row || row.status === 'disabled') return false;
  return row.tokenHash === hashToken(token);
}

export function heartbeat(id: string): { ok: boolean } {
  const now = new Date().toISOString();
  const r = db.update(workerNodes).set({
    lastHeartbeatAt: now,
    status: 'online',
    updatedAt: now,
  }).where(eq(workerNodes.id, id)).run();
  return { ok: (r as any).changes > 0 };
}

export function markStaleWorkersOffline(): number {
  const cutoff = new Date(Date.now() - HEARTBEAT_OFFLINE_MS).toISOString();
  const r = db.update(workerNodes).set({ status: 'offline' })
    .where(and(
      eq(workerNodes.status, 'online'),
      lt(workerNodes.lastHeartbeatAt, cutoff),
    )).run();
  return (r as any).changes ?? 0;
}

export function listWorkers() {
  markStaleWorkersOffline();
  return db.select().from(workerNodes).orderBy(desc(workerNodes.lastHeartbeatAt)).all()
    .map(w => ({
      ...w,
      capabilities: safeJson(w.capabilities, [] as string[]),
    }));
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/**
 * Atomically claim the oldest queued wakeup whose required capability is
 * supported by this worker. Uses a compare-and-swap on agent_wakeup_requests:
 * flip status from 'queued' to 'claimed' where status is still 'queued'.
 */
export function claimWork(
  workerId: string,
  requiredCapability: string | null,
): { runId: string; expertId: string; unternehmenId: string; payload: any } | null {
  const worker = db.select().from(workerNodes).where(eq(workerNodes.id, workerId)).get();
  if (!worker || worker.status !== 'online') return null;
  if (worker.activeRuns >= worker.maxConcurrency) return null;

  const candidates = db.select().from(agentWakeupRequests)
    .where(eq(agentWakeupRequests.status, 'queued'))
    .orderBy(agentWakeupRequests.requestedAt)
    .limit(10).all();

  for (const req of candidates) {
    if (requiredCapability) {
      const caps = safeJson(worker.capabilities, [] as string[]);
      const payload = safeJson(req.payload, {} as any);
      const needed = payload?.connectionType || requiredCapability;
      if (!caps.includes(needed)) continue;
    }

    const now = new Date().toISOString();
    const claimed = db.update(agentWakeupRequests)
      .set({ status: 'claimed', claimedAt: now })
      .where(and(eq(agentWakeupRequests.id, req.id), eq(agentWakeupRequests.status, 'queued')))
      .run();

    if ((claimed as any).changes > 0) {
      db.update(workerNodes)
        .set({ activeRuns: sql`${workerNodes.activeRuns} + 1`, updatedAt: now })
        .where(eq(workerNodes.id, workerId)).run();
      return {
        runId: req.id,
        expertId: req.agentId,
        unternehmenId: req.companyId,
        payload: safeJson(req.payload, {}),
      };
    }
  }

  return null;
}

export function submitResult(workerId: string, wakeupId: string, success: boolean, error?: string): { ok: boolean } {
  const now = new Date().toISOString();
  db.update(agentWakeupRequests).set({
    status: success ? 'completed' : 'failed',
    finishedAt: now,
  }).where(eq(agentWakeupRequests.id, wakeupId)).run();

  db.update(workerNodes).set({
    activeRuns: sql`MAX(${workerNodes.activeRuns} - 1, 0)`,
    totalRuns: sql`${workerNodes.totalRuns} + 1`,
    updatedAt: now,
  }).where(eq(workerNodes.id, workerId)).run();

  return { ok: true };
}

export function disableWorker(id: string): void {
  db.update(workerNodes).set({
    status: 'disabled',
    updatedAt: new Date().toISOString(),
  }).where(eq(workerNodes.id, id)).run();
}

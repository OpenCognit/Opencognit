// Cleanup Service — removes stale data to prevent unbounded DB/disk growth
// Runs on a schedule: every 6 hours via cron.ts integration

import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import {
  arbeitszyklen,
  agentWakeupRequests,
  traceEreignisse,
  palaceSummaries,
  aktivitaetslog,
  chatNachrichten,
} from '../db/schema.js';
import { lt, eq, and, sql, inArray } from 'drizzle-orm';

const DATA_DIR = path.resolve('data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

export interface CleanupStats {
  sessionFilesDeleted: number;
  staleRunsDeleted: number;
  staleWakeupsExpired: number;
  staleTracesDeleted: number;
  staleSummariesDeleted: number;
  staleActivityDeleted: number;
  staleChatMessagesDeleted: number;
}

class CleanupService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run immediately on start, then every 6 hours
    this.runCleanup().catch(e => console.warn('⚠️ Initial cleanup error:', e.message));
    this.intervalId = setInterval(() => {
      this.runCleanup().catch(e => console.warn('⚠️ Cleanup error:', e.message));
    }, 6 * 60 * 60 * 1000);

    console.log('🧹 Cleanup service started (every 6h)');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  async runCleanup(): Promise<CleanupStats> {
    const stats: CleanupStats = {
      sessionFilesDeleted: 0,
      staleRunsDeleted: 0,
      staleWakeupsExpired: 0,
      staleTracesDeleted: 0,
      staleSummariesDeleted: 0,
      staleActivityDeleted: 0,
      staleChatMessagesDeleted: 0,
    };

    const now = new Date();

    // ── 1. Session files older than 7 days ────────────────────────────────────
    try {
      stats.sessionFilesDeleted = this.cleanSessionFiles(7);
    } catch (e: any) {
      console.warn('⚠️ Session file cleanup failed:', e.message);
    }

    // ── 2. Arbeitszyklen (execution runs) older than 30 days ─────────────────
    // Keep failed/error ones for 14 days for debugging
    try {
      const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const cutoff14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

      const deletedSucceeded = db.delete(arbeitszyklen)
        .where(and(
          inArray(arbeitszyklen.status, ['succeeded', 'cancelled', 'deferred']),
          lt(arbeitszyklen.erstelltAm, cutoff30),
        ))
        .run();
      stats.staleRunsDeleted += deletedSucceeded.changes;

      const deletedFailed = db.delete(arbeitszyklen)
        .where(and(
          inArray(arbeitszyklen.status, ['failed', 'timed_out']),
          lt(arbeitszyklen.erstelltAm, cutoff14),
        ))
        .run();
      stats.staleRunsDeleted += deletedFailed.changes;
    } catch (e: any) {
      console.warn('⚠️ Run cleanup failed:', e.message);
    }

    // ── 3. Stale wakeup requests — queued for >24h ────────────────────────────
    try {
      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const expired = db.update(agentWakeupRequests)
        .set({ status: 'deferred', finishedAt: now.toISOString() })
        .where(and(
          eq(agentWakeupRequests.status, 'queued'),
          lt(agentWakeupRequests.requestedAt, cutoff24h),
        ))
        .run();
      stats.staleWakeupsExpired = expired.changes;
    } catch (e: any) {
      console.warn('⚠️ Wakeup expiry failed:', e.message);
    }

    // ── 4. Trace events older than 14 days ───────────────────────────────────
    try {
      const cutoff14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.delete(traceEreignisse)
        .where(lt(traceEreignisse.erstelltAm, cutoff14))
        .run();
      stats.staleTracesDeleted = deleted.changes;
    } catch (e: any) {
      console.warn('⚠️ Trace cleanup failed:', e.message);
    }

    // ── 5. Memory Summaries — keep only last 3 versions per agent ──────────
    try {
      // Find agents with >3 summary versions and delete oldest
      const summaryStats = db.all<{ expertId: string; cnt: number }>(
        sql`SELECT expert_id as expertId, COUNT(*) as cnt FROM palace_summaries GROUP BY expert_id HAVING cnt > 3`
      );
      for (const { expertId, cnt } of summaryStats) {
        const toDelete = cnt - 3;
        // Get oldest IDs
        const oldest = db.all<{ id: string }>(
          sql`SELECT id FROM palace_summaries WHERE expert_id = ${expertId} ORDER BY version ASC LIMIT ${toDelete}`
        );
        for (const { id } of oldest) {
          db.delete(palaceSummaries).where(eq(palaceSummaries.id, id)).run();
          stats.staleSummariesDeleted++;
        }
      }
    } catch (e: any) {
      console.warn('⚠️ Summary cleanup failed:', e.message);
    }

    // ── 6. Activity log older than 90 days ───────────────────────────────────
    try {
      const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.delete(aktivitaetslog)
        .where(lt(aktivitaetslog.erstelltAm, cutoff90))
        .run();
      stats.staleActivityDeleted = deleted.changes;
    } catch (e: any) {
      console.warn('⚠️ Activity log cleanup failed:', e.message);
    }

    // ── 7. System chat messages older than 30 days ───────────────────────────
    try {
      const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.delete(chatNachrichten)
        .where(and(
          eq(chatNachrichten.absenderTyp, 'system'),
          lt(chatNachrichten.erstelltAm, cutoff30),
        ))
        .run();
      stats.staleChatMessagesDeleted = deleted.changes;
    } catch (e: any) {
      console.warn('⚠️ Chat message cleanup failed:', e.message);
    }

    const total = stats.sessionFilesDeleted + stats.staleRunsDeleted +
      stats.staleWakeupsExpired + stats.staleTracesDeleted +
      stats.staleSummariesDeleted + stats.staleActivityDeleted + stats.staleChatMessagesDeleted;

    if (total > 0) {
      console.log(
        `🧹 Cleanup complete: ${stats.sessionFilesDeleted} session files, ` +
        `${stats.staleRunsDeleted} old runs, ${stats.staleWakeupsExpired} stale wakeups, ` +
        `${stats.staleTracesDeleted} traces, ${stats.staleSummariesDeleted} summaries, ` +
        `${stats.staleActivityDeleted} activity entries, ${stats.staleChatMessagesDeleted} system msgs`
      );
    }

    return stats;
  }

  private cleanSessionFiles(maxAgeDays: number): number {
    if (!fs.existsSync(SESSIONS_DIR)) return 0;

    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    const files = fs.readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(SESSIONS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch {
        // File might be in use — skip
      }
    }

    return deleted;
  }
}

export const cleanupService = new CleanupService();

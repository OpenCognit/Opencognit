// Cleanup Service — removes stale data to prevent unbounded DB/disk growth
// Runs on a schedule: every 6 hours via cron.ts integration

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db/client.js';
import {
  workCycles,
  workCyclesArchive,
  agentWakeupRequests,
  traceEvents,
  palaceSummaries,
  activityLog,
  chatMessages,
} from '../db/schema.js';
import { lt, eq, and, sql, inArray } from 'drizzle-orm';

const DATA_DIR = path.resolve('data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

export interface CleanupStats {
  sessionFilesDeleted: number;
  staleRunsDeleted: number;
  staleRunsArchived: number;
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
      staleRunsArchived: 0,
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
    // Archive before deletion to preserve aggregated statistics for analytics
    try {
      const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const cutoff14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

      // Archive succeeded/cancelled/deferred runs older than 30 days
      stats.staleRunsArchived += await this.archiveOldRuns(
        ['succeeded', 'cancelled', 'deferred'],
        cutoff30
      );
      const deletedSucceeded = db.delete(workCycles)
        .where(and(
          inArray(workCycles.status, ['succeeded', 'cancelled', 'deferred']),
          lt(workCycles.createdAt, cutoff30),
        ))
        .run();
      stats.staleRunsDeleted += deletedSucceeded.changes;

      // Archive failed/timed_out runs older than 14 days
      stats.staleRunsArchived += await this.archiveOldRuns(
        ['failed', 'timed_out'],
        cutoff14
      );
      const deletedFailed = db.delete(workCycles)
        .where(and(
          inArray(workCycles.status, ['failed', 'timed_out']),
          lt(workCycles.createdAt, cutoff14),
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
      const deleted = db.delete(traceEvents)
        .where(lt(traceEvents.createdAt, cutoff14))
        .run();
      stats.staleTracesDeleted = deleted.changes;
    } catch (e: any) {
      console.warn('⚠️ Trace cleanup failed:', e.message);
    }

    // ── 5. Memory Summaries — keep only last 3 versions per agent ──────────
    try {
      // Find agents with >3 summary versions and delete oldest
      const summaryStats = db.all(
        sql`SELECT expert_id as expertId, COUNT(*) as cnt FROM palace_summaries GROUP BY expert_id HAVING cnt > 3`
      );
      for (const { expertId, cnt } of summaryStats) {
        const toDelete = cnt - 3;
        // Get oldest IDs
        const oldest = db.all(
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
      const deleted = db.delete(activityLog)
        .where(lt(activityLog.createdAt, cutoff90))
        .run();
      stats.staleActivityDeleted = deleted.changes;
    } catch (e: any) {
      console.warn('⚠️ Activity log cleanup failed:', e.message);
    }

    // ── 7. System chat messages older than 30 days ───────────────────────────
    try {
      const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = db.delete(chatMessages)
        .where(and(
          eq(chatMessages.senderType, 'system'),
          lt(chatMessages.createdAt, cutoff30),
        ))
        .run();
      stats.staleChatMessagesDeleted = deleted.changes;
    } catch (e: any) {
      console.warn('⚠️ Chat message cleanup failed:', e.message);
    }

    const total = stats.sessionFilesDeleted + stats.staleRunsDeleted + stats.staleRunsArchived +
      stats.staleWakeupsExpired + stats.staleTracesDeleted +
      stats.staleSummariesDeleted + stats.staleActivityDeleted + stats.staleChatMessagesDeleted;

    if (total > 0) {
      console.log(
        `🧹 Cleanup complete: ${stats.sessionFilesDeleted} session files, ` +
        `${stats.staleRunsDeleted} old runs (${stats.staleRunsArchived} archived), ` +
        `${stats.staleWakeupsExpired} stale wakeups, ` +
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

  private async archiveOldRuns(statuses: string[], cutoffIso: string): Promise<number> {
    try {
      // Aggregate runs per agent per day
      const rows = db.all(sql`
        SELECT
          unternehmen_id,
          expert_id,
          DATE(erstellt_am) as archiv_datum,
          COUNT(*) as zyklus_anzahl,
          SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as erfolgreich_anzahl,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as fehlgeschlagen_anzahl,
          SUM(CASE WHEN status IN ('cancelled', 'deferred') THEN 1 ELSE 0 END) as abgebrochen_anzahl,
          COALESCE(AVG(
            CASE
              WHEN gestartet_am IS NOT NULL AND beendet_am IS NOT NULL
              THEN (julianday(beendet_am) - julianday(gestartet_am)) * 86400000
              ELSE 0
            END
          ), 0) as avg_dauer_ms,
          COALESCE(SUM(CAST(json_extract(usage_json, '$.inputTokens') AS INTEGER)), 0) as total_input_tokens,
          COALESCE(SUM(CAST(json_extract(usage_json, '$.outputTokens') AS INTEGER)), 0) as total_output_tokens,
          COALESCE(SUM(CAST(json_extract(usage_json, '$.costCents') AS INTEGER)), 0) as total_kosten_cent
        FROM arbeitszyklen
        WHERE status IN (${statuses.map(s => `'${s}'`).join(',')})
          AND erstellt_am < ${cutoffIso}
        GROUP BY unternehmen_id, expert_id, DATE(erstellt_am)
      `);

      let archived = 0;
      const now = new Date().toISOString();

      for (const row of rows) {
        const id = crypto.randomUUID();
        try {
          db.insert(workCyclesArchive).values({
            id,
            companyId: row.unternehmen_id,
            agentId: row.expert_id,
            archivDatum: row.archiv_datum,
            zyklusAnzahl: row.zyklus_anzahl,
            erfolgreichAnzahl: row.erfolgreich_anzahl,
            fehlgeschlagenAnzahl: row.fehlgeschlagen_anzahl,
            abgebrochenAnzahl: row.abgebrochen_anzahl,
            durchschnittDauerMs: Math.round(row.avg_dauer_ms),
            gesamtInputTokens: row.total_input_tokens,
            gesamtOutputTokens: row.total_output_tokens,
            gesamtKostenCent: row.total_kosten_cent,
            modelleJson: null,
            createdAt: now,
          }).run();
          archived++;
        } catch (e: any) {
          // Unique constraint violation = already archived this day
          if (!e.message?.includes('UNIQUE')) {
            console.warn('[Cleanup] Archive insert failed:', e.message);
          }
        }
      }

      return archived;
    } catch (e: any) {
      console.warn('⚠️ Run archive failed:', e.message);
      return 0;
    }
  }
}

export const cleanupService = new CleanupService();

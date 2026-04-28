// Wakeup Service - Manages agent wake-up requests
// Implements coalescing deduplication and multi-source triggers (timer, assignment, automation)

import { db } from '../db/client.js';
import { agentWakeupRequests, workCycles, agents, tasks } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export type WakeupSource = 'timer' | 'assignment' | 'on_demand' | 'automation';
export type WakeupTriggerDetail = 'manual' | 'ping' | 'callback' | 'system' | 'cron' | 'issue_assigned' | 'issue_comment' | 'mention';

export interface WakeupOptions {
  source: WakeupSource;
  triggerDetail: WakeupTriggerDetail;
  reason: string;
  payload?: {
    issueId?: string;
    taskId?: string;
    wakeCommentId?: string;
    [key: string]: unknown;
  };
  contextSnapshot?: {
    issueId?: string;
    source?: string;
    [key: string]: unknown;
  };
}

export interface WakeupService {
  /**
   * Queue a wake-up request for an agent
   * Implements coalescing - duplicates for same agent+task are merged
   */
  wakeup(expertId: string, unternehmenId: string, options: WakeupOptions): Promise<string>;

  /**
   * Get pending wake-up requests for an agent
   */
  getPendingWakeups(expertId: string, limit?: number): Promise<PendingWakeup[]>;

  /**
   * Claim a wake-up request (mark as being processed)
   */
  claimWakeup(wakeupId: string, runId: string): Promise<boolean>;

  /**
   * Complete a wake-up request
   */
  completeWakeup(wakeupId: string, success: boolean): Promise<void>;

  /**
   * Wake agent for task assignment
   */
  wakeupForAssignment(expertId: string, unternehmenId: string, issueId: string): Promise<string>;

  /**
   * Wake agent for comment mention
   */
  wakeupForComment(expertId: string, unternehmenId: string, issueId: string, commentId: string): Promise<string>;
}

export interface PendingWakeup {
  id: string;
  source: WakeupSource;
  triggerDetail: WakeupTriggerDetail;
  reason: string;
  payload: any;
  contextSnapshot: any;
  requestedAt: string;
  coalescedCount: number;
}

class WakeupServiceImpl implements WakeupService {
  /**
   * Queue a wake-up request for an agent
   * Implements coalescing - prevents duplicate wakeups for same agent+task
   */
  async wakeup(expertId: string, unternehmenId: string, options: WakeupOptions): Promise<string> {
    const now = new Date().toISOString();

    // Check for existing pending wakeup with same context
    const existingKey = options.contextSnapshot?.issueId
      ? `expert:${expertId}:issue:${options.contextSnapshot.issueId}`
      : `expert:${expertId}:source:${options.source}`;

    // Try to coalesce with existing pending request
    const existing = await db.select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.agentId, expertId),
          eq(agentWakeupRequests.companyId, unternehmenId),
          eq(agentWakeupRequests.status, 'queued')
        )
      )
      .limit(1);

    if (existing.length > 0 && options.contextSnapshot?.issueId) {
      let existingContext: any = {};
      try { existingContext = existing[0].contextSnapshot ? JSON.parse(existing[0].contextSnapshot) : {}; } catch {}

      if (existingContext.issueId === options.contextSnapshot.issueId) {
        // Coalesce - increment counter instead of creating new request
        const updated = await db.update(agentWakeupRequests)
          .set({
            coalescedCount: sql`${agentWakeupRequests.coalescedCount} + 1`,
            updatedAt: now,
          })
          .where(eq(agentWakeupRequests.id, existing[0].id))
          .returning();

        console.log(`🔀 Wakeup coalesced for expert ${expertId} (count: ${updated[0].coalescedCount + 1})`);
        return existing[0].id;
      }
    }

    // Create new wakeup request
    const wakeupId = crypto.randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupId,
      companyId: unternehmenId,
      agentId: expertId,
      source: options.source,
      triggerDetail: options.triggerDetail,
      reason: options.reason,
      payload: options.payload ? JSON.stringify(options.payload) : null,
      status: 'queued',
      coalescedCount: 0,
      contextSnapshot: options.contextSnapshot ? JSON.stringify(options.contextSnapshot) : null,
      requestedAt: now,
    });

    console.log(`⏰ Wakeup queued for expert ${expertId}: ${options.reason} (source: ${options.source})`);
    return wakeupId;
  }

  /**
   * Get pending wake-up requests for an agent
   */
  async getPendingWakeups(expertId: string, limit: number = 10): Promise<PendingWakeup[]> {
    const results = await db.select()
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.agentId, expertId),
          eq(agentWakeupRequests.status, 'queued')
        )
      )
      .orderBy(sql`${agentWakeupRequests.requestedAt} ASC`)
      .limit(limit);

    return results.map(r => {
      let payload = null;
      let contextSnapshot = null;
      try { payload = r.payload ? JSON.parse(r.payload) : null; } catch {}
      try { contextSnapshot = r.contextSnapshot ? JSON.parse(r.contextSnapshot) : null; } catch {}
      return {
      id: r.id,
      source: r.source as WakeupSource,
      triggerDetail: r.triggerDetail as WakeupTriggerDetail,
      reason: r.reason,
      payload,
      contextSnapshot,
      requestedAt: r.requestedAt,
      coalescedCount: r.coalescedCount,
    };
    });
  }

  /**
   * Claim a wake-up request (mark as being processed)
   */
  async claimWakeup(wakeupId: string, runId: string): Promise<boolean> {
    const now = new Date().toISOString();

    const updated = await db.update(agentWakeupRequests)
      .set({
        status: 'claimed',
        runId,
        claimedAt: now,
      })
      .where(
        and(
          eq(agentWakeupRequests.id, wakeupId),
          eq(agentWakeupRequests.status, 'queued')
        )
      )
      .returning();

    if (updated.length > 0) {
      console.log(`📌 Wakeup ${wakeupId} claimed by run ${runId}`);
      return true;
    }

    return false;
  }

  /**
   * Complete a wake-up request
   */
  async completeWakeup(wakeupId: string, success: boolean): Promise<void> {
    const now = new Date().toISOString();

    await db.update(agentWakeupRequests)
      .set({
        status: success ? 'completed' : 'failed',
        finishedAt: now,
      })
      .where(eq(agentWakeupRequests.id, wakeupId));
  }

  /**
   * Wake agent for task assignment
   */
  async wakeupForAssignment(expertId: string, unternehmenId: string, issueId: string): Promise<string> {
    return this.wakeup(expertId, unternehmenId, {
      source: 'assignment',
      triggerDetail: 'issue_assigned',
      reason: 'Aufgabe zugewiesen',
      payload: { issueId },
      contextSnapshot: { issueId, source: 'issue_assignment' },
    });
  }

  /**
   * Wake agent for comment mention
   */
  async wakeupForComment(expertId: string, unternehmenId: string, issueId: string, commentId: string): Promise<string> {
    return this.wakeup(expertId, unternehmenId, {
      source: 'automation',
      triggerDetail: 'issue_comment',
      reason: 'Erwähnung in Kommentar',
      payload: { issueId, wakeCommentId: commentId },
      contextSnapshot: { issueId, source: 'comment_mention' },
    });
  }
}

// Singleton instance
export const wakeupService = new WakeupServiceImpl();

// Convenience exports
export const queueWakeup = wakeupService.wakeup.bind(wakeupService);
export const getPendingWakeups = wakeupService.getPendingWakeups.bind(wakeupService);
export const claimWakeup = wakeupService.claimWakeup.bind(wakeupService);
export const completeWakeup = wakeupService.completeWakeup.bind(wakeupService);
export const wakeupForAssignment = wakeupService.wakeupForAssignment.bind(wakeupService);
export const wakeupForComment = wakeupService.wakeupForComment.bind(wakeupService);

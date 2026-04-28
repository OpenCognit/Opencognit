/**
 * Contract-Net Protocol (CNP) — Task Bidding/Auction System
 * ==========================================================
 * When a task is unassigned, the orchestrator ANNOUNCES it.
 * Eligible agents BID based on capability match, trust score, and workload.
 * The best bid is ACCEPTED, others are REJECTED.
 *
 * Based on: FIPA Contract Net Protocol (SC00026) + 2026 resource-aware bidding.
 * State-of-the-Art: "Contract-net protocol — manager advertises, agents bid,
 * best-fit wins. Useful when different agents have different capabilities."
 */

import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  tasks,
  agents,
  contractNetBids,
  agentCapabilities,
} from '../db/schema.js';
import { wakeupService } from './wakeup.js';
import { getTrustWeight } from './trust-reputation.js';

export interface BidAnnouncement {
  taskId: string;
  companyId: string;
  announcerAgentId: string;
  taskKeywords: string[]; // extracted from title/description
  requiredCapabilities?: string[];
  maxBidDurationMinutes?: number;
}

export interface BidResult {
  winnerAgentId: string | null;
  winnerBidId: string | null;
  bidScore: number;
  allBids: Array<{
    agentId: string;
    expertName: string;
    bidScore: number;
    reason: string;
  }>;
  reason: string;
}

/**
 * Announce a task to all eligible agents and collect bids.
 * This is step 1 of the Contract-Net Protocol.
 */
export async function announceTask(
  announcement: BidAnnouncement
): Promise<BidResult> {
  const { taskId, companyId, announcerAgentId, taskKeywords } = announcement;

  // Get all active agents in the company (excluding the announcer)
  const agentRows = db
    .select()
    .from(agents)
    .where(and(
      eq(agents.companyId, companyId),
      eq(agents.status, 'active')
    ))
    .all()
    .filter(a => a.id !== announcerAgentId);

  if (agentRows.length === 0) {
    return {
      winnerAgentId: null,
      winnerBidId: null,
      bidScore: 0,
      allBids: [],
      reason: 'No active agents available for bidding.',
    };
  }

  // Auto-generate bids for each agent based on their capabilities + trust + workload
  const bids: BidResult['allBids'] = [];

  for (const agent of agentRows) {
    const bid = await computeAutoBid(agent, taskId, companyId, taskKeywords);
    if (bid.score > 0) {
      // Store the bid
      const bidId = crypto.randomUUID();
      db.insert(contractNetBids).values({
        id: bidId,
        companyId,
        taskId,
        bidderAgentId: agent.id,
        bidScore: bid.score,
        reason: bid.reason,
        estimatedMinutes: bid.estimatedMinutes,
        status: 'pending',
        announcerAgentId,
        createdAt: new Date().toISOString(),
      }).run();

      bids.push({
        agentId: agent.id,
        expertName: agent.name,
        bidScore: bid.score,
        reason: bid.reason,
      });
    }
  }

  if (bids.length === 0) {
    return {
      winnerAgentId: null,
      winnerBidId: null,
      bidScore: 0,
      allBids: [],
      reason: 'No agents bid on this task.',
    };
  }

  // Sort by bid score (highest wins)
  bids.sort((a, b) => b.bidScore - a.bidScore);
  const winner = bids[0];

  // Find the bid record
  const winnerBid = db
    .select()
    .from(contractNetBids)
    .where(and(
      eq(contractNetBids.taskId, taskId),
      eq(contractNetBids.bidderAgentId, winner.agentId),
      eq(contractNetBids.status, 'pending')
    ))
    .get();

  return {
    winnerAgentId: winner.agentId,
    winnerBidId: winnerBid?.id || null,
    bidScore: winner.bidScore,
    allBids: bids,
    reason: `Winner: ${winner.expertName} with score ${winner.bidScore}/100 — ${winner.reason}`,
  };
}

/**
 * Accept the winning bid and assign the task.
 * Step 2 of Contract-Net: Manager awards contract to best bidder.
 */
export async function acceptWinningBid(
  bidResult: BidResult,
  taskId: string,
  companyId: string
): Promise<boolean> {
  if (!bidResult.winnerAgentId || !bidResult.winnerBidId) return false;

  const now = new Date().toISOString();

  // Mark winning bid as accepted
  db.update(contractNetBids)
    .set({ status: 'accepted', completedAt: now })
    .where(eq(contractNetBids.id, bidResult.winnerBidId))
    .run();

  // Mark other bids as rejected
  db.update(contractNetBids)
    .set({ status: 'rejected', completedAt: now })
    .where(and(
      eq(contractNetBids.taskId, taskId),
      eq(contractNetBids.status, 'pending')
    ))
    .run();

  // Assign task to winner
  db.update(tasks)
    .set({
      assignedTo: bidResult.winnerAgentId,
      status: 'todo',
      updatedAt: now,
    })
    .where(eq(tasks.id, taskId))
    .run();

  // Wakeup the winner
  await wakeupService.wakeupForAssignment(bidResult.winnerAgentId, companyId, taskId);

  return true;
}

/**
 * Check if there are pending bids for a task that have expired.
 * Clean them up and optionally re-announce.
 */
export function expireOldBids(maxAgeHours: number = 24): number {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  const expired = db
    .select()
    .from(contractNetBids)
    .where(and(
      eq(contractNetBids.status, 'pending'),
      sql`${contractNetBids.createdAt} < ${cutoff}`
    ))
    .all();

  for (const bid of expired) {
    db.update(contractNetBids)
      .set({ status: 'expired', completedAt: new Date().toISOString() })
      .where(eq(contractNetBids.id, bid.id))
      .run();
  }

  return expired.length;
}

/**
 * Get bid history for an agent (how often they win/lose bids).
 */
export function getAgentBidStats(agentId: string): {
  totalBids: number;
  wins: number;
  winRate: number;
  avgBidScore: number;
} {
  const allBids = db
    .select()
    .from(contractNetBids)
    .where(eq(contractNetBids.bidderAgentId, agentId))
    .all();

  const wins = allBids.filter(b => b.status === 'accepted').length;
  const avgScore = allBids.length > 0
    ? allBids.reduce((sum, b) => sum + b.bidScore, 0) / allBids.length
    : 0;

  return {
    totalBids: allBids.length,
    wins,
    winRate: allBids.length > 0 ? wins / allBids.length : 0,
    avgBidScore: Math.round(avgScore),
  };
}

// ===== Internal: Auto-bidding engine =====

interface ComputedBid {
  score: number;
  reason: string;
  estimatedMinutes: number;
}

async function computeAutoBid(
  agent: typeof agents.$inferSelect,
  taskId: string,
  companyId: string,
  taskKeywords: string[]
): Promise<ComputedBid> {
  const scores: Record<string, number> = {};

  // 1. Capability Match (0-40 points)
  const capRecord = db
    .select()
    .from(agentCapabilities)
    .where(and(
      eq(agentCapabilities.agentId, agent.id),
      eq(agentCapabilities.companyId, companyId)
    ))
    .get();

  let capabilityScore = 0;
  let matchReasons: string[] = [];

  if (capRecord) {
    try {
      const caps = JSON.parse(capRecord.capabilitiesJson) as {
        domains?: string[];
        tools?: string[];
        languages?: string[];
        complexity?: string;
      };
      const agentKeywords = [
        ...(caps.domains || []),
        ...(caps.tools || []),
        ...(caps.languages || []),
      ].map(k => k.toLowerCase());

      const matches = taskKeywords.filter(kw =>
        agentKeywords.some(ak => ak.includes(kw.toLowerCase()) || kw.toLowerCase().includes(ak))
      );

      capabilityScore = Math.min(40, Math.round((matches.length / Math.max(1, taskKeywords.length)) * 40));
      if (matches.length > 0) matchReasons.push(`matches ${matches.join(', ')}`);
    } catch {
      capabilityScore = 10; // default if JSON is corrupt
    }
  } else {
    // Fallback: parse faehigkeiten string
    if (agent.skills) {
      const skills = agent.skills.toLowerCase().split(/[,;]/);
      const matches = taskKeywords.filter(kw =>
        skills.some(s => s.trim().includes(kw.toLowerCase()) || kw.toLowerCase().includes(s.trim()))
      );
      capabilityScore = Math.min(30, Math.round((matches.length / Math.max(1, taskKeywords.length)) * 30));
      if (matches.length > 0) matchReasons.push(`skill match: ${matches.join(', ')}`);
    }
  }

  scores.capability = capabilityScore;

  // 2. Trust Score Weight (0-25 points)
  const trustWeight = getTrustWeight(agent.id, companyId);
  const trustScore = Math.round((trustWeight - 0.5) / 1.0 * 25); // 0.5->0, 1.5->25
  scores.trust = trustScore;

  // 3. Workload Penalty (0-20 points, inverse)
  const workload = db
    .select({ count: db.fn.count() })
    .from(tasks)
    .where(and(
      eq(tasks.assignedTo, agent.id),
      inArray(tasks.status, ['todo', 'in_progress', 'in_review'])
    ))
    .get()?.count || 0;

  const workloadScore = Math.max(0, 20 - workload * 4); // 0 tasks=20, 1=16, 2=12, 3=8, 4=4, 5+=0
  scores.workload = workloadScore;

  // 4. Role Alignment (0-15 points)
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  let roleScore = 0;
  if (task && agent.role) {
    const role = agent.role.toLowerCase();
    const title = task.title.toLowerCase();
    if (title.includes(role) || role.includes(title.split(' ')[0])) {
      roleScore = 15;
      matchReasons.push('role-aligned');
    }
  }
  scores.role = roleScore;

  // Total score
  const totalScore = scores.capability + scores.trust + scores.workload + scores.role;

  // Estimated time (naive: 30min base + 15min per keyword)
  const estimatedMinutes = 30 + taskKeywords.length * 15;

  const reasons = [
    totalScore > 70 ? 'strong match' : totalScore > 40 ? 'moderate match' : 'weak match',
    `cap:${scores.capability}`,
    `trust:${scores.trust}`,
    `load:${scores.workload}`,
    `role:${scores.role}`,
    ...matchReasons,
  ];

  return {
    score: totalScore,
    reason: reasons.join(', '),
    estimatedMinutes,
  };
}

/**
 * Extract keywords from task title/description for matching.
 */
export function extractTaskKeywords(task: typeof tasks.$inferSelect): string[] {
  const text = `${task.title} ${task.description || ''}`.toLowerCase();
  const keywords = new Set<string>();

  // Common tech/domain keywords
  const knownKeywords = [
    'react', 'vue', 'angular', 'svelte', 'frontend', 'backend', 'api', 'database',
    'sql', 'docker', 'kubernetes', 'devops', 'testing', 'design', 'ui', 'ux',
    'marketing', 'sales', 'finance', 'accounting', 'legal', 'hr', 'support',
    'python', 'javascript', 'typescript', 'go', 'rust', 'java', 'cpp', 'c#',
    'writing', 'content', 'research', 'analysis', 'planning', 'strategy',
    'bug', 'feature', 'refactor', 'optimize', 'deploy', 'review', 'audit',
  ];

  for (const kw of knownKeywords) {
    if (text.includes(kw)) keywords.add(kw);
  }

  // Extract from faehigkeiten of all agents (cross-reference)
  const allSkills = db
    .select({ faehigkeiten: agents.skills })
    .from(agents)
    .all();

  for (const s of allSkills) {
    if (!s.skills) continue;
    for (const skill of s.skills.toLowerCase().split(/[,;]/)) {
      const trimmed = skill.trim();
      if (trimmed.length > 2 && text.includes(trimmed)) {
        keywords.add(trimmed);
      }
    }
  }

  return Array.from(keywords);
}

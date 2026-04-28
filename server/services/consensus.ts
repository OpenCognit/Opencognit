/**
 * Agent Consensus / Voting System
 * ================================
 * Formal voting protocol for multi-agent decisions.
 * Supports: simple majority, weighted voting (trust-adjusted),
 * ranked choice, and veto override.
 *
 * State-of-the-Art 2026: "Voting or consensus — multiple agents generate
 * opinions and vote to settle on the most suitable output. Useful for
 * quality checks and evaluations. Weighted by expertise/reputation."
 *
 * Inspired by: FIPA-ACL voting protocols + Byzantine fault tolerance principles.
 */

import { eq, and, avg, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentMeetings, agents, agentVotes } from '../db/schema.js';
import { getTrustWeight } from './trust-reputation.js';

export type VotingMethod = 'simple_majority' | 'weighted_trust' | 'unanimous' | 'supermajority_66' | 'supermajority_75';
export type VoteValue = -1 | 0 | 1; // reject | abstain | approve

export interface VotingConfig {
  contextId: string;
  contextType: 'meeting' | 'task' | 'decision' | 'proposal';
  companyId: string;
  method: VotingMethod;
  proposalText: string;
  participantIds: string[];
  minParticipation?: number; // minimum voters required (0-1 ratio)
  timeoutMinutes?: number;
}

export interface VotingResult {
  passed: boolean;
  approveCount: number;
  rejectCount: number;
  abstainCount: number;
  totalWeight: number;
  approveWeight: number;
  margin: number; // how decisive the result is (0-1)
  reason: string;
  individualVotes: Array<{
    agentId: string;
    expertName: string;
    vote: number;
    weightedVote: number;
    reason?: string;
  }>;
}

/**
 * Cast a vote in a consensus process.
 * Each agent evaluates the proposal and votes.
 */
export function castVote(
  agentId: string,
  companyId: string,
  contextId: string,
  contextType: VotingConfig['contextType'],
  vote: VoteValue,
  proposalText: string,
  reason?: string
): void {
  const now = new Date().toISOString();

  // Compute weighted vote based on trust
  const weight = getTrustWeight(agentId, companyId);
  const weightedVote = vote * weight;

  // Check if this agent already voted in this context
  const existing = db
    .select()
    .from(agentVotes)
    .where(and(
      eq(agentVotes.agentId, agentId),
      eq(agentVotes.contextId, contextId),
      eq(agentVotes.contextType, contextType)
    ))
    .get();

  if (existing) {
    // Update existing vote
    db.update(agentVotes)
      .set({
        vote,
        weightedVote: weightedVote,
        reason: reason || existing.reason,
        proposalText,
        createdAt: now,
      })
      .where(eq(agentVotes.id, existing.id))
      .run();
  } else {
    db.insert(agentVotes).values({
      id: crypto.randomUUID(),
      companyId,
      contextId,
      contextType,
      agentId,
      vote,
      weightedVote: weightedVote,
      reason,
      proposalText,
      createdAt: now,
    }).run();
  }
}

/**
 * Resolve a vote once all participants have voted or timeout is reached.
 */
export function resolveVote(config: VotingConfig): VotingResult {
  const { contextId, contextType, companyId, method, participantIds, minParticipation = 0.5 } = config;

  // Collect all votes for this context
  const votes = db
    .select()
    .from(agentVotes)
    .where(and(
      eq(agentVotes.contextId, contextId),
      eq(agentVotes.contextType, contextType),
      eq(agentVotes.companyId, companyId)
    ))
    .all();

  // Enrich with agent names
  const enrichedVotes = votes.map(v => {
    const agent = db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, v.agentId))
      .get();
    return {
      agentId: v.agentId,
      expertName: agent?.name || 'Unknown',
      vote: v.vote,
      weightedVote: v.weightedVote,
      reason: v.reason || undefined,
    };
  });

  const approveCount = votes.filter(v => v.vote === 1).length;
  const rejectCount = votes.filter(v => v.vote === -1).length;
  const abstainCount = votes.filter(v => v.vote === 0).length;

  const totalWeight = votes.reduce((sum, v) => sum + Math.abs(v.weightedVote), 0);
  const approveWeight = votes.filter(v => v.vote === 1).reduce((sum, v) => sum + v.weightedVote, 0);
  const rejectWeight = votes.filter(v => v.vote === -1).reduce((sum, v) => sum + Math.abs(v.weightedVote), 0);

  // Check participation
  const participation = participantIds.length > 0
    ? votes.filter(v => participantIds.includes(v.agentId)).length / participantIds.length
    : 1;

  if (participation < minParticipation) {
    return {
      passed: false,
      approveCount,
      rejectCount,
      abstainCount,
      totalWeight,
      approveWeight,
      margin: 0,
      reason: `Insufficient participation: ${Math.round(participation * 100)}% (minimum ${Math.round(minParticipation * 100)}%).`,
      individualVotes: enrichedVotes,
    };
  }

  let passed = false;
  let margin = 0;
  let reason = '';

  switch (method) {
    case 'simple_majority': {
      passed = approveCount > rejectCount;
      margin = votes.length > 0 ? (approveCount - rejectCount) / votes.length : 0;
      reason = passed
        ? `Approved by simple majority: ${approveCount} approve vs ${rejectCount} reject.`
        : `Rejected by simple majority: ${approveCount} approve vs ${rejectCount} reject.`;
      break;
    }

    case 'weighted_trust': {
      passed = approveWeight > rejectWeight;
      margin = totalWeight > 0 ? (approveWeight - rejectWeight) / totalWeight : 0;
      reason = passed
        ? `Approved by trust-weighted vote: ${approveWeight.toFixed(1)} vs ${rejectWeight.toFixed(1)}.`
        : `Rejected by trust-weighted vote: ${approveWeight.toFixed(1)} vs ${rejectWeight.toFixed(1)}.`;
      break;
    }

    case 'unanimous': {
      passed = rejectCount === 0 && approveCount > 0 && approveCount === votes.length;
      margin = passed ? 1 : 0;
      reason = passed
        ? 'Approved unanimously.'
        : `Not unanimous: ${rejectCount} rejection(s), ${abstainCount} abstention(s).`;
      break;
    }

    case 'supermajority_66': {
      const threshold = votes.length * 0.66;
      passed = approveCount >= threshold;
      margin = votes.length > 0 ? approveCount / votes.length : 0;
      reason = passed
        ? `Approved with ${Math.round(margin * 100)}% (≥66% required).`
        : `Rejected: only ${Math.round((approveCount / votes.length) * 100)}% approval (≥66% required).`;
      break;
    }

    case 'supermajority_75': {
      const threshold75 = votes.length * 0.75;
      passed = approveCount >= threshold75;
      margin = votes.length > 0 ? approveCount / votes.length : 0;
      reason = passed
        ? `Approved with ${Math.round(margin * 100)}% (≥75% required).`
        : `Rejected: only ${Math.round((approveCount / votes.length) * 100)}% approval (≥75% required).`;
      break;
    }
  }

  return {
    passed,
    approveCount,
    rejectCount,
    abstainCount,
    totalWeight,
    approveWeight,
    margin,
    reason,
    individualVotes: enrichedVotes,
  };
}

/**
 * Auto-vote for an agent based on their analysis.
 * The agent's LLM output is parsed for a voting decision.
 */
export function autoVoteFromAnalysis(
  agentId: string,
  companyId: string,
  contextId: string,
  contextType: VotingConfig['contextType'],
  analysisText: string,
  proposalText: string
): VotingResult | null {
  // Parse the agent's analysis for a vote signal
  const text = analysisText.toLowerCase();

  let vote: VoteValue = 0;
  let reason = '';

  // Look for explicit vote markers
  if (text.includes('approve') || text.includes('zustimmen') || text.includes('ja') || text.includes('yes') || text.includes('👍')) {
    vote = 1;
    reason = 'Agent approves based on analysis.';
  } else if (text.includes('reject') || text.includes('ablehnen') || text.includes('nein') || text.includes('no') || text.includes('👎')) {
    vote = -1;
    reason = 'Agent rejects based on analysis.';
  } else if (text.includes('abstain') || text.includes('enthaltung') || text.includes('unsure')) {
    vote = 0;
    reason = 'Agent abstains — insufficient information.';
  } else {
    // Default: infer from sentiment
    const positive = (text.match(/\b(good|great|excellent|correct|valid|sound|strong|approve|support)\b/g) || []).length;
    const negative = (text.match(/\b(bad|poor|incorrect|invalid|flawed|weak|reject|oppose|concern)\b/g) || []).length;

    if (positive > negative) {
      vote = 1;
      reason = 'Agent leans positive based on sentiment analysis.';
    } else if (negative > positive) {
      vote = -1;
      reason = 'Agent leans negative based on sentiment analysis.';
    } else {
      vote = 0;
      reason = 'Agent is neutral — no clear signal.';
    }
  }

  castVote(agentId, companyId, contextId, contextType, vote, proposalText, reason);

  return null; // Caller should call resolveVote when ready
}

/**
 * Run a full consensus cycle for a meeting.
 * 1. Each participant votes
 * 2. Results are aggregated
 * 3. Decision is recorded in the meeting
 */
export function runMeetingConsensus(
  meetingId: string,
  proposalText: string,
  method: VotingMethod = 'weighted_trust'
): VotingResult {
  const meeting = db
    .select()
    .from(agentMeetings)
    .where(eq(agentMeetings.id, meetingId))
    .get();

  if (!meeting) {
    return {
      passed: false,
      approveCount: 0, rejectCount: 0, abstainCount: 0,
      totalWeight: 0, approveWeight: 0, margin: 0,
      reason: 'Meeting not found.',
      individualVotes: [],
    };
  }

  const participantIds: string[] = JSON.parse(meeting.participantIds || '[]');

  const result = resolveVote({
    contextId: meetingId,
    contextType: 'meeting',
    companyId: meeting.companyId,
    method,
    proposalText,
    participantIds,
    minParticipation: 0.5,
  });

  // Store result in meeting
  db.update(agentMeetings)
    .set({
      result: `Consensus (${method}): ${result.passed ? 'APPROVED' : 'REJECTED'}\n\n${result.reason}\n\nVotes: ${result.approveCount} approve, ${result.rejectCount} reject, ${result.abstainCount} abstain.`,
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    .where(eq(agentMeetings.id, meetingId))
    .run();

  return result;
}

/**
 * Get voting history for an agent.
 */
export function getAgentVotingRecord(agentId: string): {
  totalVotes: number;
  approvalRate: number;
  consensusAlignment: number; // how often they vote with the majority
} {
  const votes = db
    .select()
    .from(agentVotes)
    .where(eq(agentVotes.agentId, agentId))
    .all();

  if (votes.length === 0) {
    return { totalVotes: 0, approvalRate: 0, consensusAlignment: 0 };
  }

  const approvals = votes.filter(v => v.vote === 1).length;
  const approvalRate = approvals / votes.length;

  // Compute consensus alignment: for each context, was this agent with the majority?
  const contextIds = [...new Set(votes.map(v => v.contextId))];
  let aligned = 0;

  for (const ctxId of contextIds) {
    const contextVotes = votes.filter(v => v.contextId === ctxId);
    if (contextVotes.length === 0) continue;

    // Get all votes for this context
    const allCtxVotes = db
      .select()
      .from(agentVotes)
      .where(and(
        eq(agentVotes.contextId, ctxId as string),
        eq(agentVotes.contextType, contextVotes[0].contextType as any)
      ))
      .all();

    const approveCount = allCtxVotes.filter(v => v.vote === 1).length;
    const rejectCount = allCtxVotes.filter(v => v.vote === -1).length;
    const majorityVote = approveCount >= rejectCount ? 1 : -1;

    const agentVote = contextVotes[0].vote;
    if (agentVote !== 0 && agentVote === majorityVote) {
      aligned++;
    }
  }

  return {
    totalVotes: votes.length,
    approvalRate,
    consensusAlignment: contextIds.length > 0 ? aligned / contextIds.length : 0,
  };
}

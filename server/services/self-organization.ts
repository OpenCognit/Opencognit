// Self-Organization — Dynamic Org-Chart Reorganization
//
// Paperclip has static org charts. OpenCognit has SELF-ORGANIZING hierarchies.
// Agents rise, fall, and reorganize based on trust, workload, and skill gaps.
//
// Based on 2026 Research: "The most effective multi-agent systems adapt their
// structure to the task, not the other way around."

import crypto from 'crypto';
import { db } from '../db/client.js';
import { agents, agentTrustScores, tasks, companies } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getTrustScore } from './trust-reputation.js';

export interface ReorgProposal {
  id: string;
  type: 'promotion' | 'demotion' | 'reassignment' | 'new_role' | 'merge' | 'split';
  subjectExpertId: string;
  subjectName: string;
  currentRole: string;
  proposedRole?: string;
  newReportsTo?: string;
  rationale: string;
  confidence: number; // 0-1
  expectedImpact: 'high' | 'medium' | 'low';
  autoApply: boolean; // if true, applies immediately without approval
}

export interface OrgHealthReport {
  unternehmenId: string;
  companyId: string;
  timestamp: string;
  agentCount: number;
  avgTrustScore: number;
  trustVariance: number; // high variance = unstable org
  workloadBalance: number; // 0-1, 1 = perfectly balanced
  skillCoverage: number; // 0-1, 1 = all required skills covered
  proposals: ReorgProposal[];
  anomalies: Array<{
    agentId: string;
    name: string;
    issue: string;
    severity: 'critical' | 'warning';
  }>;
}

// ─── Thresholds for automatic reorganization ────────────────────────────────

const TRUST_PROMOTION_THRESHOLD = 0.85; // Trust >= 85% → consider promotion
const TRUST_DEMOTION_THRESHOLD = 0.40;  // Trust <= 40% → consider demotion
const TRUST_TERMINATE_THRESHOLD = 0.20; // Trust <= 20% → consider termination
const WORKLOAD_IMBALANCE_RATIO = 2.5;   // Most loaded / least loaded > 2.5x → rebalance
const MIN_TASKS_FOR_EVAL = 5;           // Minimum completed tasks before reorg

// ─── 1. Analyze Org Health ──────────────────────────────────────────────────

/**
 * Analyze the health of an organization's agent structure.
 * Returns proposals for reorganization based on trust, workload, and skills.
 */
export async function analyzeOrgHealth(unternehmenId: string): Promise<OrgHealthReport> {
  const agentRows = db.select()
    .from(agents)
    .where(eq(agents.companyId, unternehmenId))
    .all();

  const now = new Date().toISOString();
  const proposals: ReorgProposal[] = [];
  const anomalies: OrgHealthReport['anomalies'] = [];

  // ── Trust Analysis ───────────────────────────────────────────────────────
  const trustScores: Array<{ agentId: string; score: number; name: string }> = [];
  for (const agent of agentRows) {
    const trust = getTrustScore(agent.id, unternehmenId);
    const score = trust.score;
    trustScores.push({ agentId: agent.id, score, name: agent.name });

    // Anomaly: critical trust collapse
    if (score < TRUST_TERMINATE_THRESHOLD) {
      anomalies.push({
        agentId: agent.id,
        name: agent.name,
        issue: `Trust collapsed to ${(score * 100).toFixed(0)}% — consider termination`,
        severity: 'critical',
      });
    } else if (score < TRUST_DEMOTION_THRESHOLD) {
      anomalies.push({
        agentId: agent.id,
        name: agent.name,
        issue: `Trust low at ${(score * 100).toFixed(0)}% — performance review needed`,
        severity: 'warning',
      });
    }
  }

  const avgTrust = trustScores.reduce((s, t) => s + t.score, 0) / (trustScores.length || 1);
  const trustVariance = trustScores.reduce((s, t) => s + Math.pow(t.score - avgTrust, 2), 0) / (trustScores.length || 1);

  // ── Workload Analysis ────────────────────────────────────────────────────
  const workload: Array<{ agentId: string; name: string; openTasks: number; doneTasks: number }> = [];
  for (const agent of agentRows) {
    const open = db.select({ count: sql<number>`COUNT(*)` })
      .from(tasks)
      .where(and(
        eq(tasks.assignedTo, agent.id),
        eq(tasks.status, 'in_progress')
      ))
      .get()?.count || 0;

    const done = db.select({ count: sql<number>`COUNT(*)` })
      .from(tasks)
      .where(and(
        eq(tasks.assignedTo, agent.id),
        eq(tasks.status, 'done')
      ))
      .get()?.count || 0;

    workload.push({ agentId: agent.id, name: agent.name, openTasks: open, doneTasks: done });
  }

  const maxLoad = Math.max(...workload.map(w => w.openTasks), 1);
  const minLoad = Math.min(...workload.map(w => w.openTasks));
  const workloadBalance = maxLoad > 0 ? minLoad / maxLoad : 1;

  // Anomaly: severe workload imbalance
  if (maxLoad / Math.max(minLoad, 1) > WORKLOAD_IMBALANCE_RATIO) {
    const overloaded = workload.filter(w => w.openTasks >= maxLoad * 0.8);
    const underloaded = workload.filter(w => w.openTasks <= maxLoad * 0.2);

    for (const o of overloaded) {
      for (const u of underloaded.slice(0, 2)) {
        proposals.push({
          id: crypto.randomUUID(),
          type: 'reassignment',
          subjectExpertId: o.agentId,
          subjectName: o.name,
          currentRole: agentRows.find(a => a.id === o.agentId)?.role || '',
          rationale: `${o.name} is overloaded (${o.openTasks} open tasks). ${u.name} has capacity (${u.openTasks} tasks). Suggest task redistribution.`,
          confidence: 0.75,
          expectedImpact: 'medium',
          autoApply: true,
        });
      }
    }
  }

  // ── Promotion Proposals ──────────────────────────────────────────────────
  for (const { agentId, score, name } of trustScores) {
    if (score >= TRUST_PROMOTION_THRESHOLD) {
      const agent = agentRows.find(a => a.id === agentId);
      if (!agent) continue;

      // Check if agent has enough completed work to justify promotion
      const doneCount = db.select({ count: sql<number>`COUNT(*)` })
        .from(tasks)
        .where(and(
          eq(tasks.assignedTo, agentId),
          eq(tasks.status, 'done')
        ))
        .get()?.count || 0;

      if (doneCount < MIN_TASKS_FOR_EVAL) continue;

      // Find who they report to
      const currentManager = agent.reportsTo
        ? agentRows.find(a => a.id === agent.reportsTo)
        : null;

      // If they report to someone with lower trust, propose promotion
      if (currentManager) {
        const managerScore = trustScores.find(t => t.agentId === currentManager.id)?.score || 0;
        if (score > managerScore + 0.15) {
          proposals.push({
            id: crypto.randomUUID(),
            type: 'promotion',
            subjectExpertId: agentId,
            subjectName: name,
            currentRole: agent.role,
            proposedRole: suggestHigherRole(agent.role),
            newReportsTo: currentManager.reportsTo || undefined,
            rationale: `${name} has exceptional trust (${(score * 100).toFixed(0)}%) and outperforms their manager ${currentManager.name} (${(managerScore * 100).toFixed(0)}%). ${doneCount} tasks completed.`,
            confidence: score * 0.9,
            expectedImpact: 'high',
            autoApply: false, // Requires board approval
          });
        }
      }
    }
  }

  // ── Demotion Proposals ───────────────────────────────────────────────────
  for (const { agentId, score, name } of trustScores) {
    if (score <= TRUST_DEMOTION_THRESHOLD && score > TRUST_TERMINATE_THRESHOLD) {
      const agent = agentRows.find(a => a.id === agentId);
      if (!agent || agent.isOrchestrator) continue; // Don't demote CEO automatically

      proposals.push({
        id: crypto.randomUUID(),
        type: 'demotion',
        subjectExpertId: agentId,
        subjectName: name,
        currentRole: agent.role,
        proposedRole: suggestLowerRole(agent.role),
        rationale: `${name} trust score dropped to ${(score * 100).toFixed(0)}%. Consistent underperformance detected. Recommend demotion and supervised reassignment.`,
        confidence: 1 - score,
        expectedImpact: 'medium',
        autoApply: false,
      });
    }
  }

  // ── Skill Gap Analysis ───────────────────────────────────────────────────
  const allSkills = new Set<string>();
  const agentSkills = new Map<string, Set<string>>();

  for (const agent of agentRows) {
    const skills = new Set<string>((agent.skills || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s !== ''));
    agentSkills.set(agent.id, skills);
    skills.forEach(s => allSkills.add(s));
  }

  // Find skills that only one agent has → single point of failure
  const skillCounts = new Map<string, number>();
  for (const [, skills] of agentSkills) {
    for (const skill of skills) {
      skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
    }
  }

  const rareSkills = Array.from(skillCounts.entries())
    .filter(([, count]) => count === 1)
    .map(([skill]) => skill);

  if (rareSkills.length > 0) {
    proposals.push({
      id: crypto.randomUUID(),
      type: 'new_role',
      subjectExpertId: '',
      subjectName: 'New Agent',
      currentRole: '',
      proposedRole: 'Specialist (' + rareSkills.slice(0, 3).join(', ') + ')',
      rationale: `Single point of failure detected: ${rareSkills.length} unique skills are held by only one agent each. Recommend hiring backup specialists.`,
      confidence: 0.7,
      expectedImpact: 'high',
      autoApply: false,
    });
  }

  // ── Skill Coverage Score ─────────────────────────────────────────────────
  const totalUniqueSkills = allSkills.size;
  const skillCoverage = totalUniqueSkills > 0
    ? Array.from(skillCounts.values()).filter(c => c >= 2).length / totalUniqueSkills
    : 1;

  return {
    unternehmenId,
    companyId: unternehmenId,
    timestamp: now,
    agentCount: agentRows.length,
    avgTrustScore: avgTrust,
    trustVariance,
    workloadBalance,
    skillCoverage,
    proposals: proposals.sort((a, b) => b.confidence - a.confidence),
    anomalies,
  };
}

// ─── 2. Apply Reorganization ────────────────────────────────────────────────

/**
 * Apply an auto-approved reorganization proposal.
 * Returns true if applied successfully.
 */
export function applyReorg(proposal: ReorgProposal): boolean {
  if (!proposal.autoApply) {
    throw new Error('Proposal requires board approval — cannot auto-apply');
  }

  const now = new Date().toISOString();

  switch (proposal.type) {
    case 'reassignment': {
      // Just log it — actual task reassignment happens via Contract-Net
      console.log(`[Self-Org] Task redistribution recommended: ${proposal.rationale}`);
      return true;
    }

    case 'promotion': {
      if (!proposal.proposedRole || !proposal.newReportsTo) return false;
      db.update(agents)
        .set({
          role: proposal.proposedRole,
          reportsTo: proposal.newReportsTo,
          updatedAt: now,
        })
        .where(eq(agents.id, proposal.subjectExpertId))
        .run();
      console.log(`[Self-Org] ${proposal.subjectName} promoted to ${proposal.proposedRole}`);
      return true;
    }

    case 'demotion': {
      if (!proposal.proposedRole) return false;
      db.update(agents)
        .set({
          role: proposal.proposedRole,
          status: 'paused',
          updatedAt: now,
        })
        .where(eq(agents.id, proposal.subjectExpertId))
        .run();
      console.log(`[Self-Org] ${proposal.subjectName} demoted to ${proposal.proposedRole} and paused`);
      return true;
    }

    default:
      return false;
  }
}

// ─── 3. Role Helpers ────────────────────────────────────────────────────────

function suggestHigherRole(currentRole: string): string {
  const hierarchy: Record<string, string> = {
    'developer': 'senior_developer',
    'designer': 'lead_designer',
    'marketing': 'marketing_manager',
    'qa': 'qa_lead',
    'content_writer': 'content_lead',
    'business_analyst': 'product_manager',
    'senior_developer': 'cto',
    'lead_designer': 'cto',
    'marketing_manager': 'ceo',
    'qa_lead': 'cto',
    'content_lead': 'cto',
    'product_manager': 'ceo',
  };
  return hierarchy[currentRole.toLowerCase()] || currentRole;
}

function suggestLowerRole(currentRole: string): string {
  const demotion: Record<string, string> = {
    'cto': 'senior_developer',
    'ceo': 'business_analyst',
    'marketing_manager': 'marketing',
    'qa_lead': 'qa',
    'lead_designer': 'designer',
    'content_lead': 'content_writer',
    'product_manager': 'business_analyst',
    'senior_developer': 'developer',
  };
  return demotion[currentRole.toLowerCase()] || currentRole;
}

// ─── 4. Periodic Self-Organization Check ────────────────────────────────────

/**
 * Run self-organization analysis for all active companies.
 * Should be called by cron or heartbeat periodically.
 */
export async function runPeriodicSelfOrg(): Promise<void> {
  const companyRows = db.select()
    .from(companies)
    .where(eq(companies.status, 'active'))
    .all();

  for (const company of companyRows) {
    try {
      const health = await analyzeOrgHealth(company.id);

      // Auto-apply safe proposals
      const autoProposals = health.proposals.filter(p => p.autoApply);
      for (const proposal of autoProposals) {
        applyReorg(proposal);
      }

      // Log health report
      console.log(`[Self-Org] ${company.name}: ${health.agentCount} agents, avg trust ${(health.avgTrustScore * 100).toFixed(0)}%, ${health.proposals.length} proposals (${autoProposals.length} auto-applied)`);

      // Write report to company workspace
      // ... (optional: persist report for dashboard)
    } catch (e: any) {
      console.error(`[Self-Org] Failed for ${company.id}:`, e.message);
    }
  }
}

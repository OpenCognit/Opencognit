// Self-Healing — Error recovery for agents
// When an agent enters error state, analyzes the failure and prepares recovery context.

import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { tasks, comments, agents } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

/**
 * If agent is in error state, analyze the last failed task and write recovery notes.
 * Returns recovery context string to inject into system prompt, or null.
 */
export function prepareRecoveryContext(agentId: string, companyId: string): string | null {
  const agent = db.select({ status: agents.status, name: agents.name, soulPath: agents.soulPath })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();

  if (!agent || agent.status !== 'error' || !agent.soulPath) return null;

  // Find last failed task assigned to this agent
  const failedTask = db.select({ id: tasks.id, title: tasks.title, description: tasks.description })
    .from(tasks)
    .where(and(
      eq(tasks.assignedTo, agentId),
      eq(tasks.companyId, companyId),
      eq(tasks.status, 'cancelled' as any)
    ))
    .orderBy(desc(tasks.completedAt))
    .limit(1)
    .get();

  if (!failedTask) return null;

  const commentRows = db.select({ content: comments.content })
    .from(comments)
    .where(and(eq(comments.taskId, failedTask.id), eq(comments.authorType, 'agent')))
    .orderBy(desc(comments.createdAt))
    .limit(3)
    .all();

  const agentDir = path.dirname(agent.soulPath);
  const recoveryDir = path.join(agentDir, 'memory');
  if (!fs.existsSync(recoveryDir)) fs.mkdirSync(recoveryDir, { recursive: true });

  const recoveryPath = path.join(recoveryDir, 'error-recovery.md');
  const recoveryContent = [
    `# Error Recovery — ${new Date().toISOString()}`,
    `**Task:** ${failedTask.title}`,
    `**Agent:** ${agent.name}`,
    '',
    `## Failure Context`,
    failedTask.description || 'No description',
    '',
    `## Agent Output`,
    ...(commentRows.length > 0 ? commentRows.map(c => `- ${c.content.slice(0, 300)}`) : ['- No agent output recorded']),
    '',
    `## Recovery Instructions`,
    '- Analyze the root cause before attempting a fix',
    '- Break the fix into smaller, verifiable steps',
    '- If stuck after 2 attempts, delegate to supervisor',
  ].join('\n');

  fs.writeFileSync(recoveryPath, recoveryContent, 'utf-8');

  return [
    `\n\n--- RECOVERY MODE ---`,
    `You previously failed on task: "${failedTask.title}"`,
    `Error analysis has been written to your memory folder.`,
    `Focus on understanding the root cause before fixing.`,
    `Break the fix into small, verifiable steps.`,
  ].join('\n');
}

// Skill Extractor — Auto-generates reusable skills from completed tasks

import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { tasks, comments, agents } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

/**
 * After a task is marked done, extract a reusable skill if the task was complex enough.
 * Saves to: agents/{name}/skills/{safe-task-title}.md
 */
export async function extractSkill(
  taskId: string,
  agentId: string,
  companyId: string
): Promise<string | null> {
  const task = db.select({ id: tasks.id, title: tasks.title, description: tasks.description })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .get();
  if (!task) return null;

  const agent = db.select({ name: agents.name, soulPath: agents.soulPath })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent?.soulPath) return null;

  // Load recent agent comments on this task
  const commentRows = db.select({ content: comments.content, authorType: comments.authorType })
    .from(comments)
    .where(and(eq(comments.taskId, taskId), eq(comments.authorType, 'agent')))
    .orderBy(desc(comments.createdAt))
    .limit(5)
    .all();

  // Only extract if there was meaningful agent output
  const agentOutput = commentRows.map(c => c.content).join('\n\n');
  if (agentOutput.length < 200) return null; // Too simple — not worth a skill

  const safeTitle = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const skillsDir = path.join(path.dirname(agent.soulPath), 'skills');
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

  const skillPath = path.join(skillsDir, `${safeTitle}.md`);

  // Don't overwrite existing skills
  if (fs.existsSync(skillPath)) return null;

  const skillContent = [
    `# Skill: ${task.title}`,
    `**Agent:** ${agent.name}  `,
    `**Date:** ${new Date().toISOString()}  `,
    `**Task ID:** ${taskId}`,
    '',
    `## Problem`,
    task.description || task.title,
    '',
    `## Solution`,
    agentOutput.slice(0, 2000), // Cap length
    '',
    `## Key Steps`,
    ...(commentRows.length > 0
      ? commentRows.slice(0, 3).map((c, i) => `${i + 1}. ${c.content.slice(0, 200).replace(/\n/g, ' ')}...`)
      : ['1. Execute task systematically', '2. Document results', '3. Verify output']),
    '',
    `## Learned Pitfalls`,
    '- Review output before marking done',
    '- Ensure all sub-steps are completed',
  ].join('\n');

  fs.writeFileSync(skillPath, skillContent, 'utf-8');
  console.log(`  📚 Skill extracted: ${skillPath}`);
  return skillPath;
}

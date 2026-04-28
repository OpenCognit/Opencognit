// Shared Memory — Cross-Agent Memory Sharing
// Aggregates insights from all agents into a company-wide shared knowledge base.

import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { agents, companies } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Sync all agent memories into the company shared memory folder.
 * Creates / updates company-facts.md from all agent insights.
 */
export function syncSharedMemory(companyId: string): void {
  const company = db.select({ workDir: companies.workDir }).from(companies).where(eq(companies.id, companyId)).get();
  if (!company?.workDir) return;

  const sharedDir = path.join(company.workDir, 'shared');
  if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });

  const agentRows = db.select({ id: agents.id, name: agents.name, soulPath: agents.soulPath })
    .from(agents)
    .where(eq(agents.companyId, companyId))
    .all();

  const facts: string[] = [
    '# Company Shared Memory',
    `**Last Sync:** ${new Date().toISOString()}`,
    `**Agents:** ${agentRows.length}`,
    '',
    '## Active Agent Insights',
  ];

  for (const agent of agentRows) {
    if (!agent.soulPath) continue;
    const memoryDir = path.join(path.dirname(agent.soulPath), 'memory');
    if (!fs.existsSync(memoryDir)) continue;

    const entries = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    if (entries.length === 0) continue;

    facts.push(`\n### ${agent.name}`);
    for (const entry of entries.slice(0, 3)) {
      const content = fs.readFileSync(path.join(memoryDir, entry), 'utf-8');
      const firstLine = content.split('\n')[0].replace(/^#+\s*/, '');
      facts.push(`- **${firstLine}** (${entry})`);
    }
  }

  facts.push('\n## Conventions');
  facts.push('- All agents can read this file');
  facts.push('- Write to `shared/` to share with other agents');
  facts.push('- Keep entries factual and concise');

  fs.writeFileSync(path.join(sharedDir, 'company-facts.md'), facts.join('\n'), 'utf-8');
}

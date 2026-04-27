/**
 * Agent Identity Directory Helpers
 * ================================
 * Centralized path resolution for SOUL.md and AGENTS.md files.
 * Extracted to avoid circular dependencies between services and index.ts
 */

import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { companies } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export function getAgentIdentityDir(agent: { name: string; companyId: string }): { soulPath: string; agentsPath: string; dir: string } {
  const safeName = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const company = db.select({ workDir: companies.workDir }).from(companies).where(eq(companies.id, agent.companyId)).get();
  if (company?.workDir && fs.existsSync(company.workDir)) {
    const dir = path.join(company.workDir, 'agents', safeName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return { dir, soulPath: path.join(dir, 'SOUL.md'), agentsPath: path.join(dir, 'AGENTS.md') };
  }
  // Fallback: legacy data/souls directory
  const soulsDir = path.resolve('data', 'souls');
  if (!fs.existsSync(soulsDir)) fs.mkdirSync(soulsDir, { recursive: true });
  return { dir: soulsDir, soulPath: path.join(soulsDir, `${safeName}.soul.md`), agentsPath: path.join(soulsDir, `${safeName}.agents.md`) };
}

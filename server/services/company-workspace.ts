// Company Workspace — Shared directory structure for all agents in a company
// Creates inbox/, outbox/, shared/, decisions/ inside the company workDir.

import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { companies } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const COMPANY_SUBDIRS = ['agents', 'inbox', 'outbox', 'shared', 'decisions', 'memory'];

/**
 * Ensure the company workspace structure exists.
 * If workDir is set and exists, creates subdirs inside it.
 * If workDir is not set, creates a default workspace under data/companies/{id}/.
 * Returns the root path.
 */
export function ensureCompanyWorkspace(unternehmenId: string): string {
  const company = db.select({ id: companies.id, workDir: companies.workDir })
    .from(companies)
    .where(eq(companies.id, unternehmenId))
    .get();

  let root: string;
  if (company?.workDir && fs.existsSync(company.workDir)) {
    root = company.workDir;
  } else {
    root = path.join(process.cwd(), 'data', 'companies', unternehmenId);
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    // Update DB with auto-created workDir
    if (!company?.workDir) {
      db.update(companies).set({ workDir: root }).where(eq(companies.id, unternehmenId)).run();
    }
  }

  for (const sub of COMPANY_SUBDIRS) {
    const subPath = path.join(root, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
    }
  }

  // Create default README in decisions/
  const decisionsReadme = path.join(root, 'decisions', 'README.md');
  if (!fs.existsSync(decisionsReadme)) {
    fs.writeFileSync(decisionsReadme, [
      '# Decisions Log',
      '',
      'This is an append-only audit trail of all significant decisions made by agents.',
      'Format: YYYY-MM-DD_agent-name_decision-title.md',
      '',
      '## Rules',
      '- Never edit or delete existing entries',
      '- Each entry must include: who, when, what, why',
      '- Link back to the parent goal or ticket',
    ].join('\n'), 'utf-8');
  }

  // Create default README in shared/
  const sharedReadme = path.join(root, 'shared', 'README.md');
  if (!fs.existsSync(sharedReadme)) {
    fs.writeFileSync(sharedReadme, [
      '# Shared Workspace',
      '',
      'Agents place files here for other agents to consume.',
      'This is the company\'s communal desk — keep it tidy.',
      '',
      '## Conventions',
      '- One file per deliverable',
      '- Use descriptive names: api-draft-v1.md, campaign-ideas-q2.md',
      '- Mark WIP files with _WIP suffix',
    ].join('\n'), 'utf-8');
  }

  return root;
}

/**
 * Write a decision log entry.
 */
export function logDecision(
  unternehmenId: string,
  agentName: string,
  title: string,
  content: string
): string {
  const root = ensureCompanyWorkspace(unternehmenId);
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const filename = `${new Date().toISOString().slice(0, 10)}_${agentName.replace(/\s+/g, '-')}_${safeTitle}.md`;
  const filepath = path.join(root, 'decisions', filename);

  const entry = [
    `# ${title}`,
    `**Agent:** ${agentName}  `,
    `**Date:** ${new Date().toISOString()}  `,
    `**Company:** ${unternehmenId}`,
    '',
    content,
  ].join('\n');

  fs.writeFileSync(filepath, entry, 'utf-8');
  return filepath;
}

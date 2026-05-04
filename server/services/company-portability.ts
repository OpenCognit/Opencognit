// Company Import/Export Service — Volle Portabilität
// Exportiert eine Firma als JSON-Manifest (Agents, Skills, Tasks, Settings).
// Importiert mit Preview, Collision-Handling und Adapter-Override.

import { db } from '../db/client.js';
import { companies, agents, tasks, skillsLibrary, agentSkills, settings, budgetPolicies } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// ─── Manifest Types ──────────────────────────────────────────────��──────────

export interface CompanyManifest {
  version: '1.0.0';
  exportiertAm: string;
  companies: {
    name: string;
    description: string | null;
    goal: string | null;
    workDir: string | null;
  };
  agenten: Array<{
    name: string;
    role: string;
    title: string | null;
    capabilities: string | null;
    connectionType: string;
    avatar: string | null;
    avatarColor: string;
    monthlyBudgetCent: number;
    reportsToName: string | null; // Name statt ID für Portabilität
    systemPrompt: string | null;
    isOrchestrator: boolean;
    skills: Array<{
      name: string;
      description: string | null;
      content: string;
      tags: string | null;
      confidence: number;
      source: string;
    }>;
  }>;
  tasks: Array<{
    title: string;
    description: string | null;
    status: string;
    priority: string;
    assignedToName: string | null; // Name statt ID
  }>;
  settings: Array<{
    schluessel: string;
    wert: string;
    istGeheim: boolean;
  }>;
  budgetPolicies: Array<{
    scope: string;
    scopeName: string; // Name des Scopes (Company/Agent-Name)
    limitCent: number;
    fenster: string;
    warnProzent: number;
    hardStop: boolean;
  }>;
}

export interface ImportOptions {
  /** Collision-Strategie für Agenten mit gleichem Namen */
  collisionStrategy: 'skip' | 'rename' | 'replace';
  /** Adapter-Override (z.B. alle auf 'openrouter' setzen) */
  adapterOverride?: string;
  /** Nur bestimmte Agenten importieren */
  agentFilter?: string[];
  /** Tasks importieren? */
  importTasks?: boolean;
  /** Einstellungen importieren? */
  importSettings?: boolean;
}

export interface ImportPreview {
  unternehmenName: string;
  agentenCount: number;
  aufgabenCount: number;
  skillsCount: number;
  collisions: Array<{ name: string; typ: string }>;
}

// ─── Export ─────────────────────────────────────────────────────────────────

export function exportCompany(companyId: string): CompanyManifest | null {
  const company = db.select().from(companies).where(eq(companies.id, companyId)).get();
  if (!company) return null;

  const agentsRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
  const tasksRows = db.select().from(tasks).where(eq(tasks.companyId, companyId)).all();
  const settingsRows = db.select().from(settings).where(eq(settings.companyId, companyId)).all();
  const policies = db.select().from(budgetPolicies).where(eq(budgetPolicies.companyId, companyId)).all();

  // Agent-ID → Name Mapping
  const idToName = new Map(agentsRows.map(a => [a.id, a.name]));

  // Manifest bauen
  const manifest: CompanyManifest = {
    version: '1.0.0',
    exportiertAm: new Date().toISOString(),
    companies: {
      name: company.name,
      description: company.description,
      goal: company.goal,
      workDir: company.workDir,
    },
    agenten: agentsRows.map(a => {
      // Skills für diesen Agent laden
      const agentSkillsRows = db.select({ skill: skillsLibrary }).from(agentSkills)
        .innerJoin(skillsLibrary, eq(agentSkills.skillId, skillsLibrary.id))
        .where(eq(agentSkills.agentId, a.id))
        .all()
        .map((r: any) => r.skill);

      let isOrch = false;
      try { isOrch = JSON.parse(a.connectionConfig || '{}').isOrchestrator === true; } catch {}

      return {
        name: a.name,
        role: a.role,
        title: a.title,
        capabilities: a.skills,
        connectionType: a.connectionType,
        avatar: a.avatar,
        avatarColor: a.avatarColor,
        monthlyBudgetCent: a.monthlyBudgetCent,
        reportsToName: a.reportsTo ? idToName.get(a.reportsTo) || null : null,
        systemPrompt: a.systemPrompt,
        isOrchestrator: isOrch,
        skills: agentSkillsRows.map(s => ({
          name: s.name,
          description: s.description,
          content: s.content,
          tags: s.tags,
          confidence: s.confidence,
          source: s.source,
        })),
      };
    }),
    tasks: tasksRows.map(t => ({
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assignedToName: t.assignedTo ? idToName.get(t.assignedTo) || null : null,
    })),
    settings: settingsRows
      .filter(s => !s.key.includes('api_key') && !s.key.includes('token')) // Secrets nicht exportieren
      .map(s => ({
        schluessel: s.key,
        wert: s.value || '',
        istGeheim: false,
      })),
    budgetPolicies: policies.map(p => ({
      scope: p.scope,
      scopeName: p.scope === 'agent' ? (idToName.get(p.scopeId) || p.scopeId) : company.name,
      limitCent: p.limitCent,
      fenster: p.fenster,
      warnProzent: p.warnProzent,
      hardStop: p.hardStop,
    })),
  };

  return manifest;
}

// ─── Import Preview ────────────────────────���────────────────────────────────

export function previewImport(targetUnternehmenId: string, manifest: CompanyManifest): ImportPreview {
  const existingAgents = db.select().from(agents)
    .where(eq(agents.companyId, targetUnternehmenId)).all();
  const existingNames = new Set(existingAgents.map(a => a.name));

  const collisions = manifest.agenten
    .filter(a => existingNames.has(a.name))
    .map(a => ({ name: a.name, typ: 'agent' }));

  return {
    unternehmenName: manifest.companies.name,
    agentenCount: manifest.agenten.length,
    aufgabenCount: manifest.tasks.length,
    skillsCount: manifest.agenten.reduce((s, a) => s + a.skills.length, 0),
    collisions,
  };
}

// ─── Import ───────────────────────────────────────────────────���─────────────

export function importCompany(
  targetUnternehmenId: string,
  manifest: CompanyManifest,
  options: ImportOptions
): { success: boolean; agentsImported: number; tasksImported: number; errors: string[] } {
  const now = new Date().toISOString();
  const errors: string[] = [];
  let agentsImported = 0;
  let tasksImported = 0;

  const existingAgents = db.select().from(agents)
    .where(eq(agents.companyId, targetUnternehmenId)).all();
  const existingNames = new Set(existingAgents.map(a => a.name));
  const nameToId = new Map<string, string>();

  // ─── Pre-transaction: collision handling + ID generation ────────────
  const agentsToImport: Array<{
    agentDef: CompanyManifest['agenten'][0];
    name: string;
    agentId: string;
    verbindungsTyp: string;
    config: string;
  }> = [];

  for (const agentDef of manifest.agenten) {
    if (options.agentFilter && !options.agentFilter.includes(agentDef.name)) continue;

    let name = agentDef.name;

    if (existingNames.has(name)) {
      if (options.collisionStrategy === 'skip') continue;
      if (options.collisionStrategy === 'rename') {
        name = `${name} (Import)`;
      }
      // 'replace': Lösche existierenden Agent → wird unten neu erstellt
    }

    const agentId = uuid();
    nameToId.set(agentDef.name, agentId);

    const verbindungsTyp = options.adapterOverride || agentDef.connectionType;
    const config = agentDef.isOrchestrator
      ? JSON.stringify({ isOrchestrator: true, autonomyLevel: 'teamplayer' })
      : JSON.stringify({ autonomyLevel: 'copilot' });

    agentsToImport.push({ agentDef, name, agentId, verbindungsTyp, config });
  }

  // Tasks vorbereiten
  const tasksToImport = options.importTasks !== false
    ? manifest.tasks.map(taskDef => ({
        taskDef,
        assignedTo: taskDef.assignedToName ? nameToId.get(taskDef.assignedToName) || null : null,
      }))
    : [];

  // ─── Atomic transaction: all DB mutations ───────────────────────────
  try {
    db.transaction((tx) => {
      for (const { agentDef, name, agentId, verbindungsTyp, config } of agentsToImport) {
        tx.insert(agents).values({
          id: agentId,
          companyId: targetUnternehmenId,
          name,
          role: agentDef.role,
          title: agentDef.title,
          capabilities: agentDef.skills,
          connectionType: verbindungsTyp,
          connectionConfig: config,
          avatar: agentDef.avatar,
          avatarColor: agentDef.avatarColor,
          monthlyBudgetCent: agentDef.monthlyBudgetCent,
          monthlySpendCent: 0,
          systemPrompt: agentDef.systemPrompt,
          status: 'idle',
          messageCount: 0,
          createdAt: now,
          updatedAt: now,
        }).run();

        for (const skillDef of agentDef.skills) {
          const skillId = uuid();
          tx.insert(skillsLibrary).values({
            id: skillId,
            companyId: targetUnternehmenId,
            name: skillDef.name,
            description: skillDef.description,
            content: skillDef.content,
            tags: skillDef.tags,
            confidence: skillDef.confidence || 50,
            uses: 0,
            successes: 0,
            source: (skillDef.source as any) || 'manuell',
            createdBy: 'import',
            createdAt: now,
            updatedAt: now,
          }).run();

          tx.insert(agentSkills).values({
            id: uuid(), agentId, skillId, createdAt: now,
          }).run();
        }

        agentsImported++;
      }

      // Phase 2: reportsTo auflösen
      for (const agentDef of manifest.agenten) {
        if (agentDef.reportsToName) {
          const agentId = nameToId.get(agentDef.name);
          const reportsToId = nameToId.get(agentDef.reportsToName);
          if (agentId && reportsToId) {
            tx.update(agents).set({ reportsTo: reportsToId, updatedAt: now })
              .where(eq(agents.id, agentId)).run();
          }
        }
      }

      // Phase 3: Tasks importieren
      for (const { taskDef, assignedTo } of tasksToImport) {
        tx.insert(tasks).values({
          id: uuid(),
          companyId: targetUnternehmenId,
          title: taskDef.title,
          description: taskDef.description,
          status: taskDef.status as any,
          priority: taskDef.priority as any,
          assignedTo,
          createdAt: now,
          updatedAt: now,
        }).run();
        tasksImported++;
      }
    });
  } catch (err: any) {
    errors.push(`Import-Transaktion fehlgeschlagen: ${err.message}`);
    return { success: false, agentsImported: 0, tasksImported: 0, errors };
  }

  return { success: errors.length === 0, agentsImported, tasksImported, errors };
}

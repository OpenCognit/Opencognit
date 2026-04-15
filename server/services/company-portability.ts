// Company Import/Export Service — Volle Portabilität
// Exportiert eine Firma als JSON-Manifest (Agents, Skills, Tasks, Settings).
// Importiert mit Preview, Collision-Handling und Adapter-Override.

import { db } from '../db/client.js';
import { unternehmen, experten, aufgaben, skillsLibrary, expertenSkills, einstellungen, budgetPolicies } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// ─── Manifest Types ──────────────────────────────────────────────��──────────

export interface CompanyManifest {
  version: '1.0.0';
  exportiertAm: string;
  unternehmen: {
    name: string;
    beschreibung: string | null;
    ziel: string | null;
    workDir: string | null;
  };
  agenten: Array<{
    name: string;
    rolle: string;
    titel: string | null;
    faehigkeiten: string | null;
    verbindungsTyp: string;
    avatar: string | null;
    avatarFarbe: string;
    budgetMonatCent: number;
    reportsToName: string | null; // Name statt ID für Portabilität
    systemPrompt: string | null;
    isOrchestrator: boolean;
    skills: Array<{
      name: string;
      beschreibung: string | null;
      inhalt: string;
      tags: string | null;
      konfidenz: number;
      quelle: string;
    }>;
  }>;
  aufgaben: Array<{
    titel: string;
    beschreibung: string | null;
    status: string;
    prioritaet: string;
    zugewiesenAnName: string | null; // Name statt ID
  }>;
  einstellungen: Array<{
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

export function exportCompany(unternehmenId: string): CompanyManifest | null {
  const company = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();
  if (!company) return null;

  const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
  const tasks = db.select().from(aufgaben).where(eq(aufgaben.unternehmenId, unternehmenId)).all();
  const settings = db.select().from(einstellungen).where(eq(einstellungen.unternehmenId, unternehmenId)).all();
  const policies = db.select().from(budgetPolicies).where(eq(budgetPolicies.unternehmenId, unternehmenId)).all();

  // Agent-ID → Name Mapping
  const idToName = new Map(agents.map(a => [a.id, a.name]));

  // Manifest bauen
  const manifest: CompanyManifest = {
    version: '1.0.0',
    exportiertAm: new Date().toISOString(),
    unternehmen: {
      name: company.name,
      beschreibung: company.beschreibung,
      ziel: company.ziel,
      workDir: company.workDir,
    },
    agenten: agents.map(a => {
      // Skills für diesen Agent laden
      const agentSkills = db.select({ skill: skillsLibrary }).from(expertenSkills)
        .innerJoin(skillsLibrary, eq(expertenSkills.skillId, skillsLibrary.id))
        .where(eq(expertenSkills.expertId, a.id))
        .all()
        .map((r: any) => r.skill);

      let isOrch = false;
      try { isOrch = JSON.parse(a.verbindungsConfig || '{}').isOrchestrator === true; } catch {}

      return {
        name: a.name,
        rolle: a.rolle,
        titel: a.titel,
        faehigkeiten: a.faehigkeiten,
        verbindungsTyp: a.verbindungsTyp,
        avatar: a.avatar,
        avatarFarbe: a.avatarFarbe,
        budgetMonatCent: a.budgetMonatCent,
        reportsToName: a.reportsTo ? idToName.get(a.reportsTo) || null : null,
        systemPrompt: a.systemPrompt,
        isOrchestrator: isOrch,
        skills: agentSkills.map(s => ({
          name: s.name,
          beschreibung: s.beschreibung,
          inhalt: s.inhalt,
          tags: s.tags,
          konfidenz: s.konfidenz,
          quelle: s.quelle,
        })),
      };
    }),
    aufgaben: tasks.map(t => ({
      titel: t.titel,
      beschreibung: t.beschreibung,
      status: t.status,
      prioritaet: t.prioritaet,
      zugewiesenAnName: t.zugewiesenAn ? idToName.get(t.zugewiesenAn) || null : null,
    })),
    einstellungen: settings
      .filter(s => !s.schluessel.includes('api_key') && !s.schluessel.includes('token')) // Secrets nicht exportieren
      .map(s => ({
        schluessel: s.schluessel,
        wert: s.wert || '',
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
  const existingAgents = db.select().from(experten)
    .where(eq(experten.unternehmenId, targetUnternehmenId)).all();
  const existingNames = new Set(existingAgents.map(a => a.name));

  const collisions = manifest.agenten
    .filter(a => existingNames.has(a.name))
    .map(a => ({ name: a.name, typ: 'agent' }));

  return {
    unternehmenName: manifest.unternehmen.name,
    agentenCount: manifest.agenten.length,
    aufgabenCount: manifest.aufgaben.length,
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

  const existingAgents = db.select().from(experten)
    .where(eq(experten.unternehmenId, targetUnternehmenId)).all();
  const existingNames = new Set(existingAgents.map(a => a.name));
  const nameToId = new Map<string, string>();

  // Phase 1: Agenten importieren
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

    try {
      const agentId = uuid();
      nameToId.set(agentDef.name, agentId);

      const verbindungsTyp = options.adapterOverride || agentDef.verbindungsTyp;
      const config = agentDef.isOrchestrator
        ? JSON.stringify({ isOrchestrator: true, autonomyLevel: 'teamplayer' })
        : JSON.stringify({ autonomyLevel: 'copilot' });

      db.insert(experten).values({
        id: agentId,
        unternehmenId: targetUnternehmenId,
        name,
        rolle: agentDef.rolle,
        titel: agentDef.titel,
        faehigkeiten: agentDef.faehigkeiten,
        verbindungsTyp,
        verbindungsConfig: config,
        avatar: agentDef.avatar,
        avatarFarbe: agentDef.avatarFarbe,
        budgetMonatCent: agentDef.budgetMonatCent,
        verbrauchtMonatCent: 0,
        systemPrompt: agentDef.systemPrompt,
        status: 'idle',
        nachrichtenCount: 0,
        erstelltAm: now,
        aktualisiertAm: now,
      }).run();

      // Skills importieren
      for (const skillDef of agentDef.skills) {
        const skillId = uuid();
        db.insert(skillsLibrary).values({
          id: skillId,
          unternehmenId: targetUnternehmenId,
          name: skillDef.name,
          beschreibung: skillDef.beschreibung,
          inhalt: skillDef.inhalt,
          tags: skillDef.tags,
          konfidenz: skillDef.konfidenz || 50,
          nutzungen: 0,
          erfolge: 0,
          quelle: (skillDef.quelle as any) || 'manuell',
          erstelltVon: 'import',
          erstelltAm: now,
          aktualisiertAm: now,
        }).run();

        db.insert(expertenSkills).values({
          id: uuid(), expertId: agentId, skillId, erstelltAm: now,
        }).run();
      }

      agentsImported++;
    } catch (err: any) {
      errors.push(`Agent "${name}": ${err.message}`);
    }
  }

  // Phase 2: reportsTo auflösen
  for (const agentDef of manifest.agenten) {
    if (agentDef.reportsToName) {
      const agentId = nameToId.get(agentDef.name);
      const reportsToId = nameToId.get(agentDef.reportsToName);
      if (agentId && reportsToId) {
        db.update(experten).set({ reportsTo: reportsToId, aktualisiertAm: now })
          .where(eq(experten.id, agentId)).run();
      }
    }
  }

  // Phase 3: Tasks importieren
  if (options.importTasks !== false) {
    for (const taskDef of manifest.aufgaben) {
      try {
        const zugewiesenAn = taskDef.zugewiesenAnName ? nameToId.get(taskDef.zugewiesenAnName) || null : null;
        db.insert(aufgaben).values({
          id: uuid(),
          unternehmenId: targetUnternehmenId,
          titel: taskDef.titel,
          beschreibung: taskDef.beschreibung,
          status: taskDef.status as any,
          prioritaet: taskDef.prioritaet as any,
          zugewiesenAn,
          erstelltAm: now,
          aktualisiertAm: now,
        }).run();
        tasksImported++;
      } catch (err: any) {
        errors.push(`Task "${taskDef.titel}": ${err.message}`);
      }
    }
  }

  return { success: errors.length === 0, agentsImported, tasksImported, errors };
}

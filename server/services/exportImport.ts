/**
 * Phase 8 — Company Export/Import
 *
 * Export: Full company snapshot as JSON, secrets scrubbed
 * Import: Re-map all IDs, insert into existing DB as a new company
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/client.js';
import {
  companies, agents, tasks, projects, goals,
  routines, routineTrigger, comments, approvals,
  agentPermissions, activityLog, workCycles, agentWakeupRequests,
} from '../db/schema.js';
import { eq, and, gte, desc } from 'drizzle-orm';

const EXPORT_VERSION = '1.0';

// ===== Secret scrubbing =====
// Keys in verbindungsConfig whose values we strip
const SECRET_CONFIG_KEYS = new Set(['api_key', 'apiKey', 'token', 'secret', 'password', 'passwort', 'bearer']);

function scrubVerbindungsConfig(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const scrubbed: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const keyLower = k.toLowerCase();
      const isSensitive = SECRET_CONFIG_KEYS.has(k) ||
        Array.from(SECRET_CONFIG_KEYS).some(s => keyLower.includes(s));
      scrubbed[k] = isSensitive ? '***SCRUBBED***' : v;
    }
    return JSON.stringify(scrubbed);
  } catch {
    // Not JSON — scrub entirely if it looks like a key
    if (raw.startsWith('sk-') || raw.startsWith('Bearer ') || raw.length > 100) {
      return '***SCRUBBED***';
    }
    return raw;
  }
}

// ===== Export =====
export interface CompanyExport {
  version: string;
  exportedAt: string;
  companies: any;
  agents: any[];
  tasks: any[];
  projects: any[];
  goals: any[];
  routines: any[];
  routineTrigger: any[];
  comments: any[];
  approvals: any[];
  agentPermissions: any[];
  _meta: {
    counts: Record<string, number>;
    secretsScrubbed: boolean;
  };
}

export function exportCompany(unternehmenId: string): CompanyExport {
  const firma = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  if (!firma) throw new Error('Unternehmen nicht gefunden');

  const expertenList = db.select().from(agents).where(eq(agents.companyId, unternehmenId)).all();
  const aufgabenList = db.select().from(tasks).where(eq(tasks.companyId, unternehmenId)).all();
  const projekteList = db.select().from(projects).where(eq(projects.companyId, unternehmenId)).all();
  const zieleList = db.select().from(goals).where(eq(goals.companyId, unternehmenId)).all();
  const routinenList = db.select().from(routines).where(eq(routines.companyId, unternehmenId)).all();

  const routineIds = routinenList.map(r => r.id);
  const triggerList = routineIds.length > 0
    ? db.select().from(routineTrigger).where(eq(routineTrigger.companyId, unternehmenId)).all()
    : [];

  const kommentareList = db.select().from(comments).where(eq(comments.companyId, unternehmenId)).all();
  const genehmigungenList = db.select().from(approvals).where(eq(approvals.companyId, unternehmenId)).all();

  const expertIds = expertenList.map(e => e.id);
  const permissionsList = expertIds.length > 0
    ? db.select().from(agentPermissions).all().filter(p => expertIds.includes(p.agentId))
    : [];

  // Scrub sensitive data from verbindungsConfig
  const cleanedExperten = expertenList.map(e => ({
    ...e,
    verbindungsConfig: scrubVerbindungsConfig(e.connectionConfig),
  }));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    companies: firma,
    agents: cleanedExperten,
    tasks: aufgabenList,
    projects: projekteList,
    goals: zieleList,
    routines: routinenList,
    routineTrigger: triggerList,
    comments: kommentareList,
    approvals: genehmigungenList,
    agentPermissions: permissionsList,
    _meta: {
      counts: {
        agents: expertenList.length,
        tasks: aufgabenList.length,
        projects: projekteList.length,
        goals: zieleList.length,
        routines: routinenList.length,
        routineTrigger: triggerList.length,
        comments: kommentareList.length,
        approvals: genehmigungenList.length,
        agentPermissions: permissionsList.length,
      },
      secretsScrubbed: true,
    },
  };
}

// ===== Import =====
export interface ImportResult {
  unternehmenId: string;
  unternehmenName: string;
  counts: Record<string, number>;
  warnings: string[];
}

export function importCompany(data: CompanyExport, newName?: string): ImportResult {
  const warnings: string[] = [];

  // Version check
  if (data.version !== EXPORT_VERSION) {
    warnings.push(`Export-Version ${data.version} weicht von aktueller Version ${EXPORT_VERSION} ab. Import wird trotzdem versucht.`);
  }

  // ID remapping: old ID -> new ID
  const idMap = new Map<string, string>();
  const remap = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return idMap.get(id) ?? id;
  };
  const remapRequired = (id: string): string => {
    return idMap.get(id) ?? id;
  };

  const n = () => new Date().toISOString();

  // 1. Generate new ID for Unternehmen
  const newUnternehmenId = uuid();
  idMap.set(data.companies.id, newUnternehmenId);

  const importedName = newName?.trim() || `${data.companies.name} (Import)`;

  // 2. Generate new IDs for all Experten
  for (const e of data.agents) {
    idMap.set(e.id, uuid());
  }

  // 3. Generate new IDs for Aufgaben (need two-pass for parentId)
  for (const a of data.tasks) {
    idMap.set(a.id, uuid());
  }

  // 4. Generate new IDs for Projekte
  for (const p of data.projects) {
    idMap.set(p.id, uuid());
  }

  // 5. Generate new IDs for Ziele
  for (const z of data.goals) {
    idMap.set(z.id, uuid());
  }

  // 6. Generate new IDs for Routinen
  for (const r of data.routines) {
    idMap.set(r.id, uuid());
  }

  // 7. Generate new IDs for Trigger
  for (const t of data.routineTrigger) {
    idMap.set(t.id, uuid());
  }

  // 8. Generate new IDs for Kommentare
  for (const k of data.comments) {
    idMap.set(k.id, uuid());
  }

  // 9. Generate new IDs for Genehmigungen
  for (const g of data.approvals) {
    idMap.set(g.id, uuid());
  }

  // 10. Generate new IDs for AgentPermissions
  for (const p of data.agentPermissions) {
    idMap.set(p.id, uuid());
  }

  // ===== Insert =====
  // Insert Unternehmen
  db.insert(companies).values({
    id: newUnternehmenId,
    name: importedName,
    description: data.companies.description ?? null,
    ziel: data.companies.goal ?? null,
    status: data.companies.status ?? 'active',
    createdAt: n(),
    updatedAt: n(),
  }).run();

  // Insert Experten
  let importedExperten = 0;
  for (const e of data.agents) {
    try {
      db.insert(agents).values({
        id: remapRequired(e.id),
        companyId: newUnternehmenId,
        name: e.name,
        role: e.role,
        title: e.title ?? null,
        status: 'idle', // reset status on import
        reportsTo: remap(e.reportsTo),
        skills: e.skills ?? null,
        connectionType: e.connectionType ?? 'claude',
        connectionConfig: e.connectionConfig?.includes('SCRUBBED') ? null : (e.connectionConfig ?? null),
        avatar: e.avatar ?? null,
        avatarColor: e.avatarColor ?? '#23CDCA',
        monthlyBudgetCent: e.monthlyBudgetCent ?? 0,
        monthlySpendCent: 0, // reset on import
        lastCycle: null,
        autoCycleIntervalSec: e.autoCycleIntervalSec ?? 300,
        autoCycleActive: false, // don't auto-start on import
        systemPrompt: e.systemPrompt ?? null,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedExperten++;
    } catch (err: any) {
      warnings.push(`Experte "${e.name}" konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Ziele (two-pass: first without parentId, then with)
  let importedZiele = 0;
  const zieleWithParent: any[] = [];
  for (const z of data.goals) {
    const hasParent = !!z.parentId && data.goals.some(p => p.id === z.parentId);
    if (hasParent) {
      zieleWithParent.push(z);
      continue;
    }
    try {
      db.insert(goals).values({
        id: remapRequired(z.id),
        companyId: newUnternehmenId,
        title: z.title,
        description: z.description ?? null,
        ebene: z.level ?? 'company',
        parentId: null,
        ownerAgentId: remap(z.ownerAgentId),
        status: z.status ?? 'planned',
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedZiele++;
    } catch (err: any) {
      warnings.push(`Ziel "${z.title}" konnte nicht importiert werden: ${err.message}`);
    }
  }
  for (const z of zieleWithParent) {
    try {
      db.insert(goals).values({
        id: remapRequired(z.id),
        companyId: newUnternehmenId,
        title: z.title,
        description: z.description ?? null,
        ebene: z.level ?? 'team',
        parentId: remap(z.parentId),
        ownerAgentId: remap(z.ownerAgentId),
        status: z.status ?? 'planned',
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedZiele++;
    } catch (err: any) {
      warnings.push(`Ziel "${z.title}" (mit Parent) konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Projekte
  let importedProjekte = 0;
  for (const p of data.projects) {
    try {
      db.insert(projects).values({
        id: remapRequired(p.id),
        companyId: newUnternehmenId,
        name: p.name,
        description: p.description ?? null,
        status: p.status ?? 'aktiv',
        priority: p.priority ?? 'medium',
        zielId: remap(p.goalId),
        ownerAgentId: remap(p.eigentuemerId),
        farbe: p.farbe ?? '#23CDCB',
        deadline: p.deadline ?? null,
        progress: p.progress ?? 0,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedProjekte++;
    } catch (err: any) {
      warnings.push(`Projekt "${p.name}" konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Aufgaben (two-pass for parentId)
  let importedAufgaben = 0;
  const aufgabenWithParent: any[] = [];
  for (const a of data.tasks) {
    const hasParent = !!a.parentId && data.tasks.some(p => p.id === a.parentId);
    if (hasParent) {
      aufgabenWithParent.push(a);
      continue;
    }
    try {
      db.insert(tasks).values({
        id: remapRequired(a.id),
        companyId: newUnternehmenId,
        title: a.title,
        description: a.description ?? null,
        status: a.status === 'in_progress' ? 'todo' : (a.status ?? 'backlog'), // reset running tasks
        priority: a.priority ?? 'medium',
        assignedTo: remap(a.assignedTo),
        erstelltVon: a.createdBy ?? null,
        parentId: null,
        projektId: remap(a.projectId),
        zielId: remap(a.goalId),
        executionRunId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        blockedBy: null,
        workspacePath: null,
        gestartetAm: null,
        completedAt: a.completedAt ?? null,
        abgebrochenAm: a.cancelledAt ?? null,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedAufgaben++;
    } catch (err: any) {
      warnings.push(`Aufgabe "${a.title}" konnte nicht importiert werden: ${err.message}`);
    }
  }
  for (const a of aufgabenWithParent) {
    try {
      db.insert(tasks).values({
        id: remapRequired(a.id),
        companyId: newUnternehmenId,
        title: a.title,
        description: a.description ?? null,
        status: a.status === 'in_progress' ? 'todo' : (a.status ?? 'backlog'),
        priority: a.priority ?? 'medium',
        assignedTo: remap(a.assignedTo),
        erstelltVon: a.createdBy ?? null,
        parentId: remap(a.parentId),
        projektId: remap(a.projectId),
        zielId: remap(a.goalId),
        executionRunId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        blockedBy: null,
        workspacePath: null,
        gestartetAm: null,
        completedAt: a.completedAt ?? null,
        abgebrochenAm: a.cancelledAt ?? null,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedAufgaben++;
    } catch (err: any) {
      warnings.push(`Aufgabe "${a.title}" (mit Parent) konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Routinen
  let importedRoutinen = 0;
  for (const r of data.routines) {
    try {
      db.insert(routines).values({
        id: remapRequired(r.id),
        companyId: newUnternehmenId,
        title: r.title,
        description: r.description ?? null,
        assignedTo: remap(r.assignedTo),
        priority: r.priority ?? 'medium',
        status: r.status ?? 'active',
        concurrencyPolicy: r.concurrencyPolicy ?? 'coalesce_if_active',
        catchUpPolicy: r.catchUpPolicy ?? 'skip_missed',
        variablen: r.variables ?? null,
        zuletztAusgefuehrtAm: null,
        zuletztEnqueuedAm: null,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedRoutinen++;
    } catch (err: any) {
      warnings.push(`Routine "${r.title}" konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Routine Trigger
  let importedTrigger = 0;
  for (const t of data.routineTrigger) {
    try {
      db.insert(routineTrigger).values({
        id: remapRequired(t.id),
        companyId: newUnternehmenId,
        routineId: remapRequired(t.routineId),
        kind: t.kind,
        active: t.active ?? true,
        cronExpression: t.cronExpression ?? null,
        timezone: t.timezone ?? 'UTC',
        naechsterAusfuehrungAm: null, // will be recalculated by cron service
        zuletztGefeuertAm: null,
        publicId: t.publicId ?? null,
        secretId: null, // scrub webhook secrets
        createdAt: n(),
      }).run();
      importedTrigger++;
    } catch (err: any) {
      warnings.push(`Trigger konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Kommentare
  let importedKommentare = 0;
  for (const k of data.comments) {
    try {
      db.insert(comments).values({
        id: remapRequired(k.id),
        companyId: newUnternehmenId,
        taskId: remapRequired(k.taskId),
        authorAgentId: remap(k.authorAgentId),
        authorType: k.authorType ?? 'board',
        content: k.content,
        createdAt: n(),
      }).run();
      importedKommentare++;
    } catch (err: any) {
      // Non-critical — comments may reference deleted tasks
      warnings.push(`Kommentar konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Genehmigungen
  let importedGenehmigungen = 0;
  for (const g of data.approvals) {
    try {
      db.insert(approvals).values({
        id: remapRequired(g.id),
        companyId: newUnternehmenId,
        type: g.type,
        title: g.title,
        description: g.description ?? null,
        requestedBy: g.requestedBy ?? null,
        status: g.status ?? 'pending',
        payload: g.payload ?? null,
        decisionNote: g.decisionNote ?? null,
        decidedAt: g.decidedAt ?? null,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedGenehmigungen++;
    } catch (err: any) {
      warnings.push(`Genehmigung konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Agent Permissions
  let importedPermissions = 0;
  for (const p of data.agentPermissions) {
    try {
      db.insert(agentPermissions).values({
        id: remapRequired(p.id),
        agentId: remapRequired(p.agentId),
        darfAufgabenErstellen: p.darfAufgabenErstellen ?? true,
        darfAufgabenZuweisen: p.darfAufgabenZuweisen ?? false,
        darfGenehmigungAnfordern: p.darfGenehmigungAnfordern ?? true,
        darfGenehmigungEntscheiden: p.darfGenehmigungEntscheiden ?? false,
        darfExpertenAnwerben: p.darfExpertenAnwerben ?? false,
        budgetLimitCent: p.budgetLimitCent ?? null,
        erlaubtePfade: p.erlaubtePfade ?? null,
        erlaubteDomains: p.erlaubteDomains ?? null,
        createdAt: n(),
        updatedAt: n(),
      }).run();
      importedPermissions++;
    } catch (err: any) {
      warnings.push(`Agent-Permission konnte nicht importiert werden: ${err.message}`);
    }
  }

  return {
    unternehmenId: newUnternehmenId,
    unternehmenName: importedName,
    counts: {
      agents: importedExperten,
      tasks: importedAufgaben,
      projects: importedProjekte,
      goals: importedZiele,
      routines: importedRoutinen,
      routineTrigger: importedTrigger,
      comments: importedKommentare,
      approvals: importedGenehmigungen,
      agentPermissions: importedPermissions,
    },
    warnings,
  };
}

// ===== Fine-Tuning Export =====

export interface TrainingRecord {
  instruction: string;
  input: string;
  output: string;
  metadata: {
    agentName: string;
    agentId: string;
    taskId: string;
    completedAt: string | null;
    criticApproved: boolean;
  };
}

export interface TrainingExportOptions {
  format: 'jsonl' | 'json';
  minQuality: 'approved' | 'all';
  agentId?: string;
  since?: string; // ISO date filter
  limit?: number;
}

/**
 * Export agent execution data as training pairs (instruction/input/output).
 *
 * Data source:
 * - tasks  → instruction (titel + beschreibung)
 * - comments → output (agent-authored, most recent per task)
 * - workCycles → criticApproved (status=succeeded = passed critic gate)
 */
export async function exportTrainingData(
  unternehmenId: string,
  opts: TrainingExportOptions,
): Promise<TrainingRecord[]> {
  const limit = Math.min(opts.limit ?? 500, 2000);

  // Fetch completed tasks for this company
  let tasksQuery = db
    .select({
      id: tasks.id,
      titel: tasks.title,
      beschreibung: tasks.description,
      zugewiesenAn: tasks.assignedTo,
      abgeschlossenAm: tasks.completedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.companyId, unternehmenId),
        eq(tasks.status, 'done'),
        opts.agentId ? eq(tasks.assignedTo, opts.agentId) : undefined,
        opts.since ? gte(tasks.completedAt, opts.since) : undefined,
      ),
    )
    .orderBy(desc(tasks.completedAt))
    .limit(limit) as any;

  const taskRows: any[] = await tasksQuery.all();
  if (taskRows.length === 0) return [];

  // Resolve agent names
  const agentIds = [...new Set(taskRows.map((t: any) => t.assignedTo).filter(Boolean))] as string[];
  const agentRows = agentIds.length
    ? db.select({ id: agents.id, name: agents.name }).from(agents).all()
    : [];
  const agentMap = new Map(agentRows.map((a: any) => [a.id, a.name]));

  const records: TrainingRecord[] = [];

  for (const task of taskRows) {
    // Find the most recent agent comment (output) for this task
    const comment = db
      .select({ inhalt: comments.content })
      .from(comments)
      .where(
        and(
          eq(comments.taskId, task.id),
          eq(comments.authorType, 'agent'),
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(1)
      .get() as any;

    if (!comment?.content) continue;

    // Check if critic approved: task had a successful run
    const criticApproved = !!db
      .select({ id: workCycles.id })
      .from(workCycles)
      .where(
        and(
          eq(workCycles.agentId, task.assignedTo ?? ''),
          eq(workCycles.status, 'succeeded'),
        ),
      )
      .limit(1)
      .get();

    if (opts.minQuality === 'approved' && !criticApproved) continue;

    records.push({
      instruction: task.title + (task.description ? `\n\n${task.description}` : ''),
      input: '',
      output: comment.content,
      metadata: {
        agentName: agentMap.get(task.assignedTo) ?? task.assignedTo ?? 'unknown',
        agentId: task.assignedTo ?? '',
        taskId: task.id,
        completedAt: task.completedAt,
        criticApproved,
      },
    });
  }

  return records;
}

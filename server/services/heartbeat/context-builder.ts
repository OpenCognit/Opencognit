// Heartbeat Context Builder — assembles AdapterContext for task execution

import fs from 'fs';
import { db } from '../../db/client.js';
import { experten, aufgaben, ziele, projekte, issueRelations, kommentare, palaceKg, chatNachrichten } from '../../db/schema.js';
import { eq, and, inArray, desc, asc, isNull, sql } from 'drizzle-orm';
import type { AdapterContext, AdapterTask, CompanyGoal } from '../../adapters/types.js';
import { loadRelevantMemory } from '../memory-auto.js';

export interface BuildContextParams {
  taskFull: any;
  expert: any;
  unternehmenData: any;
  comments: any[];
  blockerOutputs: string | null;
  advisorPlan: string | null;
  expertId: string;
  unternehmenId: string;
}

/**
 * Assemble full AdapterContext for a task execution.
 * Loads memory, goals, team/project context, workspace files, advisor plan, and orchestrator overview.
 * Also trims oversized context to stay within token budget.
 */
export async function buildAdapterContext(params: BuildContextParams): Promise<AdapterContext> {
  const { taskFull, expert, unternehmenData, comments, blockerOutputs, advisorPlan, expertId, unternehmenId } = params;

  const adapterTask: AdapterTask = {
    id: taskFull.id,
    titel: taskFull.titel,
    beschreibung: taskFull.beschreibung,
    status: taskFull.status,
    prioritaet: taskFull.prioritaet,
  };

  // ─── Memory Kontext laden (nativ) ───────────────────────────────
  const taskKeywords = [taskFull.titel, taskFull.beschreibung || '']
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 4);
  const memoryContext = loadRelevantMemory(expertId, taskKeywords) || null;

  // ─── Letzte Chat-Nachrichten laden (Board ↔ Agent) ──────────────────
  // Damit der Agent weiß was im direkten Chat besprochen wurde und
  // autonome Aktionen nicht im Widerspruch zur letzten Unterhaltung stehen.
  let boardKommunikation: string | undefined;
  try {
    const recentChat = await db.select({
      absenderTyp: chatNachrichten.absenderTyp,
      nachricht: chatNachrichten.nachricht,
      erstelltAm: chatNachrichten.erstelltAm,
    })
      .from(chatNachrichten)
      .where(and(
        eq(chatNachrichten.unternehmenId, unternehmenId),
        eq(chatNachrichten.expertId, expertId),
      ))
      .orderBy(desc(chatNachrichten.erstelltAm))
      .limit(8)
      .then(rows => rows.reverse()); // chronological order

    if (recentChat.length > 0) {
      const lines = recentChat
        .filter(m => m.absenderTyp !== 'system')
        .map(m => {
          const who = m.absenderTyp === 'board' ? '👤 Board' : `🤖 ${expert?.name || 'Agent'}`;
          const ts = m.erstelltAm ? new Date(m.erstelltAm).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
          return `[${ts}] ${who}: ${m.nachricht}`;
        });
      if (lines.length > 0) {
        boardKommunikation = lines.join('\n');
      }
    }
  } catch { /* non-critical */ }
  // ────────────────────────────────────────────────────────────────────

  // ─── Load active goals with live task progress ──────────────────────
  let activeGoals: CompanyGoal[] = [];
  try {
    const rawGoals = await db.select({
      id: ziele.id,
      titel: ziele.titel,
      beschreibung: ziele.beschreibung,
      fortschritt: ziele.fortschritt,
      status: ziele.status,
    }).from(ziele)
      .where(and(
        eq(ziele.unternehmenId, unternehmenId),
        inArray(ziele.status, ['active', 'planned']),
      ))
      .orderBy(asc(ziele.erstelltAm))
      .limit(5);

    for (const g of rawGoals) {
      const linkedTasks = await db.select({ status: aufgaben.status })
        .from(aufgaben)
        .where(and(eq(aufgaben.zielId, g.id), eq(aufgaben.unternehmenId, unternehmenId)));
      const doneTasks = linkedTasks.filter(t => t.status === 'done').length;
      const openTasks = linkedTasks.filter(t => t.status !== 'done').length;
      const computedProgress = linkedTasks.length > 0
        ? Math.round((doneTasks / linkedTasks.length) * 100)
        : g.fortschritt;
      activeGoals.push({
        id: g.id,
        titel: g.titel,
        beschreibung: g.beschreibung,
        fortschritt: computedProgress,
        status: g.status,
        openTasks,
        doneTasks,
      });
    }
  } catch (err: any) {
    console.warn(`  ⚠️ Goals konnten nicht geladen werden: ${err.message}`);
  }
  // ──────────────────────────────────────────────────────────────────

  // Load team members for orchestrator context
  const teamMembers = expert?.isOrchestrator
    ? await db.select({ id: experten.id, name: experten.name, rolle: experten.rolle, status: experten.status })
        .from(experten)
        .where(and(eq(experten.unternehmenId, unternehmenId), eq(experten.isOrchestrator, false)))
    : [];

  // Load open/unassigned tasks summary for orchestrator
  const openTasks = expert?.isOrchestrator
    ? await db.select({ id: aufgaben.id, titel: aufgaben.titel, status: aufgaben.status, zugewiesenAn: aufgaben.zugewiesenAn, prioritaet: aufgaben.prioritaet })
        .from(aufgaben)
        .where(and(
          eq(aufgaben.unternehmenId, unternehmenId),
          inArray(aufgaben.status, ['backlog', 'todo', 'in_progress', 'blocked']),
        ))
        .limit(20)
    : [];

  // Load project context if task belongs to a project
  let projektContext: AdapterContext['projektContext'] | undefined;
  if (taskFull.projektId) {
    const proj = await db.select({ name: projekte.name, beschreibung: projekte.beschreibung, workDir: projekte.workDir })
      .from(projekte)
      .where(eq(projekte.id, taskFull.projektId))
      .limit(1)
      .then((rows: any[]) => rows[0]);
    if (proj) {
      projektContext = { name: proj.name, beschreibung: proj.beschreibung, workDir: proj.workDir };
    }
  }

  const adapterContext: AdapterContext = {
    task: adapterTask,
    previousComments: comments.map((c: any) => ({
      id: c.id,
      inhalt: c.inhalt,
      autorTyp: c.autorTyp as 'agent' | 'board',
      erstelltAm: c.erstelltAm,
    })),
    companyContext: {
      name: unternehmenData?.name || 'Unknown',
      ziel: unternehmenData?.ziel || null,
      goals: activeGoals.length > 0 ? activeGoals : undefined,
    },
    ...(projektContext ? { projektContext } : {}),
    agentContext: {
      name: expert?.name || 'Unknown Agent',
      rolle: expert?.rolle || 'Agent',
      faehigkeiten: expert?.faehigkeiten || null,
      // MaximizerMode: tell the agent to work at maximum speed and output
      ...((taskFull as any).isMaximizerMode ? {
        maximizerMode: '⚡ MAXIMIZER MODE AKTIV: Arbeite schnellstmöglich. Erzeuge vollständigen, sofort nutzbaren Output. Keine Rückfragen, keine Platzhalter — liefere alles in einem Durchgang.',
      } : {}),
      // Workspace context: show what files already exist so agents coordinate
      ...(() => {
        const wp = (taskFull as any).workspacePath;
        if (!wp || !fs.existsSync(wp)) return {};
        try {
          const allFiles = fs.readdirSync(wp, { recursive: true } as any) as string[];
          const files = allFiles
            .filter((f: string) => !f.includes('node_modules') && !f.includes('.git'))
            .slice(0, 60)
            .join('\n');
          return files ? { workspaceFiles: `## Bereits vorhandene Dateien im Workspace\n\`\`\`\n${files}\n\`\`\`\nBitte konsistenten Code-Stil verwenden und bestehende Dateien beachten.` } : {};
        } catch { return {}; }
      })(),
      ...(memoryContext ? { gedaechtnis: memoryContext } : {}),
      ...(boardKommunikation ? { boardKommunikation } : {}),
      ...(blockerOutputs ? { vorgaengerOutputs: blockerOutputs } : {}),
      ...(advisorPlan ? { advisorPlan: `### 🧠 STRATEGISCHER PLAN DES ARCHITEKTEN/ADVISORS\n\n${advisorPlan}\n\n*Bitte befolge diesen Plan strikt bei der Ausführung der Aufgabe.*` } : {}),
      // Orchestrator gets full team + task overview
      ...(expert?.isOrchestrator && teamMembers.length > 0 ? {
        team: teamMembers.map(m => ({ id: m.id, name: m.name, rolle: m.rolle, status: m.status })),
        offeneTasks: openTasks.map(t => ({ id: t.id, titel: t.titel, status: t.status, zugewiesenAn: t.zugewiesenAn, prioritaet: t.prioritaet })),
        aktionsFormat: `
## WICHTIG: Aktionen als JSON ausgeben

Wenn du Tasks erstellen, zuweisen oder Ziele aktualisieren willst, füge am ENDE deiner Antwort einen JSON-Block ein:

\`\`\`json
{
  "actions": [
    {"type": "create_task", "titel": "Task-Titel", "beschreibung": "Beschreibung...", "assignTo": "Agent Name", "prioritaet": "high", "zielId": "GOAL_ID"},
    {"type": "assign_task", "taskId": "TASK_ID", "assignTo": "Agent Name"},
    {"type": "mark_done", "taskId": "TASK_ID"},
    {"type": "update_goal", "goalId": "GOAL_ID", "fortschritt": 50},
    {"type": "hire_agent", "rolle": "QA Engineer", "faehigkeiten": "Testing, Python", "begruendung": "Wir brauchen mehr QA-Kapazität"}
  ]
}
\`\`\`

Verfügbare Prioritäten: critical, high, medium, low
Verfügbare Team-Mitglieder: ${teamMembers.map(m => m.name).join(', ')}
WICHTIG: Verknüpfe jeden neuen Task mit einem Ziel via "zielId". Aktualisiere Ziel-Fortschritt (update_goal) wenn Tasks abgeschlossen wurden.
`,
      } : {}),
    },
  };

  if (memoryContext) {
    console.log(`  🧠 Memory geladen für Agent ${expertId} (${memoryContext.length} Zeichen)`);
  }

  // ─── TOKEN BUDGET GUARD ────────────────────────────────────────────────
  // Rough estimate: 1 token ≈ 4 chars. Hard ceiling: 80k tokens = 320k chars.
  // Trim least-important fields first to stay within context window.
  const CONTEXT_CHAR_LIMIT = 320_000;
  const estimatedSize = JSON.stringify(adapterContext).length;
  if (estimatedSize > CONTEXT_CHAR_LIMIT) {
    console.warn(`  ⚠️ Context too large (${Math.round(estimatedSize / 1000)}k chars) — trimming`);

    // 1. Trim blocker outputs (often very long code/docs)
    const agentCtx = adapterContext.agentContext as any;
    if (agentCtx.vorgaengerOutputs) {
      agentCtx.vorgaengerOutputs =
        agentCtx.vorgaengerOutputs.slice(0, 20_000) + '\n[...gekürzt]';
    }

    // 2. Trim memory context
    if (adapterContext.agentContext.gedaechtnis) {
      adapterContext.agentContext.gedaechtnis =
        (adapterContext.agentContext.gedaechtnis as string).slice(0, 10_000) + '\n[...gekürzt]';
    }

    // 3. Drop oldest comments if still too large
    if (JSON.stringify(adapterContext).length > CONTEXT_CHAR_LIMIT) {
      adapterContext.previousComments = adapterContext.previousComments.slice(-5);
    }

    // 4. Trim open tasks list for orchestrators
    if (agentCtx.offeneTasks) {
      agentCtx.offeneTasks = agentCtx.offeneTasks.slice(0, 20);
    }

    const afterSize = JSON.stringify(adapterContext).length;
    console.log(`  ✂️ Context trimmed: ${Math.round(estimatedSize / 1000)}k → ${Math.round(afterSize / 1000)}k chars`);
  }
  // ──────────────────────────────────────────────────────────────────────

  return adapterContext;
}

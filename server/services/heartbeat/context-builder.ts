// Heartbeat Context Builder — assembles AdapterContext for task execution

import fs from 'fs';
import { db } from '../../db/client.js';
import { agents, tasks, goals, projects, issueRelations, comments, palaceKg, chatMessages, ceoDecisionLog } from '../../db/schema.js';
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
  agentId: string;
  companyId: string;
}

/**
 * Assemble full AdapterContext for a task execution.
 * Loads memory, goals, team/project context, workspace files, advisor plan, and orchestrator overview.
 * Also trims oversized context to stay within token budget.
 */
export async function buildAdapterContext(params: BuildContextParams): Promise<AdapterContext> {
  const { taskFull, expert, unternehmenData, comments, blockerOutputs, advisorPlan, agentId, companyId } = params;

  const adapterTask: AdapterTask = {
    id: taskFull.id,
    title: taskFull.title,
    description: taskFull.description,
    status: taskFull.status,
    priority: taskFull.priority,
  };

  // ─── Memory Kontext laden (nativ) ───────────────────────────────
  const taskKeywords = [taskFull.title, taskFull.description || '']
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 4);
  const memoryContext = loadRelevantMemory(agentId, taskKeywords) || null;

  // ─── Letzte Chat-Nachrichten laden (Board ↔ Agent) ──────────────────
  // Damit der Agent weiß was im direkten Chat besprochen wurde und
  // autonome Aktionen nicht im Widerspruch zur letzten Unterhaltung stehen.
  let boardKommunikation: string | undefined;
  try {
    const recentChat = await db.select({
      senderType: chatMessages.senderType,
      message: chatMessages.message,
      createdAt: chatMessages.createdAt,
    })
      .from(chatMessages)
      .where(and(
        eq(chatMessages.companyId, companyId),
        eq(chatMessages.agentId, agentId),
      ))
      .orderBy(desc(chatMessages.createdAt))
      .limit(8)
      .then(rows => rows.reverse()); // chronological order

    if (recentChat.length > 0) {
      const lines = recentChat
        .filter(m => m.senderType !== 'system')
        .map(m => {
          const who = m.senderType === 'board' ? '👤 Board' : `🤖 ${expert?.name || 'Agent'}`;
          const ts = m.createdAt ? new Date(m.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
          return `[${ts}] ${who}: ${m.message}`;
        });
      if (lines.length > 0) {
        boardKommunikation = lines.join('\n');
      }
    }
  } catch { /* non-critical */ }
  // ────────────────────────────────────────────────────────────────────

  // ─── CEO Decision Log: letzten Planungs-Eintrag laden ───────────────
  // Nur für Orchestratoren — gibt dem CEO seinen roten Faden zurück.
  let letzteEntscheidung: string | undefined;
  if (expert?.isOrchestrator) {
    try {
      const lastDecision = await db.select()
        .from(ceoDecisionLog as any)
        .where(and(
          eq((ceoDecisionLog as any).agentId, agentId),
          eq((ceoDecisionLog as any).companyId, companyId),
        ))
        .orderBy(desc((ceoDecisionLog as any).createdAt))
        .limit(1)
        .then((rows: any[]) => rows[0]);

      if (lastDecision) {
        const ts = new Date(lastDecision.createdAt).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        const actions: string[] = JSON.parse(lastDecision.actionsJson || '[]');
        const actionList = actions.length > 0
          ? '\nAusgeführte Aktionen:\n' + actions.map((a: string) => `  • ${a}`).join('\n')
          : '\n(Keine Aktionen ausgeführt)';
        letzteEntscheidung = [
          `[${ts}] Fokus: ${lastDecision.focusSummary}`,
          lastDecision.goalsSnapshot ? `Ziele: ${lastDecision.goalsSnapshot}` : null,
          `Offene Tasks zu dem Zeitpunkt: ${lastDecision.pendingTaskCount}`,
          lastDecision.teamSummary ? `Team: ${lastDecision.teamSummary}` : null,
          actionList,
        ].filter(Boolean).join('\n');
      }
    } catch { /* non-critical */ }
  }
  // ────────────────────────────────────────────────────────────────────

  // ─── Load active goals with live task progress ──────────────────────
  let activeGoals: CompanyGoal[] = [];
  try {
    const rawGoals = await db.select({
      id: goals.id,
      title: goals.title,
      description: goals.description,
      progress: goals.progress,
      status: goals.status,
    }).from(goals)
      .where(and(
        eq(goals.companyId, companyId),
        inArray(goals.status, ['active', 'planned']),
      ))
      .orderBy(asc(goals.createdAt))
      .limit(5);

    for (const g of rawGoals) {
      const linkedTasks = await db.select({ status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.goalId, g.id), eq(tasks.companyId, companyId)));
      const doneTasks = linkedTasks.filter(t => t.status === 'done').length;
      const openTasks = linkedTasks.filter(t => t.status !== 'done').length;
      const computedProgress = linkedTasks.length > 0
        ? Math.round((doneTasks / linkedTasks.length) * 100)
        : g.progress;
      activeGoals.push({
        id: g.id,
        title: g.title,
        description: g.description,
        progress: computedProgress,
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
    ? await db.select({ id: agents.id, name: agents.name, role: agents.role, status: agents.status })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.isOrchestrator, false)))
    : [];

  // Load open/unassigned tasks summary for orchestrator
  const openTasks = expert?.isOrchestrator
    ? await db.select({ id: tasks.id, title: tasks.title, status: tasks.status, assignedTo: tasks.assignedTo, priority: tasks.priority })
        .from(tasks)
        .where(and(
          eq(tasks.companyId, companyId),
          inArray(tasks.status, ['backlog', 'todo', 'in_progress', 'blocked']),
        ))
        .limit(20)
    : [];

  // Load project context if task belongs to a project
  let projektContext: AdapterContext['projektContext'] | undefined;
  if (taskFull.projectId) {
    const proj = await db.select({ name: projects.name, description: projects.description, workDir: projects.workDir })
      .from(projects)
      .where(eq(projects.id, taskFull.projectId))
      .limit(1)
      .then((rows: any[]) => rows[0]);
    if (proj) {
      projektContext = { name: proj.name, description: proj.description, workDir: proj.workDir };
    }
  }

  const adapterContext: AdapterContext = {
    task: adapterTask,
    previousComments: comments.map((c: any) => ({
      id: c.id,
      content: c.content,
      senderType: c.authorType as 'agent' | 'board',
      createdAt: c.createdAt,
    })),
    companyContext: {
      name: unternehmenData?.name || 'Unknown',
      goal: unternehmenData?.goal || null,
      goals: activeGoals.length > 0 ? activeGoals : undefined,
    },
    ...(projektContext ? { projektContext } : {}),
    agentContext: {
      name: expert?.name || 'Unknown Agent',
      role: expert?.role || 'Agent',
      skills: expert?.skills || null,
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
      ...(memoryContext ? { memory: memoryContext } : {}),
      ...(letzteEntscheidung ? { letzteEntscheidung } : {}),
      ...(boardKommunikation ? { boardKommunikation } : {}),
      ...(blockerOutputs ? { vorgaengerOutputs: blockerOutputs } : {}),
      ...(advisorPlan ? { advisorPlan: `### 🧠 STRATEGISCHER PLAN DES ARCHITEKTEN/ADVISORS\n\n${advisorPlan}\n\n*Bitte befolge diesen Plan strikt bei der Ausführung der Aufgabe.*` } : {}),
      // Orchestrator gets full team + task overview
      ...(expert?.isOrchestrator && teamMembers.length > 0 ? {
        team: teamMembers.map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status })),
        offeneTasks: openTasks.map(t => ({ id: t.id, title: t.title, status: t.status, assignedTo: t.assignedTo, priority: t.priority })),
        aktionsFormat: `
## WICHTIG: Aktionen als JSON ausgeben

Wenn du Tasks erstellen, zuweisen oder Ziele aktualisieren willst, füge am ENDE deiner Antwort einen JSON-Block ein:

\`\`\`json
{
  "actions": [
    {"type": "create_task", "titel": "Task-Titel", "beschreibung": "Beschreibung...", "assignTo": "Agent Name", "priority": "high", "targetId": "GOAL_ID"},
    {"type": "assign_task", "taskId": "TASK_ID", "assignTo": "Agent Name"},
    {"type": "mark_done", "taskId": "TASK_ID"},
    {"type": "update_goal", "goalId": "GOAL_ID", "progress": 50},
    {"type": "hire_agent", "rolle": "QA Engineer", "faehigkeiten": "Testing, Python", "begruendung": "Wir brauchen mehr QA-Kapazität"}
  ]
}
\`\`\`

Verfügbare Prioritäten: critical, high, medium, low
Verfügbare Team-Mitglieder: ${teamMembers.map(m => m.name).join(', ')}
WICHTIG: Verknüpfe jeden neuen Task mit einem Ziel via "targetId". Aktualisiere Ziel-Fortschritt (update_goal) wenn Tasks abgeschlossen wurden.
`,
      } : {}),
    },
  };

  if (memoryContext) {
    console.log(`  🧠 Memory geladen für Agent ${agentId} (${memoryContext.length} Zeichen)`);
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
    if (adapterContext.agentContext.memory) {
      adapterContext.agentContext.memory =
        (adapterContext.agentContext.memory as string).slice(0, 10_000) + '\n[...gekürzt]';
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

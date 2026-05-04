// Heartbeat Actions Orchestrator — CEO action dispatcher

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../../db/client.js';
import { tasks, agents, goals, agentPermissions, approvals, agentMeetings, agentWakeupRequests, settings, routines, routineTrigger, comments, projects } from '../../db/schema.js';
import { eq, and, inArray, or, desc, gte } from 'drizzle-orm';
import { wakeupService } from '../wakeup.js';
import { v4 as uuid } from 'uuid';
import { trace } from './utils.js';
import { isSafeWorkdir } from '../../adapters/workspace-guard.js';

export interface OrchestratorActionResult {
  /** true if the orchestrator's actions included marking the current task as done */
  done: boolean;
  /** human-readable summary of each executed action, for the decision log */
  actionSummary: string[];
}

/**
 * Auto-generate subtasks based on project name keywords.
 * Returns array of partial task objects for create_project.
 */
function generateProjectSubtasks(projectName: string, team: Array<{ id: string; name: string }>): Array<{ title: string; description?: string; priority?: string; agentId?: string }> {
  const name = projectName.toLowerCase();
  const dev = team.find(a => a.name.toLowerCase().includes('dev') || a.name.toLowerCase().includes('coder') || a.name.toLowerCase().includes('entwick'));
  const designer = team.find(a => a.name.toLowerCase().includes('design') || a.name.toLowerCase().includes('ui') || a.name.toLowerCase().includes('ux'));
  const qa = team.find(a => a.name.toLowerCase().includes('qa') || a.name.toLowerCase().includes('test'));

  // Website / E-Commerce projects
  if (name.includes('website') || name.includes('web') || name.includes('shop') || name.includes('e-commerce') || name.includes('store')) {
    return [
      { title: '1. Projekt-Setup & Architektur', description: 'Tech-Stack wählen, Repo initialisieren, CI/CD einrichten', priority: 'high', agentId: dev?.id },
      { title: '2. Backend-API entwickeln', description: 'Datenbank-Schema, REST/GraphQL API, Auth, Business-Logik', priority: 'high', agentId: dev?.id },
      { title: '3. Frontend-Grundgerüst', description: 'Routing, Layout, State-Management, API-Integration', priority: 'high', agentId: dev?.id },
      { title: '4. UI/UX Design implementieren', description: 'Komponenten-Bibliothek, Responsiveness, Dark Mode', priority: 'medium', agentId: designer?.id || dev?.id },
      { title: '5. Checkout & Zahlung', description: 'Warenkorb, Bezahlung, Bestellverwaltung', priority: 'high', agentId: dev?.id },
      { title: '6. Tests schreiben', description: 'Unit-Tests, Integration-Tests, E2E-Tests', priority: 'high', agentId: qa?.id || dev?.id },
      { title: '7. Deployment & Monitoring', description: 'Build, Deploy, Health-Checks, Logging', priority: 'medium', agentId: dev?.id },
    ];
  }

  // Mobile App projects
  if (name.includes('app') || name.includes('mobile') || name.includes('ios') || name.includes('android')) {
    return [
      { title: '1. App-Setup & Architektur', description: 'Framework wählen, Projekt initialisieren', priority: 'high', agentId: dev?.id },
      { title: '2. Backend-API & Auth', description: 'API-Endpunkte, Authentifizierung, Datenmodell', priority: 'high', agentId: dev?.id },
      { title: '3. UI Screens implementieren', description: 'Navigation, Screens, Komponenten', priority: 'high', agentId: designer?.id || dev?.id },
      { title: '4. State Management & API-Integration', description: 'Data-Fetching, Caching, Offline-Support', priority: 'high', agentId: dev?.id },
      { title: '5. Tests & Build', description: 'Unit-Tests, E2E-Tests, App-Store-Vorbereitung', priority: 'high', agentId: qa?.id || dev?.id },
    ];
  }

  // API / Backend projects
  if (name.includes('api') || name.includes('backend') || name.includes('service')) {
    return [
      { title: '1. API-Design & Spezifikation', description: 'OpenAPI/Swagger, Endpunkte definieren', priority: 'high', agentId: dev?.id },
      { title: '2. Datenbank-Schema', description: 'Migrationen, Indizes, Beziehungen', priority: 'high', agentId: dev?.id },
      { title: '3. Core-Endpoints implementieren', description: 'CRUD, Auth, Business-Logik', priority: 'high', agentId: dev?.id },
      { title: '4. Tests & Dokumentation', description: 'Unit-Tests, Integration-Tests, API-Docs', priority: 'high', agentId: qa?.id || dev?.id },
      { title: '5. Deployment', description: 'Docker, CI/CD, Monitoring', priority: 'medium', agentId: dev?.id },
    ];
  }

  // Default: generic project subtasks
  return [
    { title: '1. Anforderungsanalyse & Planung', description: 'Scope definieren, Akzeptanzkriterien festlegen', priority: 'high', agentId: dev?.id },
    { title: '2. Implementierung', description: 'Core-Logik entwickeln', priority: 'high', agentId: dev?.id },
    { title: '3. Review & Tests', description: 'Code-Review, Tests, QA', priority: 'high', agentId: qa?.id || dev?.id },
    { title: '4. Dokumentation & Deployment', description: 'Docs schreiben, deployen', priority: 'medium', agentId: dev?.id },
  ];
}

/**
 * CEO Action Parser — liest den Output des Orchestrators und führt Aktionen aus:
 * create_task, assign_task, mark_done, update_goal, hire_agent, call_meeting, update_task_status
 */
export async function processOrchestratorActions(
  taskId: string,
  orchestratorId: string,
  companyId: string,
  output: string,
): Promise<OrchestratorActionResult> {
  // Extrahiere JSON-Block aus CEO Output (```json ... ``` oder roher JSON mit "actions")
  let actions: any[] = [];
  let currentTaskMarkedDone = false;
  const actionSummary: string[] = [];

  const jsonBlockMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  const rawJsonMatch = output.match(/\{\s*"actions"\s*:\s*\[[\s\S]*?\]\s*\}/);

  for (const raw of [jsonBlockMatch?.[1], rawJsonMatch?.[0]]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        actions = parsed.actions;
        break;
      }
    } catch { /* kein valides JSON */ }
  }

  if (actions.length === 0) return { done: currentTaskMarkedDone, actionSummary: [] };

  console.log(`  🎯 CEO Action Parser: ${actions.length} Aktion(en) gefunden`);
  trace(orchestratorId, companyId, 'action', `CEO führt ${actions.length} Aktion(en) aus`);

  // Load permissions for this orchestrator — gate which actions are allowed
  const perms = db.select().from(agentPermissions)
    .where(eq(agentPermissions.agentId, orchestratorId)).get();

  const canCreateTask     = !perms || perms.darfAufgabenErstellen !== false;
  const canAssignTask     = !perms || perms.darfAufgabenZuweisen !== false;
  const canRequestApproval = !perms || perms.darfGenehmigungAnfordern !== false;
  const canRecruitAgent   = !perms || perms.darfExpertenAnwerben !== false;

  // ceo_require_approval: when 'true', CEO's create_task goes to approval queue
  const requireApprovalSetting = db.select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'ceo_require_approval'), eq(settings.companyId, companyId)))
    .get();
  const ceoRequireApproval = requireApprovalSetting?.value === 'true';

  // ceo_max_tasks_per_cycle: max create_task actions before queuing remainder for approval
  const maxTasksSetting = db.select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'ceo_max_tasks_per_cycle'), eq(settings.companyId, companyId)))
    .get();
  const maxTasksPerCycle = maxTasksSetting?.value ? parseInt(maxTasksSetting.value, 10) : Infinity;
  let tasksCreatedThisCycle = 0;

  // Lade Team für Name→ID Auflösung
  const team = await db.select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.companyId, companyId));

  const findAgent = (name: string) =>
    team.find(a => a.name.toLowerCase().includes(name.toLowerCase()));

  const now = new Date().toISOString();
  let lastCreatedProjectId: string | null = null;

  for (const action of actions) {
    try {
      switch (action.type) {

        case 'create_task': {
          if (!action.title) break;
          if (!canCreateTask) {
            console.warn(`  🚫 ${orchestratorId} hat keine Berechtigung: create_task`);
            break;
          }

          // ── CEO Approval Gate ─────────────────────────────────────────────────
          const needsApproval = ceoRequireApproval || tasksCreatedThisCycle >= maxTasksPerCycle;
          if (needsApproval && canRequestApproval) {
            const approvalId = crypto.randomUUID();
            await db.insert(approvals as any).values({
              id: approvalId,
              companyId,
              type: 'approve_strategy',
              title: `CEO möchte Task erstellen: ${action.title}`,
              description: action.description || null,
              requestedBy: orchestratorId,
              status: 'pending',
              payload: JSON.stringify({ action }),
              createdAt: now,
              updatedAt: now,
            }).run();
            console.log(`  📋 CEO Task "${action.title}" → Genehmigung ausstehend (Approval Gate)`);
            trace(orchestratorId, companyId, 'info', `Task wartet auf Genehmigung: ${action.title}`);
            break;
          }
          // ─────────────────────────────────────────────────────────────────────

          // ── Deduplication: skip if similar task exists in last 50 open tasks ──
          const normalizeTitle = (t: string) => t.toLowerCase().trim().slice(0, 60);
          const normalized = normalizeTitle(action.title);
          // Dedup: include open tasks + recently-done tasks (last 48h) to avoid re-creating completed work
          const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
          const recentTasks = await db.select({ title: tasks.title, status: tasks.status })
            .from(tasks)
            .where(and(
              eq(tasks.companyId, companyId),
              or(
                inArray(tasks.status, ['backlog', 'todo', 'in_progress', 'blocked']),
                and(eq(tasks.status, 'done'), gte(tasks.completedAt, cutoff48h)),
              ),
            ))
            .orderBy(desc(tasks.createdAt))
            .limit(100);
          const isDuplicate = recentTasks.some(t => normalizeTitle(t.title) === normalized);
          if (isDuplicate) {
            console.log(`  ⏭️ CEO: Task "${action.title}" bereits vorhanden — übersprungen (Dedup)`);
            trace(orchestratorId, companyId, 'info', `Duplikat-Task verhindert: ${action.title}`);
            break;
          }
          // ────────────────────────────────────────────────────────────────────

          const agent = action.assignTo ? findAgent(action.assignTo) : null;
          const newTaskId = uuid();

          await db.insert(tasks).values({
            id: newTaskId,
            companyId,
            title: action.title,
            description: action.description || null,
            status: 'todo',
            priority: action.priority || 'medium',
            assignedTo: agent?.id || null,
            targetId: action.goalId || null,
            projectId: action.projectId === 'auto' || action.projectId === 'last'
              ? lastCreatedProjectId
              : (action.projectId || null),
            createdBy: orchestratorId,
            createdAt: now,
            updatedAt: now,
          } as any).run();

          console.log(`  ✅ CEO erstellt Task: "${action.title}" → ${agent?.name || 'offen'}`);
          trace(orchestratorId, companyId, 'action',
            `CEO erstellt Task: ${action.title}`,
            `Zugewiesen an: ${agent?.name || 'nicht zugewiesen'}`,
          );
          actionSummary.push(`create_task: "${action.title}" → ${agent?.name || 'offen'} [${action.priority || 'medium'}]`);
          tasksCreatedThisCycle++;

          // Wecke den zugewiesenen Agent sofort
          if (agent) {
            await wakeupService.wakeup(agent.id, companyId, {
              source: 'automation',
              triggerDetail: 'callback',
              reason: `Neuer Task vom CEO: ${action.title}`,
            });
          }
          break;
        }

        case 'assign_task': {
          if (!action.taskId || !action.assignTo) break;
          if (!canAssignTask) {
            console.warn(`  🚫 ${orchestratorId} hat keine Berechtigung: assign_task`);
            break;
          }
          const agent = findAgent(action.assignTo);
          if (!agent) { console.warn(`  ⚠️ Agent "${action.assignTo}" nicht gefunden`); break; }

          await db.update(tasks)
            .set({ assignedTo: agent.id, updatedAt: now })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          console.log(`  ✅ CEO weist Task zu → ${agent.name}`);
          trace(orchestratorId, companyId, 'action', `Task zugewiesen an ${agent.name}`);
          actionSummary.push(`assign_task: ${action.taskId} → ${agent.name}`);

          await wakeupService.wakeup(agent.id, companyId, {
            source: 'automation',
            triggerDetail: 'issue_assigned',
            reason: 'Task wurde dir zugewiesen',
          });
          break;
        }

        case 'mark_done': {
          if (!action.taskId) break;

          // ── Verification Gate: prüfe Workspace auf Deliverables ────────────
          const targetTask = db.select().from(tasks)
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .get();

          let verificationPassed = true;
          let verificationReason = '';

          if (targetTask?.workspacePath && isSafeWorkdir(targetTask.workspacePath) && fs.existsSync(targetTask.workspacePath)) {
            const allFiles = fs.readdirSync(targetTask.workspacePath, { recursive: true } as any) as string[];
            const nonEmptyFiles = allFiles
              .filter(f => !f.startsWith('.') && !f.includes('.meta.json'))
              .filter(f => {
                const fp = path.join(targetTask.workspacePath!, f);
                try {
                  const stat = fs.statSync(fp);
                  return !stat.isDirectory() && stat.size > 0;
                } catch { return false; }
              });

            if (nonEmptyFiles.length === 0) {
              verificationPassed = false;
              verificationReason = `Workspace leer — keine Deliverables gefunden`;
            } else if (nonEmptyFiles.length < 3 && /\b(website|web|app|shop|store|projekt|project|plattform|platform)\b/i.test(targetTask?.title || '')) {
              verificationPassed = false;
              verificationReason = `Nur ${nonEmptyFiles.length} Datei(en) im Workspace — zu wenig für ein vollständiges Projekt`;
            }
          } else {
            // Wenn es ein Entwicklungs-Task ist und kein Workspace existiert → blockieren
            const devKeywords = /\b(code|build|create|develop|write|generate|implement|design|script|programm|entwickel|erstelle|baue|schreibe)\b/i;
            if (devKeywords.test(targetTask?.title || '')) {
              verificationPassed = false;
              verificationReason = `Entwicklungs-Task ohne Workspace/Deliverables — verifiziere erst den Output`;
            }
          }

          if (!verificationPassed) {
            console.warn(`  🚫 CEO mark_done BLOCKIERT für ${action.taskId}: ${verificationReason}`);
            trace(orchestratorId, companyId, 'warning', `mark_done blockiert: ${verificationReason}`);
            actionSummary.push(`mark_done BLOCKED: ${action.taskId} — ${verificationReason}`);

            // Task bleibt in_progress, CEO bekommt Feedback als Kommentar
            await db.insert(comments as any).values({
              id: crypto.randomUUID(),
              companyId,
              taskId: action.taskId,
              authorAgentId: orchestratorId,
              authorType: 'agent',
              content: `🚫 **CEO-Verifikation blockiert mark_done**\n\n${verificationReason}\n\nBitte prüfe den Workspace und stelle sicher, dass der Agent tatsächlich gearbeitet hat.`,
              createdAt: now,
            }).run();
            break;
          }
          // ─────────────────────────────────────────────────────────────────────

          // ── Multi-Stage Review: prüfe Parent/Subtask-Beziehungen ────────────
          // Wenn der Task ein Parent hat, prüfe ob alle Siblings done sind
          if (targetTask?.parentId) {
            const siblings = db.select({ id: tasks.id, status: tasks.status })
              .from(tasks)
              .where(and(eq(tasks.parentId, targetTask.parentId), eq(tasks.companyId, companyId)))
              .all();
            const unfinishedSiblings = siblings.filter((s: any) => s.id !== action.taskId && s.status !== 'done' && s.status !== 'cancelled');
            if (unfinishedSiblings.length > 0) {
              console.log(`  📋 Task ${action.taskId} hat ${unfinishedSiblings.length} unfertige Sibling-Tasks → in_review statt done`);
              await db.update(tasks)
                .set({ status: 'in_review', updatedAt: now })
                .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
                .run();
              await db.insert(comments as any).values({
                id: crypto.randomUUID(),
                companyId,
                taskId: action.taskId,
                authorAgentId: orchestratorId,
                authorType: 'agent',
                content: `📋 **Review ausstehend**\n\nTask ist fertig, wartet aber auf Review.\nUnfertige Sibling-Tasks: ${unfinishedSiblings.map((s: any) => s.id).join(', ')}`,
                createdAt: now,
              }).run();
              actionSummary.push(`mark_done → in_review: ${action.taskId} (wartet auf Sibling-Completion)`);
              break;
            }
          }

          // Wenn der Task Children hat, prüfe ob alle Children done sind
          const children = db.select({ id: tasks.id, status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.parentId, action.taskId), eq(tasks.companyId, companyId)))
            .all();
          const unfinishedChildren = children.filter((c: any) => c.status !== 'done' && c.status !== 'cancelled');
          if (unfinishedChildren.length > 0) {
            console.log(`  📋 Task ${action.taskId} hat ${unfinishedChildren.length} unfertige Subtasks → in_review statt done`);
            await db.update(tasks)
              .set({ status: 'in_review', updatedAt: now })
              .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
              .run();
            await db.insert(comments as any).values({
              id: crypto.randomUUID(),
              companyId,
              taskId: action.taskId,
              authorAgentId: orchestratorId,
              authorType: 'agent',
              content: `📋 **Review ausstehend**\n\nTask ist fertig, wartet aber auf Review.\nUnfertige Subtasks: ${unfinishedChildren.map((c: any) => c.id).join(', ')}`,
              createdAt: now,
            }).run();
            actionSummary.push(`mark_done → in_review: ${action.taskId} (wartet auf Subtask-Completion)`);
            break;
          }
          // ─────────────────────────────────────────────────────────────────────

          // ── Peer Review: assign to another agent in same project for review ──
          // Find a peer reviewer (another agent in same project, not the original assignee)
          let reviewerId: string | null = null;
          if (targetTask?.projectId) {
            const projectAgents = db.select({ id: agents.id, name: agents.name })
              .from(agents)
              .where(and(
                eq(agents.companyId, companyId),
                eq(agents.status, 'active'),
              ))
              .all();
            // Pick someone who is NOT the original assignee and NOT the orchestrator
            const peers = projectAgents.filter((a: any) =>
              a.id !== targetTask.assignedTo && a.id !== orchestratorId
            );
            if (peers.length > 0) {
              reviewerId = peers[0].id;
            }
          }
          // Fallback: CEO reviews if no peer available
          if (!reviewerId) {
            reviewerId = orchestratorId;
          }

          await db.update(tasks)
            .set({ status: 'in_review', assignedTo: reviewerId, updatedAt: now, executionLockedAt: null })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          if (action.taskId === taskId) {
            currentTaskMarkedDone = true;
          }

          const reviewerName = reviewerId === orchestratorId ? 'CEO' : (team.find(a => a.id === reviewerId)?.name || reviewerId);
          console.log(`  📋 Task ${action.taskId} → in_review, zugewiesen an Reviewer: ${reviewerName}`);
          trace(orchestratorId, companyId, 'info', `Task zur Review zugewiesen: ${targetTask?.title} → ${reviewerName}`);
          actionSummary.push(`mark_done → in_review: ${action.taskId} (Reviewer: ${reviewerName})`);

          await db.insert(comments as any).values({
            id: crypto.randomUUID(),
            companyId,
            taskId: action.taskId,
            authorAgentId: orchestratorId,
            authorType: 'agent',
            content: `📋 **Review ausstehend**\n\nTask ist fertig und wartet auf Review durch ${reviewerName}.\n\nOriginal-Assignee: ${targetTask?.assignedTo ? (team.find(a => a.id === targetTask.assignedTo)?.name || targetTask.assignedTo) : 'unbekannt'}`,
            createdAt: now,
          }).run();

          // Wake up reviewer
          await wakeupService.wakeup(reviewerId, companyId, {
            source: 'automation',
            triggerDetail: 'review_requested',
            reason: `Review angefordert: ${targetTask?.title}`,
          });

          // Wenn Parent existiert, prüfe ob alle Siblings jetzt in_review/done
          if (targetTask?.parentId) {
            const parentTask = db.select().from(tasks).where(eq(tasks.id, targetTask.parentId)).get();
            if (parentTask?.assignedTo) {
              await wakeupService.wakeup(parentTask.assignedTo, companyId, {
                source: 'automation',
                triggerDetail: 'subtask_completed',
                reason: `Subtask zur Review: ${targetTask.title}`,
              });
            }
          }
          break;
        }

        case 'approve_task': {
          if (!action.taskId) break;
          const reviewTask = db.select().from(tasks)
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .get();
          if (!reviewTask || reviewTask.status !== 'in_review') {
            console.warn(`  ⚠️ Task ${action.taskId} ist nicht in_review — approve nicht möglich`);
            actionSummary.push(`❌ approve_task: ${action.taskId} nicht in_review`);
            break;
          }

          await db.update(tasks)
            .set({ status: 'done', completedAt: now, updatedAt: now })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          console.log(`  ✅ Reviewer approvt Task ${action.taskId} → done`);
          trace(orchestratorId, companyId, 'result', `Task approved: ${reviewTask.title}`);
          actionSummary.push(`approve_task: ${action.taskId} → done`);

          await db.insert(comments as any).values({
            id: crypto.randomUUID(),
            companyId,
            taskId: action.taskId,
            authorAgentId: orchestratorId,
            authorType: 'agent',
            content: `✅ **Task approved**\n\nReviewer hat den Task als fertig bestätigt.`,
            createdAt: now,
          }).run();

          // Unlock dependent tasks
          const { unlockDependentTasks } = await import('./dependencies.js');
          await unlockDependentTasks(action.taskId, companyId).catch(() => {});

          // Wake up original assignee
          if (reviewTask.assignedTo && reviewTask.assignedTo !== orchestratorId) {
            await wakeupService.wakeup(reviewTask.assignedTo, companyId, {
              source: 'automation',
              triggerDetail: 'task_approved',
              reason: `Dein Task wurde approved: ${reviewTask.title}`,
            });
          }
          break;
        }

        case 'reject_task': {
          if (!action.taskId) break;
          const rejectTask = db.select().from(tasks)
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .get();
          if (!rejectTask || rejectTask.status !== 'in_review') {
            console.warn(`  ⚠️ Task ${action.taskId} ist nicht in_review — reject nicht möglich`);
            actionSummary.push(`❌ reject_task: ${action.taskId} nicht in_review`);
            break;
          }

          // Return to original assignee
          const originalAssignee = rejectTask.createdBy || rejectTask.assignedTo;
          await db.update(tasks)
            .set({ status: 'in_progress', assignedTo: originalAssignee, updatedAt: now })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          console.log(`  ❌ Reviewer rejected Task ${action.taskId} → zurück an ${originalAssignee}`);
          trace(orchestratorId, companyId, 'warning', `Task rejected: ${rejectTask.title}`);
          actionSummary.push(`reject_task: ${action.taskId} → in_progress (Rückgabe an Assignee)`);

          await db.insert(comments as any).values({
            id: crypto.randomUUID(),
            companyId,
            taskId: action.taskId,
            authorAgentId: orchestratorId,
            authorType: 'agent',
            content: `❌ **Task rejected**\n\n${action.reason || 'Reviewer hat den Task abgelehnt. Bitte überarbeite und reiche erneut ein.'}`,
            createdAt: now,
          }).run();

          if (originalAssignee) {
            await wakeupService.wakeup(originalAssignee, companyId, {
              source: 'automation',
              triggerDetail: 'task_rejected',
              reason: `Dein Task wurde abgelehnt: ${rejectTask.title}`,
            });
          }
          break;
        }

        case 'update_goal': {
          if (!action.goalId) break;
          const goalUpdate: any = { updatedAt: now };
          if (typeof action.progress === 'number') goalUpdate.progress = action.progress;
          if (action.status) goalUpdate.status = action.status;

          await db.update(goals)
            .set(goalUpdate)
            .where(and(eq(goals.id, action.goalId), eq(goals.companyId, companyId)))
            .run();

          console.log(`  ✅ CEO aktualisiert Ziel ${action.goalId}: ${action.progress ?? ''}%`);
          actionSummary.push(`update_goal: ${action.goalId} → ${action.progress ?? '?'}%`);
          trace(orchestratorId, companyId, 'result',
            `Ziel aktualisiert${typeof action.progress === 'number' ? `: ${action.progress}%` : ''}`,
          );
          break;
        }

        case 'hire_agent': {
          // CEO requests hiring a new agent — creates an approval request for human review
          if (!action.role) break;
          if (!canRecruitAgent && !canRequestApproval) {
            console.warn(`  🚫 ${orchestratorId} hat keine Berechtigung: hire_agent`);
            break;
          }
          // Deduplication: skip if a pending hire_expert request for same role already exists
          const existingHire = await db.select({ id: approvals.id })
            .from(approvals as any)
            .where(and(
              eq(approvals.companyId as any, companyId),
              eq(approvals.type as any, 'hire_expert'),
              eq(approvals.status as any, 'pending'),
            ))
            .limit(20);
          const duplicateRole = existingHire.some(g => {
            try {
              const payload = JSON.parse((g as any).payload || '{}');
              return payload.role === action.role;
            } catch { return false; }
          });
          if (duplicateRole) {
            console.log(`  ⏭ hire_agent dedup: pending request for "${action.role}" already exists — skipping`);
            trace(orchestratorId, companyId, 'info', `Einstellung "${action.role}" bereits beantragt — übersprungen`);
            break;
          }
          const approvalId = crypto.randomUUID();
          await db.insert(approvals as any).values({
            id: approvalId,
            companyId,
            type: 'hire_expert',
            title: `Neuen Agent einstellen: ${action.role}`,
            description: action.begruendung || `Der CEO empfiehlt, einen neuen Agent mit der Rolle "${action.role}" einzustellen.`,
            requestedBy: orchestratorId,
            status: 'pending',
            payload: JSON.stringify({
              role: action.role,
              skills: action.skills || '',
              connectionType: action.connectionType || 'custom',
              monthlyBudgetCent: action.monthlyBudgetCent || 50000,
            }),
            createdAt: now,
            updatedAt: now,
          }).run();

          console.log(`  📋 CEO beantragt Einstellung: "${action.role}" — Genehmigung ausstehend`);
          actionSummary.push(`hire_agent: "${action.role}" → Genehmigung ausstehend`);
          trace(orchestratorId, companyId, 'action',
            `Einstellungsantrag: ${action.role}`,
            `Genehmigung erforderlich`,
          );
          break;
        }

        case 'call_meeting': {
          // CEO kann ein Meeting einberufen: { type: 'call_meeting', thema: string, participantIds: string[], agenda?: string }
          if (!action.thema || !Array.isArray(action.participantIds) || action.participantIds.length === 0) break;

          const meetingId = crypto.randomUUID();
          await db.insert(agentMeetings).values({
            id: meetingId,
            companyId,
            organizerAgentId: orchestratorId,
            title: action.thema,
            participantIds: JSON.stringify(action.participantIds),
            responses: JSON.stringify({}),
            status: 'running',
            createdAt: now,
          }).run();

          // Wake up all participants
          for (const participantId of action.participantIds) {
            await db.insert(agentWakeupRequests).values({
              id: crypto.randomUUID(),
              agentId: participantId,
              companyId,
              reason: `Meeting einberufen: ${action.thema}`,
              source: 'automation',
              payload: JSON.stringify({ meetingId, thema: action.thema }),
              requestedAt: now,
            }).run();
          }

          console.log(`  📋 CEO ruft Meeting ein: "${action.thema}" mit ${action.participantIds.length} Teilnehmern`);
          actionSummary.push(`call_meeting: "${action.thema}" (${action.participantIds.length} Teilnehmer)`);
          trace(orchestratorId, companyId, 'action',
            `Meeting einberufen: ${action.thema}`,
            `${action.participantIds.length} Teilnehmer`, undefined
          );
          break;
        }

        case 'create_project': {
          if (!action.name) break;
          if (!canCreateTask) {
            console.warn(`  🚫 ${orchestratorId} hat keine Berechtigung: create_project`);
            break;
          }

          // Dedup: skip if project with same name already exists
          const existingProject = db.select().from(projects)
            .where(and(eq(projects.companyId, companyId), eq(projects.name, action.name)))
            .get();
          if (existingProject) {
            console.log(`  ⏭️ CEO: Projekt "${action.name}" existiert bereits — übersprungen`);
            lastCreatedProjectId = (existingProject as any).id;
            break;
          }

          const projectId = uuid();

          // Auto-generate subtasks if none provided, based on project type
          const projectSubtasks = action.tasks && Array.isArray(action.tasks) && action.tasks.length > 0
            ? action.tasks
            : generateProjectSubtasks(action.name, team);

          // Atomic transaction: project + subtasks
          db.transaction((tx) => {
            tx.insert(projects).values({
              id: projectId,
              companyId,
              name: action.name,
              description: action.description || null,
              status: 'aktiv',
              priority: action.priority || 'medium',
              goalId: action.goalId || null,
              ownerAgentId: orchestratorId,
              color: action.color || '#23CDCB',
              createdAt: now,
              updatedAt: now,
            } as any).run();

            for (const t of projectSubtasks) {
              const newTaskId = uuid();
              const taskAgent = t.agentId ? team.find(a => a.id === t.agentId) : null;
              tx.insert(tasks).values({
                id: newTaskId,
                companyId,
                title: t.title,
                description: t.description || null,
                status: 'todo',
                priority: t.priority || 'medium',
                assignedTo: taskAgent?.id || null,
                projectId: projectId,
                createdBy: orchestratorId,
                createdAt: now,
                updatedAt: now,
              } as any).run();
            }
          });

          console.log(`  ✅ CEO erstellt Projekt: "${action.name}" (${projectId})`);
          trace(orchestratorId, companyId, 'action', `Projekt erstellt: ${action.name}`, `ID: ${projectId}`);
          actionSummary.push(`create_project: "${action.name}" [${action.priority || 'medium'}]`);

          // Wakeup calls outside transaction
          if (projectSubtasks && projectSubtasks.length > 0) {
            for (const t of projectSubtasks) {
              const taskAgent = t.agentId ? team.find(a => a.id === t.agentId) : null;
              if (taskAgent) {
                console.log(`    📋 Projekt-Task erstellt: "${t.title}" → ${taskAgent.name || 'offen'}`);
                trace(orchestratorId, companyId, 'action', `Projekt-Task erstellt: ${t.title}`, `Projekt: ${action.name}`);
                wakeupService.wakeup(taskAgent.id, companyId, {
                  source: 'automation',
                  triggerDetail: 'issue_assigned',
                  reason: `Neuer Projekt-Task: ${t.title}`,
                }).catch(() => {});
              }
            }
          }

          // Remember for subsequent tasks in the same action batch
          lastCreatedProjectId = projectId;
          break;
        }

        case 'create_routine': {
          const { title: rtitel, description: rdesc, cronExpression, timezone, assignToSelf } = action;
          if (!rtitel || !cronExpression) {
            console.warn(`  ⚠️ create_routine: title and cronExpression are required`);
            break;
          }
          const routineId = uuid();
          const ts = new Date().toISOString();

          // Atomic transaction: routine + trigger
          db.transaction((tx) => {
            tx.insert(routines).values({
              id: routineId,
              companyId,
              title: rtitel,
              description: rdesc || '',
              assignedTo: assignToSelf !== false ? orchestratorId : null,
              priority: (action.priority || 'medium') as any,
              status: 'active',
              createdAt: ts,
              updatedAt: ts,
            }).run();
            tx.insert(routineTrigger).values({
              id: uuid(),
              companyId,
              routineId,
              kind: 'schedule',
              active: true,
              cronExpression,
              timezone: timezone || 'Europe/Berlin',
              createdAt: ts,
            }).run();
          });

          console.log(`  ✅ CEO erstellt Routine: "${rtitel}" (${cronExpression})`);
          trace(orchestratorId, companyId, 'action', `Routine erstellt: ${rtitel}`, `Zeitplan: ${cronExpression}`);
          actionSummary.push(`create_routine: "${rtitel}" (${cronExpression})`);
          break;
        }

        default:
          console.warn(`  ⚠️ Unbekannte CEO Action: ${action.type}`);
      }
    } catch (err: any) {
      console.error(`  ❌ CEO Action "${action.type}" fehlgeschlagen: ${err.message}`);
    }
  }
  return { done: currentTaskMarkedDone, actionSummary };
}

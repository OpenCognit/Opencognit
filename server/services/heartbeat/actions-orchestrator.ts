// Heartbeat Actions Orchestrator — CEO action dispatcher

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { tasks, agents, goals, agentPermissions, approvals, agentMeetings, agentWakeupRequests, settings, routines, routineTrigger } from '../../db/schema.js';
import { eq, and, inArray, or, desc, gte } from 'drizzle-orm';
import { wakeupService } from '../wakeup.js';
import { v4 as uuid } from 'uuid';
import { trace } from './utils.js';

export interface OrchestratorActionResult {
  /** true if the orchestrator's actions included marking the current task as done */
  done: boolean;
  /** human-readable summary of each executed action, for the decision log */
  actionSummary: string[];
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
          await db.update(tasks)
            .set({ status: 'done', completedAt: now, updatedAt: now, executionLockedAt: null })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          if (action.taskId === taskId) {
            currentTaskMarkedDone = true;
          }
          console.log(`  ✅ CEO markiert Task ${action.taskId} als erledigt`);
          trace(orchestratorId, companyId, 'result', `Task als erledigt markiert`);
          actionSummary.push(`mark_done: ${action.taskId}`);
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

        case 'create_routine': {
          const { title: rtitel, description: rdesc, cronExpression, timezone, assignToSelf } = action;
          if (!rtitel || !cronExpression) {
            console.warn(`  ⚠️ create_routine: title and cronExpression are required`);
            break;
          }
          const routineId = uuid();
          const ts = new Date().toISOString();
          await db.insert(routines).values({
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
          await db.insert(routineTrigger).values({
            id: uuid(),
            companyId,
            routineId,
            kind: 'schedule',
            active: true,
            cronExpression,
            timezone: timezone || 'Europe/Berlin',
            createdAt: ts,
          }).run();
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

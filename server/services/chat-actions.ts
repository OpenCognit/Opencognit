// Chat Actions — CEO action dispatcher for chat context
// Same logic as heartbeat/actions-orchestrator.ts but without taskId dependency

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../db/client.js';
import { tasks, agents, goals, agentPermissions, approvals, agentMeetings, agentWakeupRequests, settings, routines, routineTrigger, comments, projects } from '../db/schema.js';
import { z } from 'zod';
import { eq, and, inArray, or, desc, gte } from 'drizzle-orm';
import { wakeupService } from './wakeup.js';
import { v4 as uuid } from 'uuid';
import { appEvents } from '../events.js';
import { isSafeWorkdir } from '../adapters/workspace-guard.js';

export interface ChatActionResult {
  /** true if any action was executed */
  executed: boolean;
  /** human-readable summary of each executed action */
  actionSummary: string[];
  /** full reply text with action results embedded */
  replyText: string;
  /** IDs of tasks created during execution */
  createdTaskIds: string[];
  /** IDs of projects created during execution */
  createdProjectIds: string[];
}

function emitTrace(agentId: string, companyId: string, type: string, title: string, details?: string) {
  appEvents.emit('trace', { agentId, companyId, type, title, details, runId: undefined });
}

/**
 * Parse and execute CEO actions from chat [ACTION] blocks.
 * Supports: create_task, assign_task, mark_done, update_goal, hire_agent,
 *           call_meeting, create_project, create_routine
 */
export async function processChatActions(
  agentId: string,
  companyId: string,
  replyText: string,
): Promise<ChatActionResult> {
  // ─── Zod Schema for Chat Actions ───────────────────────────────────────────
  const chatActionSchema = z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('create_task'), title: z.string().min(1).max(200), description: z.string().max(5000).optional(), priority: z.string().optional(), assignTo: z.string().optional(), goalId: z.string().optional(), projectId: z.string().optional() }),
    z.object({ type: z.literal('assign_task'), taskId: z.string().min(1), assignTo: z.string().min(1) }),
    z.object({ type: z.literal('mark_done'), taskId: z.string().min(1) }),
    z.object({ type: z.literal('approve_task'), taskId: z.string().min(1) }),
    z.object({ type: z.literal('reject_task'), taskId: z.string().min(1), reason: z.string().max(2000).optional() }),
    z.object({ type: z.literal('update_goal'), goalId: z.string().min(1), progress: z.number().min(0).max(100).optional(), status: z.string().optional() }),
    z.object({ type: z.literal('hire_agent'), role: z.string().min(1).max(100), skills: z.string().optional(), connectionType: z.string().optional(), monthlyBudgetCent: z.number().optional(), begruendung: z.string().optional() }),
    z.object({ type: z.literal('call_meeting'), thema: z.string().min(1).max(200), participantIds: z.array(z.string()).optional(), agenda: z.string().optional() }),
    z.object({ type: z.literal('create_project'), name: z.string().min(1).max(200), description: z.string().max(5000).optional(), type: z.string().optional(), priority: z.string().optional(), goalId: z.string().optional(), color: z.string().optional(), tasks: z.array(z.any()).optional() }),
    z.object({ type: z.literal('create_routine'), title: z.string().min(1).max(200), description: z.string().optional(), cronExpression: z.string().min(1), timezone: z.string().optional(), assignToSelf: z.boolean().optional(), priority: z.string().optional() }),
  ]));
  // ─────────────────────────────────────────────────────────────────────────────

  // Extract JSON blocks from [ACTION]{...}[/ACTION]
  let rawActions: any[] = [];
  const actionSummary: string[] = [];

  const actionRegex = /\[ACTION\]([\s\S]*?)\[\/ACTION\]/g;
  let match;
  while ((match = actionRegex.exec(replyText)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        rawActions.push(...parsed.actions);
      } else if (parsed.type) {
        rawActions.push(parsed);
      }
    } catch { /* invalid JSON */ }
  }

  // Also try ```json ... ``` blocks with "actions" array
  const jsonBlockMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/);
  const rawJsonMatch = replyText.match(/\{\s*"actions"\s*:\s*\[[\s\S]*?\]\s*\}/);
  for (const raw of [jsonBlockMatch?.[1], rawJsonMatch?.[0]]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        rawActions.push(...parsed.actions);
        break;
      }
    } catch { /* invalid JSON */ }
  }

  // Validate actions with Zod
  let actions: any[] = [];
  const validationResult = chatActionSchema.safeParse(rawActions);
  if (validationResult.success) {
    actions = validationResult.data;
  } else {
    console.warn(`  ⚠️ Chat Actions Zod-Validierung fehlgeschlagen: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
    actions = rawActions.filter((a: any) => typeof a?.type === 'string');
  }

  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];

  if (actions.length === 0) {
    return { executed: false, actionSummary: [], replyText, createdTaskIds, createdProjectIds };
  }

  console.log(`  🎯 Chat Action Parser: ${actions.length} Aktion(en) gefunden`);
  emitTrace(agentId, companyId, 'action', `CEO führt ${actions.length} Aktion(en) aus (Chat)`);

  // Load permissions
  const perms = db.select().from(agentPermissions)
    .where(eq(agentPermissions.agentId, agentId)).get();

  const canCreateTask      = !perms || perms.darfAufgabenErstellen !== false;
  const canAssignTask      = !perms || perms.darfAufgabenZuweisen !== false;
  const canRequestApproval = !perms || perms.darfGenehmigungAnfordern !== false;
  const canRecruitAgent    = !perms || perms.darfExpertenAnwerben !== false;

  const requireApprovalSetting = db.select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'ceo_require_approval'), eq(settings.companyId, companyId)))
    .get();
  const ceoRequireApproval = requireApprovalSetting?.value === 'true';

  const maxTasksSetting = db.select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'ceo_max_tasks_per_cycle'), eq(settings.companyId, companyId)))
    .get();
  const maxTasksPerCycle = maxTasksSetting?.value ? parseInt(maxTasksSetting.value, 10) : Infinity;
  let tasksCreatedThisCycle = 0;

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
            console.warn(`  🚫 ${agentId} hat keine Berechtigung: create_task`);
            actionSummary.push(`❌ create_task: keine Berechtigung`);
            break;
          }

          const needsApproval = ceoRequireApproval || tasksCreatedThisCycle >= maxTasksPerCycle;
          if (needsApproval && canRequestApproval) {
            const approvalId = crypto.randomUUID();
            await db.insert(approvals as any).values({
              id: approvalId,
              companyId,
              type: 'approve_strategy',
              title: `CEO möchte Task erstellen: ${action.title}`,
              description: action.description || null,
              requestedBy: agentId,
              status: 'pending',
              payload: JSON.stringify({ action }),
              createdAt: now,
              updatedAt: now,
            }).run();
            console.log(`  📋 CEO Task "${action.title}" → Genehmigung ausstehend`);
            emitTrace(agentId, companyId, 'info', `Task wartet auf Genehmigung: ${action.title}`);
            actionSummary.push(`📋 create_task: "${action.title}" → wartet auf Genehmigung`);
            break;
          }

          // Dedup
          const normalizeTitle = (t: string) => t.toLowerCase().trim().slice(0, 60);
          const normalized = normalizeTitle(action.title);
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
            console.log(`  ⏭️ CEO: Task "${action.title}" bereits vorhanden — übersprungen`);
            emitTrace(agentId, companyId, 'info', `Duplikat-Task verhindert: ${action.title}`);
            actionSummary.push(`⏭ create_task: "${action.title}" → existiert bereits`);
            break;
          }

          const taskAgent = action.assignTo ? findAgent(action.assignTo) : null;
          const newTaskId = uuid();

          await db.insert(tasks).values({
            id: newTaskId,
            companyId,
            title: action.title,
            description: action.description || null,
            status: 'todo',
            priority: action.priority || 'medium',
            assignedTo: taskAgent?.id || null,
            targetId: action.goalId || null,
            projectId: action.projectId === 'auto' || action.projectId === 'last'
              ? lastCreatedProjectId
              : (action.projectId || null),
            createdBy: agentId,
            createdAt: now,
            updatedAt: now,
          } as any).run();
          createdTaskIds.push(newTaskId);

          console.log(`  ✅ CEO erstellt Task: "${action.title}" → ${taskAgent?.name || 'offen'}`);
          emitTrace(agentId, companyId, 'action', `CEO erstellt Task: ${action.title}`, `Zugewiesen an: ${taskAgent?.name || 'nicht zugewiesen'}`);
          actionSummary.push(`✅ create_task: "${action.title}" → ${taskAgent?.name || 'offen'}`);
          tasksCreatedThisCycle++;

          if (taskAgent) {
            await wakeupService.wakeup(taskAgent.id, companyId, {
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
            console.warn(`  🚫 ${agentId} hat keine Berechtigung: assign_task`);
            actionSummary.push(`❌ assign_task: keine Berechtigung`);
            break;
          }
          const taskAgent = findAgent(action.assignTo);
          if (!taskAgent) {
            console.warn(`  ⚠️ Agent "${action.assignTo}" nicht gefunden`);
            actionSummary.push(`❌ assign_task: Agent "${action.assignTo}" nicht gefunden`);
            break;
          }

          await db.update(tasks)
            .set({ assignedTo: taskAgent.id, updatedAt: now })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          console.log(`  ✅ CEO weist Task zu → ${taskAgent.name}`);
          emitTrace(agentId, companyId, 'action', `Task zugewiesen an ${taskAgent.name}`);
          actionSummary.push(`✅ assign_task: ${action.taskId} → ${taskAgent.name}`);

          await wakeupService.wakeup(taskAgent.id, companyId, {
            source: 'automation',
            triggerDetail: 'issue_assigned',
            reason: 'Task wurde dir zugewiesen',
          });
          break;
        }

        case 'mark_done': {
          if (!action.taskId) break;

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
            const devKeywords = /\b(code|build|create|develop|write|generate|implement|design|script|programm|entwickel|erstelle|baue|schreibe)\b/i;
            if (devKeywords.test(targetTask?.title || '')) {
              verificationPassed = false;
              verificationReason = `Entwicklungs-Task ohne Workspace/Deliverables — verifiziere erst den Output`;
            }
          }

          if (!verificationPassed) {
            console.warn(`  🚫 CEO mark_done BLOCKIERT für ${action.taskId}: ${verificationReason}`);
            emitTrace(agentId, companyId, 'warning', `mark_done blockiert: ${verificationReason}`);
            actionSummary.push(`🚫 mark_done: ${action.taskId} → ${verificationReason}`);

            await db.insert(comments as any).values({
              id: crypto.randomUUID(),
              companyId,
              taskId: action.taskId,
              authorAgentId: agentId,
              authorType: 'agent',
              content: `🚫 **CEO-Verifikation blockiert mark_done**\n\n${verificationReason}\n\nBitte prüfe den Workspace und stelle sicher, dass der Agent tatsächlich gearbeitet hat.`,
              createdAt: now,
            }).run();
            break;
          }

          // Multi-Stage Review: check parent/child relationships
          if (targetTask?.parentId) {
            const siblings = db.select({ id: tasks.id, status: tasks.status })
              .from(tasks)
              .where(and(eq(tasks.parentId, targetTask.parentId), eq(tasks.companyId, companyId)))
              .all();
            const unfinishedSiblings = siblings.filter((s: any) => s.id !== action.taskId && s.status !== 'done' && s.status !== 'cancelled');
            if (unfinishedSiblings.length > 0) {
              await db.update(tasks)
                .set({ status: 'in_review', updatedAt: now })
                .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
                .run();
              await db.insert(comments as any).values({
                id: crypto.randomUUID(),
                companyId,
                taskId: action.taskId,
                authorAgentId: agentId,
                authorType: 'agent',
                content: `📋 **Review ausstehend**\n\nTask ist fertig, wartet aber auf Review.\nUnfertige Sibling-Tasks: ${unfinishedSiblings.map((s: any) => s.id).join(', ')}`,
                createdAt: now,
              }).run();
              actionSummary.push(`📋 mark_done → in_review: ${action.taskId} (wartet auf Sibling-Completion)`);
              break;
            }
          }

          const children = db.select({ id: tasks.id, status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.parentId, action.taskId), eq(tasks.companyId, companyId)))
            .all();
          const unfinishedChildren = children.filter((c: any) => c.status !== 'done' && c.status !== 'cancelled');
          if (unfinishedChildren.length > 0) {
            await db.update(tasks)
              .set({ status: 'in_review', updatedAt: now })
              .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
              .run();
            await db.insert(comments as any).values({
              id: crypto.randomUUID(),
              companyId,
              taskId: action.taskId,
              authorAgentId: agentId,
              authorType: 'agent',
              content: `📋 **Review ausstehend**\n\nTask ist fertig, wartet aber auf Review.\nUnfertige Subtasks: ${unfinishedChildren.map((c: any) => c.id).join(', ')}`,
              createdAt: now,
            }).run();
            actionSummary.push(`📋 mark_done → in_review: ${action.taskId} (wartet auf Subtask-Completion)`);
            break;
          }

          // Peer Review: assign to another agent in same project
          let reviewerId: string | null = null;
          if (targetTask?.projectId) {
            const projectAgents = db.select({ id: agents.id, name: agents.name })
              .from(agents)
              .where(and(eq(agents.companyId, companyId), eq(agents.status, 'active')))
              .all();
            const peers = projectAgents.filter((a: any) => a.id !== targetTask.assignedTo && a.id !== agentId);
            if (peers.length > 0) reviewerId = peers[0].id;
          }
          if (!reviewerId) reviewerId = agentId;

          await db.update(tasks)
            .set({ status: 'in_review', assignedTo: reviewerId, updatedAt: now, executionLockedAt: null })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();

          const reviewerName = reviewerId === agentId ? 'CEO' : (team.find(a => a.id === reviewerId)?.name || reviewerId);
          console.log(`  📋 Task ${action.taskId} → in_review, Reviewer: ${reviewerName}`);
          emitTrace(agentId, companyId, 'info', `Task zur Review: ${targetTask?.title} → ${reviewerName}`);
          actionSummary.push(`📋 mark_done → in_review: ${action.taskId} (Reviewer: ${reviewerName})`);

          await db.insert(comments as any).values({
            id: crypto.randomUUID(),
            companyId,
            taskId: action.taskId,
            authorAgentId: agentId,
            authorType: 'agent',
            content: `📋 **Review ausstehend**\n\nTask wartet auf Review durch ${reviewerName}.`,
            createdAt: now,
          }).run();

          await wakeupService.wakeup(reviewerId, companyId, {
            source: 'automation',
            triggerDetail: 'review_requested',
            reason: `Review: ${targetTask?.title}`,
          });

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
            actionSummary.push(`❌ approve_task: ${action.taskId} nicht in_review`);
            break;
          }
          await db.update(tasks)
            .set({ status: 'done', completedAt: now, updatedAt: now })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();
          emitTrace(agentId, companyId, 'result', `Task approved: ${reviewTask.title}`);
          actionSummary.push(`✅ approve_task: ${action.taskId} → done`);

          await db.insert(comments as any).values({
            id: crypto.randomUUID(),
            companyId,
            taskId: action.taskId,
            authorAgentId: agentId,
            authorType: 'agent',
            content: `✅ **Task approved**`,
            createdAt: now,
          }).run();

          const { unlockDependentTasks } = await import('./dependencies.js');
          await unlockDependentTasks(action.taskId, companyId).catch(() => {});
          break;
        }

        case 'reject_task': {
          if (!action.taskId) break;
          const rejectTask = db.select().from(tasks)
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .get();
          if (!rejectTask || rejectTask.status !== 'in_review') {
            actionSummary.push(`❌ reject_task: ${action.taskId} nicht in_review`);
            break;
          }
          const originalAssignee = rejectTask.createdBy || rejectTask.assignedTo;
          await db.update(tasks)
            .set({ status: 'in_progress', assignedTo: originalAssignee, updatedAt: now })
            .where(and(eq(tasks.id, action.taskId), eq(tasks.companyId, companyId)))
            .run();
          emitTrace(agentId, companyId, 'warning', `Task rejected: ${rejectTask.title}`);
          actionSummary.push(`❌ reject_task: ${action.taskId} → in_progress`);

          await db.insert(comments as any).values({
            id: crypto.randomUUID(),
            companyId,
            taskId: action.taskId,
            authorAgentId: agentId,
            authorType: 'agent',
            content: `❌ **Task rejected**\n\n${action.reason || 'Reviewer hat den Task abgelehnt.'}`,
            createdAt: now,
          }).run();
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
          actionSummary.push(`✅ update_goal: ${action.goalId} → ${action.progress ?? '?'}%`);
          emitTrace(agentId, companyId, 'result', `Ziel aktualisiert${typeof action.progress === 'number' ? `: ${action.progress}%` : ''}`);
          break;
        }

        case 'hire_agent': {
          if (!action.role) break;
          if (!canRecruitAgent && !canRequestApproval) {
            console.warn(`  🚫 ${agentId} hat keine Berechtigung: hire_agent`);
            actionSummary.push(`❌ hire_agent: keine Berechtigung`);
            break;
          }

          const existingHire = await db.select({ id: approvals.id })
            .from(approvals as any)
            .where(and(
              eq(approvals.companyId as any, companyId),
              eq(approvals.type as any, 'hire_expert'),
              eq(approvals.status as any, 'pending'),
            ))
            .limit(20);
          const duplicateRole = existingHire.some((g: any) => {
            try {
              const payload = JSON.parse(g.payload || '{}');
              return payload.role === action.role;
            } catch { return false; }
          });
          if (duplicateRole) {
            console.log(`  ⏭ hire_agent dedup: pending request for "${action.role}" already exists`);
            emitTrace(agentId, companyId, 'info', `Einstellung "${action.role}" bereits beantragt — übersprungen`);
            actionSummary.push(`⏭ hire_agent: "${action.role}" → bereits beantragt`);
            break;
          }

          const approvalId = crypto.randomUUID();
          await db.insert(approvals as any).values({
            id: approvalId,
            companyId,
            type: 'hire_expert',
            title: `Neuen Agent einstellen: ${action.role}`,
            description: action.begruendung || `Der CEO empfiehlt, einen neuen Agent mit der Rolle "${action.role}" einzustellen.`,
            requestedBy: agentId,
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
          actionSummary.push(`📋 hire_agent: "${action.role}" → Genehmigung ausstehend`);
          emitTrace(agentId, companyId, 'action', `Einstellungsantrag: ${action.role}`, `Genehmigung erforderlich`);
          break;
        }

        case 'call_meeting': {
          if (!action.thema || !Array.isArray(action.participantIds) || action.participantIds.length === 0) break;

          const meetingId = crypto.randomUUID();
          await db.insert(agentMeetings).values({
            id: meetingId,
            companyId,
            organizerAgentId: agentId,
            title: action.thema,
            participantIds: JSON.stringify(action.participantIds),
            responses: JSON.stringify({}),
            status: 'running',
            createdAt: now,
          }).run();

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
          actionSummary.push(`📋 call_meeting: "${action.thema}" (${action.participantIds.length} Teilnehmer)`);
          emitTrace(agentId, companyId, 'action', `Meeting einberufen: ${action.thema}`, `${action.participantIds.length} Teilnehmer`);
          break;
        }

        case 'create_project': {
          if (!action.name) break;
          if (!canCreateTask) {
            console.warn(`  🚫 ${agentId} hat keine Berechtigung: create_project`);
            actionSummary.push(`❌ create_project: keine Berechtigung`);
            break;
          }

          const existingProject = db.select().from(projects)
            .where(and(eq(projects.companyId, companyId), eq(projects.name, action.name)))
            .get();
          if (existingProject) {
            console.log(`  ⏭️ CEO: Projekt "${action.name}" existiert bereits — übersprungen`);
            lastCreatedProjectId = (existingProject as any).id;
            actionSummary.push(`⏭ create_project: "${action.name}" → existiert bereits`);
            break;
          }

          const projectId = uuid();
          const projectTasks = action.tasks && Array.isArray(action.tasks) ? action.tasks : [];

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
              ownerAgentId: agentId,
              color: action.color || '#23CDCB',
              createdAt: now,
              updatedAt: now,
            } as any).run();

            for (const t of projectTasks) {
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
                createdBy: agentId,
                createdAt: now,
                updatedAt: now,
              } as any).run();
            }
          });

          createdProjectIds.push(projectId);
          console.log(`  ✅ CEO erstellt Projekt: "${action.name}" (${projectId})`);
          emitTrace(agentId, companyId, 'action', `Projekt erstellt: ${action.name}`, `ID: ${projectId}`);
          actionSummary.push(`✅ create_project: "${action.name}"`);

          // Wakeup calls outside transaction
          for (const t of projectTasks) {
            const taskAgent = t.agentId ? team.find(a => a.id === t.agentId) : null;
            if (taskAgent) {
              console.log(`    📋 Projekt-Task erstellt: "${t.title}" → ${taskAgent.name || 'offen'}`);
              emitTrace(agentId, companyId, 'action', `Projekt-Task erstellt: ${t.title}`, `Projekt: ${action.name}`);
              actionSummary.push(`  📋 Projekt-Task: "${t.title}" → ${taskAgent.name || 'offen'}`);
              wakeupService.wakeup(taskAgent.id, companyId, {
                source: 'automation',
                triggerDetail: 'issue_assigned',
                reason: `Neuer Projekt-Task: ${t.title}`,
              }).catch(() => {});
            }
          }

          lastCreatedProjectId = projectId;
          break;
        }

        case 'create_routine': {
          const { title: rtitel, description: rdesc, cronExpression, timezone, assignToSelf } = action;
          if (!rtitel || !cronExpression) {
            console.warn(`  ⚠️ create_routine: title and cronExpression are required`);
            actionSummary.push(`❌ create_routine: title und cronExpression erforderlich`);
            break;
          }
          const routineId = uuid();

          // Atomic transaction: routine + trigger
          db.transaction((tx) => {
            tx.insert(routines).values({
              id: routineId,
              companyId,
              title: rtitel,
              description: rdesc || '',
              assignedTo: assignToSelf !== false ? agentId : null,
              priority: (action.priority || 'medium') as any,
              status: 'active',
              createdAt: now,
              updatedAt: now,
            }).run();
            tx.insert(routineTrigger).values({
              id: uuid(),
              companyId,
              routineId,
              kind: 'schedule',
              active: true,
              cronExpression,
              timezone: timezone || 'Europe/Berlin',
              createdAt: now,
            }).run();
          });

          console.log(`  ✅ CEO erstellt Routine: "${rtitel}" (${cronExpression})`);
          emitTrace(agentId, companyId, 'action', `Routine erstellt: ${rtitel}`, `Zeitplan: ${cronExpression}`);
          actionSummary.push(`✅ create_routine: "${rtitel}" (${cronExpression})`);
          break;
        }

        default:
          console.warn(`  ⚠️ Unbekannte CEO Action: ${action.type}`);
          actionSummary.push(`⚠️ Unbekannte Action: ${action.type}`);
      }
    } catch (err: any) {
      console.error(`  ❌ CEO Action "${action.type}" fehlgeschlagen: ${err.message}`);
      actionSummary.push(`❌ ${action.type} fehlgeschlagen: ${err.message?.slice(0, 80)}`);
    }
  }

  // Build reply with action results appended
  let finalReply = replyText;
  if (actionSummary.length > 0) {
    const isEn = db.select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, 'ui_language'), eq(settings.companyId, companyId)))
      .get()?.value === 'en';

    const resultHeader = isEn
      ? '\n\n---\n📋 **Actions executed:**\n'
      : '\n\n---\n📋 **Ausgeführte Aktionen:**\n';

    const resultBody = actionSummary.map(s => `- ${s}`).join('\n');
    finalReply = replyText.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, '').trim()
      + resultHeader + resultBody;
  }

  return { executed: actionSummary.length > 0, actionSummary, replyText: finalReply, createdTaskIds, createdProjectIds };
}

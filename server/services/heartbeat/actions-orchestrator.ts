// Heartbeat Actions Orchestrator — CEO action dispatcher

import crypto from 'crypto';
import { db } from '../../db/client.js';
import { aufgaben, experten, ziele, agentPermissions, genehmigungen, agentMeetings, agentWakeupRequests, einstellungen } from '../../db/schema.js';
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
  unternehmenId: string,
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

  if (actions.length === 0) return currentTaskMarkedDone;

  console.log(`  🎯 CEO Action Parser: ${actions.length} Aktion(en) gefunden`);
  trace(orchestratorId, unternehmenId, 'action', `CEO führt ${actions.length} Aktion(en) aus`);

  // Load permissions for this orchestrator — gate which actions are allowed
  const perms = db.select().from(agentPermissions)
    .where(eq(agentPermissions.expertId, orchestratorId)).get();

  const canCreateTask     = !perms || perms.darfAufgabenErstellen !== false;
  const canAssignTask     = !perms || perms.darfAufgabenZuweisen !== false;
  const canRequestApproval = !perms || perms.darfGenehmigungAnfordern !== false;
  const canRecruitAgent   = !perms || perms.darfExpertenAnwerben !== false;

  // ceo_require_approval: when 'true', CEO's create_task goes to approval queue
  const requireApprovalSetting = db.select({ wert: einstellungen.wert })
    .from(einstellungen)
    .where(and(eq(einstellungen.schluessel, 'ceo_require_approval'), eq(einstellungen.unternehmenId, unternehmenId)))
    .get();
  const ceoRequireApproval = requireApprovalSetting?.wert === 'true';

  // ceo_max_tasks_per_cycle: max create_task actions before queuing remainder for approval
  const maxTasksSetting = db.select({ wert: einstellungen.wert })
    .from(einstellungen)
    .where(and(eq(einstellungen.schluessel, 'ceo_max_tasks_per_cycle'), eq(einstellungen.unternehmenId, unternehmenId)))
    .get();
  const maxTasksPerCycle = maxTasksSetting?.wert ? parseInt(maxTasksSetting.wert, 10) : Infinity;
  let tasksCreatedThisCycle = 0;

  // Lade Team für Name→ID Auflösung
  const team = await db.select({ id: experten.id, name: experten.name })
    .from(experten)
    .where(eq(experten.unternehmenId, unternehmenId));

  const findAgent = (name: string) =>
    team.find(a => a.name.toLowerCase().includes(name.toLowerCase()));

  const now = new Date().toISOString();

  for (const action of actions) {
    try {
      switch (action.type) {

        case 'create_task': {
          if (!action.titel) break;
          if (!canCreateTask) {
            console.warn(`  🚫 ${orchestratorId} hat keine Berechtigung: create_task`);
            break;
          }

          // ── CEO Approval Gate ─────────────────────────────────────────────────
          const needsApproval = ceoRequireApproval || tasksCreatedThisCycle >= maxTasksPerCycle;
          if (needsApproval && canRequestApproval) {
            const approvalId = crypto.randomUUID();
            await db.insert(genehmigungen as any).values({
              id: approvalId,
              unternehmenId,
              typ: 'approve_strategy',
              titel: `CEO möchte Task erstellen: ${action.titel}`,
              beschreibung: action.beschreibung || null,
              angefordertVon: orchestratorId,
              status: 'pending',
              payload: JSON.stringify({ action }),
              erstelltAm: now,
              aktualisiertAm: now,
            }).run();
            console.log(`  📋 CEO Task "${action.titel}" → Genehmigung ausstehend (Approval Gate)`);
            trace(orchestratorId, unternehmenId, 'info', `Task wartet auf Genehmigung: ${action.titel}`);
            break;
          }
          // ─────────────────────────────────────────────────────────────────────

          // ── Deduplication: skip if similar task exists in last 50 open tasks ──
          const normalizeTitle = (t: string) => t.toLowerCase().trim().slice(0, 60);
          const normalized = normalizeTitle(action.titel);
          // Dedup: include open tasks + recently-done tasks (last 48h) to avoid re-creating completed work
          const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
          const recentTasks = await db.select({ titel: aufgaben.titel, status: aufgaben.status })
            .from(aufgaben)
            .where(and(
              eq(aufgaben.unternehmenId, unternehmenId),
              or(
                inArray(aufgaben.status, ['backlog', 'todo', 'in_progress', 'blocked']),
                and(eq(aufgaben.status, 'done'), gte(aufgaben.abgeschlossenAm, cutoff48h)),
              ),
            ))
            .orderBy(desc(aufgaben.erstelltAm))
            .limit(100);
          const isDuplicate = recentTasks.some(t => normalizeTitle(t.titel) === normalized);
          if (isDuplicate) {
            console.log(`  ⏭️ CEO: Task "${action.titel}" bereits vorhanden — übersprungen (Dedup)`);
            trace(orchestratorId, unternehmenId, 'info', `Duplikat-Task verhindert: ${action.titel}`);
            break;
          }
          // ────────────────────────────────────────────────────────────────────

          const agent = action.assignTo ? findAgent(action.assignTo) : null;
          const newTaskId = uuid();

          await db.insert(aufgaben).values({
            id: newTaskId,
            unternehmenId,
            titel: action.titel,
            beschreibung: action.beschreibung || null,
            status: 'todo',
            prioritaet: action.prioritaet || 'medium',
            zugewiesenAn: agent?.id || null,
            zielId: action.zielId || null,
            erstelltVon: orchestratorId,
            erstelltAm: now,
            aktualisiertAm: now,
          } as any).run();

          console.log(`  ✅ CEO erstellt Task: "${action.titel}" → ${agent?.name || 'offen'}`);
          trace(orchestratorId, unternehmenId, 'action',
            `CEO erstellt Task: ${action.titel}`,
            `Zugewiesen an: ${agent?.name || 'nicht zugewiesen'}`,
          );
          actionSummary.push(`create_task: "${action.titel}" → ${agent?.name || 'offen'} [${action.prioritaet || 'medium'}]`);
          tasksCreatedThisCycle++;

          // Wecke den zugewiesenen Agent sofort
          if (agent) {
            await wakeupService.wakeup(agent.id, unternehmenId, {
              source: 'automation',
              triggerDetail: 'callback',
              reason: `Neuer Task vom CEO: ${action.titel}`,
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

          await db.update(aufgaben)
            .set({ zugewiesenAn: agent.id, aktualisiertAm: now })
            .where(and(eq(aufgaben.id, action.taskId), eq(aufgaben.unternehmenId, unternehmenId)))
            .run();

          console.log(`  ✅ CEO weist Task zu → ${agent.name}`);
          trace(orchestratorId, unternehmenId, 'action', `Task zugewiesen an ${agent.name}`);
          actionSummary.push(`assign_task: ${action.taskId} → ${agent.name}`);

          await wakeupService.wakeup(agent.id, unternehmenId, {
            source: 'automation',
            triggerDetail: 'issue_assigned',
            reason: 'Task wurde dir zugewiesen',
          });
          break;
        }

        case 'mark_done': {
          if (!action.taskId) break;
          await db.update(aufgaben)
            .set({ status: 'done', abgeschlossenAm: now, aktualisiertAm: now, executionLockedAt: null })
            .where(and(eq(aufgaben.id, action.taskId), eq(aufgaben.unternehmenId, unternehmenId)))
            .run();

          if (action.taskId === taskId) {
            currentTaskMarkedDone = true;
          }
          console.log(`  ✅ CEO markiert Task ${action.taskId} als erledigt`);
          trace(orchestratorId, unternehmenId, 'result', `Task als erledigt markiert`);
          actionSummary.push(`mark_done: ${action.taskId}`);
          break;
        }

        case 'update_goal': {
          if (!action.goalId) break;
          const goalUpdate: any = { aktualisiertAm: now };
          if (typeof action.fortschritt === 'number') goalUpdate.fortschritt = action.fortschritt;
          if (action.status) goalUpdate.status = action.status;

          await db.update(ziele)
            .set(goalUpdate)
            .where(and(eq(ziele.id, action.goalId), eq(ziele.unternehmenId, unternehmenId)))
            .run();

          console.log(`  ✅ CEO aktualisiert Ziel ${action.goalId}: ${action.fortschritt ?? ''}%`);
          actionSummary.push(`update_goal: ${action.goalId} → ${action.fortschritt ?? '?'}%`);
          trace(orchestratorId, unternehmenId, 'result',
            `Ziel aktualisiert${typeof action.fortschritt === 'number' ? `: ${action.fortschritt}%` : ''}`,
          );
          break;
        }

        case 'hire_agent': {
          // CEO requests hiring a new agent — creates an approval request for human review
          if (!action.rolle) break;
          if (!canRecruitAgent && !canRequestApproval) {
            console.warn(`  🚫 ${orchestratorId} hat keine Berechtigung: hire_agent`);
            break;
          }
          // Deduplication: skip if a pending hire_expert request for same role already exists
          const existingHire = await db.select({ id: genehmigungen.id })
            .from(genehmigungen as any)
            .where(and(
              eq(genehmigungen.unternehmenId as any, unternehmenId),
              eq(genehmigungen.typ as any, 'hire_expert'),
              eq(genehmigungen.status as any, 'pending'),
            ))
            .limit(20);
          const duplicateRole = existingHire.some(g => {
            try {
              const payload = JSON.parse((g as any).payload || '{}');
              return payload.rolle === action.rolle;
            } catch { return false; }
          });
          if (duplicateRole) {
            console.log(`  ⏭ hire_agent dedup: pending request for "${action.rolle}" already exists — skipping`);
            trace(orchestratorId, unternehmenId, 'info', `Einstellung "${action.rolle}" bereits beantragt — übersprungen`);
            break;
          }
          const approvalId = crypto.randomUUID();
          await db.insert(genehmigungen as any).values({
            id: approvalId,
            unternehmenId,
            typ: 'hire_expert',
            titel: `Neuen Agent einstellen: ${action.rolle}`,
            beschreibung: action.begruendung || `Der CEO empfiehlt, einen neuen Agent mit der Rolle "${action.rolle}" einzustellen.`,
            angefordertVon: orchestratorId,
            status: 'pending',
            payload: JSON.stringify({
              rolle: action.rolle,
              faehigkeiten: action.faehigkeiten || '',
              verbindungsTyp: action.verbindungsTyp || 'custom',
              budgetMonatCent: action.budgetMonatCent || 50000,
            }),
            erstelltAm: now,
            aktualisiertAm: now,
          }).run();

          console.log(`  📋 CEO beantragt Einstellung: "${action.rolle}" — Genehmigung ausstehend`);
          actionSummary.push(`hire_agent: "${action.rolle}" → Genehmigung ausstehend`);
          trace(orchestratorId, unternehmenId, 'action',
            `Einstellungsantrag: ${action.rolle}`,
            `Genehmigung erforderlich`,
          );
          break;
        }

        case 'call_meeting': {
          // CEO kann ein Meeting einberufen: { type: 'call_meeting', thema: string, teilnehmerIds: string[], agenda?: string }
          if (!action.thema || !Array.isArray(action.teilnehmerIds) || action.teilnehmerIds.length === 0) break;

          const meetingId = crypto.randomUUID();
          await db.insert(agentMeetings).values({
            id: meetingId,
            unternehmenId,
            veranstalterExpertId: orchestratorId,
            titel: action.thema,
            teilnehmerIds: JSON.stringify(action.teilnehmerIds),
            antworten: JSON.stringify({}),
            status: 'running',
            erstelltAm: now,
          }).run();

          // Wake up all participants
          for (const participantId of action.teilnehmerIds) {
            await db.insert(agentWakeupRequests).values({
              id: crypto.randomUUID(),
              expertId: participantId,
              unternehmenId,
              reason: `Meeting einberufen: ${action.thema}`,
              source: 'automation',
              payload: JSON.stringify({ meetingId, thema: action.thema }),
              requestedAt: now,
            }).run();
          }

          console.log(`  📋 CEO ruft Meeting ein: "${action.thema}" mit ${action.teilnehmerIds.length} Teilnehmern`);
          actionSummary.push(`call_meeting: "${action.thema}" (${action.teilnehmerIds.length} Teilnehmer)`);
          trace(orchestratorId, unternehmenId, 'action',
            `Meeting einberufen: ${action.thema}`,
            `${action.teilnehmerIds.length} Teilnehmer`, undefined
          );
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

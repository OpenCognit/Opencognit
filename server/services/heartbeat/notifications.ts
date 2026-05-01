// Heartbeat Notifications — CEO feedback loop, meeting wakeup handler

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../../db/client.js';
import { agents, tasks, goals, chatMessages, settings, agentMeetings, comments } from '../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { wakeupService } from '../wakeup.js';
import { isFocusModeActive, trace } from './utils.js';
import { isSafeWorkdir } from '../../adapters/workspace-guard.js';

// ─── CEO FEEDBACK LOOP ──────────────────────────────────────────────────────

/**
 * After a worker finishes a task:
 * 1. Analyze workspace deliverables
 * 2. Check unblockable dependents
 * 3. Build rich context for CEO re-evaluation
 * 4. Post a CEO-style chat report
 * 5. Trigger orchestrator wakeup with FULL context
 */
export async function notifyOrchestratorTaskDone(
  companyId: string,
  workerExpertId: string,
  workerName: string,
  taskTitel: string,
  taskId: string,
  output: string,
): Promise<void> {
  try {
    const orchestrator = await db.select()
      .from(agents)
      .where(and(
        eq(agents.companyId, companyId),
        eq(agents.isOrchestrator, true),
        eq(agents.status, 'active'),
      ))
      .limit(1)
      .then((r: any[]) => r[0]);

    if (!orchestrator) return;

    // ── 1. Build output summary ──────────────────────────────────────────
    const summary = output
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 20 && !l.startsWith('```') && !l.startsWith('#'))
      .slice(0, 2)
      .join(' ')
      .slice(0, 300);

    // ── 2. Check workspace deliverables ──────────────────────────────────
    const taskRow = await db.select({ workspacePath: tasks.workspacePath, goalId: tasks.goalId })
      .from(tasks).where(eq(tasks.id, taskId)).get() as any;

    let deliverablesLine = '';
    if (taskRow?.workspacePath && isSafeWorkdir(taskRow.workspacePath) && fs.existsSync(taskRow.workspacePath)) {
      try {
        const files = fs.readdirSync(taskRow.workspacePath, { recursive: true } as any) as string[];
        const nonEmpty = files
          .filter(f => !f.startsWith('.') && !f.includes('.meta.json'))
          .filter(f => {
            const fp = path.join(taskRow.workspacePath, f);
            try { return !fs.statSync(fp).isDirectory() && fs.statSync(fp).size > 0; } catch { return false; }
          })
          .map(f => {
            const fp = path.join(taskRow.workspacePath, f);
            const sz = fs.statSync(fp).size;
            return `${f} (${sz < 1024 ? `${sz}B` : `${(sz / 1024).toFixed(1)}KB`})`;
          });
        if (nonEmpty.length > 0) {
          deliverablesLine = `\n📁 Deliverables: ${nonEmpty.join(', ')}`;
        } else {
          deliverablesLine = `\n⚠️ Workspace leer — keine Dateien gefunden`;
        }
      } catch { /* ignore */ }
    }

    // ── 3. Check goal progress ───────────────────────────────────────────
    let goalLine = '';
    if (taskRow?.goalId) {
      const goalTasks = await db.select({
        done: sql<number>`count(case when ${tasks.status} = 'done' then 1 end)`,
        total: sql<number>`count(*)`,
        title: goals.title,
      })
        .from(tasks)
        .leftJoin(goals, eq(goals.id, tasks.goalId))
        .where(eq(tasks.goalId, taskRow.goalId))
        .get() as any;

      if (goalTasks?.total > 0) {
        const pct = Math.round((goalTasks.done / goalTasks.total) * 100);
        goalLine = `\n📊 Ziel **${goalTasks.title}**: ${goalTasks.done}/${goalTasks.total} Tasks (${pct}%)`;
        if (pct === 100) goalLine += ' — **Ziel erreicht! 🎉**';
      }
    }

    // ── 4. Find tasks that are now unblocked ─────────────────────────────
    let unblockLine = '';
    const { issueRelations } = await import('../../db/schema.js');
    const dependents = await db.select({ targetId: issueRelations.targetId })
      .from(issueRelations)
      .where(eq(issueRelations.sourceId, taskId));

    if (dependents.length > 0) {
      const dependentTasks = await db.select()
        .from(tasks)
        .where(and(
          eq(tasks.companyId, companyId),
          sql`${tasks.id} IN (${dependents.map(d => `'${d.targetId}'`).join(',')})`,
        ));

      const newlyUnblocked = dependentTasks.filter((t: any) => t.status === 'blocked');
      if (newlyUnblocked.length > 0) {
        unblockLine = `\n🔓 Jetzt entsperrt: ${newlyUnblocked.map((t: any) => `"${t.title}"`).join(', ')}`;
      }
    }

    // ── 5. Check if CEO should create follow-up tasks ────────────────────
    const openTasksCount = await db.select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(and(
        eq(tasks.companyId, companyId),
        sql`${tasks.status} IN ('backlog', 'todo', 'in_progress', 'blocked')`,
      ))
      .then((r: any[]) => r[0].count);

    const followUpHint = openTasksCount === 0
      ? '\n💡 Hinweis: Keine offenen Tasks mehr — das Team braucht neue Aufgaben!'
      : '';

    // ── 6. Build rich wake reason for CEO ────────────────────────────────
    const wakeReason = [
      `Task "${taskTitel}" von ${workerName} abgeschlossen.`,
      summary ? `Ergebnis: ${summary}` : '',
      deliverablesLine,
      goalLine,
      unblockLine,
      followUpHint,
      `\nDeine Aufgabe als CEO:`,
      `- Prüfe, ob dieser Task das Unternehmensziel vorangebracht hat`,
      `- Wenn abhängige Tasks jetzt frei sind: weise sie zu oder erstelle Folge-Tasks`,
      `- Wenn keine Tasks mehr offen sind: erstelle neue strategische Tasks`,
      `- Wenn der Workspace leer ist: markiere den Task NICHT als erledigt`,
    ].filter(Boolean).join('\n');

    // ── 7. Post chat message ─────────────────────────────────────────────
    const msg = `✅ **${workerName}** hat Task abgeschlossen: **${taskTitel}**${deliverablesLine}${goalLine}${unblockLine}`;

    if (!isFocusModeActive(companyId)) {
      await db.insert(chatMessages).values({
        id: crypto.randomUUID(),
        companyId,
        agentId: orchestrator.id,
        senderType: 'agent',
        message: msg,
        read: false,
        createdAt: new Date().toISOString(),
      });
      console.log(`  📣 CEO Report: "${taskTitel}" abgeschlossen von ${workerName}`);
    }
    trace(orchestrator.id, companyId, 'info', `${workerName} hat Task erledigt: ${taskTitel}`, msg);

    // ── 8. Wake CEO with FULL context ────────────────────────────────────
    await wakeupService.wakeup(orchestrator.id, companyId, {
      source: 'automation',
      triggerDetail: 'callback',
      reason: wakeReason,
      payload: {
        taskId,
        completedBy: workerExpertId,
        deliverables: deliverablesLine,
        goalProgress: goalLine,
        unblockedTasks: unblockLine,
        openTasksCount,
      },
    });

    console.log(`  🔔 Orchestrator ${orchestrator.name} geweckt mit vollständigem Kontext`);
  } catch (err: any) {
    console.warn(`  ⚠️ CEO Feedback Loop Fehler: ${err.message}`);
  }
}

/**
 * Handle a meeting wakeup: load meeting context, call LLM for response,
 * save the answer into agentMeetings.responses, mark meeting done if all responded.
 */
export async function handleMeetingWakeup(runId: string, agentId: string, companyId: string, meetingId: string): Promise<void> {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, meetingId)).get() as any;
    if (!meeting) { console.warn(`  ⚠️ Meeting ${meetingId} not found`); return; }

    const expert = db.select({ name: agents.name, role: agents.role, skills: agents.skills })
      .from(agents).where(eq(agents.id, agentId)).get() as any;

    const existingAnswers: Record<string, string> = (() => {
      try { return JSON.parse(meeting.responses || '{}'); } catch { return {}; }
    })();

    const meetingPrompt = `Du nimmst an einem Team-Meeting teil.

**Meeting-Thema:** ${meeting.title}

**Bisherige Antworten der Teilnehmer:**
${Object.entries(existingAnswers).map(([id, ans]) => `- ${id}: ${ans}`).join('\n') || '(noch keine)'}

Bitte gib deine Meinung, deinen Input oder deine Empfehlung zum Thema in 2-4 Sätzen. Sei präzise und konstruktiv.`;

    // Call LLM via custom API
    const customKey  = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'custom_api_key')).get();
    const customBase = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'custom_api_base_url')).get();

    let response = `(${expert?.name || agentId} hat nicht geantwortet — kein LLM verfügbar)`;

    if (customKey?.value && customBase?.value) {
      const apiBase = customBase.value.replace(/\/$/, '');
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customKey.value}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 400,
          messages: [
            { role: 'system', content: `Du bist ${expert?.name || 'ein Agent'}, ${expert?.role || 'Teammitglied'}. ${expert?.skills ? `Deine Skills: ${expert.skills}.` : ''}` },
            { role: 'user', content: meetingPrompt },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        response = data.choices?.[0]?.message?.content || response;
      }
    }

    // Save answer keyed by agentId (as per schema: { agentId: "response" })
    existingAnswers[agentId] = response;
    db.update(agentMeetings)
      .set({ responses: JSON.stringify(existingAnswers) })
      .where(eq(agentMeetings.id, meetingId)).run();

    // Check if all participants have answered → close meeting
    const participantIds: string[] = (() => {
      try { return JSON.parse(meeting.participantIds || '[]'); } catch { return []; }
    })();
    const allAnswered = participantIds.every((id: string) => existingAnswers[id]);

    if (allAnswered) {
      // Build human-readable summary for CEO notification
      const summary = participantIds.map((id: string) => {
        const name = db.select({ name: agents.name }).from(agents).where(eq(agents.id, id)).get()?.name || id;
        return `${name}: "${(existingAnswers[id] || '').slice(0, 100)}"`;
      }).join(' | ');

      db.update(agentMeetings)
        .set({ status: 'completed', completedAt: new Date().toISOString() })
        .where(eq(agentMeetings.id, meetingId)).run();
      console.log(`  ✅ Meeting "${meeting.title}" — alle Antworten eingegangen, abgeschlossen`);
      // Notify orchestrator with full summary
      await wakeupService.wakeup(meeting.organizerAgentId, companyId, {
        source: 'automation',
        triggerDetail: 'callback',
        reason: `Meeting abgeschlossen: "${meeting.title}". Alle Antworten: ${summary}`,
      });
    }

    console.log(`  📋 Meeting "${meeting.title}" — ${expert?.name} hat geantwortet`);
    trace(agentId, companyId, 'result', `Meeting-Antwort: ${meeting.title}`, response.slice(0, 200), runId);
  } catch (err: any) {
    console.error(`  ❌ Meeting wakeup handler failed: ${err.message}`);
  }
}

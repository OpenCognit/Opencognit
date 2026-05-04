import { db } from '../db/client.js';
import { agents, tasks, companies, projects, approvals, chatMessages, settings, traceEvents, agentMeetings } from '../db/schema.js';
import { eq, and, isNull, desc, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import { decryptSetting } from '../utils/crypto.js';
import { isSafeWorkdir } from './workspace-guard.js';
import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { scheduler } from '../scheduler.js';

/**
 * Creates a project workspace folder inside the company's workDir.
 * Returns the absolute path to the created folder.
 * If no workDir is configured, returns null (agents will use company workDir or fallback).
 */
function createProjectWorkspace(companyWorkDir: string | null | undefined, taskTitle: string): string | null {
  if (!companyWorkDir || !path.isAbsolute(companyWorkDir)) return null;
  const slug = taskTitle
    .toLowerCase()
    .replace(/[äöü]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[c] || c))
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  const dir = path.join(companyWorkDir, slug || `projekt-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (e) {
    console.error(`[CEO] Workspace-Ordner konnte nicht erstellt werden: ${dir}`, e);
    return null;
  }
}

const now = () => new Date().toISOString();

/**
 * CEO-Adapter — LLM-powered Orchestration Engine
 *
 * Der CEO:
 * 1. Liest alle nicht zugewiesenen Tasks und verteilt sie an passende Agents
 * 2. Analysiert Company-Ziel und erstellt proaktiv neue Tasks (Idle-Behavior)
 * 3. Beantragt Hiring wenn Kapazität fehlt oder Rollen fehlen
 * 4. Kommuniziert Entscheidungen als Chat-Nachricht
 */
export class CEOAdapter implements ExpertAdapter {
  name = 'ceo';
  description = 'CEO - Chief Executive Officer (LLM-powered Orchestration)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();

    try {
      // Get company info
      const company = db.select().from(companies).where(eq(companies.id, options.companyId)).get();
      if (!company) throw new Error('Unternehmen nicht gefunden');

      // Get all active agents (excl. CEO itself)
      const allAgents = db.select().from(agents)
        .where(and(
          eq(agents.companyId, options.companyId),
          eq(agents.status, 'active'),
        ))
        .all()
        .filter(a => a.id !== options.agentId);

      // Get unassigned tasks or tasks assigned to CEO for orchestration
      const unassignedTasks = db.select().from(tasks)
        .where(and(
          eq(tasks.companyId, options.companyId),
          or(
            isNull(tasks.assignedTo),
            eq(tasks.assignedTo, options.agentId)
          )
        ))
        .all()
        .filter(t => t.status !== 'done' && t.status !== 'cancelled');

      // Get all open tasks (for context)
      const allOpenTasks = db.select().from(tasks)
        .where(eq(tasks.companyId, options.companyId))
        .all()
        .filter(t => t.status !== 'done' && t.status !== 'cancelled');

      // ── Meeting intelligence signals ─────────────────────────────────────────
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const activeRunningMeetings = db.select().from(agentMeetings)
        .where(and(
          eq(agentMeetings.companyId, options.companyId),
          eq(agentMeetings.status, 'running'),
        ))
        .all();

      const recentMeetings = db.select().from(agentMeetings)
        .where(eq(agentMeetings.companyId, options.companyId))
        .orderBy(desc(agentMeetings.createdAt))
        .limit(5)
        .all();

      const blockedTasks = allOpenTasks.filter(t => t.status === 'blocked');
      const staleTasks = allOpenTasks.filter(t =>
        t.status === 'in_progress' && t.startedAt && t.startedAt < threeDaysAgo
      );
      const meetingRecentlyStarted = recentMeetings.some(m => m.createdAt > twoHoursAgo);
      const canCallMeeting = allAgents.length >= 1
        && !meetingRecentlyStarted
        && activeRunningMeetings.length === 0;

      const lastMeetingDate = recentMeetings[0]?.createdAt?.slice(0, 10) || 'noch keins';

      const meetingSignals = `
🚦 Meeting-Signale:
- Verfügbare Team-Mitglieder: ${allAgents.length}
- Aktive Meetings gerade: ${activeRunningMeetings.length}
- Blockierte Tasks: ${blockedTasks.length}${blockedTasks.length > 0 ? ` (${blockedTasks.map(t => `"${t.title}"`).join(', ')})` : ''}
- Stale Tasks (>3 Tage ohne Fortschritt): ${staleTasks.length}${staleTasks.length > 0 ? ` (${staleTasks.map(t => `"${t.title}"`).join(', ')})` : ''}
- Letztes Meeting: ${lastMeetingDate}
- Meeting jetzt einberufbar: ${canCallMeeting ? 'JA' : 'NEIN' + (activeRunningMeetings.length > 0 ? ' — eines läuft bereits' : ' — Cooldown (< 2h)')}

Wann ein Meeting sinnvoll ist:
✅ 2+ blockierte Tasks die Team-Input brauchen
✅ Stale Tasks wo unklar ist warum kein Fortschritt
✅ Komplexe strategische Entscheidung die mehrere Rollen betrifft
✅ Widersprüchliche Prioritäten zwischen Agenten
❌ NICHT wenn canCallMeeting=NEIN, Team < 2 Personen, oder die Antwort offensichtlich ist`;

      // Get recent chat history with the board
      const recentChat = db.select().from(chatMessages)
        .where(and(eq(chatMessages.companyId, options.companyId), eq(chatMessages.agentId, options.agentId)))
        .orderBy(desc(chatMessages.createdAt))
        .limit(10)
        .all();

      const chatHistoryDesc = recentChat.reverse().map(m => 
        `[${m.senderType === 'board' ? 'USER' : 'SYSTEM/AGENT'}]: ${m.message}`
      ).join('\n');

      // Build CEO context for LLM
      const agentsDesc = allAgents.map(a =>
        `- ${a.name} (${a.role}): ${a.skills || 'keine Angabe'}`
      ).join('\n');

      const unassignedDesc = unassignedTasks.map(t =>
        `- [${t.id.slice(0, 8)}] "${t.title}" (${t.priority}) — ${t.description?.slice(0, 100) || 'keine Beschreibung'}`
      ).join('\n');

      const allTasksDesc = allOpenTasks.map(t => {
        const assignee = t.assignedTo
          ? allAgents.find(a => a.id === t.assignedTo)?.name || 'unbekannt'
          : 'nicht zugewiesen';
        return `- "${t.title}" → ${assignee} (${t.status})`;
      }).join('\n');

      // ── Workspace verification context for in_progress / recently done tasks ──
      let workspaceVerificationDesc = '';
      const tasksToVerify = allOpenTasks.filter(t =>
        t.status === 'in_progress' || t.status === 'blocked'
      );
      if (tasksToVerify.length > 0) {
        const wsInfos: string[] = [];
        for (const t of tasksToVerify.slice(0, 8)) {
          if (t.workspacePath && isSafeWorkdir(t.workspacePath) && fs.existsSync(t.workspacePath)) {
            try {
              const files = fs.readdirSync(t.workspacePath, { recursive: true } as any) as string[];
              const nonEmpty = files
                .filter(f => !f.startsWith('.') && !f.includes('.meta.json'))
                .filter(f => {
                  const fp = path.join(t.workspacePath!, f);
                  try { return !fs.statSync(fp).isDirectory() && fs.statSync(fp).size > 0; } catch { return false; }
                })
                .map(f => {
                  const fp = path.join(t.workspacePath!, f);
                  const sz = fs.statSync(fp).size;
                  return `${f} (${sz < 1024 ? `${sz}B` : `${(sz / 1024).toFixed(1)}KB`})`;
                });
              if (nonEmpty.length > 0) {
                wsInfos.push(`📁 "${t.title}" (${t.status}):\n  ${nonEmpty.join('\n  ')}`);
              } else {
                wsInfos.push(`⚠️ "${t.title}" (${t.status}): Workspace LEER — Agent hat noch nichts produziert`);
              }
            } catch { /* ignore */ }
          }
        }
        if (wsInfos.length > 0) {
          workspaceVerificationDesc = `
## Workspace-Status (In-Progress / Blocked Tasks)
${wsInfos.join('\n\n')}

WICHTIG: Bevor du einen Task als erledigt markierst (mark_done), MUSST du prüfen ob der Workspace Dateien enthält. Tasks mit leerem Workspace sind NICHT erledigt.
`;
        }
      }

      // Detect if we're in conversational/manual mode (triggered by a board message)
      const hasNewBoardMessage = recentChat.some(m => m.senderType === 'board');
      const isConversational = hasNewBoardMessage || (options.prompt?.includes('direkte Nachricht') ?? false);

      // Determine mode: chat reply, assign tasks, OR idle/proactive
      const mode = isConversational ? 'chat' : unassignedTasks.length > 0 ? 'assign' : 'proactive';

      const systemPrompt = `Du bist der CEO von "${company.name}" — direkt, menschlich, auf Augenhöhe. Du bist KEIN Berater, du HANDELST.
Unternehmensziel: ${company.goal || company.description || 'Nicht definiert'}

Dein Team:
${agentsDesc || 'Noch kein Team außer dir selbst.'}

Offene Tasks:
${allTasksDesc || 'Keine offenen Tasks gerade.'}
${workspaceVerificationDesc}
${meetingSignals}

## DEIN ARBEITSABLAUF (befolge diese Schritte strikt):

1. **Status-Check**: Welche Tasks laufen, welche sind blockiert, welche sind erledigt?
2. **Lücken-Analyse**: Fehlt etwas für das Unternehmensziel? Gibt es offensichtliche nächste Schritte?
3. **Verifikation**: Bevor du einen Task als erledigt markierst, prüfe den Workspace.
4. **Aktion**: Erstelle/Weise Tasks zu, rufe Meetings ein, oder stelle ein neues Team-Mitglied ein.
5. **Kommunikation**: Sag dem Board ehrlich was läuft — auch wenn nichts läuft.

## REGELN:
- Du bist PROAKTIV. Wenn ein Task erledigt ist, überlege SOFORT was als Nächstes kommt.
- Ein Task ohne Dateien im Workspace ist NICHT erledigt.
- Wenn ein Agent seit >3 Tagen nichts produziert hat (stale), prüfe ob der Task noch Sinn macht.
- Wenn das Team überlastet ist (alle Agents haben 2+ offene Tasks), stelle ein neues Mitglied ein.
- Wenn 2+ Tasks blockiert sind, rufe ein Meeting ein.
- Kommunikationsstil: "du", kurz, direkt, kein Unternehmens-Speak.`;

      let userPrompt: string;

      if (mode === 'chat') {
        userPrompt = `Neue Nachricht vom Board:

${chatHistoryDesc}

Antworte locker und direkt auf Deutsch. Kein Unternehmens-Speak, kein "Ihre Anfrage".
Auf Grüße oder Smalltalk: kurz und menschlich antworten (1-2 Sätze reichen).
Auf Statusfragen: sag was gerade läuft — keine Tasks? Dann sag das ehrlich.

Wenn das Board einen konkreten Auftrag gibt (z.B. "baue X ein", "erstell Y", "kümmere dich um Z"):

1. **PRÜFE**: Handelt es sich um etwas mit MEHREREN Teilen? (z.B. "Website" = Design + HTML + Content)
   → JA: Erstelle ZUERST ein Projekt mit create_project, DANN Tasks darin.
   → NEIN: Erstelle direkt einen Task.

2. **Erstelle Tasks** und delegiere sie an passende Agenten.
3. **Antworte MIT einem JSON-Block UND einem "reply"-Feld.**

Verfügbare Agenten für agentId:
${allAgents.filter(a => a.status !== 'terminated').map(a => `- ${a.id}: ${a.name} (${a.role || 'kein Titel'})`).join('\n')}

Beispiel mit Projekt (für Aufträge mit mehreren Teilen):
\`\`\`json
{
  "actions": [
    { "type": "create_project", "name": "Website Relaunch", "beschreibung": "Neue Unternehmenswebsite", "prioritaet": "high" },
    { "type": "create_task", "titel": "Design Mockups erstellen", "beschreibung": "Figma-Designs für alle Seiten", "prioritaet": "high", "agentId": "AGENT_ID", "projectId": "auto" },
    { "type": "create_task", "titel": "HTML/CSS implementieren", "beschreibung": "Responsive Website basierend auf Design", "prioritaet": "high", "agentId": "AGENT_ID", "projectId": "auto" }
  ],
  "reply": "Projekt angelegt und Tasks verteilt. Das Team kümmert sich drum."
}
\`\`\`

Beispiel einzelner Task (für einfache Aufträge):
\`\`\`json
{
  "actions": [
    { "type": "create_task", "titel": "Kurzer Titel", "beschreibung": "Was zu tun ist", "prioritaet": "high", "agentId": "AGENT_ID" }
  ],
  "reply": "Direkt weitergegeben an [Name]. Die kümmern sich darum."
}
\`\`\`

Für bestehende unzugewiesene Tasks:
\`\`\`json
{ "actions": [{ "type": "assign_task", "taskId": "TASK_ID", "agentId": "AGENT_ID", "reason": "kurze Begründung" }], "reply": "..." }
\`\`\`

Für ein Meeting:
\`\`\`json
{ "actions": [{ "type": "call_meeting", "frage": "Eure Einschätzung zu X?", "teilnehmer": ["AGENT_ID_1", "AGENT_ID_2"] }], "reply": "Ich hol mal schnell das Team ran..." }
\`\`\`

Auf reine Grüße oder Statusfragen ohne Auftrag: normaler Text ohne JSON reicht.`;
      } else if (mode === 'assign') {
        userPrompt = `Diese Tasks sind noch nicht zugewiesen:
${unassignedDesc}

Verteile sie an die passenden Agenten. Antworte mit diesem JSON:
{
  "actions": [
    { "type": "assign_task", "taskId": "TASK_ID_ERSTE_8_ZEICHEN", "agentId": "AGENT_ID", "reason": "kurze Begründung" },
    ...
  ],
  "summary": "Was du entschieden hast in 1-2 Sätzen"
}

Wenn du für eine Rolle keinen passenden Agenten hast:
{ "type": "hire_agent", "rolle": "Rollenname", "faehigkeiten": "benötigte Skills", "reason": "warum gebraucht" }

${canCallMeeting ? `Wenn blockierte oder unklare Tasks vorliegen, kannst du ZUSÄTZLICH ein Meeting einberufen:
{ "type": "call_meeting", "frage": "Eure Einschätzung zu X?", "teilnehmer": ["AGENT_ID_1", "AGENT_ID_2"] }` : `(Meeting nicht möglich — ${activeRunningMeetings.length > 0 ? 'eines läuft bereits' : 'Cooldown aktiv'})`}`;
      } else {
        const meetingHint = canCallMeeting && (blockedTasks.length > 0 || staleTasks.length > 0)
          ? `\n⚠️ Es gibt ${blockedTasks.length} blockierte und ${staleTasks.length} stale Tasks — erwäge ein Meeting einzuberufen!`
          : '';

        userPrompt = `Du bist im PROAKTIVEN Modus. Ein Task wurde gerade abgeschlossen oder es gibt keinen offenen Task mehr.

Deine Aufgabe als CEO:
1. **Lücken-Analyse**: Was fehlt noch für das Unternehmensziel? Gibt es offensichtliche nächste Schritte?
2. **Folge-Tasks**: Wenn ein Task erledigt ist, WAS kommt danach? Erstelle SOFORT Folge-Tasks.
3. **Freigewordene Tasks**: Prüfe ob blockierte Tasks jetzt frei sind und weise sie zu.
4. **Ziel-Check**: Sind Ziele erreicht? Wenn ja → feiere und plane nächstes Ziel. Wenn nein → erstelle Tasks dafür.
5. **Team-Kapazität**: Hat jeder Agent Arbeit? Wenn nicht → erstelle Tasks. Wenn überlastet → stelle ein neues Mitglied ein.

${meetingHint}

Antworte mit diesem JSON:
{
  "actions": [
    { "type": "create_task", "titel": "Konkreter Titel", "beschreibung": "Was GENAU zu tun ist — mit Akzeptanzkriterien", "prioritaet": "high|medium|low", "agentId": "AGENT_ID_oder_null" },
    { "type": "assign_task", "taskId": "TASK_ID", "assignTo": "Agent Name", "reason": "warum dieser Agent" },
    { "type": "mark_done", "taskId": "TASK_ID" },
    { "type": "hire_agent", "rolle": "Rollenname", "faehigkeiten": "Skills", "reason": "warum" },
    { "type": "call_meeting", "frage": "Eure Einschätzung zu X?", "teilnehmer": ["AGENT_ID_1", "AGENT_ID_2"] }
  ],
  "summary": "Was du entschieden hast in 1-2 Sätzen"
}

STRENGE REGELN:
- Du MUSST Folge-Tasks erstellen, wenn ein Task erledigt ist. Niemals leer laufen lassen.
- Jeder Task braucht eine konkrete Beschreibung mit Akzeptanzkriterien.
- Weise Tasks SOFORT zu — nicht im Backlog liegen lassen.
- Wenn ein Agent seit >3 Tagen nichts produziert hat → prüfe ob der Task noch Sinn macht.
- call_meeting nur wenn canCallMeeting=JA und es echten Mehrwert bringt.
- hire_agent nur wenn das Team überlastet ist (alle haben 2+ offene Tasks).`;
      }

      // Call LLM
      const llmResult = await this.callLLM(systemPrompt, userPrompt, options);

      if (!llmResult.success) {
        // Fallback to rule-based if LLM fails
        return this.runRuleBased(options, unassignedTasks, allAgents, startTime);
      }

      // Parse and execute CEO decisions
      const output = await this.executeCEODecisions(
        llmResult.text,
        options,
        unassignedTasks,
        allAgents,
        company.workDir,
      );

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        tokenUsage: llmResult.tokenUsage,
      };

    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: `CEO-Orchestrierung fehlgeschlagen: ${error.message}`,
        duration: Date.now() - startTime
      };
    }
  }

  // ── Tool definitions for native tool_use API ──────────────────────────────
  private static readonly CEO_TOOLS_ANTHROPIC = [
    {
      name: 'create_task',
      description: 'Create a new task and optionally assign it to an agent immediately',
      input_schema: {
        type: 'object',
        properties: {
          titel: { type: 'string', description: 'Short, clear task title' },
          beschreibung: { type: 'string', description: 'Detailed description of what needs to be done' },
          prioritaet: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          agentId: { type: 'string', description: 'Agent ID to assign to (optional)' },
        },
        required: ['titel', 'beschreibung', 'prioritaet'],
      },
    },
    {
      name: 'assign_task',
      description: 'Assign an existing unassigned task to a specific agent',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'First 8 characters of the task ID' },
          agentId: { type: 'string', description: 'Agent ID to assign to' },
          reason: { type: 'string', description: 'Brief reason for this assignment' },
        },
        required: ['taskId', 'agentId', 'reason'],
      },
    },
    {
      name: 'call_meeting',
      description: 'Call a team meeting with specific agents to discuss a question',
      input_schema: {
        type: 'object',
        properties: {
          frage: { type: 'string', description: 'The question or topic for the meeting' },
          teilnehmer: { type: 'array', items: { type: 'string' }, description: 'Array of agent IDs to invite' },
        },
        required: ['frage', 'teilnehmer'],
      },
    },
    {
      name: 'hire_agent',
      description: 'Request board approval to hire a new agent for a missing role',
      input_schema: {
        type: 'object',
        properties: {
          rolle: { type: 'string', description: 'Job title for the new agent' },
          faehigkeiten: { type: 'string', description: 'Required skills' },
          reason: { type: 'string', description: 'Business justification' },
        },
        required: ['rolle', 'faehigkeiten', 'reason'],
      },
    },
    {
      name: 'send_reply',
      description: 'Send a conversational reply to the board (for chat responses without actions)',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send' },
        },
        required: ['message'],
      },
    },
    {
      name: 'inspect_file',
      description: 'Read the contents of a file from a task workspace to verify deliverables. Use BEFORE mark_done to confirm quality.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Full task ID whose workspace to inspect' },
          filename: { type: 'string', description: 'Relative path of the file within the workspace (e.g. "index.html" or "src/main.ts")' },
        },
        required: ['taskId', 'filename'],
      },
    },
    {
      name: 'list_workspace',
      description: 'List all files in a task workspace with sizes. Use to verify an agent actually produced files.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Full task ID whose workspace to list' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'create_project',
      description: 'Create a new project to group related tasks. ALWAYS create a project when the user asks for something with multiple parts (e.g. "build a website", "create a marketing campaign").',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short, clear project name' },
          beschreibung: { type: 'string', description: 'What the project is about' },
          prioritaet: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          goalId: { type: 'string', description: 'Goal ID to link this project to (optional)' },
        },
        required: ['name', 'beschreibung', 'prioritaet'],
      },
    },
  ];

  private static get CEO_TOOLS_OPENAI() {
    return CEOAdapter.CEO_TOOLS_ANTHROPIC.map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }

  // ── Native tool_use call (Anthropic + OpenRouter) ─────────────────────────
  private async callLLMWithTools(systemPrompt: string, userPrompt: string, options: AdapterRunOptions): Promise<{
    success: boolean;
    text: string;
    tokenUsage: { inputTokens: number; outputTokens: number; costCent: number };
  }> {
    const config = JSON.parse(options.connectionConfig || '{}');

    // Helper: convert tool_use blocks → JSON string that executeCEODecisions understands
    const toolBlocksToText = (toolBlocks: any[], textContent: string): string => {
      const actions: any[] = [];
      let reply = textContent.trim();
      for (const block of toolBlocks) {
        if (block.name === 'send_reply') {
          reply = block.input?.message || reply;
        } else {
          actions.push({ type: block.name, ...block.input });
        }
      }
      return JSON.stringify({ actions, reply, summary: reply });
    };

    // Helper: convert OpenAI tool_calls → same format
    const toolCallsToText = (toolCalls: any[], textContent: string): string => {
      const actions: any[] = [];
      let reply = textContent?.trim() || '';
      for (const tc of toolCalls) {
        try {
          const input = JSON.parse(tc.function?.arguments || '{}');
          if (tc.function?.name === 'send_reply') {
            reply = input.message || reply;
          } else {
            actions.push({ type: tc.function?.name, ...input });
          }
        } catch { /* ignore malformed tool call */ }
      }
      return JSON.stringify({ actions, reply, summary: reply });
    };

    // ── 1. Anthropic native tool_use ─────────────────────────────────────────
    const anthropicKeyRaw = options.connectionType === 'anthropic' && options.apiKey
      ? options.apiKey
      : db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get()?.value;
    const anthropicKey = anthropicKeyRaw ? decryptSetting('anthropic_api_key', anthropicKeyRaw) : null;

    if (anthropicKey) {
      try {
        // CEO should use a capable model — Sonnet is the minimum for orchestration quality
        const model = (options.connectionType === 'anthropic' && config.model)
          ? config.model
          : 'claude-sonnet-4-6';

        // Extended Thinking: enabled on Sonnet 4.5+ and Opus — CEO "thinks" before acting
        // Can be disabled via verbindungsConfig.extendedThinking = false
        const thinkingDisabled = config.extendedThinking === false;
        const supportsThinking = !thinkingDisabled && (model.includes('sonnet-4') || model.includes('opus-4') || model.includes('claude-4'));
        const thinkingBudget = typeof config.thinkingBudget === 'number' ? config.thinkingBudget : 8000;

        const requestBody: any = {
          model,
          max_tokens: supportsThinking ? thinkingBudget + 2000 : 2000,
          system: systemPrompt,
          tools: CEOAdapter.CEO_TOOLS_ANTHROPIC,
          messages: [{ role: 'user', content: userPrompt }],
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        };

        if (supportsThinking) {
          requestBody.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
          // tool_choice must be auto when thinking is enabled
          requestBody.tool_choice = { type: 'auto' };
          headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
        }

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });

        if (res.ok) {
          const data = await res.json() as any;
          // Filter: thinking blocks are internal — skip them for action extraction
          const toolBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
          const textContent = (data.content || [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
          const thinkingBlocks = (data.content || []).filter((b: any) => b.type === 'thinking');
          if (thinkingBlocks.length > 0) {
            console.log(`[CEO thinking] ${thinkingBlocks[0].thinking?.slice(0, 120)}…`);
          }
          console.log(`[CEO tool_use] Anthropic${supportsThinking ? ' +thinking' : ''}: ${toolBlocks.length} tool(s) called`);
          return {
            success: true,
            text: toolBlocks.length > 0 ? toolBlocksToText(toolBlocks, textContent) : textContent,
            tokenUsage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, costCent: 0 },
          };
        }
      } catch (e: any) {
        console.error('[CEO] Anthropic tool_use failed:', e.message);
      }
    }

    // ── 2. OpenRouter function calling ────────────────────────────────────────
    const orKeyRaw = options.connectionType === 'openrouter' && options.apiKey
      ? options.apiKey
      : db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get()?.value;
    const orKey = orKeyRaw ? decryptSetting('openrouter_api_key', orKeyRaw) : null;

    if (orKey) {
      try {
        const model = (options.connectionType === 'openrouter' && config.model) ? config.model : 'openrouter/auto';
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${orKey}`, 'HTTP-Referer': 'https://opencognit.mytherrablockchain.org', 'X-Title': 'OpenCognit CEO' },
          body: JSON.stringify({
            model, temperature: 0.3,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            tools: CEOAdapter.CEO_TOOLS_OPENAI,
            tool_choice: 'auto',
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const message = data.choices?.[0]?.message;
          const toolCalls = message?.tool_calls || [];
          console.log(`[CEO tool_use] OpenRouter: ${toolCalls.length} tool(s) called`);
          return {
            success: true,
            text: toolCalls.length > 0 ? toolCallsToText(toolCalls, message?.content || '') : (message?.content || ''),
            tokenUsage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, costCent: 0 },
          };
        }
      } catch (e: any) {
        console.error('[CEO] OpenRouter tool_use failed:', e.message);
      }
    }

    // ── 3. OpenAI function calling ────────────────────────────────────────────
    const openaiKeyRaw = options.connectionType === 'openai' && options.apiKey
      ? options.apiKey
      : db.select().from(settings).where(eq(settings.key, 'openai_api_key')).get()?.value;
    const openaiKey = openaiKeyRaw ? decryptSetting('openai_api_key', openaiKeyRaw) : null;

    if (openaiKey) {
      try {
        const model = (options.connectionType === 'openai' && config.model) ? config.model : 'gpt-4o-mini';
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model, temperature: 0.3,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            tools: CEOAdapter.CEO_TOOLS_OPENAI,
            tool_choice: 'auto',
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const message = data.choices?.[0]?.message;
          const toolCalls = message?.tool_calls || [];
          console.log(`[CEO tool_use] OpenAI: ${toolCalls.length} tool(s) called`);
          return {
            success: true,
            text: toolCalls.length > 0 ? toolCallsToText(toolCalls, message?.content || '') : (message?.content || ''),
            tokenUsage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, costCent: 0 },
          };
        }
      } catch (e: any) {
        console.error('[CEO] OpenAI tool_use failed:', e.message);
      }
    }

    return { success: false, text: '', tokenUsage: { inputTokens: 0, outputTokens: 0, costCent: 0 } };
  }

  private async callLLM(systemPrompt: string, userPrompt: string, options: AdapterRunOptions): Promise<{
    success: boolean;
    text: string;
    tokenUsage: { inputTokens: number; outputTokens: number; costCent: number };
  }> {
    // ── Try native tool_use first (more reliable than text parsing) ──────────
    const toolResult = await this.callLLMWithTools(systemPrompt, userPrompt, options);
    if (toolResult.success) return toolResult;
    console.log('[CEO] Tool-use failed or no key found — falling back to text-based LLM');

    // 1. Check if a specific engine was requested via connection settings
    if (options.connectionType && options.connectionType !== 'ceo') {
      const type = options.connectionType;
      const apiKey = options.apiKey;
      const baseUrl = options.apiBaseUrl;
      const config = JSON.parse(options.connectionConfig || '{}');
      const ollamaDefaultRaw = type === 'ollama'
        ? db.select().from(settings).where(eq(settings.key, 'ollama_default_model')).get()?.value
        : undefined;
      const model = config.model || (type === 'ollama' ? (ollamaDefaultRaw || 'llama3') : 'openrouter/auto');

      console.log(`[CEO] callLLM via ${type}, model=${model}, hasKey=${!!apiKey}`);

      try {
        if (type === 'openrouter') {
          // Try the configured model first, then fall back to openrouter/auto on 429
          const modelsToTry = model === 'openrouter/auto' ? ['openrouter/auto'] : [model, 'openrouter/auto'];
          for (const tryModel of modelsToTry) {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://opencognit.mytherrablockchain.org',
                'X-Title': 'OpenCognit CEO',
              },
              body: JSON.stringify({
                model: tryModel,
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                temperature: 0.3,
              }),
            });
            if (res.ok) {
              const data = await res.json() as any;
              return { success: true, text: data.choices?.[0]?.message?.content || '', tokenUsage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, costCent: 0 } };
            } else {
              const errBody = await res.text().catch(() => '');
              console.error(`[CEO] OpenRouter error ${res.status} (model=${tryModel}): ${errBody.slice(0, 200)}`);
              if (res.status !== 429 && res.status !== 503) break; // Only retry on rate limit / service unavailable
            }
          }
        }

        if (type === 'ollama') {
          const endpoint = baseUrl.endsWith('/') ? `${baseUrl}api/chat` : `${baseUrl}/api/chat`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
              stream: false,
            }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            return { success: true, text: data.message?.content || '', tokenUsage: { inputTokens: data.prompt_eval_count || 0, outputTokens: data.eval_count || 0, costCent: 0 } };
          }
        }

        if (type === 'openai') {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: model || 'gpt-4o-mini',
              messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            return { success: true, text: data.choices?.[0]?.message?.content || '', tokenUsage: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, costCent: 0 } };
          }
        }

        if (type === 'anthropic') {
           const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: model || 'claude-3-haiku-20240307',
              max_tokens: 1000,
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
            }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            return { success: true, text: data.content?.[0]?.text || '', tokenUsage: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, costCent: 0 } };
          }
        }
      } catch (e: any) {
        console.error(`CEO dynamic engine (${type}) failed:`, e.message || e);
        if (type === 'ollama' && e.code === 'ECONNREFUSED') {
          console.warn(`[OLLAMA] Verbindung verweigert zu ${baseUrl}. Läuft Ollama?`);
        }
      }
    }

    // 2. Fallback to existing global keys if no specific connection worked
    const orKey = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
    const anthropicKey = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
    const openaiKey = db.select().from(settings).where(eq(settings.key, 'openai_api_key')).get();
    const ollamaUrl = db.select().from(settings).where(eq(settings.key, 'ollama_base_url')).get();

    try {
      if (orKey?.value) {
        const apiKey = decryptSetting('openrouter_api_key', orKey.value);
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3200',
            'X-Title': 'OpenCognit CEO',
          },
          body: JSON.stringify({
            model: 'openrouter/auto',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const text = data.choices?.[0]?.message?.content || '';
          return {
            success: true,
            text,
            tokenUsage: {
              inputTokens: data.usage?.prompt_tokens || 0,
              outputTokens: data.usage?.completion_tokens || 0,
              costCent: 0,
            },
          };
        }
      }

      if (anthropicKey?.value) {
        const apiKey = decryptSetting('anthropic_api_key', anthropicKey.value);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const text = data.content?.[0]?.text || '';
          return {
            success: true,
            text,
            tokenUsage: {
              inputTokens: data.usage?.input_tokens || 0,
              outputTokens: data.usage?.output_tokens || 0,
              costCent: 0,
            },
          };
        }
      }

      if (openaiKey?.value) {
        const apiKey = decryptSetting('openai_api_key', openaiKey.value);
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 1000,
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const text = data.choices?.[0]?.message?.content || '';
          return {
            success: true,
            text,
            tokenUsage: {
              inputTokens: data.usage?.prompt_tokens || 0,
              outputTokens: data.usage?.completion_tokens || 0,
              costCent: 0,
            },
          };
        }
      }
 
      if (ollamaUrl?.value) {
        const baseUrl = ollamaUrl.value;
        const endpoint = baseUrl.endsWith('/') ? `${baseUrl}api/chat` : `${baseUrl}/api/chat`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3', // Default for CEO orchestration
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            stream: false,
            options: { temperature: 0.3 }
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          const text = data.message?.content || '';
          return {
            success: true,
            text,
            tokenUsage: {
              inputTokens: data.prompt_eval_count || 0,
              outputTokens: data.eval_count || 0,
              costCent: 0,
            },
          };
        }
      }
    } catch (e) {
      console.error('CEO LLM call failed:', e);
    }

    return { success: false, text: '', tokenUsage: { inputTokens: 0, outputTokens: 0, costCent: 0 } };
  }

  private async executeCEODecisions(
    llmText: string,
    options: AdapterRunOptions,
    unassignedTasks: any[],
    agents: any[],
    companyWorkDir?: string | null,
  ): Promise<string> {
    // If response is plain text (no JSON), return it directly (conversational mode)
    const jsonMatch = llmText.match(/```json\s*([\s\S]*?)\s*```/) ||
                      llmText.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      // Plain text response — conversational reply
      return llmText.trim();
    }

    // Extract JSON from LLM response
    let parsed: any = null;
    try {
      parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } catch {
      // If JSON in llmText but unparseable, return the text as-is
      if (llmText.trim().length > 10) return llmText.trim();
      console.warn('CEO: Could not parse LLM JSON, falling back to rule-based');
      return this.runRuleBasedSync(options, unassignedTasks, agents);
    }

    // If JSON has a 'reply' field (chat mode), use it as the primary output
    const chatReply: string = parsed?.reply || '';

    const actions: any[] = parsed?.actions || [];
    // Normalize German keys → English (prompts/schemas use DE, handlers expect EN)
    for (const action of actions) {
      if (action.titel !== undefined && action.title === undefined) action.title = action.titel;
      if (action.beschreibung !== undefined && action.description === undefined) action.description = action.beschreibung;
      if (action.prioritaet !== undefined && action.priority === undefined) action.priority = action.prioritaet;
      if (action.rolle !== undefined && action.role === undefined) action.role = action.rolle;
      if (action.faehigkeiten !== undefined && action.skills === undefined) action.skills = action.faehigkeiten;
    }
    const summary: string = parsed?.summary || '';
    const log: string[] = [];
    // Collect agents to wake in parallel at the end (avoid sequential delays)
    const agentsToWake: Array<{ agentId: string; unternehmenId: string }> = [];

    for (const action of actions) {
      if (action.type === 'assign_task') {
        const task = unassignedTasks.find(t =>
          t.id === action.taskId || t.id.startsWith(action.taskId)
        );
        const agent = agents.find(a => a.id === action.agentId);

        if (task && agent) {
          // Resolve workDir: projekt.workDir → companyWorkDir (per-project takes priority)
          const projektRow = task.projectId
            ? db.select({ workDir: projects.workDir }).from(projects).where(eq(projects.id, task.projectId)).get() as any
            : null;
          const effectiveWorkDir = projektRow?.workDir || companyWorkDir;
          const wsPath = task.workspacePath || createProjectWorkspace(effectiveWorkDir, task.title);

          db.update(tasks).set({
            assignedTo: agent.id,
            status: 'todo',
            updatedAt: now(),
            ...(wsPath && !task.workspacePath ? { workspacePath: wsPath } : {}),
          }).where(eq(tasks.id, task.id)).run();

          const wsInfo = wsPath ? `\nArbeitsverzeichnis: ${wsPath}` : '';
          db.insert(chatMessages).values({
            id: uuid(),
            companyId: options.companyId,
            agentId: agent.id,
            senderType: 'system',
            message: `📋 Neue Aufgabe von CEO zugewiesen: "${task.title}" — ${action.reason || ''}${wsInfo}`,
            read: false,
            createdAt: now(),
          }).run();

          agentsToWake.push({ agentId: agent.id, unternehmenId: options.companyId });
          log.push(`✅ "${task.title}" → ${agent.name}${wsPath ? ` 📁 ${path.basename(wsPath)}` : ''}`);
        }

      } else if (action.type === 'create_task') {
        const agent = action.agentId ? agents.find(a => a.id === action.agentId) : null;
        const taskId = uuid();

        // Resolve workDir: use action.projectId's workDir if set, else companyWorkDir
        const newTaskProjektRow = action.projectId
          ? db.select({ workDir: projects.workDir }).from(projects).where(eq(projects.id, action.projectId)).get() as any
          : null;
        const newTaskWorkDir = newTaskProjektRow?.workDir || companyWorkDir;
        const wsPath = createProjectWorkspace(newTaskWorkDir, action.title);

        db.insert(tasks).values({
          id: taskId,
          companyId: options.companyId,
          title: action.title,
          description: action.description || '',
          status: agent ? 'todo' : 'backlog',
          priority: action.priority || 'medium',
          assignedTo: agent?.id || null,
          createdBy: options.agentId,
          workspacePath: wsPath,
          createdAt: now(),
          updatedAt: now(),
        }).run();

        if (agent) {
          const wsInfo = wsPath ? `\nArbeitsverzeichnis: ${wsPath}` : '';
          db.insert(chatMessages).values({
            id: uuid(),
            companyId: options.companyId,
            agentId: agent.id,
            senderType: 'system',
            message: `📋 CEO hat neue Aufgabe erstellt und dir zugewiesen: "${action.title}"${wsInfo}`,
            read: false,
            createdAt: now(),
          }).run();
          agentsToWake.push({ agentId: agent.id, unternehmenId: options.companyId });
          log.push(`🆕 "${action.title}" → ${agent.name}${wsPath ? ` 📁 ${path.basename(wsPath)}` : ''}`);
        } else {
          log.push(`🆕 "${action.title}" im Backlog${wsPath ? ` 📁 ${path.basename(wsPath)}` : ''}`);
        }

      } else if (action.type === 'hire_agent') {
        const existing = db.select().from(approvals)
          .where(and(
            eq(approvals.companyId, options.companyId),
            eq(approvals.type, 'hire_expert'),
            eq(approvals.status, 'pending'),
          ))
          .all()
          .find(g => {
            try { return JSON.parse(g.payload || '{}').role === action.role; } catch { return false; }
          });

        if (!existing) {
          db.insert(approvals).values({
            id: uuid(),
            companyId: options.companyId,
            type: 'hire_expert',
            title: `Neue Stelle: ${action.role}`,
            description: `${action.reason || ''}\n\nBenötigte Fähigkeiten: ${action.skills || action.role}`,
            requestedBy: options.agentId,
            status: 'pending',
            payload: JSON.stringify({
              rolle: action.role,
              faehigkeiten: action.skills || '',
              budgetMonatCent: 50000,
              verbindungsTyp: 'openrouter',
            }),
            createdAt: now(),
            updatedAt: now(),
          }).run();

          log.push(`👥 Hiring-Antrag für "${action.role}" zur Board-Genehmigung eingereicht`);
        }
      } else if (action.type === 'chat') {
        const agent = action.agentId ? agents.find(a => a.id === action.agentId) : null;
        if (agent) {
          db.insert(chatMessages).values({
            id: uuid(),
            companyId: options.companyId,
            agentId: agent.id,
            vonExpertId: options.agentId,
            senderType: 'agent',
            message: `[CEO]: ${action.message || action.text}`,
            read: false,
            createdAt: now(),
          }).run();
          // Wake up the agent so they process the message (batched with others for parallel fire)
          agentsToWake.push({ agentId: agent.id, unternehmenId: options.companyId });
          log.push(`💬 Nachricht an ${agent.name} gesendet`);
        }

      } else if (action.type === 'call_meeting') {
        // Delegate to scheduler's executeAgentAction which handles full meeting setup
        await scheduler.executeAgentAction(
          options.companyId,
          options.agentId,
          'call_meeting',
          { frage: action.frage, teilnehmer: action.teilnehmer },
          true, // skipAutonomyCheck — CEO is always autonomous
        );
        log.push(`📋 Meeting gestartet: "${action.frage}"`);
      }
    }

    // Fire all agent wakeups in parallel (avoid staggered setTimeout delays)
    if (agentsToWake.length > 0) {
      console.log(`[CEO] Waking ${agentsToWake.length} agent(s) in parallel`);
      await Promise.all(agentsToWake.map(({ agentId, unternehmenId }) =>
        scheduler.triggerZyklus(agentId, unternehmenId, 'manual').catch(console.error),
      ));
    }

    // Prefer direct chat reply; append action log if any
    const output = [
      chatReply || (summary ? `🧠 CEO: ${summary}` : ''),
      ...log,
    ].filter(Boolean).join('\n');

    return output || 'CEO: Alle Tasks sind zugewiesen, kein Handlungsbedarf.';
  }

  private async runRuleBased(
    options: AdapterRunOptions,
    unassignedTasks: any[],
    agents: any[],
    startTime: number,
  ): Promise<AdapterRunResult> {
    // Save task IDs before assignment to know which agents were newly assigned
    const previouslyAssigned = new Set(unassignedTasks.map(t => t.assignedTo).filter(Boolean));
    const ausgabe = this.runRuleBasedSync(options, unassignedTasks, agents);

    // Wake up agents that were newly assigned tasks (with stagger)
    const assignedTasks = db.select({ zugewiesenAn: tasks.assignedTo })
      .from(tasks)
      .where(and(eq(tasks.companyId, options.companyId), eq(tasks.status, 'todo')))
      .all()
      .map((t: any) => t.assignedTo)
      .filter((id: string | null) => id && !previouslyAssigned.has(id));

    const uniqueAgents = [...new Set(assignedTasks)] as string[];
    if (uniqueAgents.length > 0) {
      console.log(`[CEO] Rule-based: waking ${uniqueAgents.length} agent(s) in parallel`);
      await Promise.all(uniqueAgents.map(agentId =>
        scheduler.triggerZyklus(agentId, options.companyId, 'manual').catch(console.error),
      ));
    }

    return {
      success: true,
      output: ausgabe,
      duration: Date.now() - startTime,
      tokenUsage: { inputTokens: 0, outputTokens: 0, costCent: 0 },
    };
  }

  private runRuleBasedSync(options: AdapterRunOptions, unassignedTasks: any[], agents: any[]): string {
    const log: string[] = [];

    for (const task of unassignedTasks) {
      const agent = this.findBestAgent(task, agents);
      if (agent) {
        db.update(tasks).set({
          assignedTo: agent.id,
          status: 'todo',
          updatedAt: now(),
        }).where(eq(tasks.id, task.id)).run();

        db.insert(chatMessages).values({
          id: uuid(),
          companyId: options.companyId,
          agentId: agent.id,
          senderType: 'system',
          message: `📋 Neue Aufgabe zugewiesen: "${task.title}"`,
          read: false,
          createdAt: now(),
        }).run();

        log.push(`✅ "${task.title}" → ${agent.name}`);
      } else {
        log.push(`⚠️ Kein passender Agent für "${task.title}"`);
      }
    }

    return log.length > 0
      ? `CEO (regelbasiert):\n${log.join('\n')}`
      : 'CEO: Keine unzugewiesenen Tasks gefunden.';
  }

  private findBestAgent(task: any, agents: any[]): any {
    const text = (task.title + ' ' + (task.description || '')).toLowerCase();

    const scored = agents.map(agent => {
      const skills = ((agent.skills || '') + ' ' + agent.role).toLowerCase();
      const words = text.split(/\s+/);
      const score = words.filter(w => w.length > 3 && skills.includes(w)).length;
      return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);

    if (scored[0]?.score > 0) return scored[0].agent;

    const taskCounts = new Map<string, number>();
    for (const a of agents) {
      const count = db.select().from(tasks)
        .where(and(
          eq(tasks.assignedTo, a.id),
          eq(tasks.status, 'in_progress'),
        ))
        .all().length;
      taskCounts.set(a.id, count);
    }

    return agents.sort((a, b) => (taskCounts.get(a.id) || 0) - (taskCounts.get(b.id) || 0))[0] || null;
  }
}

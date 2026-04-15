import { db } from '../db/client.js';
import { experten, aufgaben, unternehmen, genehmigungen, chatNachrichten, einstellungen, traceEreignisse, agentMeetings } from '../db/schema.js';
import { eq, and, isNull, desc, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import { decryptSetting } from '../utils/crypto.js';
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
  beschreibung = 'CEO - Chief Executive Officer (LLM-powered Orchestration)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();

    try {
      // Get company info
      const company = db.select().from(unternehmen).where(eq(unternehmen.id, options.unternehmenId)).get();
      if (!company) throw new Error('Unternehmen nicht gefunden');

      // Get all active agents (excl. CEO itself)
      const agents = db.select().from(experten)
        .where(and(
          eq(experten.unternehmenId, options.unternehmenId),
          eq(experten.status, 'active'),
        ))
        .all()
        .filter(a => a.id !== options.expertId);

      // Get unassigned tasks or tasks assigned to CEO for orchestration
      const unassignedTasks = db.select().from(aufgaben)
        .where(and(
          eq(aufgaben.unternehmenId, options.unternehmenId),
          or(
            isNull(aufgaben.zugewiesenAn),
            eq(aufgaben.zugewiesenAn, options.expertId)
          )
        ))
        .all()
        .filter(t => t.status !== 'done' && t.status !== 'cancelled');

      // Get all open tasks (for context)
      const allOpenTasks = db.select().from(aufgaben)
        .where(eq(aufgaben.unternehmenId, options.unternehmenId))
        .all()
        .filter(t => t.status !== 'done' && t.status !== 'cancelled');

      // ── Meeting intelligence signals ─────────────────────────────────────────
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const activeRunningMeetings = db.select().from(agentMeetings)
        .where(and(
          eq(agentMeetings.unternehmenId, options.unternehmenId),
          eq(agentMeetings.status, 'running'),
        ))
        .all();

      const recentMeetings = db.select().from(agentMeetings)
        .where(eq(agentMeetings.unternehmenId, options.unternehmenId))
        .orderBy(desc(agentMeetings.erstelltAm))
        .limit(5)
        .all();

      const blockedTasks = allOpenTasks.filter(t => t.status === 'blocked');
      const staleTasks = allOpenTasks.filter(t =>
        t.status === 'in_progress' && t.gestartetAm && t.gestartetAm < threeDaysAgo
      );
      const meetingRecentlyStarted = recentMeetings.some(m => m.erstelltAm > twoHoursAgo);
      const canCallMeeting = agents.length >= 1
        && !meetingRecentlyStarted
        && activeRunningMeetings.length === 0;

      const lastMeetingDate = recentMeetings[0]?.erstelltAm?.slice(0, 10) || 'noch keins';

      const meetingSignals = `
🚦 Meeting-Signale:
- Verfügbare Team-Mitglieder: ${agents.length}
- Aktive Meetings gerade: ${activeRunningMeetings.length}
- Blockierte Tasks: ${blockedTasks.length}${blockedTasks.length > 0 ? ` (${blockedTasks.map(t => `"${t.titel}"`).join(', ')})` : ''}
- Stale Tasks (>3 Tage ohne Fortschritt): ${staleTasks.length}${staleTasks.length > 0 ? ` (${staleTasks.map(t => `"${t.titel}"`).join(', ')})` : ''}
- Letztes Meeting: ${lastMeetingDate}
- Meeting jetzt einberufbar: ${canCallMeeting ? 'JA' : 'NEIN' + (activeRunningMeetings.length > 0 ? ' — eines läuft bereits' : ' — Cooldown (< 2h)')}

Wann ein Meeting sinnvoll ist:
✅ 2+ blockierte Tasks die Team-Input brauchen
✅ Stale Tasks wo unklar ist warum kein Fortschritt
✅ Komplexe strategische Entscheidung die mehrere Rollen betrifft
✅ Widersprüchliche Prioritäten zwischen Agenten
❌ NICHT wenn canCallMeeting=NEIN, Team < 2 Personen, oder die Antwort offensichtlich ist`;

      // Get recent chat history with the board
      const recentChat = db.select().from(chatNachrichten)
        .where(and(eq(chatNachrichten.unternehmenId, options.unternehmenId), eq(chatNachrichten.expertId, options.expertId)))
        .orderBy(desc(chatNachrichten.erstelltAm))
        .limit(10)
        .all();

      const chatHistoryDesc = recentChat.reverse().map(m => 
        `[${m.absenderTyp === 'board' ? 'USER' : 'SYSTEM/AGENT'}]: ${m.nachricht}`
      ).join('\n');

      // Build CEO context for LLM
      const agentsDesc = agents.map(a =>
        `- ${a.name} (${a.rolle}): ${a.faehigkeiten || 'keine Angabe'}`
      ).join('\n');

      const unassignedDesc = unassignedTasks.map(t =>
        `- [${t.id.slice(0, 8)}] "${t.titel}" (${t.prioritaet}) — ${t.beschreibung?.slice(0, 100) || 'keine Beschreibung'}`
      ).join('\n');

      const allTasksDesc = allOpenTasks.map(t => {
        const assignee = t.zugewiesenAn
          ? agents.find(a => a.id === t.zugewiesenAn)?.name || 'unbekannt'
          : 'nicht zugewiesen';
        return `- "${t.titel}" → ${assignee} (${t.status})`;
      }).join('\n');

      // Detect if we're in conversational/manual mode (triggered by a board message)
      const hasNewBoardMessage = recentChat.some(m => m.absenderTyp === 'board');
      const isConversational = hasNewBoardMessage || (options.prompt?.includes('direkte Nachricht') ?? false);

      // Determine mode: chat reply, assign tasks, OR idle/proactive
      const mode = isConversational ? 'chat' : unassignedTasks.length > 0 ? 'assign' : 'proactive';

      const systemPrompt = `Du bist der CEO von "${company.name}" — direkt, menschlich, auf Augenhöhe.
Unternehmensziel: ${company.ziel || company.beschreibung || 'Nicht definiert'}

Dein Team:
${agentsDesc || 'Noch kein Team außer dir selbst.'}

Offene Tasks:
${allTasksDesc || 'Keine offenen Tasks gerade.'}
${meetingSignals}
Kommunikationsstil:
- Immer "du", nie "Sie"
- Kurz und klar, kein Bullshit
- Menschlich und direkt, kein Unternehmens-Speak
- Bei Statusfragen: ehrlich sagen was gerade läuft (oder eben nicht)`;

      let userPrompt: string;

      if (mode === 'chat') {
        userPrompt = `Neue Nachricht vom Board:

${chatHistoryDesc}

Antworte locker und direkt auf Deutsch. Kein Unternehmens-Speak, kein "Ihre Anfrage".
Auf Grüße oder Smalltalk: kurz und menschlich antworten (1-2 Sätze reichen).
Auf Statusfragen: sag was gerade läuft — keine Tasks? Dann sag das ehrlich.

Wenn das Board einen konkreten Auftrag gibt (z.B. "baue X ein", "erstell Y", "kümmere dich um Z"):
- Erstelle sofort einen Task und delegiere ihn an den passenden Agenten.
- Antworte MIT einem JSON-Block UND einem "reply"-Feld.

Verfügbare Agenten für agentId:
${agents.filter(a => a.status !== 'terminated').map(a => `- ${a.id}: ${a.name} (${a.rolle || 'kein Titel'})`).join('\n')}

Beispiel für Task-Erstellung + Delegation:
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

        userPrompt = `Alle Tasks sind zugewiesen. Analysiere den Status des Unternehmens und entscheide proaktiv:
- Welche neuen strategischen Tasks soll das Team angehen?
- Braucht das Team neue Mitglieder?
- Braucht das Team ein Meeting (siehe Meeting-Signale im System-Prompt)?${meetingHint}

Antworte mit diesem JSON:
{
  "actions": [
    { "type": "create_task", "titel": "Task Titel", "beschreibung": "Was zu tun ist", "prioritaet": "high|medium|low", "agentId": "AGENT_ID_oder_null" },
    { "type": "hire_agent", "rolle": "Rollenname", "faehigkeiten": "Skills", "reason": "warum" },
    { "type": "call_meeting", "frage": "Eure Einschätzung zu X?", "teilnehmer": ["AGENT_ID_1", "AGENT_ID_2"] }
  ],
  "summary": "Was du entschieden hast in 1-2 Sätzen"
}

Regeln:
- Maximal 3 neue Tasks
- call_meeting nur wenn canCallMeeting=JA (sieh Meeting-Signale) und es echten Mehrwert bringt
- Kein hire_agent wenn das Team bereits gut aufgestellt ist
- Wenn alles gut läuft: nur kurze Summary, keine unnötigen Actions`;
      }

      // Call LLM
      const llmResult = await this.callLLM(systemPrompt, userPrompt, options);

      if (!llmResult.success) {
        // Fallback to rule-based if LLM fails
        return this.runRuleBased(options, unassignedTasks, agents, startTime);
      }

      // Parse and execute CEO decisions
      const ausgabe = await this.executeCEODecisions(
        llmResult.text,
        options,
        unassignedTasks,
        agents,
        company.workDir,
      );

      return {
        success: true,
        ausgabe,
        dauer: Date.now() - startTime,
        tokenVerbrauch: llmResult.tokenVerbrauch,
      };

    } catch (error: any) {
      return {
        success: false,
        ausgabe: '',
        fehler: `CEO-Orchestrierung fehlgeschlagen: ${error.message}`,
        dauer: Date.now() - startTime
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
    tokenVerbrauch: { inputTokens: number; outputTokens: number; kostenCent: number };
  }> {
    const config = JSON.parse(options.verbindungsConfig || '{}');

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
    const anthropicKeyRaw = options.verbindungsTyp === 'anthropic' && options.apiKey
      ? options.apiKey
      : db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'anthropic_api_key')).get()?.wert;
    const anthropicKey = anthropicKeyRaw ? decryptSetting('anthropic_api_key', anthropicKeyRaw) : null;

    if (anthropicKey) {
      try {
        // CEO should use a capable model — Sonnet is the minimum for orchestration quality
        const model = (options.verbindungsTyp === 'anthropic' && config.model)
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
            tokenVerbrauch: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, kostenCent: 0 },
          };
        }
      } catch (e: any) {
        console.error('[CEO] Anthropic tool_use failed:', e.message);
      }
    }

    // ── 2. OpenRouter function calling ────────────────────────────────────────
    const orKeyRaw = options.verbindungsTyp === 'openrouter' && options.apiKey
      ? options.apiKey
      : db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openrouter_api_key')).get()?.wert;
    const orKey = orKeyRaw ? decryptSetting('openrouter_api_key', orKeyRaw) : null;

    if (orKey) {
      try {
        const model = (options.verbindungsTyp === 'openrouter' && config.model) ? config.model : 'openrouter/auto';
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
            tokenVerbrauch: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, kostenCent: 0 },
          };
        }
      } catch (e: any) {
        console.error('[CEO] OpenRouter tool_use failed:', e.message);
      }
    }

    // ── 3. OpenAI function calling ────────────────────────────────────────────
    const openaiKeyRaw = options.verbindungsTyp === 'openai' && options.apiKey
      ? options.apiKey
      : db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openai_api_key')).get()?.wert;
    const openaiKey = openaiKeyRaw ? decryptSetting('openai_api_key', openaiKeyRaw) : null;

    if (openaiKey) {
      try {
        const model = (options.verbindungsTyp === 'openai' && config.model) ? config.model : 'gpt-4o-mini';
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
            tokenVerbrauch: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, kostenCent: 0 },
          };
        }
      } catch (e: any) {
        console.error('[CEO] OpenAI tool_use failed:', e.message);
      }
    }

    return { success: false, text: '', tokenVerbrauch: { inputTokens: 0, outputTokens: 0, kostenCent: 0 } };
  }

  private async callLLM(systemPrompt: string, userPrompt: string, options: AdapterRunOptions): Promise<{
    success: boolean;
    text: string;
    tokenVerbrauch: { inputTokens: number; outputTokens: number; kostenCent: number };
  }> {
    // ── Try native tool_use first (more reliable than text parsing) ──────────
    const toolResult = await this.callLLMWithTools(systemPrompt, userPrompt, options);
    if (toolResult.success) return toolResult;
    console.log('[CEO] Tool-use failed or no key found — falling back to text-based LLM');

    // 1. Check if a specific engine was requested via connection settings
    if (options.verbindungsTyp && options.verbindungsTyp !== 'ceo') {
      const type = options.verbindungsTyp;
      const apiKey = options.apiKey;
      const baseUrl = options.apiBaseUrl;
      const config = JSON.parse(options.verbindungsConfig || '{}');
      const ollamaDefaultRaw = type === 'ollama'
        ? db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'ollama_default_model')).get()?.wert
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
              return { success: true, text: data.choices?.[0]?.message?.content || '', tokenVerbrauch: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, kostenCent: 0 } };
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
            return { success: true, text: data.message?.content || '', tokenVerbrauch: { inputTokens: data.prompt_eval_count || 0, outputTokens: data.eval_count || 0, kostenCent: 0 } };
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
            return { success: true, text: data.choices?.[0]?.message?.content || '', tokenVerbrauch: { inputTokens: data.usage?.prompt_tokens || 0, outputTokens: data.usage?.completion_tokens || 0, kostenCent: 0 } };
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
            return { success: true, text: data.content?.[0]?.text || '', tokenVerbrauch: { inputTokens: data.usage?.input_tokens || 0, outputTokens: data.usage?.output_tokens || 0, kostenCent: 0 } };
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
    const orKey = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openrouter_api_key')).get();
    const anthropicKey = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'anthropic_api_key')).get();
    const openaiKey = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openai_api_key')).get();
    const ollamaUrl = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'ollama_base_url')).get();

    try {
      if (orKey?.wert) {
        const apiKey = decryptSetting('openrouter_api_key', orKey.wert);
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
            tokenVerbrauch: {
              inputTokens: data.usage?.prompt_tokens || 0,
              outputTokens: data.usage?.completion_tokens || 0,
              kostenCent: 0,
            },
          };
        }
      }

      if (anthropicKey?.wert) {
        const apiKey = decryptSetting('anthropic_api_key', anthropicKey.wert);
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
            tokenVerbrauch: {
              inputTokens: data.usage?.input_tokens || 0,
              outputTokens: data.usage?.output_tokens || 0,
              kostenCent: 0,
            },
          };
        }
      }

      if (openaiKey?.wert) {
        const apiKey = decryptSetting('openai_api_key', openaiKey.wert);
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
            tokenVerbrauch: {
              inputTokens: data.usage?.prompt_tokens || 0,
              outputTokens: data.usage?.completion_tokens || 0,
              kostenCent: 0,
            },
          };
        }
      }
 
      if (ollamaUrl?.wert) {
        const baseUrl = ollamaUrl.wert;
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
            tokenVerbrauch: {
              inputTokens: data.prompt_eval_count || 0,
              outputTokens: data.eval_count || 0,
              kostenCent: 0,
            },
          };
        }
      }
    } catch (e) {
      console.error('CEO LLM call failed:', e);
    }

    return { success: false, text: '', tokenVerbrauch: { inputTokens: 0, outputTokens: 0, kostenCent: 0 } };
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
          // Create a project workspace folder for this task if company workDir is set
          const wsPath = task.workspacePath || createProjectWorkspace(companyWorkDir, task.titel);

          db.update(aufgaben).set({
            zugewiesenAn: agent.id,
            status: 'todo',
            aktualisiertAm: now(),
            ...(wsPath && !task.workspacePath ? { workspacePath: wsPath } : {}),
          }).where(eq(aufgaben.id, task.id)).run();

          const wsInfo = wsPath ? `\nArbeitsverzeichnis: ${wsPath}` : '';
          db.insert(chatNachrichten).values({
            id: uuid(),
            unternehmenId: options.unternehmenId,
            expertId: agent.id,
            absenderTyp: 'system',
            nachricht: `📋 Neue Aufgabe von CEO zugewiesen: "${task.titel}" — ${action.reason || ''}${wsInfo}`,
            gelesen: false,
            erstelltAm: now(),
          }).run();

          agentsToWake.push({ agentId: agent.id, unternehmenId: options.unternehmenId });
          log.push(`✅ "${task.titel}" → ${agent.name}${wsPath ? ` 📁 ${path.basename(wsPath)}` : ''}`);
        }

      } else if (action.type === 'create_task') {
        const agent = action.agentId ? agents.find(a => a.id === action.agentId) : null;
        const taskId = uuid();

        // Create project workspace folder
        const wsPath = createProjectWorkspace(companyWorkDir, action.titel);

        db.insert(aufgaben).values({
          id: taskId,
          unternehmenId: options.unternehmenId,
          titel: action.titel,
          beschreibung: action.beschreibung || '',
          status: agent ? 'todo' : 'backlog',
          prioritaet: action.prioritaet || 'medium',
          zugewiesenAn: agent?.id || null,
          erstelltVon: options.expertId,
          workspacePath: wsPath,
          erstelltAm: now(),
          aktualisiertAm: now(),
        }).run();

        if (agent) {
          const wsInfo = wsPath ? `\nArbeitsverzeichnis: ${wsPath}` : '';
          db.insert(chatNachrichten).values({
            id: uuid(),
            unternehmenId: options.unternehmenId,
            expertId: agent.id,
            absenderTyp: 'system',
            nachricht: `📋 CEO hat neue Aufgabe erstellt und dir zugewiesen: "${action.titel}"${wsInfo}`,
            gelesen: false,
            erstelltAm: now(),
          }).run();
          agentsToWake.push({ agentId: agent.id, unternehmenId: options.unternehmenId });
          log.push(`🆕 "${action.titel}" → ${agent.name}${wsPath ? ` 📁 ${path.basename(wsPath)}` : ''}`);
        } else {
          log.push(`🆕 "${action.titel}" im Backlog${wsPath ? ` 📁 ${path.basename(wsPath)}` : ''}`);
        }

      } else if (action.type === 'hire_agent') {
        const existing = db.select().from(genehmigungen)
          .where(and(
            eq(genehmigungen.unternehmenId, options.unternehmenId),
            eq(genehmigungen.typ, 'hire_expert'),
            eq(genehmigungen.status, 'pending'),
          ))
          .all()
          .find(g => {
            try { return JSON.parse(g.payload || '{}').rolle === action.rolle; } catch { return false; }
          });

        if (!existing) {
          db.insert(genehmigungen).values({
            id: uuid(),
            unternehmenId: options.unternehmenId,
            typ: 'hire_expert',
            titel: `Neue Stelle: ${action.rolle}`,
            beschreibung: `${action.reason || ''}\n\nBenötigte Fähigkeiten: ${action.faehigkeiten || action.rolle}`,
            angefordertVon: options.expertId,
            status: 'pending',
            payload: JSON.stringify({
              rolle: action.rolle,
              faehigkeiten: action.faehigkeiten || '',
              budgetMonatCent: 50000,
              verbindungsTyp: 'openrouter',
            }),
            erstelltAm: now(),
            aktualisiertAm: now(),
          }).run();

          log.push(`👥 Hiring-Antrag für "${action.rolle}" zur Board-Genehmigung eingereicht`);
        }
      } else if (action.type === 'chat') {
        const agent = action.agentId ? agents.find(a => a.id === action.agentId) : null;
        if (agent) {
          db.insert(chatNachrichten).values({
            id: uuid(),
            unternehmenId: options.unternehmenId,
            expertId: agent.id,
            vonExpertId: options.expertId,
            absenderTyp: 'agent',
            nachricht: `[CEO]: ${action.nachricht || action.text}`,
            gelesen: false,
            erstelltAm: now(),
          }).run();
          // Wake up the agent so they process the message (batched with others for parallel fire)
          agentsToWake.push({ agentId: agent.id, unternehmenId: options.unternehmenId });
          log.push(`💬 Nachricht an ${agent.name} gesendet`);
        }

      } else if (action.type === 'call_meeting') {
        // Delegate to scheduler's executeAgentAction which handles full meeting setup
        await scheduler.executeAgentAction(
          options.unternehmenId,
          options.expertId,
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
    const previouslyAssigned = new Set(unassignedTasks.map(t => t.zugewiesenAn).filter(Boolean));
    const ausgabe = this.runRuleBasedSync(options, unassignedTasks, agents);

    // Wake up agents that were newly assigned tasks (with stagger)
    const assignedTasks = db.select({ zugewiesenAn: aufgaben.zugewiesenAn })
      .from(aufgaben)
      .where(and(eq(aufgaben.unternehmenId, options.unternehmenId), eq(aufgaben.status, 'todo')))
      .all()
      .map((t: any) => t.zugewiesenAn)
      .filter((id: string | null) => id && !previouslyAssigned.has(id));

    const uniqueAgents = [...new Set(assignedTasks)] as string[];
    if (uniqueAgents.length > 0) {
      console.log(`[CEO] Rule-based: waking ${uniqueAgents.length} agent(s) in parallel`);
      await Promise.all(uniqueAgents.map(agentId =>
        scheduler.triggerZyklus(agentId, options.unternehmenId, 'manual').catch(console.error),
      ));
    }

    return {
      success: true,
      ausgabe,
      dauer: Date.now() - startTime,
      tokenVerbrauch: { inputTokens: 0, outputTokens: 0, kostenCent: 0 },
    };
  }

  private runRuleBasedSync(options: AdapterRunOptions, unassignedTasks: any[], agents: any[]): string {
    const log: string[] = [];

    for (const task of unassignedTasks) {
      const agent = this.findBestAgent(task, agents);
      if (agent) {
        db.update(aufgaben).set({
          zugewiesenAn: agent.id,
          status: 'todo',
          aktualisiertAm: now(),
        }).where(eq(aufgaben.id, task.id)).run();

        db.insert(chatNachrichten).values({
          id: uuid(),
          unternehmenId: options.unternehmenId,
          expertId: agent.id,
          absenderTyp: 'system',
          nachricht: `📋 Neue Aufgabe zugewiesen: "${task.titel}"`,
          gelesen: false,
          erstelltAm: now(),
        }).run();

        log.push(`✅ "${task.titel}" → ${agent.name}`);
      } else {
        log.push(`⚠️ Kein passender Agent für "${task.titel}"`);
      }
    }

    return log.length > 0
      ? `CEO (regelbasiert):\n${log.join('\n')}`
      : 'CEO: Keine unzugewiesenen Tasks gefunden.';
  }

  private findBestAgent(task: any, agents: any[]): any {
    const text = (task.titel + ' ' + (task.beschreibung || '')).toLowerCase();

    const scored = agents.map(agent => {
      const skills = ((agent.faehigkeiten || '') + ' ' + agent.rolle).toLowerCase();
      const words = text.split(/\s+/);
      const score = words.filter(w => w.length > 3 && skills.includes(w)).length;
      return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);

    if (scored[0]?.score > 0) return scored[0].agent;

    const taskCounts = new Map<string, number>();
    for (const a of agents) {
      const count = db.select().from(aufgaben)
        .where(and(
          eq(aufgaben.zugewiesenAn, a.id),
          eq(aufgaben.status, 'in_progress'),
        ))
        .all().length;
      taskCounts.set(a.id, count);
    }

    return agents.sort((a, b) => (taskCounts.get(a.id) || 0) - (taskCounts.get(b.id) || 0))[0] || null;
  }
}

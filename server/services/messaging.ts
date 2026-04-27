import { db } from '../db/client.js';
import { settings, agents, chatMessages, companies, goals, costEntries } from '../db/schema.js';
import { eq, and, desc, asc, gte } from 'drizzle-orm';
import { decryptSetting, encryptSetting } from '../utils/crypto.js';
import { v4 as uuid } from 'uuid';
import { scheduler } from '../scheduler.js';
import { traceEvents, tasks as tasksTable, approvals as approvalsTable, agentPermissions, routines, projects, skillsLibrary, agentSkills, agentMeetings } from '../db/schema.js';
import { appEvents } from '../events.js';
import { runClaudeDirectChat } from '../adapters/claude-code.js';
import { runCodexDirectChat } from '../adapters/codex-cli.js';
import { runGeminiDirectChat } from '../adapters/gemini-cli.js';
import { runKimiDirectChat } from '../adapters/kimi-cli.js';
import { discordBotService } from './discord-bot.js';

// ─── Agent/Task lookup helpers ────────────────────────────────────────────────

function findAgent(companyId: string, agentId: string): any | null {
  const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
  return (agentRows as any[]).find(a =>
    a.id === agentId ||
    a.id.startsWith(agentId) ||
    a.name.toLowerCase() === agentId.toLowerCase() ||
    a.name.toLowerCase().replace(/\s+/g, '') === agentId.toLowerCase().replace(/\s+/g, '')
  ) || null;
}

function findTask(companyId: string, taskId: string): any | null {
  const taskRows = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).all();
  return (taskRows as any[]).find(t => t.id === taskId || t.id.startsWith(taskId)) || null;
}

// ─── Shared: Build CEO config context for system prompts ─────────────────────

export function buildConfigContext(companyId: string): string {
  const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
  const taskRows = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).orderBy(desc(tasksTable.createdAt)).limit(15).all();
  let projs: any[] = [];
  try { projs = db.select().from(projects as any).where(eq((projects as any).companyId, companyId)).all() as any[]; } catch {}
  const routinesAll= db.select().from(routines).where(eq(routines.companyId, companyId)).all();
  const allSettings = db.select().from(settings).all();

  const getKey = (key: string) =>
    allSettings.find(s => s.key === key && s.companyId === companyId) ||
    allSettings.find(s => s.key === key && (!s.companyId || s.companyId === ''));

  const keyStatus = (key: string) => (getKey(key)?.value ? '✅ gesetzt' : '❌ fehlt');

  const agentLines = (agentRows as any[]).map(a => {
    let cfg: any = {};
    try { cfg = JSON.parse(a.connectionConfig || '{}'); } catch {}
    const model = cfg.model || '(Standard)';
    const heartbeat = a.autoCycleActive ? `❤️ aktiv (${a.autoCycleIntervalSec || 300}s)` : '💤 pausiert';
    const orch = (a.isOrchestrator === true || a.isOrchestrator === 1) ? ' 👑 CEO' : '';
    return `  • [${a.id.slice(0,8)}] ${a.name}${orch} — ${a.role} | ${a.connectionType || 'claude-code'} ${model} | Status: ${a.status || 'idle'} | ${heartbeat}`;
  }).join('\n') || '  (keine Agenten)';

  const openTasks = (taskRows as any[]).filter((t: any) => t.status !== 'done' && t.status !== 'cancelled');
  const taskLines = openTasks.slice(0, 8).map((t: any) => {
    const assignee = (agentRows as any[]).find((a: any) => a.id === t.assignedTo)?.name || '—';
    return `  • [${t.id.slice(0,6)}] "${t.title}" → ${assignee} (${t.status}, ${t.priority || 'medium'})`;
  }).join('\n') || '  (keine offenen Tasks)';

  let projectLines = '  (keine Projekte)';
  if (projs.length > 0) {
    projectLines = projs.slice(0, 5).map((p: any) => `  • [${p.id?.slice(0,6) || '?'}] ${p.name} — ${p.status || 'aktiv'}`).join('\n');
  }

  const routineLines = (routinesAll as any[]).length > 0
    ? (routinesAll as any[]).map((r: any) => `  • [${r.id.slice(0,6)}] "${r.title}" — ${r.status === 'active' ? '✅ aktiv' : '⏸ pausiert'}`).join('\n')
    : '  (keine Routinen)';

  const comp = db.select().from(companies).where(eq(companies.id, companyId)).get();

  const pendingApprovals = db.select().from(approvalsTable)
    .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending')))
    .orderBy(desc(approvalsTable.createdAt)).limit(5).all() as any[];
  const approvalLines = pendingApprovals.length > 0
    ? pendingApprovals.map(g => `  • [${g.id.slice(0,6)}] ${g.type} — "${g.title}"`).join('\n')
    : '  (keine offenen Genehmigungen)';

  const goalRows = db.select().from(goals).where(eq(goals.companyId, companyId)).orderBy(desc(goals.createdAt)).limit(5).all() as any[];
  const goalLines = goalRows.length > 0
    ? goalRows.map(g => `  • [${g.id.slice(0,6)}] "${g.title}" (${g.status}, ${g.progress}%)`).join('\n')
    : '  (keine Ziele)';

  const skillsAvail = db.select().from(skillsLibrary).where(eq(skillsLibrary.companyId, companyId)).limit(20).all() as any[];
  const skillLines = skillsAvail.length > 0
    ? skillsAvail.slice(0, 12).map(s => `  • [${s.id.slice(0,6)}] ${s.name}`).join('\n')
    : '  (keine Skills in Library)';

  return `
VOLLSTÄNDIGE SYSTEM-KONFIGURATION (du hast vollen Zugriff und kannst alles ändern):

Unternehmen: ${(comp as any)?.name || companyId}
Arbeitsverzeichnis: ${(comp as any)?.workDir || '(nicht gesetzt)'}

AGENTEN (${agentRows.length}):
${agentLines}

OFFENE TASKS (${openTasks.length}):
${taskLines}

PROJEKTE:
${projectLines}

ROUTINEN:
${routineLines}

OFFENE GENEHMIGUNGEN (${pendingApprovals.length}):
${approvalLines}

ZIELE (${goalRows.length}):
${goalLines}

VERFÜGBARE SKILLS (${skillsAvail.length}):
${skillLines}

API KEYS:
  • OpenRouter:  ${keyStatus('openrouter_api_key')}
  • Anthropic:   ${keyStatus('anthropic_api_key')}
  • OpenAI:      ${keyStatus('openai_api_key')}
  • Ollama URL:  ${keyStatus('ollama_base_url')}
  • Telegram:    ${keyStatus('telegram_bot_token')}
  • Telegram Chat-ID: ${keyStatus('telegram_chat_id')}

VERBINDUNGSTYPEN:
  • claude-code  — Claude CLI (Pro/Max Abo, kein API Key)
  • openrouter   — OpenRouter API (benötigt openrouter_api_key)
  • anthropic    — Anthropic direkt (benötigt anthropic_api_key)
  • openai       — OpenAI direkt (benötigt openai_api_key)
  • ollama       — Lokales Ollama (kein Key, braucht laufende Instanz)

KONFIGURATIONSAKTIONEN:
[ACTION]{"type": "configure_agent", "agentId": "8-char-ID", "verbindungsTyp": "openrouter", "model": "anthropic/claude-opus-4"}[/ACTION]
[ACTION]{"type": "configure_all_agents", "verbindungsTyp": "openrouter", "model": "anthropic/claude-opus-4"}[/ACTION]
[ACTION]{"type": "update_agent", "agentId": "8-char", "name": "...", "rolle": "...", "titel": "...", "faehigkeiten": "...", "systemPrompt": "..."}[/ACTION]
[ACTION]{"type": "set_agent_heartbeat", "agentId": "8-char", "aktiv": true, "intervallSek": 300}[/ACTION]
[ACTION]{"type": "set_agent_status", "agentId": "8-char", "status": "active"}[/ACTION]
[ACTION]{"type": "set_orchestrator", "agentId": "8-char", "isOrchestrator": true}[/ACTION]
[ACTION]{"type": "create_agent", "name": "Name", "rolle": "Rolle", "faehigkeiten": "Skills", "verbindungsTyp": "claude-code"}[/ACTION]
[ACTION]{"type": "delete_agent", "agentId": "8-char"}[/ACTION]
[ACTION]{"type": "create_task", "titel": "...", "beschreibung": "...", "agentId": "8-char", "prioritaet": "high"}[/ACTION]
[ACTION]{"type": "update_task", "taskId": "6-char", "status": "done", "titel": "...", "agentId": "8-char", "prioritaet": "high"}[/ACTION]
[ACTION]{"type": "delete_task", "taskId": "6-char"}[/ACTION]
[ACTION]{"type": "create_project", "name": "...", "beschreibung": "..."}[/ACTION]
[ACTION]{"type": "create_routine", "name": "...", "beschreibung": "...", "cronAusdruck": "0 9 * * 1-5", "agentId": "8-char"}[/ACTION]
[ACTION]{"type": "set_routine_status", "routineId": "6-char", "aktiv": true}[/ACTION]
[ACTION]{"type": "save_setting", "key": "openrouter_api_key", "value": "sk-or-..."}[/ACTION]
[ACTION]{"type": "set_company_workdir", "path": "/absoluter/pfad/zum/projekt"}[/ACTION]
[ACTION]{"type": "approve_genehmigung", "genehmigungId": "6-char", "notiz": "optional"}[/ACTION]
[ACTION]{"type": "reject_genehmigung", "genehmigungId": "6-char", "notiz": "optional Grund"}[/ACTION]
[ACTION]{"type": "assign_skill", "agentId": "8-char", "skillName": "Python"}[/ACTION]
[ACTION]{"type": "remove_skill", "agentId": "8-char", "skillName": "Python"}[/ACTION]
[ACTION]{"type": "set_reports_to", "agentId": "8-char", "supervisorId": "8-char"}[/ACTION]   ← null = autonom
[ACTION]{"type": "set_agent_budget", "agentId": "8-char", "budgetEuro": 25}[/ACTION]
[ACTION]{"type": "create_goal", "titel": "...", "beschreibung": "...", "ebene": "company|team|agent|task", "eigentuemerId": "8-char (optional)"}[/ACTION]
[ACTION]{"type": "update_goal", "goalId": "6-char", "status": "active|achieved|cancelled", "fortschritt": 50}[/ACTION]
[ACTION]{"type": "create_meeting", "titel": "...", "teilnehmerIds": ["8-char","8-char"], "veranstalterId": "8-char (optional, default = du)"}[/ACTION]
[ACTION]{"type": "complete_meeting", "meetingId": "6-char", "ergebnis": "Synthese der Diskussion", "status": "completed|cancelled"}[/ACTION]
[ACTION]{"type": "create_company", "name": "...", "beschreibung": "...", "ziel": "...", "workDir": "/optional/path"}[/ACTION]
[ACTION]{"type": "update_company", "name": "...", "beschreibung": "...", "ziel": "...", "workDir": "..."}[/ACTION]
[ACTION]{"type": "archive_company"}[/ACTION]
[ACTION]{"type": "weekly_report_summary", "lang": "de|en (optional, default = UI-Sprache)"}[/ACTION]

DATEI-ANZEIGE IM CHAT:
Du kannst Dateien aus dem Arbeitsverzeichnis direkt im Chat einbetten — der Frontend-Renderer ersetzt den Marker durch eine File-Card mit Vorschau und "Open"-Button.
Verwende dazu:
[FILE]relativer/pfad/zur/datei.md[/FILE]
Beispiele: [FILE]README.md[/FILE]  oder  [FILE]reports/2026-04-26-news.md[/FILE]
Pfade sind relativ zum Arbeitsverzeichnis. Niemals absolute Pfade oder ".." verwenden.`;
}

// ─── Shared: Execute config actions ──────────────────────────────────────────

export function executeConfigAction(action: any, companyId: string): string | null {
  const _lang = getUiLanguage(companyId);
  const isEn = _lang === 'en';

  // ── configure_agent ───────────────────────────────────────────────────────
  if (action.type === 'configure_agent') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    let cfg: any = {};
    try { cfg = JSON.parse(agent.connectionConfig || '{}'); } catch {}
    if (action.model) cfg.model = action.model;
    db.update(agents).set({
      connectionType: action.connectionType || agent.connectionType,
      connectionConfig: JSON.stringify(cfg),
      updatedAt: new Date().toISOString(),
    }).where(eq(agents.id, agent.id)).run();
    return isEn ? `✅ ${agent.name} configured: ${action.connectionType || agent.connectionType}${action.model ? ` / ${action.model}` : ''}` : `✅ ${agent.name} konfiguriert: ${action.connectionType || agent.connectionType}${action.model ? ` / ${action.model}` : ''}`;
  }

  // ── configure_all_agents ──────────────────────────────────────────────────
  if (action.type === 'configure_all_agents') {
    const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
    let count = 0;
    for (const agent of agentRows as any[]) {
      let cfg: any = {};
      try { cfg = JSON.parse(agent.connectionConfig || '{}'); } catch {}
      if (action.model) cfg.model = action.model;
      db.update(agents).set({
        connectionType: action.connectionType || agent.connectionType,
        connectionConfig: JSON.stringify(cfg),
        updatedAt: new Date().toISOString(),
      }).where(eq(agents.id, agent.id)).run();
      count++;
    }
    return isEn ? `✅ ${count} agents configured: ${action.connectionType}${action.model ? ` / ${action.model}` : ''}` : `✅ ${count} Agenten konfiguriert: ${action.connectionType}${action.model ? ` / ${action.model}` : ''}`;
  }

  // ── update_agent ──────────────────────────────────────────────────────────
  if (action.type === 'update_agent') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    const updates: any = { updatedAt: new Date().toISOString() };
    if (action.name)         updates.name        = action.name;
    if (action.role)        updates.role       = action.role;
    if (action.title)        updates.title       = action.title;
    if (action.skills) updates.skills = action.skills;
    if (action.systemPrompt) {
      let cfg: any = {};
      try { cfg = JSON.parse(agent.connectionConfig || '{}'); } catch {}
      cfg.systemPrompt = action.systemPrompt;
      updates.connectionConfig = JSON.stringify(cfg);
    }
    db.update(agents).set(updates).where(eq(agents.id, agent.id)).run();
    return isEn ? `✅ Agent ${agent.name} updated.` : `✅ Agent ${agent.name} aktualisiert.`;
  }

  // ── set_agent_heartbeat ───────────────────────────────────────────────────
  if (action.type === 'set_agent_heartbeat') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    const updates: any = { updatedAt: new Date().toISOString() };
    if (typeof action.active !== 'undefined')    updates.autoCycleActive = action.active;
    if (typeof action.intervallSek !== 'undefined') updates.autoCycleIntervalSec = Number(action.intervallSek);
    db.update(agents).set(updates).where(eq(agents.id, agent.id)).run();
    const hb = action.active !== false
      ? (isEn ? `Heartbeat enabled (${action.intervallSek || agent.autoCycleIntervalSec}s)` : `Heartbeat aktiviert (${action.intervallSek || agent.autoCycleIntervalSec}s)`)
      : (isEn ? 'Heartbeat paused' : 'Heartbeat pausiert');
    return `✅ ${agent.name}: ${hb}`;
  }

  // ── set_agent_status ──────────────────────────────────────────────────────
  if (action.type === 'set_agent_status') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    const allowed = ['active', 'paused', 'idle', 'running', 'error', 'terminated'];
    if (!allowed.includes(action.status)) return isEn ? `❌ Invalid status \"${action.status}\". Allowed: ${allowed.join(', ')}` : `❌ Ungültiger Status \"${action.status}\". Erlaubt: ${allowed.join(', ')}`;
    db.update(agents).set({ status: action.status, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id)).run();
    return `✅ ${agent.name}: Status → ${action.status}`;
  }

  // ── set_orchestrator ──────────────────────────────────────────────────────
  if (action.type === 'set_orchestrator') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    if (action.isOrchestrator) {
      // Remove orchestrator from all others first
      const others = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
      for (const a of others as any[]) {
        if (a.id !== agent.id && (a.isOrchestrator === true || a.isOrchestrator === 1)) {
          db.update(agents).set({ isOrchestrator: false, updatedAt: new Date().toISOString() })
            .where(eq(agents.id, a.id)).run();
        }
      }
    }
    db.update(agents).set({ isOrchestrator: action.isOrchestrator !== false, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id)).run();
    return isEn ? `✅ ${agent.name}: ${action.isOrchestrator !== false ? '👑 set as CEO/Orchestrator' : 'Orchestrator role removed'}` : `✅ ${agent.name}: ${action.isOrchestrator !== false ? '👑 als CEO/Orchestrator gesetzt' : 'Orchestrator-Rolle entfernt'}`;
  }

  // ── create_agent ─────────────────────────────────────────────────────────
  if (action.type === 'create_agent') {
    if (!action.name || !action.role) return isEn ? '❌ Name and role required.' : '❌ Name und Rolle sind erforderlich.';
    const newId = uuid();
    const verbindungsTyp = action.connectionType || 'claude-code';
    const cfg = { model: action.model || 'claude-sonnet-4-6', autonomyLevel: action.autonomyLevel || 'autonomous' };
    db.insert(agents).values({
      id: newId, companyId,
      name: action.name, role: action.role,
      title: action.title || action.role,
      skills: action.skills || action.skills || null,
      verbindungsTyp, connectionConfig: JSON.stringify(cfg),
      status: 'idle',
      autoCycleActive: action.autoCycleActive !== false,
      autoCycleIntervalSec: action.autoCycleIntervalSec || 300,
      isOrchestrator: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).run();
    return isEn ? `✅ Agent *${action.name}* created (${action.role}) — ${verbindungsTyp}` : `✅ Agent *${action.name}* erstellt (${action.role}) — ${verbindungsTyp}`;
  }

  // ── delete_agent ──────────────────────────────────────────────────────────
  if (action.type === 'delete_agent') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    if (agent.isOrchestrator === true || agent.isOrchestrator === 1) {
      return isEn ? `❌ Cannot delete CEO/Orchestrator. Set another agent as orchestrator first.` : `❌ Kann CEO/Orchestrator nicht löschen. Bitte zuerst einen anderen als Orchestrator setzen.`;
    }
    db.delete(agents).where(eq(agents.id, agent.id)).run();
    return isEn ? `✅ Agent ${agent.name} deleted.` : `✅ Agent ${agent.name} gelöscht.`;
  }

  // ── create_task ───────────────────────────────────────────────────────────
  if (action.type === 'create_task') {
    if (!action.title) return isEn ? '❌ Title missing.' : '❌ Titel fehlt.';
    const agent = action.agentId ? findAgent(companyId, action.agentId) : null;
    const prio = (['critical','high','medium','low'].includes(action.priority) ? action.priority : 'medium');
    const taskId = uuid();
    db.insert(tasksTable).values({
      id: taskId, companyId, title: action.title,
      description: action.description || '', status: agent ? 'todo' : 'backlog',
      priority: prio, assignedTo: agent?.id || null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).run();
    return isEn ? `✅ Task created: \"${action.title}\"${agent ? ` → ${agent.name}` : ''}` : `✅ Task erstellt: \"${action.title}\"${agent ? ` → ${agent.name}` : ''}`;
  }

  // ── update_task ───────────────────────────────────────────────────────────
  if (action.type === 'update_task') {
    const task = findTask(companyId, action.taskId);
    if (!task) return (isEn ? `❌ Task "${action.taskId}" not found.` : `❌ Task "${action.taskId}" nicht gefunden.`);
    const updates: any = { updatedAt: new Date().toISOString() };
    if (action.status)    updates.status    = action.status;
    if (action.title)     updates.title     = action.title;
    if (action.priority && ['critical','high','medium','low'].includes(action.priority)) updates.priority = action.priority;
    if (action.agentId) {
      const agent = findAgent(companyId, action.agentId);
      if (agent) updates.assignedTo = agent.id;
    }
    db.update(tasksTable).set(updates).where(eq(tasksTable.id, task.id)).run();
    return isEn ? `✅ Task \"${task.title}\" updated.` : `✅ Task \"${task.title}\" aktualisiert.`;
  }

  // ── delete_task ───────────────────────────────────────────────────────────
  if (action.type === 'delete_task') {
    const task = findTask(companyId, action.taskId);
    if (!task) return (isEn ? `❌ Task "${action.taskId}" not found.` : `❌ Task "${action.taskId}" nicht gefunden.`);
    db.delete(tasksTable).where(eq(tasksTable.id, task.id)).run();
    return isEn ? `✅ Task \"${task.title}\" deleted.` : `✅ Task \"${task.title}\" gelöscht.`;
  }

  // ── create_project ────────────────────────────────────────────────────────
  if (action.type === 'create_project') {
    if (!action.name) return isEn ? '❌ Project name missing.' : '❌ Projektname fehlt.';
    try {
      const projectId = uuid();
      db.insert(projects as any).values({
        id: projectId, companyId,
        name: action.name,
        description: action.description || '',
        status: 'aktiv',
        priority: 'medium',
        progress: 0,
        color: '#c5a059',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }).run();
      return isEn ? `✅ Project \"${action.name}\" created.` : `✅ Projekt \"${action.name}\" erstellt.`;
    } catch (e: any) { return isEn ? `❌ Project creation failed: ${e?.message?.slice(0,80)}` : `❌ Projekt konnte nicht erstellt werden: ${e?.message?.slice(0,80)}`; }
  }

  // ── create_routine ────────────────────────────────────────────────────────
  if (action.type === 'create_routine') {
    if (!action.name) return isEn ? '❌ Routine name missing.' : '❌ Routinenname fehlt.';
    const agent = action.agentId ? findAgent(companyId, action.agentId) : null;
    const routineId = uuid();
    db.insert(routines).values({
      id: routineId, companyId,
      title: action.name,
      description: action.description || '',
      assignedTo: agent?.id || null,
      status: 'active',
      priority: 'medium',
      concurrencyPolicy: 'coalesce_if_active',
      catchUpPolicy: 'skip_missed',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any).run();
    return isEn ? `✅ Routine \"${action.name}\" created${agent ? ` → ${agent.name}` : ''}.` : `✅ Routine \"${action.name}\" erstellt${agent ? ` → ${agent.name}` : ''}.`;
  }

  // ── set_routine_status ────────────────────────────────────────────────────
  if (action.type === 'set_routine_status') {
    const allRoutines = db.select().from(routines).where(eq(routines.companyId, companyId)).all();
    const routine = (allRoutines as any[]).find(r => r.id.startsWith(action.routineId));
    if (!routine) return isEn ? `❌ Routine \"${action.routineId}\" not found.` : `❌ Routine \"${action.routineId}\" nicht gefunden.`;
    const newStatus = action.active !== false ? 'active' : 'paused';
    db.update(routines).set({ status: newStatus as any, updatedAt: new Date().toISOString() })
      .where(eq(routines.id, routine.id)).run();
    return isEn ? `✅ Routine \"${routine.title}\": ${action.active !== false ? 'activated' : 'paused'}` : `✅ Routine \"${routine.title}\": ${action.active !== false ? 'aktiviert' : 'pausiert'}`;
  }

  // ── save_setting ──────────────────────────────────────────────────────────
  if (action.type === 'save_setting') {
    if (!action.key || !action.value) return isEn ? '❌ Key or value missing.' : '❌ Key oder Value fehlt.';
    const ALLOWED_KEYS = [
      'openrouter_api_key', 'anthropic_api_key', 'openai_api_key',
      'ollama_base_url', 'telegram_bot_token', 'telegram_chat_id',
      'custom_api_base_url', 'custom_api_key', 'ui_language',
    ];
    if (!ALLOWED_KEYS.includes(action.key)) return isEn ? `❌ Key \"${action.key}\" not allowed.` : `❌ Key \"${action.key}\" nicht erlaubt.`;
    const encrypted = encryptSetting(action.key, action.value);
    const existing = db.select().from(settings)
      .where(and(eq(settings.key, action.key), eq(settings.companyId, companyId))).get();
    if (existing) {
      db.update(settings).set({ value: encrypted, updatedAt: new Date().toISOString() })
        .where(and(eq(settings.key, action.key), eq(settings.companyId, companyId))).run();
    } else {
      db.insert(settings).values({
        companyId, key: action.key, value: encrypted,
        updatedAt: new Date().toISOString(),
      }).run();
    }
    return isEn ? `✅ Setting \"${action.key}\" saved.` : `✅ Setting \"${action.key}\" gespeichert.`;
  }

  // ── set_company_workdir ───────────────────────────────────────────────────
  if (action.type === 'set_company_workdir') {
    if (!action.path) return (isEn ? '❌ path missing.' : '❌ Pfad fehlt.');
    db.update(companies as any)
      .set({ workDir: action.path, updatedAt: new Date().toISOString() } as any)
      .where(eq((companies as any).id, companyId)).run();
    return isEn ? `✅ Working directory set: \`${action.path}\`` : `✅ Arbeitsverzeichnis gesetzt: \`${action.path}\``;
  }

  // ── approve_genehmigung / reject_genehmigung ──────────────────────────────
  if (action.type === 'approve_genehmigung' || action.type === 'reject_genehmigung') {
    if (!action.genehmigungId) return (isEn ? '❌ approvalId missing.' : '❌ genehmigungId fehlt.');
    const all = db.select().from(approvalsTable).where(eq(approvalsTable.companyId, companyId)).all() as any[];
    const g = all.find(x => x.id === action.genehmigungId || x.id.startsWith(action.genehmigungId));
    if (!g) return (isEn ? `❌ Approval "${action.genehmigungId}" not found.` : `❌ Genehmigung "${action.genehmigungId}" nicht gefunden.`);
    if (g.status !== 'pending') return (isEn ? `⚠️ Approval already ${g.status}.` : `⚠️ Genehmigung bereits ${g.status}.`);
    const newStatus = action.type === 'approve_genehmigung' ? 'approved' : 'rejected';
    const now = new Date().toISOString();
    db.update(approvalsTable).set({
      status: newStatus,
      decisionNote: action.notiz || null,
      decidedAt: now,
      updatedAt: now,
    }).where(eq(approvalsTable.id, g.id)).run();
    return (isEn ? `${newStatus === 'approved' ? '✅ Approved' : '❌ Rejected'}: "${g.title}"` : `${newStatus === 'approved' ? '✅ Genehmigt' : '❌ Abgelehnt'}: "${g.title}"`);
  }

  // ── assign_skill / remove_skill ───────────────────────────────────────────
  if (action.type === 'assign_skill') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    const skills = db.select().from(skillsLibrary).where(eq(skillsLibrary.companyId, companyId)).all() as any[];
    const skill = skills.find(s =>
      s.id === action.skillId ||
      (action.skillId && s.id.startsWith(action.skillId)) ||
      (action.skillName && s.name.toLowerCase() === action.skillName.toLowerCase())
    );
    if (!skill) return (isEn ? `❌ Skill "${action.skillId || action.skillName}" not found.` : `❌ Skill "${action.skillId || action.skillName}" nicht gefunden.`);
    const existing = db.select().from(agentSkills)
      .where(and(eq(agentSkills.agentId, agent.id), eq(agentSkills.skillId, skill.id))).get();
    if (existing) return (isEn ? `⚠️ ${agent.name} already has "${skill.name}".` : `⚠️ ${agent.name} hat "${skill.name}" bereits.`);
    db.insert(agentSkills).values({
      id: uuid(), agentId: agent.id, skillId: skill.id, createdAt: new Date().toISOString(),
    }).run();
    return (isEn ? `✅ Skill "${skill.name}" → ${agent.name}` : `✅ Skill "${skill.name}" → ${agent.name}`);
  }

  if (action.type === 'remove_skill') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    const skills = db.select().from(skillsLibrary).all() as any[];
    const skill = skills.find(s =>
      s.id === action.skillId ||
      (action.skillId && s.id.startsWith(action.skillId)) ||
      (action.skillName && s.name.toLowerCase() === action.skillName.toLowerCase())
    );
    if (!skill) return (isEn ? `❌ Skill "${action.skillId || action.skillName}" not found.` : `❌ Skill "${action.skillId || action.skillName}" nicht gefunden.`);
    db.delete(agentSkills)
      .where(and(eq(agentSkills.agentId, agent.id), eq(agentSkills.skillId, skill.id))).run();
    return (isEn ? `🗑 Skill "${skill.name}" removed from ${agent.name}` : `🗑 Skill "${skill.name}" von ${agent.name} entfernt`);
  }

  // ── set_reports_to (Hierarchie / Organigram) ──────────────────────────────
  if (action.type === 'set_reports_to') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    let supervisorId: string | null = null;
    if (action.supervisorId === null || action.supervisorId === '') {
      supervisorId = null;
    } else if (action.supervisorId) {
      const sup = findAgent(companyId, action.supervisorId);
      if (!sup) return (isEn ? `❌ Supervisor "${action.supervisorId}" not found.` : `❌ Vorgesetzter "${action.supervisorId}" nicht gefunden.`);
      if (sup.id === agent.id) return (isEn ? `❌ ${agent.name} cannot be their own supervisor.` : `❌ ${agent.name} kann nicht sein eigener Vorgesetzter sein.`);
      supervisorId = sup.id;
    } else {
      return (isEn ? '❌ supervisorId missing (or explicitly set null).' : '❌ supervisorId fehlt (oder explizit null setzen).');
    }
    db.update(agents)
      .set({ reportsTo: supervisorId, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id)).run();
    return supervisorId
      ? `✅ ${agent.name} berichtet jetzt an ${(findAgent(companyId, supervisorId) as any)?.name}`
      : `✅ ${agent.name} ist jetzt autonom (kein Vorgesetzter)`;
  }

  // ── set_agent_budget ──────────────────────────────────────────────────────
  if (action.type === 'set_agent_budget') {
    const agent = findAgent(companyId, action.agentId);
    if (!agent) return (isEn ? `❌ Agent "${action.agentId}" not found.` : `❌ Agent "${action.agentId}" nicht gefunden.`);
    const cents = typeof action.monthlyBudgetCent === 'number'
      ? action.monthlyBudgetCent
      : (typeof action.budgetEuro === 'number' ? Math.round(action.budgetEuro * 100) : null);
    if (cents === null || cents < 0) return (isEn ? '❌ budgetMonatCent or budgetEuro missing/invalid.' : '❌ budgetMonatCent oder budgetEuro fehlt/ungültig.');
    db.update(agents)
      .set({ monthlyBudgetCent: cents, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id)).run();
    return (isEn ? `✅ Budget for ${agent.name}: ${(cents / 100).toFixed(2)} €/month` : `✅ Budget für ${agent.name}: ${(cents / 100).toFixed(2)} €/Monat`);
  }

  // ── create_goal / update_goal ─────────────────────────────────────────────
  if (action.type === 'create_goal') {
    if (!action.title) return (isEn ? '❌ title missing.' : '❌ titel fehlt.');
    const ownerId = action.eigentuemerId
      ? (findAgent(companyId, action.eigentuemerId) as any)?.id || null
      : null;
    const now = new Date().toISOString();
    const id = uuid();
    db.insert(goals).values({
      id, companyId,
      title: action.title,
      description: action.description || null,
      ebene: action.level || 'company',
      parentId: action.parentId || null,
      ownerAgentId: ownerId,
      status: 'planned',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    } as any).run();
    return isEn ? `🎯 Goal created: \"${action.title}\" (${id.slice(0, 6)})` : `🎯 Ziel angelegt: \"${action.title}\" (${id.slice(0, 6)})`;
  }

  if (action.type === 'update_goal') {
    if (!action.goalId) return (isEn ? '❌ goalId missing.' : '❌ goalId fehlt.');
    const all = db.select().from(goals).where(eq(goals.companyId, companyId)).all() as any[];
    const goal = all.find(g => g.id === action.goalId || g.id.startsWith(action.goalId));
    if (!goal) return (isEn ? `❌ Goal "${action.goalId}" not found.` : `❌ Ziel "${action.goalId}" nicht gefunden.`);
    const patch: any = { updatedAt: new Date().toISOString() };
    if (action.title) patch.title = action.title;
    if (action.description !== undefined) patch.description = action.description;
    if (action.status) patch.status = action.status;
    if (typeof action.progress === 'number') patch.progress = Math.max(0, Math.min(100, action.progress));
    db.update(goals).set(patch).where(eq(goals.id, goal.id)).run();
    return (isEn ? `✅ Goal "${goal.title}" updated` : `✅ Ziel "${goal.title}" aktualisiert`);
  }

  // ── create_meeting ────────────────────────────────────────────────────────
  if (action.type === 'create_meeting') {
    if (!action.title) return (isEn ? '❌ title missing.' : '❌ titel fehlt.');
    if (!Array.isArray(action.participantIds) || action.participantIds.length === 0) {
      return (isEn ? '❌ teilnehmerIds (array) missing.' : '❌ teilnehmerIds (Array) fehlt.');
    }
    const veranstalterRaw = action.veranstalterId || action.organizerId;
    const veranstalter = veranstalterRaw ? findAgent(companyId, veranstalterRaw) : null;
    if (!veranstalter) {
      const ceo = (db.select().from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.isOrchestrator as any, true as any))).get() as any);
      if (!ceo) return (isEn ? '❌ organizerId missing and no CEO fallback found.' : '❌ veranstalterId fehlt und kein CEO als Fallback gefunden.');
    }
    const resolved: string[] = [];
    for (const t of action.participantIds) {
      const a = findAgent(companyId, String(t));
      if (a) resolved.push(a.id);
    }
    if (resolved.length === 0) return (isEn ? '❌ No valid participants.' : '❌ Keine gültigen Teilnehmer.');
    const id = uuid();
    const now = new Date().toISOString();
    const ceo = (db.select().from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.isOrchestrator as any, true as any))).get() as any);
    db.insert(agentMeetings).values({
      id, companyId,
      title: action.title,
      organizerAgentId: veranstalter?.id || ceo?.id,
      participantIds: JSON.stringify(resolved),
      responses: '{}',
      status: 'running',
      result: null,
      createdAt: now,
      completedAt: null,
    } as any).run();
    return isEn ? `🗓 Meeting \"${action.title}\" created (${id.slice(0, 6)}) — ${resolved.length} participants` : `🗓 Meeting \"${action.title}\" erstellt (${id.slice(0, 6)}) — ${resolved.length} Teilnehmer`;
  }

  // ── complete_meeting ──────────────────────────────────────────────────────
  if (action.type === 'complete_meeting') {
    if (!action.meetingId) return (isEn ? '❌ meetingId missing.' : '❌ meetingId fehlt.');
    const all = db.select().from(agentMeetings).where(eq(agentMeetings.companyId, companyId)).all() as any[];
    const m = all.find(x => x.id === action.meetingId || x.id.startsWith(action.meetingId));
    if (!m) return (isEn ? `❌ Meeting "${action.meetingId}" not found.` : `❌ Meeting "${action.meetingId}" nicht gefunden.`);
    db.update(agentMeetings).set({
      status: action.status === 'cancelled' ? 'cancelled' : 'completed',
      result: action.result || null,
      completedAt: new Date().toISOString(),
    } as any).where(eq(agentMeetings.id, m.id)).run();
    return (isEn ? `✅ Meeting "${m.title}" ${action.status === 'cancelled' ? 'cancelled' : 'completed'}` : `✅ Meeting "${m.title}" ${action.status === 'cancelled' ? 'abgesagt' : 'abgeschlossen'}`);
  }

  // ── create_company / update_company / archive_company ─────────────────────
  if (action.type === 'create_company') {
    if (!action.name) return (isEn ? '❌ name missing.' : '❌ name fehlt.');
    const id = uuid();
    const now = new Date().toISOString();
    db.insert(companies).values({
      id, name: action.name,
      description: action.description || null,
      goal: action.goal || null,
      workDir: action.workDir || null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    } as any).run();
    return isEn ? `🏢 Company \"${action.name}\" created (${id.slice(0, 8)}). Switch to it in the UI to manage.` : `🏢 Unternehmen \"${action.name}\" angelegt (${id.slice(0, 8)}). Wechsle in der UI dorthin um es zu verwalten.`;
  }

  if (action.type === 'update_company') {
    const patch: any = { updatedAt: new Date().toISOString() };
    if (action.name) patch.name = action.name;
    if (action.description !== undefined) patch.description = action.description;
    if (action.goal !== undefined) patch.goal = action.goal;
    if (action.workDir !== undefined) patch.workDir = action.workDir;
    db.update(companies).set(patch).where(eq((companies as any).id, companyId)).run();
    return (isEn ? `✅ Company updated` : `✅ Unternehmen aktualisiert`);
  }

  if (action.type === 'archive_company') {
    db.update(companies).set({
      status: 'archived',
      updatedAt: new Date().toISOString(),
    } as any).where(eq((companies as any).id, companyId)).run();
    return (isEn ? `📦 Company archived` : `📦 Unternehmen archiviert`);
  }

  // ── weekly_report_summary ─────────────────────────────────────────────────
  if (action.type === 'weekly_report_summary') {
    const lang = action.lang === 'de' || action.lang === 'en' ? action.lang : getUiLanguage(companyId);
    const isEn = lang === 'en';

    const now = new Date();
    const dow = now.getDay();
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysFromMon);
    weekStart.setHours(0, 0, 0, 0);
    const wsISO = weekStart.toISOString();

    const taskRows = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).all() as any[];
    const created = taskRows.filter(t => t.createdAt >= wsISO).length;
    const completed = taskRows.filter(t => t.status === 'done' && t.completedAt && t.completedAt >= wsISO);
    const blocked = taskRows.filter(t => t.status === 'blocked').length;
    const inProgress = taskRows.filter(t => t.status === 'in_progress').length;

    const costs = db.select().from(costEntries)
      .where(and(eq(costEntries.companyId, companyId), gte(costEntries.timestamp, wsISO)))
      .all() as any[];
    const costCent = costs.reduce((s, k) => s + (k.costCent || 0), 0);

    const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all() as any[];
    const perAgent = agentRows.map(a => ({
      name: a.name,
      done: completed.filter(t => t.assignedTo === a.id).length,
    })).filter(x => x.done > 0).sort((a, b) => b.done - a.done).slice(0, 5);

    const goalsActive = (db.select().from(goals)
      .where(and(eq(goals.companyId, companyId), eq(goals.status, 'active'))).all() as any[])
      .slice(0, 5);

    const dateStr = weekStart.toLocaleDateString(isEn ? 'en-US' : 'de-DE', { day: '2-digit', month: '2-digit' });
    const currency = isEn ? '$' : '€';
    const lines = isEn ? [
      `📊 **Weekly Report** (week of ${dateStr})`,
      ``,
      `**Tasks**: ${completed.length} done · ${created} new · ${inProgress} in progress · ${blocked} blocked`,
      `**Costs**: ${currency}${(costCent / 100).toFixed(2)}`,
      ``,
      `**Top agents**:`,
      ...(perAgent.length ? perAgent.map(p => `  • ${p.name} — ${p.done} tasks`) : ['  (no completions this week)']),
      ``,
      `**Active goals**:`,
      ...(goalsActive.length ? goalsActive.map(g => `  • ${g.title} (${g.progress}%)`) : ['  (no active goals)']),
    ] : [
      `📊 **Wochenbericht** (KW seit ${dateStr})`,
      ``,
      `**Tasks**: ${completed.length} erledigt · ${created} neu · ${inProgress} laufend · ${blocked} blockiert`,
      `**Kosten**: ${(costCent / 100).toFixed(2)} ${currency}`,
      ``,
      `**Top-Agenten**:`,
      ...(perAgent.length ? perAgent.map(p => `  • ${p.name} — ${p.done} Tasks`) : ['  (niemand mit Erfolgen diese Woche)']),
      ``,
      `**Aktive Ziele**:`,
      ...(goalsActive.length ? goalsActive.map(g => `  • ${g.title} (${g.progress}%)`) : ['  (keine aktiven Ziele)']),
    ];
    return lines.join('\n');
  }

  return null;
}

// ─── Language helpers ─────────────────────────────────────────────────────────

export function getUiLanguage(companyId: string): 'de' | 'en' {
  try {
    // Company-specific first, then global (''), then fallback
    const row = db.select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, 'ui_language'), eq(settings.companyId, companyId)))
      .get()
      ?? db.select({ value: settings.value })
        .from(settings)
        .where(and(eq(settings.key, 'ui_language'), eq(settings.companyId, '')))
        .get();
    if (row?.value) {
      const lang = decryptSetting('ui_language', row.value);
      if (lang === 'en' || lang === 'de') return lang;
    }
  } catch {}
  // No setting saved yet — default to English (matches frontend browser-detection default)
  return 'en';
}

export function langLine(lang: 'de' | 'en'): string {
  return lang === 'en'
    ? 'Respond in English. Keep your answers concise (max 3-4 sentences for Telegram).'
    : 'Antworte auf Deutsch. Kurze Antworten (max 3-4 Sätze für Telegram).';
}

// ─── In-memory state ──────────────────────────────────────────────────────────

const offsets = new Map<string, number>();
const conversationHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
// Tracks last-access timestamp per conversation key for true LRU eviction
const conversationLastAccess = new Map<string, number>();

function pruneConversationHistory() {
  if (conversationHistory.size > 300) {
    // Sort by last-access time, evict the least recently accessed half
    const sorted = [...conversationLastAccess.entries()].sort((a, b) => a[1] - b[1]);
    const toDelete = Math.floor(conversationHistory.size / 2);
    for (let i = 0; i < toDelete; i++) {
      conversationHistory.delete(sorted[i][0]);
      conversationLastAccess.delete(sorted[i][0]);
    }
  }
}

let isPolling = false;
let pollTimeout: NodeJS.Timeout | null = null;
let pollController: AbortController | null = null;
const registeredBotCommands = new Set<string>(); // tokens that already had setMyCommands called
const invalidTokens = new Set<string>(); // tokens that returned 401 — skip until cleared

// ─── Types ────────────────────────────────────────────────────────────────────

interface BotConfig { token: string; chatId: string; }
type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function tgPost(token: string, method: string, body: object) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[Telegram] ${method} failed ${res.status}: ${err.slice(0, 120)}`);
    }
    return res;
  } catch (e) {
    console.error(`[Telegram] ${method} error:`, e);
  }
}

async function sendMsg(token: string, chatId: string | number, text: string, keyboard?: InlineKeyboard) {
  const body: any = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  const res = await tgPost(token, 'sendMessage', body);
  // Telegram rejects invalid Markdown (unbalanced *, _, `, []) with 400 — retry as plain text
  if (res && !res.ok) {
    const plain: any = { chat_id: chatId, text };
    if (keyboard) plain.reply_markup = { inline_keyboard: keyboard };
    return tgPost(token, 'sendMessage', plain);
  }
  return res;
}

async function editMsg(token: string, chatId: string | number, messageId: number, text: string, keyboard?: InlineKeyboard) {
  const body: any = { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  else body.reply_markup = { inline_keyboard: [] };
  return tgPost(token, 'editMessageText', body);
}

async function answerCbq(token: string, callbackQueryId: string, text?: string) {
  return tgPost(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function progressBar(pct: number, width = 10): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function prioEmoji(p: string) {
  return p === 'hoch' || p === 'high' ? '🔴' : p === 'mittel' || p === 'medium' ? '🟡' : '🟢';
}

function shortId(id: string) { return id.slice(0, 6); }

// ─── Company config lookup ────────────────────────────────────────────────────

function getBotConfig(companyId: string): BotConfig | null {
  const all = db.select().from(settings).all();
  const get = (key: string) =>
    all.find(s => s.key === key && s.companyId === companyId) ||
    all.find(s => s.key === key && (!s.companyId || s.companyId === ''));

  const tokenEntry = get('telegram_bot_token');
  const chatEntry  = get('telegram_chat_id');
  if (!tokenEntry?.value || !chatEntry?.value) return null;

  const token = decryptSetting('telegram_bot_token', tokenEntry.value);
  if (!token) return null;
  return { token, chatId: chatEntry.value };
}

// ─── Telegram rate limiter (GLOBAL) ─────────────────────────────────────────
// Prevents spam when a provider (e.g. Poe) is down and every heartbeat cycle
// produces the same error for dozens of tasks.
// Uses globalThis so it survives across module reloads in the same process.
const G = globalThis as any;
G.__ocTelegramRateLimit ??= new Map<string, number>();
const _telegramRateLimit = G.__ocTelegramRateLimit as Map<string, number>;
const TELEGRAM_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function isErrorLikeText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('🔴') || lower.includes('🟠') || lower.includes('⚠️') || lower.includes('⚠') ||
    lower.includes('fehler') || lower.includes('fehlgeschlagen') || lower.includes('eskalation') ||
    lower.includes('error') || lower.includes('failed') || lower.includes('escalation');
}

function shouldSendTelegram(companyId: string, text: string): boolean {
  if (!isErrorLikeText(text)) return true;
  const key = `${companyId}:__error_any__`;
  const nowTs = Date.now();
  const last = _telegramRateLimit.get(key) ?? 0;
  if (nowTs - last < TELEGRAM_COOLDOWN_MS) {
    console.log(`[TelegramRateLimit] BLOCKED for ${companyId} (last sent ${Math.round((nowTs - last) / 1000)}s ago)`);
    return false;
  }
  _telegramRateLimit.set(key, nowTs);
  console.log(`[TelegramRateLimit] ALLOWED for ${companyId}`);
  return true;
}

// ─── Main service ─────────────────────────────────────────────────────────────

export const messagingService = {

  // ── Public send (used by the rest of the app) ──────────────────────────────

  async sendTelegram(companyId: string, text: string, keyboard?: InlineKeyboard) {
    if (!shouldSendTelegram(companyId, text)) return;
    try {
      const cfg = getBotConfig(companyId);
      if (!cfg) return;
      if (invalidTokens.has(cfg.token)) return; // don't spam with a bad token
      await sendMsg(cfg.token, cfg.chatId, text, keyboard);
    } catch (e) {
      console.error(`[Telegram] sendTelegram error (${companyId}):`, e);
    }
  },

  async sendDiscord(companyId: string, text: string) {
    try {
      // Find configured Discord channel
      const setting = db.select().from(settings)
        .where(and(
          eq(settings.key, 'discord_default_channel'),
          eq(settings.companyId, companyId)
        ))
        .get();
      if (!setting?.value) return;
      await discordBotService.sendMessage(companyId, setting.value, text);
    } catch (e) {
      console.error(`[Discord] sendDiscord error (${companyId}):`, e);
    }
  },

  // ── Command handler ────────────────────────────────────────────────────────

  async handleCommand(companyId: string, chatId: string, token: string, text: string): Promise<boolean> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    // ── /start · /help ──────────────────────────────────────────────────────
    if (cmd === '/start' || cmd === '/help') {
      await sendMsg(token, chatId,
        `🧠 *OpenCognit — Mobile Interface*\n\n` +
        `*Navigation*\n` +
        `/status — System-Überblick\n` +
        `/tasks — Offene Aufgaben\n` +
        `/agents — Dein Team\n` +
        `/approvals — Genehmigungen\n` +
        `/goals — OKR-Ziele\n` +
        `/costs — Kosten-Überblick\n` +
        `/report — Wochenbericht\n\n` +
        `*Aktionen*\n` +
        `/new <Titel> — Neue Aufgabe\n` +
        `/done <ID> — Task abschließen\n` +
        `/wake <Agent> — Agent aufwecken\n` +
        `/approve <ID> — Genehmigen\n` +
        `/reject <ID> — Ablehnen\n\n` +
        `*Chat*\n` +
        `@Name <Frage> — Mit Agent chatten\n` +
        `Freier Text — CEO antwortet`,
        [[
          { text: '📊 Status', callback_data: 'mn:status' },
          { text: '📋 Tasks', callback_data: 'mn:tasks' },
          { text: '⚖️ Approvals', callback_data: 'mn:approvals' },
        ]]
      );
      return true;
    }

    // ── /status ─────────────────────────────────────────────────────────────
    if (cmd === '/status') {
      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
      const active    = agentRows.filter((a: any) => a.status === 'active' || a.status === 'busy');
      const allTaskRows = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).all();
      const inProg    = allTaskRows.filter((t: any) => t.status === 'in_progress');
      const todo      = allTaskRows.filter((t: any) => t.status === 'todo');
      const done      = allTaskRows.filter((t: any) => t.status === 'done');
      const pending   = db.select().from(approvalsTable)
        .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending'))).all();
      const traces    = db.select().from(traceEvents)
        .where(eq(traceEvents.companyId, companyId))
        .orderBy(desc(traceEvents.createdAt)).limit(4).all();
      const comp      = db.select().from(companies).where(eq(companies.id, companyId)).get();

      let msg = `📊 *${comp?.name || 'OpenCognit'}*\n\n`;
      msg += `🤖 Team: ${agentRows.length} Agenten (${active.length} aktiv)\n`;
      msg += `🏗️ Laufend: ${inProg.length}  📋 Todo: ${todo.length}  ✅ Erledigt: ${done.length}\n`;
      if (pending.length > 0) msg += `⚖️ *${pending.length} Genehmigung${pending.length > 1 ? 'en' : ''} offen!*\n`;
      if (traces.length > 0) {
        msg += `\n📜 *Letzte Aktivitäten*\n`;
        traces.forEach((t: any) => { msg += `  · ${t.title}\n`; });
      }

      const keyboard: InlineKeyboard = [
        [
          { text: '📋 Tasks', callback_data: 'mn:tasks' },
          { text: '🤖 Agenten', callback_data: 'mn:agents' },
        ],
        ...(pending.length > 0 ? [[{ text: `⚖️ ${pending.length} Genehmigung${pending.length > 1 ? 'en' : ''}`, callback_data: 'mn:approvals' }]] : []),
      ];
      await sendMsg(token, chatId, msg, keyboard);
      return true;
    }

    // ── /tasks ───────────────────────────────────────────────────────────────
    if (cmd === '/tasks') {
      const taskRows = db.select().from(tasksTable)
        .where(and(eq(tasksTable.companyId, companyId), eq(tasksTable.status, 'todo')))
        .orderBy(desc(tasksTable.createdAt)).limit(8).all();
      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();

      if (taskRows.length === 0) {
        await sendMsg(token, chatId, '📋 Keine offenen Aufgaben. 🎉');
        return true;
      }

      let msg = `📋 *Offene Aufgaben (${taskRows.length})*\n\n`;
      const keyboard: InlineKeyboard = [];

      (taskRows as any[]).forEach(t => {
        const assignee = agentRows.find((a: any) => a.id === t.assignedTo)?.name || '—';
        msg += `${prioEmoji(t.priority)} \`${shortId(t.id)}\` *${t.title}*\n`;
        msg += `   👤 ${assignee}\n`;
        keyboard.push([
          { text: `✅ ${t.title.slice(0, 20)}`, callback_data: `dn:${shortId(t.id)}` },
        ]);
      });

      await sendMsg(token, chatId, msg, keyboard);
      return true;
    }

    // ── /approvals ───────────────────────────────────────────────────────────
    if (cmd === '/approvals') {
      const approvalRows = db.select().from(approvalsTable)
        .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending')))
        .limit(5).all();

      if (approvalRows.length === 0) {
        await sendMsg(token, chatId, '✅ Keine offenen Genehmigungen.');
        return true;
      }

      let msg = `⚖️ *Offene Genehmigungen (${approvalRows.length})*\n\n`;
      const keyboard: InlineKeyboard = [];

      (approvalRows as any[]).forEach(a => {
        msg += `\`${shortId(a.id)}\` *${a.title}*\n`;
        if (a.description) msg += `_${a.description.slice(0, 80)}_\n`;
        msg += `\n`;
        keyboard.push([
          { text: `✅ Genehmigen`, callback_data: `ap:${shortId(a.id)}` },
          { text: `❌ Ablehnen`,   callback_data: `rj:${shortId(a.id)}` },
        ]);
      });

      await sendMsg(token, chatId, msg, keyboard);
      return true;
    }

    // ── /agents ──────────────────────────────────────────────────────────────
    if (cmd === '/agents') {
      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
      if (agentRows.length === 0) {
        await sendMsg(token, chatId, '🤖 Noch keine Agenten vorhanden.');
        return true;
      }

      let msg = `🤖 *Dein Team (${agentRows.length})*\n\n`;
      const keyboard: InlineKeyboard = [];

      (agentRows as any[]).forEach(a => {
        const s = a.status === 'active' ? '🟢' : a.status === 'busy' ? '🟡' : '⚫';
        msg += `${s} *${a.name}* — ${a.role}\n`;
        keyboard.push([
          { text: `⚡ ${a.name} wecken`, callback_data: `wk:${a.id.slice(0, 8)}` },
        ]);
      });

      msg += `\n_Schreib @Name um direkt zu chatten._`;
      await sendMsg(token, chatId, msg, keyboard);
      return true;
    }

    // ── /goals ───────────────────────────────────────────────────────────────
    if (cmd === '/goals') {
      const goalRows = db.select().from(goals)
        .where(and(eq(goals.companyId, companyId), eq(goals.status, 'active')))
        .orderBy(desc((goals as any).progress)).limit(8).all();

      if (goalRows.length === 0) {
        await sendMsg(token, chatId, '🎯 Keine aktiven Ziele. Erstell welche im Dashboard.');
        return true;
      }

      let msg = `🎯 *Aktive Ziele*\n\n`;
      (goalRows as any[]).forEach(g => {
        const bar = progressBar(g.progress || 0);
        const pct = g.progress || 0;
        const lvl = g.level === 'company' ? '🏢' : g.level === 'team' ? '👥' : g.level === 'agent' ? '🤖' : '📋';
        msg += `${lvl} *${g.title}*\n`;
        msg += `\`${bar}\` ${pct}%\n\n`;
      });

      await sendMsg(token, chatId, msg);
      return true;
    }

    // ── /costs ───────────────────────────────────────────────────────────────
    if (cmd === '/costs') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const allCosts = db.select().from(costEntries)
        .where(and(eq(costEntries.companyId, companyId), gte(costEntries.timestamp, monthAgo)))
        .all();

      const weekCosts = allCosts.filter((c: any) => c.timestamp >= weekAgo);
      const monthTotal = allCosts.reduce((sum: number, c: any) => sum + (c.costCent || 0), 0);
      const weekTotal  = weekCosts.reduce((sum: number, c: any) => sum + (c.costCent || 0), 0);

      // Per-agent breakdown (last 30d)
      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
      const perAgent: Record<string, number> = {};
      allCosts.forEach((c: any) => { perAgent[c.agentId] = (perAgent[c.agentId] || 0) + (c.costCent || 0); });

      let msg = `💰 *Kosten-Überblick*\n\n`;
      msg += `Diese Woche: *$${(weekTotal / 100).toFixed(3)}*\n`;
      msg += `Letzter Monat: *$${(monthTotal / 100).toFixed(3)}*\n\n`;

      if (Object.keys(perAgent).length > 0) {
        msg += `*Aufschlüsselung nach Agent (30d):*\n`;
        const sorted = Object.entries(perAgent).sort(([, a], [, b]) => b - a).slice(0, 6);
        sorted.forEach(([agentId, cents]) => {
          const name = (agentRows as any[]).find((a: any) => a.id === agentId)?.name || agentId.slice(0, 8);
          msg += `  · ${name}: $${(cents / 100).toFixed(3)}\n`;
        });
      }

      await sendMsg(token, chatId, msg);
      return true;
    }

    // ── /report ──────────────────────────────────────────────────────────────
    if (cmd === '/report') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const allTaskRows = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).all();
      const agentRows   = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
      const goalRows    = db.select().from(goals).where(and(eq(goals.companyId, companyId), eq(goals.status, 'active'))).all();
      const weekCosts = db.select().from(costEntries)
        .where(and(eq(costEntries.companyId, companyId), gte(costEntries.timestamp, weekAgo))).all();

      const doneTasks = allTaskRows.filter((t: any) => t.status === 'done' && t.updatedAt >= weekAgo);
      const openTasks = allTaskRows.filter((t: any) => t.status === 'todo' || t.status === 'in_progress');
      const totalCost = weekCosts.reduce((s: number, c: any) => s + (c.costCent || 0), 0);

      // Top agent by tasks done
      const agentDone: Record<string, number> = {};
      doneTasks.forEach((t: any) => { if (t.assignedTo) agentDone[t.assignedTo] = (agentDone[t.assignedTo] || 0) + 1; });
      const topAgentId = Object.entries(agentDone).sort(([,a],[,b]) => b-a)[0]?.[0];
      const topAgent = (agentRows as any[]).find((a: any) => a.id === topAgentId)?.name;

      const now = new Date();
      const week = `KW ${Math.ceil(now.getDate() / 7)} · ${now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;

      let msg = `📈 *Wochenbericht — ${week}*\n\n`;
      msg += `✅ Erledigt: *${doneTasks.length} Tasks*\n`;
      msg += `📋 Offen: *${openTasks.length} Tasks*\n`;
      msg += `💰 KI-Kosten: *$${(totalCost / 100).toFixed(3)}*\n`;
      if (topAgent) msg += `🏆 Top-Agent: *${topAgent}* (${agentDone[topAgentId!]} Tasks)\n`;
      msg += `🎯 Aktive Ziele: *${goalRows.length}*\n`;

      if (goalRows.length > 0) {
        msg += `\n*Ziel-Fortschritt:*\n`;
        (goalRows as any[]).slice(0, 3).forEach(g => {
          msg += `  · ${g.title}: ${progressBar(g.progress || 0, 8)} ${g.progress || 0}%\n`;
        });
      }

      await sendMsg(token, chatId, msg);
      return true;
    }

    // ── /wake ────────────────────────────────────────────────────────────────
    if (cmd === '/wake') {
      const query = parts.slice(1).join(' ').toLowerCase();
      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();

      if (!query) {
        // Show all agents with wake buttons
        let msg = `⚡ *Wen aufwecken?*\n`;
        const keyboard: InlineKeyboard = (agentRows as any[]).map(a => ([
          { text: `⚡ ${a.name}`, callback_data: `wk:${a.id.slice(0, 8)}` }
        ]));
        await sendMsg(token, chatId, msg, keyboard);
        return true;
      }

      const agent = (agentRows as any[]).find((a: any) =>
        a.name.toLowerCase().includes(query) || a.role.toLowerCase().includes(query)
      );
      if (!agent) {
        await sendMsg(token, chatId, (isEn ? `❌ Agent "${query}" not found.` : `❌ Agent "${query}" nicht gefunden.`));
        return true;
      }

      scheduler.triggerZyklus(agent.id, companyId, 'telegram').catch(console.error);
      await sendMsg(token, chatId, `⚡ *${agent.name}* aufgeweckt!`);
      return true;
    }

    // ── /done ────────────────────────────────────────────────────────────────
    if (cmd === '/done') {
      const idPrefix = parts[1]?.trim();
      if (!idPrefix) {
        await sendMsg(token, chatId, '❌ ID fehlt. Beispiel: `/done abc123`');
        return true;
      }
      const all = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).all();
      const task = (all as any[]).find((t: any) => t.id.startsWith(idPrefix));
      if (!task) {
        await sendMsg(token, chatId, `❌ Task \`${idPrefix}\` nicht gefunden.`);
        return true;
      }
      db.update(tasksTable).set({ status: 'done', updatedAt: new Date().toISOString() })
        .where(eq(tasksTable.id, task.id)).run();
      await sendMsg(token, chatId, `✅ *"${task.title}"* abgeschlossen!`);
      return true;
    }

    // ── /new ─────────────────────────────────────────────────────────────────
    if (cmd === '/new') {
      const titel = text.slice('/new'.length).trim();
      if (!titel) {
        await sendMsg(token, chatId, '❌ Bitte Titel angeben: `/new Meine Aufgabe`');
        return true;
      }
      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
      const ceo = (agentRows as any[]).find(a =>
        a.isOrchestrator === true || a.isOrchestrator === 1 ||
        a.connectionType === 'ceo' ||
        /ceo|manager|geschäftsführer/i.test(a.role)
      ) || agentRows[0];

      const newTask = {
        id: uuid(), companyId, title: titel,
        description: `Erstellt via Telegram von Chat-ID ${chatId}`,
        status: 'todo' as const, priority: 'medium' as const,
        assignedTo: ceo?.id || null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      db.insert(tasksTable).values(newTask).run();
      await sendMsg(token, chatId,
        `✅ *Task erstellt:* "${titel}"\n\`${shortId(newTask.id)}\`${ceo ? ` → ${ceo.name}` : ''}`,
        [[{ text: '✅ Sofort erledigen', callback_data: `dn:${shortId(newTask.id)}` }]]
      );
      return true;
    }

    // ── /approve · /reject (text fallback) ───────────────────────────────────
    if (cmd === '/approve' || cmd === '/reject') {
      const idPrefix = parts[1]?.trim();
      if (!idPrefix) {
        await sendMsg(token, chatId, `❌ ID fehlt. Beispiel: \`/${cmd.slice(1)} abc123\``);
        return true;
      }
      const all = db.select().from(approvalsTable)
        .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending'))).all();
      const approval = (all as any[]).find(a => a.id.startsWith(idPrefix));
      if (!approval) {
        await sendMsg(token, chatId, `❌ Genehmigung \`${idPrefix}\` nicht gefunden.`);
        return true;
      }
      const newStatus = cmd === '/approve' ? 'approved' : 'rejected';
      db.update(approvalsTable).set({ status: newStatus, updatedAt: new Date().toISOString() })
        .where(eq(approvalsTable.id, approval.id)).run();
      appEvents.emit('broadcast', {
        type: 'approval_updated',
        data: { companyId, id: approval.id, title: approval.title, status: newStatus },
      });
      await sendMsg(token, chatId,
        `${cmd === '/approve' ? '✅ Genehmigt' : '❌ Abgelehnt'}: *${approval.title}*`
      );
      return true;
    }

    // ── /me ──────────────────────────────────────────────────────────────────
    if (cmd === '/me') {
      const comp = db.select().from(companies).where(eq(companies.id, companyId)).get();
      await sendMsg(token, chatId,
        `👤 *Verbindungsinfos*\n\nTelegram Chat-ID: \`${chatId}\`\nUnternehmen: *${(comp as any)?.name || companyId}*\nID: \`${companyId}\``
      );
      return true;
    }

    return false;
  },

  // ── Callback query handler (inline button presses) ─────────────────────────

  async handleCallbackQuery(
    companyId: string,
    token: string,
    chatId: string,
    messageId: number,
    callbackQueryId: string,
    data: string
  ) {
    const [action, payload] = data.split(':');

    // Menu navigation
    if (action === 'mn') {
      await answerCbq(token, callbackQueryId);
      await this.handleCommand(companyId, chatId, token, `/${payload}`);
      return;
    }

    // Approve
    if (action === 'ap') {
      const all = db.select().from(approvalsTable)
        .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending'))).all();
      const approval = (all as any[]).find(a => a.id.startsWith(payload));
      if (!approval) { await answerCbq(token, callbackQueryId, '❌ Nicht gefunden'); return; }
      db.update(approvalsTable).set({ status: 'approved', updatedAt: new Date().toISOString() })
        .where(eq(approvalsTable.id, approval.id)).run();
      appEvents.emit('broadcast', {
        type: 'approval_updated',
        data: { companyId, id: approval.id, title: approval.title, status: 'approved' },
      });
      await answerCbq(token, callbackQueryId, '✅ Genehmigt!');
      await editMsg(token, chatId, messageId, `✅ *Genehmigt:* ${approval.title}`);
      return;
    }

    // Reject
    if (action === 'rj') {
      const all = db.select().from(approvalsTable)
        .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending'))).all();
      const approval = (all as any[]).find(a => a.id.startsWith(payload));
      if (!approval) { await answerCbq(token, callbackQueryId, '❌ Nicht gefunden'); return; }
      db.update(approvalsTable).set({ status: 'rejected', updatedAt: new Date().toISOString() })
        .where(eq(approvalsTable.id, approval.id)).run();
      appEvents.emit('broadcast', {
        type: 'approval_updated',
        data: { companyId, id: approval.id, title: approval.title, status: 'rejected' },
      });
      await answerCbq(token, callbackQueryId, '❌ Abgelehnt');
      await editMsg(token, chatId, messageId, `❌ *Abgelehnt:* ${approval.title}`);
      return;
    }

    // Done (task)
    if (action === 'dn') {
      const all = db.select().from(tasksTable).where(eq(tasksTable.companyId, companyId)).all();
      const task = (all as any[]).find(t => t.id.startsWith(payload));
      if (!task) { await answerCbq(token, callbackQueryId, '❌ Task nicht gefunden'); return; }
      db.update(tasksTable).set({ status: 'done', updatedAt: new Date().toISOString() })
        .where(eq(tasksTable.id, task.id)).run();
      await answerCbq(token, callbackQueryId, '✅ Erledigt!');
      await editMsg(token, chatId, messageId, `✅ *Erledigt:* ${task.title}`);
      return;
    }

    // Wake agent
    if (action === 'wk') {
      const agent = db.select().from(agents)
        .where(and(eq(agents.companyId, companyId))).all()
        .find((a: any) => a.id.startsWith(payload));
      if (!agent) { await answerCbq(token, callbackQueryId, '❌ Agent nicht gefunden'); return; }
      scheduler.triggerZyklus((agent as any).id, companyId, 'telegram').catch(console.error);
      await answerCbq(token, callbackQueryId, `⚡ ${(agent as any).name} aufgeweckt!`);
      await editMsg(token, chatId, messageId, `⚡ *${(agent as any).name}* wurde aufgeweckt und bearbeitet seine Inbox.`);
      return;
    }

    await answerCbq(token, callbackQueryId);
  },

  // ── Inbound message router ─────────────────────────────────────────────────

  async handleInboundMessage(companyId: string, message: any, token: string) {
    if (!message?.text) return;
    const chatId = String(message.chat.id);
    const text   = message.text;

    // Fast-path commands
    const isCmd = await this.handleCommand(companyId, chatId, token, text);
    if (isCmd) return;

    // Auto-pair chat ID
    const existing = db.select().from(settings)
      .where(and(eq(settings.key, 'telegram_chat_id'), eq(settings.companyId, companyId)))
      .get();

    if (!existing) {
      try {
        db.insert(settings).values({
          companyId, key: 'telegram_chat_id',
          value: chatId, updatedAt: new Date().toISOString(),
        }).run();
      } catch {}
      await sendMsg(token, chatId,
        `👋 Chat verbunden! Chat-ID \`${chatId}\` automatisch gespeichert.\n\nSchreib einfach los oder nutze /help.`
      );
    }

    // LLM chat
    try {
      // Show typing indicator while LLM is processing
      tgPost(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

      const agentRows = db.select().from(agents).where(eq(agents.companyId, companyId)).all();

      // @AgentName routing
      let targetAgent: any = null;
      let messageText = text;
      const atMatch = text.match(/^@(\S+)\s*([\s\S]*)/);
      if (atMatch) {
        const name = atMatch[1].toLowerCase();
        targetAgent = (agentRows as any[]).find((a: any) => {
          const normalized = a.name.toLowerCase().replace(/\s+/g, '');
          const words = a.name.toLowerCase().split(/\s+/);
          return (
            normalized === name ||                    // exact: @DevAgent
            normalized.startsWith(name) ||            // prefix no-space: @Dev → DevAgent
            words.some((w: string) => w === name) || // exact word: @Dev → "Dev Agent"
            words.some((w: string) => w.startsWith(name)) || // word prefix: @De → "Dev Agent"
            a.role.toLowerCase().replace(/\s+/g, '').startsWith(name) // role: @ceo
          );
        });
        if (targetAgent) messageText = atMatch[2].trim() || text;
      }

      const ceo = (agentRows as any[]).find((a: any) =>
        a.isOrchestrator === true || a.isOrchestrator === 1 ||
        a.connectionType === 'ceo' ||
        /ceo|manager|geschäftsführer/i.test(a.role)
      ) || agentRows[0];

      const respondingAgent = targetAgent || ceo;

      if (respondingAgent) {
        db.insert(chatMessages).values({
          id: uuid(), companyId, agentId: respondingAgent.id,
          senderType: 'board', message: `[Telegram] ${text}`,
          read: true, createdAt: new Date().toISOString(),
        }).run();
      }

      // Keep typing indicator alive every 4s (Telegram clears it after 5s)
      const typingInterval = setInterval(() => {
        tgPost(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      }, 4000);

      let reply: string;
      try {
        reply = await this.chatWithLLM(companyId, chatId, messageText, targetAgent);
      } finally {
        clearInterval(typingInterval);
      }

      if (respondingAgent) {
        const replyMsg = {
          id: uuid(), companyId, expertId: respondingAgent.id,
          absenderTyp: 'agent' as const, absenderName: respondingAgent.name || 'Agent',
          nachricht: reply, gelesen: false, erstelltAm: new Date().toISOString(),
        };
        db.insert(chatMessages).values(replyMsg).run();
        appEvents.emit('broadcast', { type: 'chat_message', data: replyMsg });
      }

      await sendMsg(token, chatId, reply);
    } catch (err) {
      console.error('[Telegram] Inbound chat error:', err);
      await sendMsg(token, chatId, '⚠️ Fehler bei der Verarbeitung. Versuch es nochmal.');
    }
  },

  // ── LLM chat ──────────────────────────────────────────────────────────────

  async chatWithLLM(companyId: string, chatId: string, userMessage: string, targetAgent: any = null): Promise<string> {
    const company = db.select().from(companies).where(eq(companies.id, companyId)).get();
    const agentRows  = db.select().from(agents).where(eq(agents.companyId, companyId)).all();
    const allTaskRows = db.select().from(tasksTable)
      .where(eq(tasksTable.companyId, companyId))
      .orderBy(desc(tasksTable.createdAt)).limit(20).all()
      .filter((t: any) => t.status !== 'done' && t.status !== 'cancelled');
    const pendingApprovals = db.select().from(approvalsTable)
      .where(and(eq(approvalsTable.companyId, companyId), eq(approvalsTable.status, 'pending'))).all();

    const agentList = (agentRows as any[]).map(a => `  • ${a.name} [${a.id.slice(0,8)}] (${a.role}, ${a.status})`).join('\n') || '  —';
    const taskList  = allTaskRows.slice(0, 8).map((t: any) => {
      const assignee = (agentRows as any[]).find((a: any) => a.id === t.assignedTo)?.name || '—';
      return `  • [${t.id.slice(0,6)}] "${t.title}" → ${assignee} (${t.status})`;
    }).join('\n') || '  —';

    // Determine the actual responding agent (targetAgent or CEO/Orchestrator)
    const respondingAgent: any = targetAgent
      || (agentRows as any[]).find((a: any) =>
          a.isOrchestrator === true || a.isOrchestrator === 1 ||
          /ceo|manager|geschäftsführer/i.test(a.role)
        )
      || null;

    if (!respondingAgent) {
      const l = getUiLanguage(companyId);
      return l === 'en'
        ? '⚠️ No CEO / Orchestrator configured. Please mark an agent as "Company Orchestrator" and connect it to an LLM.'
        : '⚠️ Kein CEO / Orchestrator konfiguriert. Bitte einen Agenten als "Company Orchestrator" einstellen und mit einem LLM verbinden.';
    }

    const myTasks = targetAgent ? allTaskRows.filter((t: any) => t.assignedTo === targetAgent.id) : [];

    const uiLang = getUiLanguage(companyId);
    const isEn = uiLang === 'en';

    let systemPrompt: string;
    if (targetAgent) {
      systemPrompt = `You are ${targetAgent.name}, an AI agent at "${(company as any)?.name || 'OpenCognit'}".
Role: ${targetAgent.role || 'Specialist'}. Status: ${targetAgent.status || 'active'}.
${targetAgent.description ? (isEn ? `About you: ${targetAgent.description}` : `Über dich: ${targetAgent.description}`) : ''}
${langLine(uiLang)} Communicate directly and authentically in first person.

${isEn ? `MY TASKS (${myTasks.length}):` : `MEINE TASKS (${myTasks.length}):`}
${myTasks.map((t: any) => `  • [${t.id.slice(0,6)}] "${t.title}" (${t.status})`).join('\n') || (isEn ? '  None' : '  Keine')}

${isEn ? 'TEAM:' : 'TEAM:'}
${agentList}

${isEn ? 'ACTIONS (optional):' : 'AKTIONEN (optional):'}
[ACTION]{"type": "create_task", "titel": "...", "agentId": "8-char-optional"}[/ACTION]
[ACTION]{"type": "message_agent", "agentId": "8-char", "message": "..."}[/ACTION]`;
    } else {
      const ceoName = respondingAgent?.name || 'CEO';
      const ceoRolle = respondingAgent?.role || 'Geschäftsführer';
      const configCtx = buildConfigContext(companyId);
      const lang = getUiLanguage(companyId);

      // Determine autonomy mode for prompt context
      let ceoCfg: any = {};
      try { ceoCfg = JSON.parse(respondingAgent?.connectionConfig || '{}'); } catch {}
      const ceoAutonomy = ceoCfg.autonomyLevel || 'autonomous';
      const autonomyNote = ceoAutonomy === 'copilot'
        ? lang === 'en'
          ? `MODE: COPILOT. All actions (tasks, assignments, agents, config) require user approval. Inform the user that you're proposing the action and it will execute after approval.`
          : `WICHTIG — Modus: COPILOT. Alle Aktionen (Tasks, Zuweisung, Agenten, Config) brauchen Freigabe des Users. Informiere den User, dass du die Aktion vorschlägst und sie nach Genehmigung ausgeführt wird.`
        : lang === 'en'
          ? `MODE: AUTONOMOUS. You execute actions directly when the user requests it.`
          : `MODUS: AUTONOM. Du führst Aktionen direkt aus, wenn der User es wünscht.`;

      const isEn = lang === 'en';
      systemPrompt = `You are ${ceoName}, ${ceoRolle} at "${(company as any)?.name || 'OpenCognit'}".
${langLine(lang)} Communicate directly in first person, no jargon.
When asked who you are, introduce yourself as ${ceoName}.
${isEn ? 'You have full system access and can configure agents, create tasks, and change settings.' : 'Du hast vollen Zugriff auf das System und kannst Agenten konfigurieren, Tasks erstellen und Settings ändern.'}
${autonomyNote}
${configCtx}

${isEn ? `TEAM (${agentRows.length} agents):` : `TEAM (${agentRows.length} Agenten):`}
${agentList}

${isEn ? `OPEN TASKS (${allTaskRows.length}):` : `OFFENE TASKS (${allTaskRows.length}):`}
${taskList}

${isEn ? `PENDING APPROVALS: ${pendingApprovals.length}` : `GENEHMIGUNGEN AUSSTEHEND: ${pendingApprovals.length}`}
${(pendingApprovals as any[]).slice(0,3).map((a: any) => `  • [${a.id.slice(0,6)}] ${a.title}`).join('\n')}

${isEn ? `OPENCOGNIT PRODUCT KNOWLEDGE (for questions about the system):` : `OPENCOGNIT PRODUKTWISSEN (für Fragen über das System):`}
  • Dashboard — ${isEn ? 'Real-time overview: agent status, open tasks, costs, recent activity' : 'Echtzeit-Überblick: Agenten-Status, offene Tasks, Kosten, letzte Aktivitäten'}
  • Focus Mode — ${isEn ? "Personal daily briefing: which tasks the user must handle themselves (blocked, unassigned, high-priority), what agents are doing. Includes a Pomodoro timer (25 min focus / 5 min break) — for the user only, no agent function." : 'Persönliche Tages-Übersicht: welche Tasks der User selbst erledigen muss (blocked, unassigned, high-priority), was Agenten tun. Enthält Pomodoro-Timer (25 min / 5 min Pause) — nur für den User.'}
  • Agents — ${isEn ? 'Create, configure, set LLM connections, manage permissions & roles' : 'Agenten erstellen, konfigurieren, LLM-Verbindung setzen, Permissions verwalten'}
  • Tasks — ${isEn ? 'Create, assign, track status, complete tasks manually' : 'Aufgaben erstellen, zuweisen, Status tracken, manuell erledigen'}
  • Goals — ${isEn ? 'OKR goals with progress tracking, linked to tasks' : 'OKR-Ziele mit Fortschrittsanzeige, verknüpft mit Tasks'}
  • Projects — ${isEn ? 'Project management with tasks and agents' : 'Projekt-Verwaltung mit Tasks und Agenten'}
  • Meetings — ${isEn ? 'Agent meetings: multiple agents discuss a topic and produce a transcript' : 'Agent-Besprechungen: mehrere Agenten diskutieren ein Thema, produzieren ein Protokoll'}
  • Routines — ${isEn ? 'Automated workflows with cron schedule (e.g. daily 9am: create standup report)' : 'Automatisierte Workflows mit Cron-Schedule (z.B. täglich 9 Uhr: Standup erstellen)'}
  • Skill Library — ${isEn ? 'Knowledge base: Markdown docs agents use as context (RAG-lite)' : 'Wissens-Datenbank: Markdown-Dokumente als Agent-Kontext (RAG-lite)'}
  • Org Chart — ${isEn ? 'Visual org chart: shows hierarchy and relationships between agents' : 'Visuelles Organigramm der Agenten-Hierarchie'}
  • Costs — ${isEn ? 'Cost tracking: token usage and API costs per agent' : 'Kosten-Tracking: Token-Verbrauch und API-Kosten pro Agent'}
  • Approvals — ${isEn ? 'Actions an agent cannot execute autonomously wait here for user approval' : 'Aktionen die ein Agent nicht selbst ausführen darf, warten auf User-Freigabe'}
  • Activity — ${isEn ? 'Full activity log of all agent actions and events' : 'Vollständiges Aktivitäts-Log aller Agenten-Aktionen'}
  • Intelligence — ${isEn ? 'Agent dashboard by "Wings"/"Rooms": budget tracking and activity logs per agent' : 'Agent-Dashboard nach "Wings"/"Rooms": Budget und Aktivitäts-Logs pro Agent'}
  • War Room — ${isEn ? 'Real-time monitor: running agents and tasks with costs and execution controls' : 'Echtzeit-Monitor: laufende Agenten/Tasks mit Kosten und Ausführungskontrollen'}
  • Clipmart — ${isEn ? 'Template marketplace: import pre-built agent teams (e.g. "Marketing Team")' : 'Template-Marktplatz: vorgefertigte Agent-Teams importieren'}
  • Performance — ${isEn ? 'Per-agent performance metrics: completion rate, success rate, 7-day trend' : 'Performance-Metriken einzelner Agenten: Abschlussquote, Erfolgsrate, Trend'}
  • Metrics — ${isEn ? 'System-wide analytics: token usage, costs, infrastructure diagnostics' : 'System-weite Analytik: Token-Nutzung, Kosten, Infrastruktur-Diagnostik'}
  • Weekly Report — ${isEn ? 'Auto-generated weekly report: tasks, agent performance, goals, narrative' : 'Automatisch generierter Wochenbericht: Tasks, Leistung, Ziele'}
  • Work Products — ${isEn ? 'Agent outputs: files, text, URLs, directories agents have created' : 'Outputs der Agenten: Dateien, Texte, URLs die Agenten erstellt haben'}
  • Settings — ${isEn ? 'API keys (OpenRouter, Anthropic, OpenAI, Ollama), Telegram bot, working directory' : 'API-Keys, Telegram-Bot, Arbeitsverzeichnis konfigurieren'}

${isEn ? `YOUR CORE ABILITY — BUILDING TEAMS VIA CHAT:
The user can ask you to build entire agent teams, automations and workflows in plain language.
When they do, you create the agents and routines immediately using ACTION blocks — no dashboard needed.

EXAMPLE REQUESTS & HOW YOU HANDLE THEM:
• "Build me a social media team that posts daily on X and Instagram"
  → create 2 agents (X-Bot, Instagram-Bot), create routines with cron "0 9 * * *", confirm setup
• "Set up a research agent that monitors news about AI and sends a daily summary"
  → create Research-Agent with systemPrompt describing the task, create routine "0 8 * * 1-5"
• "I need a customer support agent that handles emails"
  → create Support-Agent with systemPrompt, assign to task, explain next steps (email API)
• "Create a content team: researcher, writer, editor"
  → create 3 agents with clear roles and systemPrompts, set up task workflow between them
• "Make an agent that checks our GitHub repo every morning and reports issues"
  → create Dev-Agent with bash/http connection type, create routine

AGENT CREATION GUIDELINES:
- Always write a detailed systemPrompt that tells the agent EXACTLY what its job is
- Choose verbindungsTyp based on what's available (check API KEYS above)
- For automation/bots: use connectionType "http" (HTTP webhook) or "bash" (shell script)
- For LLM reasoning agents: use "claude-code", "openrouter", "anthropic", or "kimi-cli"
- Set autoCycleActive=true for agents that should run autonomously on a heartbeat

IMPORTANT:
- When the user asks to build something, DO IT immediately — create agents, tasks, routines in one response.
- Confirm what you built with a clear summary after the ACTION blocks.
- If an API key is missing for the chosen connection type, ask for it or suggest an alternative.
- Actions must NEVER appear in visible text — only as hidden blocks.
- Your visible response is always plain text, never JSON.` : `DEINE KERNFÄHIGKEIT — TEAMS PER CHAT AUFBAUEN:
Der User kann dich bitten, ganze Agenten-Teams, Automationen und Workflows auf natürlichem Weg aufzubauen.
Wenn er das tut, erstellst du die Agenten und Routinen sofort mit ACTION-Blöcken — kein Dashboard nötig.

BEISPIELANFRAGEN & WIE DU SIE ERLEDIGST:
• "Bau mir ein Social-Media-Team das täglich auf X und Instagram postet"
  → erstelle 2 Agenten (X-Bot, Instagram-Bot), erstelle Routinen mit Cron "0 9 * * *", bestätige Setup
• "Richte einen Research-Agenten ein der täglich KI-News sammelt und zusammenfasst"
  → erstelle Research-Agent mit systemPrompt, erstelle Routine "0 8 * * 1-5"
• "Ich brauche einen Kundensupport-Agenten der E-Mails bearbeitet"
  → erstelle Support-Agent mit systemPrompt, erkläre nächste Schritte (E-Mail-API)
• "Erstelle ein Content-Team: Researcher, Autor, Lektor"
  → erstelle 3 Agenten mit klaren Rollen und systemPrompts, richte Task-Workflow ein
• "Mach einen Agenten der jeden Morgen unser GitHub-Repo checkt und Issues meldet"
  → erstelle Dev-Agent mit bash/http Verbindungstyp, erstelle Routine

AGENTEN-ERSTELLUNGS-RICHTLINIEN:
- Schreib immer einen detaillierten systemPrompt der dem Agenten GENAU erklärt was seine Aufgabe ist
- Wähle verbindungsTyp basierend auf verfügbaren API-Keys (siehe API KEYS oben)
- Für Automationen/Bots: nutze connectionType "http" (HTTP Webhook) oder "bash" (Shell-Script)
- Für LLM-Reasoning-Agenten: nutze "claude-code", "openrouter", "anthropic" oder "kimi-cli"
- Setze autoCycleActive=true für Agenten die autonom im Heartbeat laufen sollen

WICHTIG:
- Wenn der User etwas aufbauen möchte, TU ES sofort — erstelle Agenten, Tasks, Routinen in einer Antwort.
- Bestätige was du gebaut hast mit einer klaren Zusammenfassung nach den ACTION-Blöcken.
- Wenn ein API-Key für den gewählten Verbindungstyp fehlt, frag danach oder schlage Alternative vor.
- Aktionen dürfen NIEMALS im sichtbaren Text erscheinen — nur als versteckter Block.
- Deine sichtbare Antwort ist immer reiner Text, kein JSON.`}

${isEn ? 'ACTIONS (execute immediately when user requests, at end of response):' : 'AKTIONEN (sofort ausführen wenn User es wünscht, am Ende der Antwort):'}
[ACTION]{"type": "create_task", "titel": "...", "beschreibung": "...", "agentId": "8-char-optional", "prioritaet": "high"}[/ACTION]
[ACTION]{"type": "assign_task", "taskId": "6-char", "agentId": "8-char"}[/ACTION]
[ACTION]{"type": "approve", "id": "6-char"}[/ACTION]
[ACTION]{"type": "reject", "id": "6-char"}[/ACTION]
[ACTION]{"type": "create_agent", "name": "Name", "rolle": "Role", "faehigkeiten": "Skills", "verbindungsTyp": "claude-code", "systemPrompt": "Detailed job description...", "autoCycleActive": false}[/ACTION]
[ACTION]{"type": "configure_agent", "agentId": "8-char", "verbindungsTyp": "openrouter", "model": "anthropic/claude-opus-4"}[/ACTION]
[ACTION]{"type": "create_routine", "name": "...", "beschreibung": "...", "cronAusdruck": "0 9 * * 1-5", "agentId": "8-char"}[/ACTION]
[ACTION]{"type": "save_setting", "key": "openrouter_api_key", "value": "sk-or-..."}[/ACTION]
[ACTION]{"type": "set_company_workdir", "path": "/path/to/project"}[/ACTION]`;
    }

    const historyKey = respondingAgent ? `${chatId}:${respondingAgent.id}` : chatId;
    const history = conversationHistory.get(historyKey) || [];
    conversationLastAccess.set(historyKey, Date.now()); // update LRU on read
    history.push({ role: 'user', content: userMessage });
    if (history.length > 20) history.splice(0, history.length - 20);

    const allSettings = db.select().from(settings).all();
    const getSetting = (key: string) =>
      (allSettings as any[]).find(s => s.key === key && s.companyId === companyId) ||
      (allSettings as any[]).find(s => s.key === key && (!s.companyId || s.companyId === ''));

    // Route through the responding agent's configured LLM connection
    const llmResponse = await this.callAgentLLM(
      respondingAgent, systemPrompt, history, userMessage, getSetting
    );

    if (!llmResponse) return '⚠️ Kein LLM konfiguriert. Bitte API-Key oder Claude Code CLI in den Einstellungen hinterlegen.';

    const finalResponse = await this.executeActions(llmResponse, companyId, agentRows, allTaskRows, pendingApprovals, respondingAgent);
    history.push({ role: 'assistant', content: finalResponse });
    conversationHistory.set(historyKey, history);
    conversationLastAccess.set(historyKey, Date.now()); // update LRU on write
    pruneConversationHistory();
    return finalResponse;
  },

  /**
   * Route a Telegram chat message through the agent's configured LLM connection.
   * Supports: claude-code CLI, codex-cli, gemini-cli, openrouter, anthropic, openai, ollama, custom.
   * Falls back to any available API key if the agent's connection can't be resolved.
   */
  async callAgentLLM(
    agent: any,
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string,
    getSetting: (key: string) => any
  ): Promise<string | null> {
    const verbindungsTyp: string = agent?.connectionType || '';
    const verbindungsConfig: any = (() => {
      try { return agent?.connectionConfig ? JSON.parse(agent.connectionConfig) : {}; } catch { return {}; }
    })();

    // ── CLI adapters (no API key needed) ─────────────────────────────────────
    if (verbindungsTyp === 'claude-code') {
      const historyText = history.slice(0, -1)
        .map(m => `[${m.role === 'user' ? 'USER' : 'ASSISTANT'}]: ${m.content}`).join('\n');
      const cliPrompt = `${systemPrompt}\n\n${historyText ? `[VERLAUF]\n${historyText}\n\n` : ''}[USER]\n${userMessage}`;
      try { return await runClaudeDirectChat(cliPrompt, agent.id); } catch { return null; }
    }
    if (verbindungsTyp === 'codex-cli') {
      const historyText = history.slice(0, -1)
        .map(m => `[${m.role === 'user' ? 'USER' : 'ASSISTANT'}]: ${m.content}`).join('\n');
      const cliPrompt = `${systemPrompt}\n\n${historyText ? `[VERLAUF]\n${historyText}\n\n` : ''}[USER]\n${userMessage}`;
      try { return await runCodexDirectChat(cliPrompt, agent.id); } catch { return null; }
    }
    if (verbindungsTyp === 'gemini-cli') {
      const historyText = history.slice(0, -1)
        .map(m => `[${m.role === 'user' ? 'USER' : 'ASSISTANT'}]: ${m.content}`).join('\n');
      const cliPrompt = `${systemPrompt}\n\n${historyText ? `[VERLAUF]\n${historyText}\n\n` : ''}[USER]\n${userMessage}`;
      try { return await runGeminiDirectChat(cliPrompt, agent.id); } catch { return null; }
    }
    if (verbindungsTyp === 'kimi-cli') {
      const historyText = history.slice(0, -1)
        .map(m => `[${m.role === 'user' ? 'USER' : 'ASSISTANT'}]: ${m.content}`).join('\n');
      const cliPrompt = `${systemPrompt}\n\n${historyText ? `[VERLAUF]\n${historyText}\n\n` : ''}[USER]\n${userMessage}`;
      try { return await runKimiDirectChat(cliPrompt, agent.id); } catch { return null; }
    }

    // ── API-key adapters ──────────────────────────────────────────────────────
    const messages = [{ role: 'system' as const, content: systemPrompt }, ...history];

    if (verbindungsTyp === 'openrouter') {
      const entry = getSetting('openrouter_api_key');
      if (!entry?.value) return null;
      const key = decryptSetting('openrouter_api_key', entry.value);
      const model = verbindungsConfig.model || 'mistralai/mistral-7b-instruct:free';
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'X-Title': 'OpenCognit' },
        body: JSON.stringify({ model, messages, max_tokens: 600, temperature: 0.7 }),
      });
      if (res.ok) return (await res.json() as any).choices?.[0]?.message?.content?.trim() || null;
      return null;
    }

    if (verbindungsTyp === 'anthropic' || verbindungsTyp === 'claude') {
      const entry = getSetting('anthropic_api_key');
      if (!entry?.value) return null;
      const key = decryptSetting('anthropic_api_key', entry.value);
      const model = verbindungsConfig.model || 'claude-haiku-4-5-20251001';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 600, system: systemPrompt, messages: history }),
      });
      if (res.ok) return (await res.json() as any).content?.[0]?.text?.trim() || null;
      return null;
    }

    if (verbindungsTyp === 'openai') {
      const entry = getSetting('openai_api_key');
      if (!entry?.value) return null;
      const key = decryptSetting('openai_api_key', entry.value);
      const model = verbindungsConfig.model || 'gpt-4o-mini';
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages, max_tokens: 600, temperature: 0.7 }),
      });
      if (res.ok) return (await res.json() as any).choices?.[0]?.message?.content?.trim() || null;
      return null;
    }

    if (verbindungsTyp === 'ollama') {
      const entry = getSetting('ollama_base_url');
      const baseUrl = entry?.value || 'http://localhost:11434';
      const model = verbindungsConfig.model || 'llama3';
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
      });
      if (res.ok) return (await res.json() as any).message?.content?.trim() || null;
      return null;
    }

    if (verbindungsTyp === 'custom') {
      const urlEntry = getSetting('custom_api_base_url');
      const keyEntry = getSetting('custom_api_key');
      if (!urlEntry?.value) return null;
      const baseUrl = urlEntry.value.replace(/\/$/, '');
      const key = keyEntry?.value ? decryptSetting('custom_api_key', keyEntry.value) : '';
      const model = verbindungsConfig.model || 'default';
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'Authorization': `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, messages, max_tokens: 600 }),
      });
      if (res.ok) return (await res.json() as any).choices?.[0]?.message?.content?.trim() || null;
      return null;
    }

    // Fallback: any available API key
    return this.callLLM(systemPrompt, history, getSetting);
  },

  async callLLM(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    getSetting: (key: string) => any
  ): Promise<string | null> {
    const orEntry = getSetting('openrouter_api_key');
    const anEntry = getSetting('anthropic_api_key');
    const oaEntry = getSetting('openai_api_key');

    if (orEntry?.value) {
      try {
        const apiKey = decryptSetting('openrouter_api_key', orEntry.value);
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'X-Title': 'OpenCognit' },
          body: JSON.stringify({ model: 'openrouter/auto', messages: [{ role: 'system', content: systemPrompt }, ...history], max_tokens: 600, temperature: 0.7 }),
        });
        if (res.ok) return ((await res.json() as any).choices?.[0]?.message?.content?.trim()) || null;
      } catch {}
    }

    if (anEntry?.value) {
      try {
        const apiKey = decryptSetting('anthropic_api_key', anEntry.value);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: systemPrompt, messages: history }),
        });
        if (res.ok) return ((await res.json() as any).content?.[0]?.text?.trim()) || null;
      } catch {}
    }

    if (oaEntry?.value) {
      try {
        const apiKey = decryptSetting('openai_api_key', oaEntry.value);
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, ...history], max_tokens: 600 }),
        });
        if (res.ok) return ((await res.json() as any).choices?.[0]?.message?.content?.trim()) || null;
      } catch {}
    }

    return null;
  },

  /** Strip all action-like content and LLM artifacts from output before sending to Telegram */
  sanitizeResponse(text: string): string {
    return text
      // [ACTION]{...}[/ACTION] (correct format)
      .replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, '')
      // ACTION{...} or ACTION({...}) without brackets
      .replace(/ACTION\s*[\(\{][^\n]*[\)\}]+\}*/g, '')
      // Lines that are purely JSON objects
      .replace(/^\s*\{[^}]*\}\}*\s*$/gm, '')
      // Leftover [ACTION] or [/ACTION] tags
      .replace(/\[\/?\s*ACTION\s*\]/g, '')
      // LLM stop/special tokens: <|endoftext|>, <|im_end|>, <|im_msg|>, etc.
      .replace(/<\|[^|>]+\|>/g, '')
      // Trailing empty JSON: {}
      .replace(/\{\s*\}\s*$/g, '')
      // Trailing bracket garbage like [] or [  ] at end
      .replace(/\[\s*\]\s*$/g, '')
      .trim()
      // Collapse multiple blank lines
      .replace(/\n{3,}/g, '\n\n');
  },

  async executeActions(llmText: string, companyId: string, agentRows: any[], taskRows: any[], approvalRows: any[], ceoAgent?: any): Promise<string> {
    const matches = [...llmText.matchAll(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/g)];
    // Always sanitize — even if no valid actions found (catches malformed output)
    let responseText = this.sanitizeResponse(llmText.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, ''));
    const results: string[] = [];

    // ── Load CEO permissions ─────────────────────────────────────────────────
    let perms: any = null;
    let autonomyLevel = 'autonomous';
    if (ceoAgent) {
      try {
        const cfg = JSON.parse(ceoAgent.connectionConfig || '{}');
        autonomyLevel = cfg.autonomyLevel || 'autonomous';
      } catch {}
      try {
        perms = db.select().from(agentPermissions).where(eq(agentPermissions.agentId, ceoAgent.id)).get();
      } catch {}
    }

    const isCopilot = autonomyLevel === 'copilot';
    // Default: allow if no permission row exists (no row = defaults apply from schema)
    const canCreateTask      = perms ? perms.darfAufgabenErstellen !== false : true;
    const canAssignTask      = perms ? perms.darfAufgabenZuweisen !== false : true;
    const canDecideApproval  = perms ? perms.darfGenehmigungEntscheiden !== false : true;
    const canRecruitAgent    = perms ? perms.darfExpertenAnwerben !== false : true;

    // Helper: create a approvals entry and emit notification
    const requestApproval = (type: 'hire_expert' | 'approve_strategy' | 'budget_change' | 'agent_action', title: string, description: string, payload: any): string => {
      const approvalId = uuid();
      db.insert(approvalsTable).values({
        id: approvalId, companyId,
        type, title, description,
        requestedBy: ceoAgent?.id || null,
        status: 'pending',
        payload: JSON.stringify(payload),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
      appEvents.emit('broadcast', { type: 'approval_needed', companyId, taskTitle: title });
      return approvalId;
    };

    for (const match of matches) {
      try {
        const action = JSON.parse(match[1]);

        if (action.type === 'create_task') {
          if (isCopilot || !canCreateTask) {
            requestApproval('agent_action', `Task erstellen: "${action.title}"`, action.description || '', action);
            results.push(`⏳ Genehmigung angefordert: Task *"${action.title}"* wartet auf deine Freigabe.`);
          } else {
            const agent = action.agentId ? (agentRows as any[]).find((a: any) => a.id.startsWith(action.agentId)) : null;
            db.insert(tasksTable).values({
              id: uuid(), companyId, title: action.title,
              description: action.description || '', status: agent ? 'todo' : 'backlog',
              priority: (['critical','high','medium','low'].includes(action.priority) ? action.priority : 'medium'),
              assignedTo: agent?.id || null,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            }).run();
            results.push(`✅ Task erstellt: *"${action.title}"*${agent ? ` → ${agent.name}` : ''}`);
          }

        } else if (action.type === 'message_agent') {
          // Messaging never needs approval — it's just communication
          const agent = (agentRows as any[]).find((a: any) => a.id.startsWith(action.agentId));
          if (agent) {
            db.insert(chatMessages).values({
              id: uuid(), companyId, agentId: agent.id,
              senderType: 'board', message: `[Telegram]: ${action.message}`,
              read: false, createdAt: new Date().toISOString(),
            }).run();
            scheduler.triggerZyklus(agent.id, companyId, 'telegram').catch(console.error);
            results.push(`💬 Nachricht an *${agent.name}* gesendet`);
          }

        } else if (action.type === 'assign_task') {
          if (isCopilot || !canAssignTask) {
            const task  = (taskRows as any[]).find((t: any) => t.id.startsWith(action.taskId));
            const agent = (agentRows as any[]).find((a: any) => a.id.startsWith(action.agentId));
            requestApproval('agent_action',
              `Task zuweisen: "${task?.title || action.taskId}" → ${agent?.name || action.agentId}`,
              '', action);
            results.push(`⏳ Genehmigung angefordert: Zuweisung wartet auf deine Freigabe.`);
          } else {
            const task  = (taskRows as any[]).find((t: any) => t.id.startsWith(action.taskId));
            const agent = (agentRows as any[]).find((a: any) => a.id.startsWith(action.agentId));
            if (task && agent) {
              db.update(tasksTable).set({ assignedTo: agent.id, status: 'todo', updatedAt: new Date().toISOString() })
                .where(eq(tasksTable.id, task.id)).run();
              results.push(`📋 *"${task.title}"* → ${agent.name}`);
            }
          }

        } else if (action.type === 'approve' || action.type === 'reject') {
          if (!canDecideApproval) {
            results.push(`⛔ ${ceoAgent?.name || 'CEO'} hat keine Berechtigung, Genehmigungen zu entscheiden.`);
          } else {
            const approval = (approvalRows as any[]).find((a: any) => a.id.startsWith(action.id));
            if (approval) {
              const s = action.type === 'approve' ? 'approved' : 'rejected';
              db.update(approvalsTable).set({ status: s, updatedAt: new Date().toISOString() })
                .where(eq(approvalsTable.id, approval.id)).run();
              results.push(`${action.type === 'approve' ? '✅ Genehmigt' : '❌ Abgelehnt'}: *${approval.title}*`);
            }
          }

        } else if (action.type === 'create_agent') {
          if (isCopilot || !canRecruitAgent) {
            requestApproval('hire_expert',
              `Agent anwerben: "${action.name}" (${action.role || '—'})`,
              `Typ: ${action.connectionType || 'claude-code'} · Fähigkeiten: ${action.skills || '—'}`,
              action);
            results.push(`⏳ Genehmigung angefordert: Agent *"${action.name}"* wartet auf deine Freigabe.`);
          } else {
            const msg = executeConfigAction(action, companyId);
            if (msg) results.push(msg);
          }

        } else if ([
          'configure_agent', 'configure_all_agents', 'update_agent',
          'set_agent_heartbeat', 'set_agent_status', 'set_orchestrator',
          'delete_agent', 'update_task', 'delete_task',
          'create_project', 'create_routine', 'set_routine_status',
          'save_setting', 'set_company_workdir',
        ].includes(action.type)) {
          if (isCopilot) {
            const label = action.type === 'configure_agent' || action.type === 'update_agent'
              ? `Agent konfigurieren (${action.agentId})`
              : action.type === 'save_setting'
              ? `Setting speichern: ${action.key}`
              : action.type === 'set_company_workdir'
              ? `Arbeitsverzeichnis: ${action.path}`
              : `${action.type} ausführen`;
            requestApproval('agent_action', label, '', action);
            results.push(`⏳ Genehmigung angefordert: _${label}_ wartet auf deine Freigabe.`);
          } else {
            const msg = executeConfigAction(action, companyId);
            if (msg) results.push(msg);
          }
        }
      } catch (e) { console.error('[Telegram] Action parse error:', e); }
    }

    return results.length > 0
      ? results.join('\n') + (responseText ? '\n\n' + responseText : '')
      : responseText || llmText;
  },

  // ── Polling loop ───────────────────────────────────────────────────────────

  async startPolling() {
    if (isPolling) return;
    isPolling = true;
    console.log('📡 Telegram Gateway (Polling Mode) gestartet.');

    const poll = async () => {
      if (!isPolling) return;
      pollController = new AbortController();

      try {
        const allSettings = db.select().from(settings)
          .where(eq(settings.key, 'telegram_bot_token')).all();

        for (const s of allSettings as any[]) {
          if (!isPolling) break;
          if (!s.value || s.value.startsWith('enc:error')) continue;

          let token: string;
          try {
            token = decryptSetting('telegram_bot_token', s.value);
          } catch (err: any) {
            if (!invalidTokens.has(s.value)) {
              invalidTokens.add(s.value);
              console.warn(`[Telegram] Token für Unternehmen ${s.companyId || '(global)'} kann nicht entschlüsselt werden (falscher ENCRYPTION_KEY oder korrupter Wert). Übersprungen.`);
            }
            continue;
          }
          let uId = s.companyId;
          if (!uId) {
            const first = db.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1).get();
            if (!first) continue;
            uId = (first as any).id;
          }

          // Register slash commands once per token so the "/" menu appears in Telegram
          if (!registeredBotCommands.has(token)) {
            registeredBotCommands.add(token);
            fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ commands: [
                { command: 'start',     description: 'Hilfe & Übersicht' },
                { command: 'status',    description: 'System-Überblick' },
                { command: 'tasks',     description: 'Offene Aufgaben' },
                { command: 'agents',    description: 'Dein Team' },
                { command: 'approvals', description: 'Genehmigungen' },
                { command: 'goals',     description: 'OKR-Ziele' },
                { command: 'costs',     description: 'Kosten-Überblick' },
                { command: 'report',    description: 'Wochenbericht' },
                { command: 'new',       description: 'Neue Aufgabe erstellen' },
                { command: 'wake',      description: 'Agent aufwecken' },
              ]}),
            }).catch(() => {});
          }

          // Skip tokens that previously returned 401
          if (invalidTokens.has(token)) continue;

          const offset = offsets.get(uId) || 0;
          try {
            const resp = await fetch(
              `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5`,
              { signal: pollController.signal }
            );
            if (!resp.ok) {
              if (resp.status === 401) {
                invalidTokens.add(token);
                console.warn(`[Telegram] Token ungültig (401) — ignoriert bis Server-Neustart.`);
              }
              continue;
            }

            const data = await resp.json() as any;
            if (!data.ok || !data.result.length) continue;

            for (const update of data.result) {
              if (update.update_id >= offset) offsets.set(uId, update.update_id + 1);

              // Regular message
              if (update.message) {
                try {
                  await this.handleInboundMessage(uId, update.message, token);
                } catch (e: any) { console.error('[Telegram] message error:', e?.message); }
              }

              // Inline button press
              if (update.callback_query) {
                const cq = update.callback_query;
                const chatId = String(cq.message?.chat?.id);
                const msgId  = cq.message?.message_id;
                try {
                  await this.handleCallbackQuery(uId, token, chatId, msgId, cq.id, cq.data || '');
                } catch (e: any) { console.error('[Telegram] callback error:', e?.message); }
              }
            }
          } catch {}
        }
      } catch (e) { console.error('[Telegram] Polling cycle error:', e); }

      if (isPolling) pollTimeout = setTimeout(poll, 3000);
    };

    poll();
  },

  // Clear cached invalid tokens — call this after a new token is saved
  clearInvalidTokens() {
    invalidTokens.clear();
    registeredBotCommands.clear();
  },

  stopPolling() {
    isPolling = false;
    if (pollController) { pollController.abort(); pollController = null; }
    if (pollTimeout)    { clearTimeout(pollTimeout); pollTimeout = null; }
    console.log('📡 Telegram Gateway gestoppt.');
  },

  // ── Push notifications ─────────────────────────────────────────────────────

  async notify(companyId: string, title: string, details?: string, type: string = 'info', keyboard?: InlineKeyboard) {
    const icon = type === 'error' ? '🔴' : type === 'warning' ? '🟠' : type === 'success' ? '✅' : '🔵';
    const text = `*${icon} ${title}*${details ? `\n\n${details}` : ''}`.trim();
    await this.sendTelegram(companyId, text, keyboard);
  },
};

import { db } from './db/client.js';
import { agents, companies, tasks, workCycles, costEntries, activityLog, settings, chatMessages, skillsLibrary, agentSkills, approvals, agentMeetings, goals, routines, routineTrigger, comments, agentPermissions, traceEvents, projects } from './db/schema.js';
import { eq, and, isNull, ne, inArray, desc, asc, sql } from 'drizzle-orm';
import { getAdapter } from './adapters/index.js';
import { decryptSetting } from './utils/crypto.js';
import { executeSkill, resolveWorkDir } from './skills.js';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { messagingService } from './services/messaging.js';
import { nodeManager } from './services/nodeManager.js';
import { mcpClient } from './services/mcpClient.js';
import { nachZyklusVerarbeitung } from './services/learning-loop.js';
import { spawnBackgroundReview, sollteReviewen, komprimiereKontext, ladeSummary, sollteKomprimieren, sessionSearch } from './services/background-review.js';
import { loadRelevantMemory, autoSaveInsights, saveMeetingResult } from './services/memory-auto.js';
import { heartbeatService } from './services/heartbeat.js';
import { findRelevantSkills, embeddingsAvailable } from './services/skill-embeddings.js';

// Lazy import of emitTrace to avoid circular dependency (index.ts exports it)
let _emitTrace: ((agentId: string, companyId: string, typ: string, titel: string, details?: string, runId?: string) => void) | null = null;
export function setEmitTrace(fn: typeof _emitTrace) { _emitTrace = fn; }
function trace(agentId: string, companyId: string, typ: string, titel: string, details?: string, runId?: string) {
  if (_emitTrace) _emitTrace(agentId, companyId, typ, titel, details, runId);
}

// Lazy broadcastUpdate callback to avoid circular dependency
let _broadcastUpdate: ((type: string, data: any) => void) | null = null;
export function setBroadcastUpdate(fn: typeof _broadcastUpdate) { _broadcastUpdate = fn; }
function broadcast(type: string, data: any) {
  if (_broadcastUpdate) _broadcastUpdate(type, data);
}

const API_BASE_URL = process.env.VITE_API_BASE_URL || 'http://localhost:3201';

const now = () => new Date().toISOString();

// ── Language helpers ─────────────────────────────────────────────────────────
function getUiLanguage(companyId: string): 'de' | 'en' {
  try {
    // Try company-specific first, then global ('')
    const row = db.select({ wert: settings.value })
      .from(settings)
      .where(and(eq(settings.key, 'ui_language'), eq(settings.companyId, companyId)))
      .get()
      ?? db.select({ wert: settings.value })
        .from(settings)
        .where(and(eq(settings.key, 'ui_language'), eq(settings.companyId, '')))
        .get();
    if (row?.value) {
      const lang = decryptSetting('ui_language', row.value);
      if (lang === 'en' || lang === 'de') return lang;
    }
  } catch {}
  return 'de'; // default
}

// Returns the language instruction line to append to prompts
function langInstruction(lang: 'de' | 'en'): string {
  return lang === 'en'
    ? 'Respond in English. Keep your answer concise and action-oriented.'
    : 'Antworte auf Deutsch. Halte deine Antwort präzise und handlungsorientiert.';
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize user-supplied text before embedding into LLM prompts.
 * Strips triple-backtick blocks (used for JSON action blocks) and limits length
 * to prevent prompt injection via task titles/descriptions.
 */
function sanitizeForPrompt(text: string, maxLen = 200): string {
  return text
    .replace(/```[\s\S]*?```/g, '[code block removed]') // strip embedded code blocks
    .replace(/\{\s*"action"\s*:/gi, '[action removed]')  // strip embedded JSON actions
    .slice(0, maxLen);
}

/**
 * Computes a priority score for a task. Higher = should be shown to the agent first.
 * Used to sort task lists before building LLM context strings.
 */
function taskPriorityScore(a: any): number {
  const prio = a.priority === 'critical' ? 100 : a.priority === 'high' ? 70 : a.priority === 'medium' ? 40 : 10;
  // In-progress tasks surface above backlog; blocked tasks go to the bottom
  const statusBonus = a.status === 'in_progress' ? 25 : a.status === 'blocked' ? -40 : 0;
  // Age bonus: +2 points per day waiting, capped at 30 — prevents starvation
  const daysSinceCreated = a.createdAt
    ? Math.min(15, (Date.now() - new Date(a.createdAt).getTime()) / 86_400_000)
    : 0;
  const ageBonus = Math.round(daysSinceCreated * 2);
  // Goal-aligned tasks get a relevance boost
  const goalBonus = a.goalId ? 15 : 0;
  // Maximizer tasks always float to top
  const maximizerBonus = a.isMaximizerMode ? 200 : 0;
  return prio + statusBonus + ageBonus + goalBonus + maximizerBonus;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.timer) return;
    console.log('⏱️  Starte Zyklus-Scheduler (OpenCognit Engine)...');
    // Alle 30 Sekunden prüfen, ob Experten einen Arbeitszyklus brauchen
    this.timer = setInterval(() => this.runTick(), 30000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('⏱️  Zyklus-Scheduler gestoppt.');
    }
  }

  // Lädt den passenden API-Key aus den Einstellungen für den Adapter
  private async getExpertApiKey(companyId: string, connectionType: string): Promise<string> {
    const keys: Record<string, string> = {
      'openrouter': 'openrouter_api_key',
      'claude': 'anthropic_api_key',
      'anthropic': 'anthropic_api_key',
      'openai': 'openai_api_key',
      'ollama': 'ollama_base_url'
    };

    const sKey = keys[connectionType];
    if (!sKey) return `ak_${crypto.randomBytes(16).toString('hex')}`;

    // 1. Try company-specific key
    if (companyId) {
       const uSetting = db.select().from(settings)
         .where(and(eq(settings.key, sKey), eq(settings.companyId, companyId)))
         .get();
       if (uSetting?.value) return sKey === 'ollama_base_url' ? uSetting.value : decryptSetting(sKey, uSetting.value);
    }

    // 2. Fallback to global key
    const gSetting = db.select().from(settings)
      .where(and(eq(settings.key, sKey), eq(settings.companyId, '')))
      .get();
    
    if (gSetting?.value) return sKey === 'ollama_base_url' ? gSetting.value : decryptSetting(sKey, gSetting.value);
    
    return connectionType === 'ollama' ? 'http://localhost:11434' : '';
  }

  // Ermittelt den effektiven Adapter + Key — fällt auf verfügbare Alternativen zurück
  private async resolveAdapter(connectionType: string, config?: string, companyId?: string): Promise<{ adapterType: string; apiKey: string }> {
    // CLI-Subscription-Adapter brauchen keinen API-Key → direkt zurückgeben
    if (['claude-code', 'codex-cli', 'gemini-cli', 'kimi-cli', 'bash', 'http'].includes(connectionType)) {
      return { adapterType: connectionType, apiKey: '' };
    }

    // Wenn Ollama (Lokal oder Cloud), prüfe zuerst die Agenten-spezifische Config
    if (connectionType === 'ollama' || connectionType === 'ollama_cloud') {
      try {
        if (config) {
          const cfg = JSON.parse(config);
          if (cfg.baseUrl) return { adapterType: connectionType, apiKey: cfg.baseUrl };
        }
      } catch { /* ignore */ }
    }

    // Try company-specific key first, then global
    const key = companyId
      ? await this.getExpertApiKey(companyId, connectionType) || await this.getExpertApiKey('', connectionType)
      : await this.getExpertApiKey('', connectionType);
    if (key) return { adapterType: connectionType, apiKey: key };

    // Fallback priority: anthropic → openrouter → openai → ollama
    const fallbacks: Array<{ type: string; settingsKey: string }> = [
      { type: 'anthropic', settingsKey: 'anthropic_api_key' },
      { type: 'openrouter', settingsKey: 'openrouter_api_key' },
      { type: 'openai', settingsKey: 'openai_api_key' },
    ];

    for (const fb of fallbacks) {
      if (fb.type === connectionType) continue; // already tried
      const e = db.select().from(settings).where(eq(settings.key, fb.settingsKey)).get();
      if (e?.value) {
        const fbKey = decryptSetting(fb.settingsKey, e.value);
        if (fbKey) return { adapterType: fb.type, apiKey: fbKey };
      }
    }

    // Ollama as last resort (no key required)
    const ollamaE = db.select().from(settings).where(eq(settings.key, 'ollama_base_url')).get();
    if (ollamaE?.value) return { adapterType: 'ollama', apiKey: ollamaE.value };

    return { adapterType: connectionType, apiKey: '' };
  }

  private async runTick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Finde Experten, die aktiv/running sind und einen Zyklus brauchen
      const activeExperts = db.select().from(agents).where(
         inArray(agents.status, ['active', 'idle'])
      ).all();

      const currentTime = new Date().getTime();

      for (const a of activeExperts) {
        if (!a.autoCycleActive || !a.autoCycleIntervalSec) continue;

        // ── Load open tasks to drive adaptive interval and budget decisions ──
        const agentTasks = db.select({
          prioritaet: tasks.priority,
          status: tasks.status,
          isMaximizerMode: (tasks as any).isMaximizerMode,
        }).from(tasks)
          .where(and(eq(tasks.assignedTo, a.id), inArray(tasks.status, ['todo', 'in_progress', 'blocked'])))
          .all();

        // ── Adaptive interval: speed up for urgent work, stick to base otherwise ──
        const hasCritical = agentTasks.some((t: any) => t.priority === 'critical');
        const hasHigh = agentTasks.some((t: any) => t.priority === 'high');
        const hasMaximizer = agentTasks.some((t: any) => t.isMaximizerMode);
        const effectiveIntervalSek = hasMaximizer || hasCritical
          ? Math.max(60, Math.floor(a.autoCycleIntervalSec / 3))   // 3× faster for critical/maximizer
          : hasHigh
          ? Math.max(90, Math.floor(a.autoCycleIntervalSec / 2))   // 2× faster for high priority
          : a.autoCycleIntervalSec;                                  // normal otherwise

        let needsZyklus = false;
        if (!a.lastCycle) {
          needsZyklus = true;
        } else {
          const lastTime = new Date(a.lastCycle).getTime();
          if (currentTime - lastTime > effectiveIntervalSek * 1000) {
            needsZyklus = true;
          }
        }

        if (!needsZyklus) continue;

        // ── Predictive budget guard ───────────────────────────────────────────
        // budget=0 means unlimited. Only block when set AND exceeded.
        if (a.monthlyBudgetCent > 0 && a.monthlySpendCent >= a.monthlyBudgetCent) continue;

        // At 95%+ budget: skip non-urgent cycles to preserve headroom
        if (a.monthlyBudgetCent > 0 && !hasMaximizer) {
          const usedPct = a.monthlySpendCent / a.monthlyBudgetCent;
          if (usedPct >= 0.95 && !hasCritical) {
            trace(a.id, a.companyId, 'warning', '⚠️ Budget fast erschöpft',
              `${Math.round(usedPct * 100)}% verbraucht — Zyklus übersprungen (kein critical/maximizer Task). Nur kritische Aufgaben werden noch ausgeführt.`);
            continue;
          }
        }

        // Fire and forget — Scheduler darf nicht blockieren
        this.triggerZyklus(a.id, a.companyId, 'scheduler').catch(e => {
          console.error(`Fehler bei Arbeitszyklus für ${a.id}:`, e);
        });
      }

      // CEO auto-wakeup: wenn unzugewiesene Tasks existieren, CEO triggern
      this.wakeupCEOIfNeeded(activeExperts);
    } finally {
      this.isRunning = false;
    }
  }

  private wakeupCEOIfNeeded(activeExperts: any[]) {
    // Find CEO agent (isOrchestrator flag OR connectionType 'ceo' OR role matches CEO/Manager)
    const ceoAgent = activeExperts.find(a =>
      a.isOrchestrator === true ||
      a.isOrchestrator === 1 ||
      a.connectionType === 'ceo' ||
      /ceo|geschäftsführer|projektmanager|manager/i.test(a.role)
    );
    if (!ceoAgent) return;

    // Check for unassigned tasks in this company
    const unassigned = db.select().from(tasks)
      .where(and(
        eq(tasks.companyId, ceoAgent.companyId),
        isNull(tasks.assignedTo),
      ))
      .all()
      .filter((t: any) => t.status !== 'done' && t.status !== 'cancelled');

    if (unassigned.length === 0) return;

    // Don't re-wake if already running
    if (ceoAgent.status === 'running') return;

    // Check CEO was not triggered in the last 60s
    if (ceoAgent.lastCycle) {
      const elapsed = Date.now() - new Date(ceoAgent.lastCycle).getTime();
      if (elapsed < 60000) return;
    }

    console.log(`🧠 CEO auto-wakeup: ${unassigned.length} unzugewiesene Task(s) erkannt`);
    this.triggerZyklus(ceoAgent.id, ceoAgent.companyId, 'scheduler').catch(e => {
      console.error('CEO wakeup error:', e);
    });
  }

  // Public: trigger CEO wakeup for a company (called when a new task is created)
  triggerCEOForCompany(companyId: string) {
    // Include 'idle' agents — CEO is normally idle between cycles, not 'active'
    const agentsRows = db.select().from(agents)
      .where(and(
        eq(agents.companyId, companyId),
        inArray(agents.status, ['active', 'idle']),
      ))
      .all();
    this.wakeupCEOIfNeeded(agentsRows);
  }

  async triggerZyklus(
    agentId: string,
    companyId: string,
    quelle: 'scheduler' | 'manual' | 'callback' | 'telegram' = 'manual',
    vonExpertId?: string,   // set when triggered by a peer agent (P2P / meeting)
    meetingId?: string,     // set when this cycle is part of a meeting
  ) {
    const expert = db.select().from(agents).where(eq(agents.id, agentId)).get();
    const company = db.select().from(companies).where(eq(companies.id, companyId)).get();

    if (!expert || !company) return;

    // Asynchroner Workflow: Blockiere parallele Zyklen, wenn der Experte bereits arbeitet
    if (expert.status === 'running') {
      let isStuck = false;
      if (expert.lastCycle) {
        const elapsed = Date.now() - new Date(expert.lastCycle).getTime();
        // Wenn länger als 5 Minuten "running", gehen wir von einem Crash aus und starten neu
        if (elapsed > 300000) {
          isStuck = true;
        }
      }
      
      if (!isStuck) {
        console.log(`⏱️  Agent ${agentId} arbeitet bereits. Eingangssignal (Quelle: ${quelle}) wird in die Warteschlange gestellt.`);
        // Optional: Einen Info-Trace absetzen, damit der User das sieht
        trace(agentId, companyId, 'info', `Eingangswarteschlange (Queue)`, `Neue Aufgabe/Nachricht empfangen. Agent arbeitet dies sofort nach aktuellem Task ab.`);
        return;
      } else {
        console.log(`⚠️ Agent ${agentId} war >5 Min blockiert. Neustart erzwungen.`);
        trace(agentId, companyId, 'warning', `Blockierung erkannt`, `Letzter Zyklus dauerte zu lange. Task-Prozess wird neu gestartet.`);
      }
    }

    // Resolve effective adapter + key (check company-specific key first, then global)
    const { adapterType, apiKey: resolvedApiKey } = await this.resolveAdapter(expert.connectionType, expert.connectionConfig || undefined, companyId);

    let isOrchestrator = false;
    let parsedConfig: any = {};
    try {
      parsedConfig = JSON.parse(expert.connectionConfig || '{}');
      isOrchestrator = parsedConfig.isOrchestrator === true;
    } catch (e) {}

    // Guard: Blockiere Free Models — verursachen Halluzinationen und Context-Overflows
    const configuredModel: string = parsedConfig.model || '';
    if (configuredModel.endsWith(':free') || configuredModel === 'auto:free') {
      console.error(`[Scheduler] Agent ${expert.name} hat ein Free-Model (${configuredModel}) konfiguriert. Ausführung blockiert.`);
      trace(agentId, companyId, 'error', 'Free-Model blockiert',
        `Modell "${configuredModel}" ist ein kostenloses Modell und wurde aus Stabilitätsgründen blockiert. Bitte wechsle zu einem bezahlten Modell.`);
      return;
    }

    // CEO-Agenten: 'ceo' Verbindung ODER Orchestrator-Flag gesetzt.
    // Ausnahme: Wenn der Nutzer explizit 'claude-code' oder 'anthropic' wählt,
    // wird die Wahl respektiert — diese haben eigene Adapter und brauchen keinen API-Key.
    const explicitAdapter = ['claude-code', 'anthropic', 'gemini-cli', 'codex-cli', 'kimi-cli', 'ollama', 'ollama_cloud', 'bash', 'http'];
    const useExplicitAdapter = explicitAdapter.includes(expert.connectionType || '');
    const isCEO = !useExplicitAdapter && (expert.connectionType === 'ceo' || isOrchestrator);

    const finalAdapterType = isCEO ? 'ceo' : adapterType;
    const adapter = getAdapter(finalAdapterType);

    if (!adapter) {
      trace(agentId, companyId, 'error', `Adapter nicht gefunden: ${finalAdapterType}`);
      console.error(`Adapter ${finalAdapterType} nicht gefunden für Experte ${agentId}`);
      return;
    }

    const laufId = uuid();
    db.insert(workCycles).values({
      id: laufId,
      companyId,
      agentId,
      quelle,
      status: 'running',
      gestartetAm: now(),
      createdAt: now(),
    }).run();

    // Status auf 'running' setzen
    db.update(agents).set({ status: 'running', lastCycle: now(), updatedAt: now() }).where(eq(agents.id, agentId)).run();
    trace(agentId, companyId, 'info', `Arbeitszyklus gestartet`, `Quelle: ${quelle} · Adapter: ${expert.connectionType}`, laufId);

    // Kontext sammeln
    // Load todo + in_progress + blocked tasks (so agent knows what to work on next)
    const expertAufgaben = db.select().from(tasks)
      .where(and(
        eq(tasks.assignedTo, agentId),
      ))
      .all()
      .filter((a: any) => a.status === 'todo' || a.status === 'in_progress' || a.status === 'blocked');
    // Maximizer Mode: Wenn mindestens eine zugewiesene Aufgabe isMaximizerMode hat, gelten keine Limits
    const isMaximizerActive = expertAufgaben.some((a: any) => a.isMaximizerMode);

    // Sort by priority score so the agent sees the most urgent tasks first
    const sortedAufgaben = [...expertAufgaben].sort((a, b) => taskPriorityScore(b) - taskPriorityScore(a));

    const tasksStrings = sortedAufgaben.map((a: any) => `[${a.id.slice(0,8)}] ${sanitizeForPrompt(a.title, 120)} (${a.status}${(a as any).isMaximizerMode ? ' MAXIMIZER' : ''}${a.description ? ': ' + sanitizeForPrompt(a.description, 80) : ''})`);
    if (tasksStrings.length > 0) {
      trace(agentId, companyId, 'thinking', `Aufgaben laden`, `${tasksStrings.length} aktive Aufgabe(n): ${tasksStrings.slice(0, 3).join(', ')}${tasksStrings.length > 3 ? '…' : ''}`, laufId);
    }

    // Load team members for agent-to-agent messaging
    const alleExperten = db.select({
      id: agents.id, name: agents.name, role: agents.role,
      status: agents.status, letzterZyklus: agents.lastCycle,
      reportsTo: agents.reportsTo, isOrchestrator: agents.isOrchestrator,
    }).from(agents).where(eq(agents.companyId, companyId)).all()
      .filter((e: any) => e.id !== agentId);

    // Build team context string
    let teamContext = '';
    if (expert.reportsTo) {
      const supervisor = alleExperten.find((e: any) => e.id === expert.reportsTo);
      teamContext = supervisor
        ? `Vorgesetzter: ${supervisor.name} (${supervisor.role})`
        : `Vorgesetzter-ID: ${expert.reportsTo}`;
    } else {
      teamContext = 'Vorgesetzter: Board (oberste Ebene)';
    }

    // ── Orchestrator: rich team status context ─────────────────────────────
    if (expert.isOrchestrator) {
      // Direct reports (agents that report to this orchestrator)
      const directReports = alleExperten.filter((e: any) => e.reportsTo === agentId);

      if (directReports.length > 0) {
        // Load active task counts per report
        const now_ts = new Date().toISOString();
        const reportIds = directReports.map((e: any) => e.id);
        const teamTasks = db.select({
          zugewiesenAn: tasks.assignedTo,
          status: tasks.status,
          titel: tasks.title,
          prioritaet: tasks.priority,
        }).from(tasks)
          .where(and(eq(tasks.companyId, companyId), inArray(tasks.assignedTo, reportIds)))
          .all();

        const tasksByAgent: Record<string, any[]> = {};
        for (const t of teamTasks) {
          if (!tasksByAgent[t.assignedTo]) tasksByAgent[t.assignedTo] = [];
          tasksByAgent[t.assignedTo].push(t);
        }

        // Load latest trace event per direct report for accurate status
        const latestTraceByAgent: Record<string, string> = {};
        for (const e of directReports) {
          try {
            const latestTrace = db.select({
              typ: traceEvents.type,
              titel: traceEvents.title,
              erstelltAm: traceEvents.createdAt,
            }).from(traceEvents)
              .where(eq(traceEvents.agentId, e.id))
              .orderBy(desc(traceEvents.createdAt))
              .limit(1)
              .get() as any;
            if (latestTrace) {
              const diffMin = Math.floor((Date.now() - new Date(latestTrace.createdAt).getTime()) / 60000);
              latestTraceByAgent[e.id] = `last action ${diffMin}m ago: ${sanitizeForPrompt(latestTrace.title, 80)}`;
            }
          } catch { /* skip */ }
        }

        const reportLines = directReports.map((e: any) => {
          const agentTasks = tasksByAgent[e.id] || [];
          const activeTasks = agentTasks.filter((t: any) => !['done', 'abgeschlossen', 'cancelled'].includes(t.status));
          const inProgressTasks = activeTasks.filter((t: any) => t.status === 'in_progress');
          const doneTasks = agentTasks.filter((t: any) => ['done', 'abgeschlossen'].includes(t.status));
          const statusEmoji: Record<string, string> = { active: '🟢', running: '⚡', idle: '⏸', paused: '🔴', error: '❌', terminated: '💀' };
          const lastSeen = e.lastCycle
            ? (() => { const diff = Date.now() - new Date(e.lastCycle).getTime(); const m = Math.floor(diff/60000); return m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`; })()
            : 'never';
          const currentTask = inProgressTasks[0] || activeTasks[0];
          const topTask = currentTask ? ` | CURRENTLY: "${sanitizeForPrompt(currentTask.title, 100)}" [${currentTask.status}/${currentTask.priority}]` : ' | NO ACTIVE TASK';
          const lastTrace = latestTraceByAgent[e.id] ? ` | ${latestTraceByAgent[e.id]}` : '';
          return `  ${statusEmoji[e.status] || '⬜'} ${e.name} (${e.role}) [ID:${e.id.slice(0,8)}] — status:${e.status}, ${activeTasks.length} open tasks (${inProgressTasks.length} in_progress), ${doneTasks.length} done, last_seen:${lastSeen}${topTask}${lastTrace}`;
        }).join('\n');

        teamContext += `\n\n═══ DEIN TEAM (DIREKTE BERICHTE) ═══\n${reportLines}`;

        // Unassigned tasks in the company (orchestrator can delegate these)
        const unassigned = db.select({ id: tasks.id, titel: tasks.title, prioritaet: tasks.priority, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.companyId, companyId), isNull(tasks.assignedTo)))
          .all()
          .filter((t: any) => !['done', 'cancelled'].includes(t.status));

        if (unassigned.length > 0) {
          teamContext += `\n\n═══ NICHT ZUGEWIESENE AUFGABEN ═══\n${unassigned.slice(0, 10).map((t: any) => `  [${t.id.slice(0,8)}] ${sanitizeForPrompt(t.title, 120)} (${t.priority}/${t.status})`).join('\n')}`;
        }
      }
    }

    // Skill Library: Smart RAG — score skills by relevance to current tasks
    const allAssignedSkills = db.select({ skill: skillsLibrary }).from(agentSkills)
      .innerJoin(skillsLibrary, eq(agentSkills.skillId, skillsLibrary.id))
      .where(eq(agentSkills.agentId, agentId)).all().map((r: any) => r.skill);

    let skillContext = '';
    if (allAssignedSkills.length > 0) {
      // Build query from current tasks + agent role for relevance scoring
      const queryText = (tasksStrings.join(' ') + ' ' + expert.role + ' ' + (expert.skills || '')).toLowerCase();

      // ── Semantic matching (MiniLM-L6-v2) with BM25 keyword fallback ────────
      let toInject: any[] = [];
      let matchMethod = 'semantic';

      if (embeddingsAvailable) {
        try {
          const topSkills = await findRelevantSkills(queryText, allAssignedSkills, 5);
          toInject = topSkills.map((skill: any) => ({ skill }));
        } catch (err) {
          // Embedding call failed — fall through to BM25
          matchMethod = 'bm25-fallback';
        }
      } else {
        matchMethod = 'bm25-fallback';
      }

      if (matchMethod === 'bm25-fallback') {
        // BM25 keyword overlap (original logic)
        const queryWords = queryText.split(/\W+/).filter((w: string) => w.length > 3);
        const scored = allAssignedSkills.map((skill: any) => {
          const skillText = `${skill.name} ${skill.description ?? ''} ${skill.content}`.toLowerCase();
          const score = queryWords.reduce((s: number, w: string) => s + (skillText.includes(w) ? 1 : 0), 0);
          return { skill, score };
        });
        const relevant = scored
          .filter((s: any) => s.score > 0)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 5);
        toInject = relevant.length > 0 ? relevant : scored.slice(0, 3);
      }

      if (toInject.length > 0) {
        trace(agentId, companyId, 'action', `Skills (RAG/${matchMethod})`, `${toInject.length}/${allAssignedSkills.length} Skill(s) relevant: ${toInject.map((s: any) => s.skill.name).join(', ')}`, laufId);
        skillContext = '\n\nWISSENSBASIS (Skills, nach Relevanz):\n' + toInject.map((s: any) =>
          `### ${s.skill.name}\n${s.skill.content.slice(0, 1500)}`
        ).join('\n\n');
      }
    }

    
    // Task workspace: prefer task-specific path, fall back to agent/company/root
    const activeTaskWorkspace = expertAufgaben.find((t: any) => t.workspacePath)?.workspacePath || null;
    const effectiveWorkDir = resolveWorkDir(agentId, companyId, activeTaskWorkspace);
    const isCustomWorkDir = effectiveWorkDir !== process.cwd();

    // Tools Erklärung
    const workDirContext = isCustomWorkDir
      ? `\n\nARBEITSVERZEICHNIS: ${effectiveWorkDir}\nDu arbeitest AUSSCHLIESSLICH in diesem Ordner. Alle Dateioperationen sind relativ dazu.\nBeispiele:\n  Lesen:     { "action": "file_read",  "params": { "path": "./README.md" } }\n  Schreiben: { "action": "file_write", "params": { "path": "./output/ergebnis.md", "content": "..." } }\n  Auflisten: { "action": "list_files", "params": { "path": "." } }\n`
      : `\n\n⚠️ Kein Arbeitsverzeichnis konfiguriert. Bitte in den Unternehmens-Einstellungen ein Projektverzeichnis setzen.\n`;

    const toolsContext = `
VERFÜGBARE TOOLS (Ausgabe als JSON in \`\`\`json Block):
- { "action": "create_task", "params": { "titel": "...", "beschreibung": "...", "zugewiesenAn": "id" } }
- { "action": "update_task_status", "params": { "id": "...", "status": "in_progress|done" } }
- { "action": "chat", "params": { "nachricht": "text", "empfaenger": "ID-eines-Kollegen (optional)" } }
- { "action": "memory_search", "params": { "query": "Suchbegriff" } }
- { "action": "memory_add_drawer", "params": { "wing": "dein_name", "room": "notizen", "content": "Wichtiges Wissen..." } }
- { "action": "memory_diary_write", "params": { "date": "2026-04-11", "thought": "...", "action": "...", "knowledge": "..." } }
- { "action": "memory_list_wings", "params": {} }
- { "action": "memory_traverse", "params": { "wing": "name", "room": "optional" } }
- { "action": "memory_kg_add", "params": { "subject": "...", "predicate": "...", "object": "...", "valid_from": "2026-04-11" } }
- { "action": "memory_kg_query", "params": { "subject": "...", "predicate": "optional" } }
- { "action": "session_search", "params": { "query": "Suchbegriff" } }
- { "action": "canvas_present", "params": { "nodeId": "...", "url": "https://..." } }
- { "action": "canvas_present_html", "params": { "nodeId": "...", "html": "<h1>Hallo</h1>" } }
- { "action": "canvas_snapshot", "params": { "nodeId": "..." } }
- { "action": "canvas_eval", "params": { "nodeId": "...", "script": "document.title" } }
- { "action": "canvas_clear", "params": { "nodeId": "..." } }
- { "action": "camera_snap", "params": { "nodeId": "..." } }
- { "action": "screen_record", "params": { "nodeId": "...", "durationSec": 10 } }
- { "action": "location_get", "params": { "nodeId": "..." } }
- { "action": "clipboard_read", "params": { "nodeId": "..." } }
- { "action": "hire_agent", "params": { "name": "...", "rolle": "...", "faehigkeiten": "...", "connectionType": "openrouter" } }
- { "action": "call_meeting", "params": { "frage": "Eure Einschätzung zu X?", "teilnehmer": ["AGENT_ID_1", "AGENT_ID_2"] } }
- { "action": "delegate_task", "params": { "taskId": "TASK_ID", "agentId": "AGENT_ID", "message": "Briefing für den Agenten (optional)" } }
- { "action": "add_dependency", "params": { "blockerId": "...", "blockedId": "..." } }
- { "action": "file_read", "params": { "path": "./hallo.txt" } }
- { "action": "file_write", "params": { "path": "./hallo.txt", "content": "hello world" } }
- { "action": "list_files", "params": { "path": "." } }
- { "action": "invoke_device_sensor", "params": { "nodeId": "...", "action": "system.notify", "params": { "title": "...", "message": "..." } } }
- { "action": "send_channel_message", "params": { "channel": "telegram", "recipient": "ID (optional)", "text": "..." } }
${workDirContext}

SKILL-GENERIERUNG (Learning Loop):
Wenn du eine wiederverwendbare Lösung findest, kannst du sie als Skill taggen:
[SKILL:Name] ...Markdown-Inhalt... [/SKILL:Name]
Das System speichert diese automatisch und stellt sie dir bei zukünftigen Tasks bereit.`;

    // Lade ungelesene Nachrichten (CEO + SYSTEM BEOBACHTUNGEN)
    const unreadMsgs = db.select().from(chatMessages)
      .where(and(eq(chatMessages.agentId, agentId), eq(chatMessages.read, false)))
      .all();

    // P2P: messages from a peer agent (vonExpertId set) — these are direct agent-to-agent messages
    const peerMsgs = unreadMsgs.filter((m: any) => m.senderType === 'agent' && m.vonExpertId);
    // Board / normal chat messages
    const boardMsgs = unreadMsgs.filter((m: any) => m.senderType === 'board' || (m.senderType === 'agent' && !m.vonExpertId));

    const chatContext = boardMsgs.map((m: any) =>
      m.senderType === 'board' ? `CEO: ${m.message}` : `Kollege: ${m.message}`
    );

    const systemObservations = unreadMsgs
      .filter((m: any) => m.senderType === 'system')
      .map((m: any) => m.message);

    const isPeerTriggered = vonExpertId != null || peerMsgs.length > 0;

    if (isPeerTriggered) {
      const senderLabel = vonExpertId
        ? (db.select({ name: agents.name }).from(agents).where(eq(agents.id, vonExpertId)).get() as any)?.name || 'Kollege'
        : 'Kollege';
      trace(agentId, companyId, 'thinking', `P2P Nachricht von ${senderLabel}`, `${peerMsgs.length} Nachricht(en)${meetingId ? ` · Meeting ${meetingId.slice(0,8)}` : ''}`, laufId);
    } else if (chatContext.length > 0) {
      trace(agentId, companyId, 'thinking', `Neue Nachrichten`, `${chatContext.length} Nachricht(en) vom Board`, laufId);
    }

    if (unreadMsgs.length > 0) {
      for (const m of unreadMsgs) {
        db.update(chatMessages).set({ read: true }).where(eq(chatMessages.id, m.id)).run();
      }
    }

    const apiKey = resolvedApiKey;

    // Load global default model for agents without a specific model configured
    let globalDefaultModel: string | undefined;
    const defaultModelKey = adapterType === 'ollama' ? 'ollama_default_model' : 'openrouter_default_model';
    if (adapterType === 'openrouter' || adapterType === 'ollama') {
      try {
        const defaultModelRow = db.select({ wert: settings.value })
          .from(settings)
          .where(and(eq(settings.key, defaultModelKey), eq(settings.companyId, companyId)))
          .get()
          ?? db.select({ wert: settings.value })
            .from(settings)
            .where(and(eq(settings.key, defaultModelKey), eq(settings.companyId, '')))
            .get();
        if (defaultModelRow?.value) {
          globalDefaultModel = decryptSetting(defaultModelKey, defaultModelRow.value);
        }
      } catch { /* ignore */ }
    }

    trace(agentId, companyId, 'action', `LLM-Anfrage senden`, `Modell: ${adapterType}`, laufId);

    // --- ITERATIVE CONTEXT-KOMPRESSION (Learning Loop-Vorbild) ---
    // Statt Kontext zu verwerfen, wird eine strukturierte Zusammenfassung erstellt/aktualisiert.
    const kontextLaenge = chatContext.join('\n').length + systemObservations.join('\n').length;
    if (sollteKomprimieren(kontextLaenge)) {
      const turnText = [...chatContext, ...systemObservations].join('\n\n');
      komprimiereKontext(agentId, companyId, turnText);
      trace(agentId, companyId, 'info', '📋 Kontext komprimiert', `${kontextLaenge} Zeichen → iterative Summary aktualisiert`);
    }

    // Summary in den Kontext laden (wenn vorhanden)
    const existingSummary = ladeSummary(agentId);
    if (existingSummary) {
      teamContext += `\n\n${existingSummary}`;
    }

    // --- MEMORY AUTO-LOAD (relevante Erinnerungen injizieren) ---
    const taskKeywords = tasksStrings
      .concat(chatContext)
      .join(' ')
      .split(/\W+/)
      .filter(w => w.length > 4)
      .slice(0, 15);
    const memoryContext = loadRelevantMemory(agentId, taskKeywords);
    if (memoryContext) {
      teamContext += memoryContext;
    }

    // Determine UI language for this company → agents respond accordingly
    const uiLang = getUiLanguage(companyId);
    const li = langInstruction(uiLang);

    // Build prompt — priority: peer message > board message > observations > default cycle
    let basePrompt: string;
    if (isPeerTriggered && (peerMsgs.length > 0 || vonExpertId)) {
      // Responding to a peer agent (P2P or meeting)
      const senderName = vonExpertId
        ? (db.select({ name: agents.name }).from(agents).where(eq(agents.id, vonExpertId)).get() as any)?.name || (uiLang === 'en' ? 'Colleague' : 'Kollege')
        : (uiLang === 'en' ? 'Colleague' : 'Kollege');
      const peerText = peerMsgs.length > 0
        ? peerMsgs.map((m: any) => m.message).join('\n')
        : (uiLang === 'en' ? '(Waiting for your assessment)' : '(Warte auf deine Einschätzung)');
      const meetingContext = meetingId
        ? (uiLang === 'en'
            ? `\nThis is part of a meeting (ID: ${meetingId.slice(0,8)}). Respond factually and concisely.`
            : `\nDies ist Teil eines Meetings (ID: ${meetingId.slice(0,8)}). Antworte sachlich und prägnant.`)
        : '';
      basePrompt = uiLang === 'en'
        ? `You received a direct message from your colleague ${senderName}.${meetingContext}
${li} No JSON needed — plain text is fine.
If you want to perform an action, you may add a JSON block.

${systemObservations.length > 0 ? `Last action results:\n${systemObservations.join('\n\n')}\n\n` : ''}Message from ${senderName}:
${peerText}`
        : `Du hast eine direkte Nachricht von deinem Kollegen ${senderName} erhalten.${meetingContext}
${li} Kein JSON nötig — einfacher Text genügt.
Wenn du eine Aktion ausführen möchtest, kannst du zusätzlich einen JSON-Block nutzen.

${systemObservations.length > 0 ? `Letzte Aktionsergebnisse:\n${systemObservations.join('\n\n')}\n\n` : ''}Nachricht von ${senderName}:
${peerText}`;
    } else if (quelle === 'manual' && chatContext.length > 0) {
      const meetingCtx = meetingId
        ? (uiLang === 'en'
            ? `\n\nYou are a participant in an active meeting. Respond directly to the meeting question — brief, specific, 2-4 sentences. NO JSON needed.`
            : `\n\nDu bist Teilnehmer eines aktiven Meetings. Antworte direkt auf die Meeting-Frage — kurz, konkret, 2-4 Sätze. KEIN JSON nötig.`)
        : '';

      const teamList = alleExperten
        .filter((e: any) => e.id !== agentId)
        .map((e: any) => `  • ${e.name} (ID: ${e.id}) — ${e.role}`)
        .join('\n');

      if (uiLang === 'en') {
        basePrompt = `You received a direct message from the board. ${li}${meetingCtx}

For simple questions (status, small talk) reply with plain text.
If the board asks you to do something — create task, delegate, change status — perform the action and briefly confirm it.

AVAILABLE ACTIONS (as separate JSON blocks after your reply):

Create task:
\`\`\`json
{"action": "create_task", "params": {"titel": "Title", "beschreibung": "Details", "zugewiesenAn": "agent-id or null"}}
\`\`\`

Delegate task:
\`\`\`json
{"action": "delegate_task", "params": {"taskId": "task-id", "agentId": "agent-id", "message": "Briefing"}}
\`\`\`

Update task status:
\`\`\`json
{"action": "update_task_status", "params": {"id": "task-id", "status": "todo|in_progress|in_review|done|blocked"}}
\`\`\`

Call a meeting:
\`\`\`json
{"action": "call_meeting", "params": {"frage": "Question for the team", "teilnehmer": ["agent-id-1", "agent-id-2"]}}
\`\`\`

Create routine/schedule:
\`\`\`json
{"action": "create_routine", "params": {"titel": "Daily Post", "beschreibung": "Posts daily content", "cronExpression": "0 10 * * *", "timezone": "Europe/Berlin"}}
\`\`\`

Store credentials/API keys:
\`\`\`json
{"action": "store_secret", "params": {"name": "api_token", "value": "the-token-value", "description": "API Token"}}
\`\`\`

Hire new agent:
\`\`\`json
{"action": "hire_agent", "params": {"name": "Social Media Manager", "rolle": "Content & Social Media", "faehigkeiten": "Instagram, Content Creation", "connectionType": "openrouter"}}
\`\`\`

${teamList ? `TEAM:\n${teamList}\n` : ''}
${tasksStrings.length > 0 ? `YOUR TASKS:\n${tasksStrings.join('\n')}\n` : ''}
Board message(s):
${chatContext.join('\n')}
${systemObservations.length > 0 ? `\nLast action results:\n${systemObservations.join('\n\n')}` : ''}`;
      } else {
        basePrompt = `Du hast eine direkte Nachricht vom Board erhalten. ${li}${meetingCtx}

Bei einfachen Fragen (Status, Smalltalk) antworte mit normalem Text.
Wenn das Board dich bittet etwas zu tun — Aufgabe erstellen, delegieren, Status ändern — führe die Aktion aus und bestätige sie kurz.

VERFÜGBARE AKTIONEN (als separate JSON-Blöcke nach deiner Antwort):

Aufgabe erstellen:
\`\`\`json
{"action": "create_task", "params": {"titel": "Titel", "beschreibung": "Details", "zugewiesenAn": "agent-id oder null"}}
\`\`\`

Aufgabe delegieren:
\`\`\`json
{"action": "delegate_task", "params": {"taskId": "task-id", "agentId": "agent-id", "message": "Briefing"}}
\`\`\`

Task-Status ändern:
\`\`\`json
{"action": "update_task_status", "params": {"id": "task-id", "status": "todo|in_progress|in_review|done|blocked"}}
\`\`\`

Meeting einberufen:
\`\`\`json
{"action": "call_meeting", "params": {"frage": "Frage ans Team", "teilnehmer": ["agent-id-1", "agent-id-2"]}}
\`\`\`

Automatische Routine/Schedule einrichten:
\`\`\`json
{"action": "create_routine", "params": {"titel": "Täglicher Post", "beschreibung": "Postet täglich Content", "cronExpression": "0 10 * * *", "timezone": "Europe/Berlin"}}
\`\`\`

Credentials/API-Keys sicher speichern:
\`\`\`json
{"action": "store_secret", "params": {"name": "api_token", "value": "der-token-wert", "description": "API Token"}}
\`\`\`

Neuen Agenten einstellen:
\`\`\`json
{"action": "hire_agent", "params": {"name": "Social Media Manager", "rolle": "Content & Social Media", "faehigkeiten": "Instagram, Content Creation", "connectionType": "openrouter"}}
\`\`\`

${teamList ? `TEAM:\n${teamList}\n` : ''}
${tasksStrings.length > 0 ? `DEINE AUFGABEN:\n${tasksStrings.join('\n')}\n` : ''}
Boardnachricht(en):
${chatContext.join('\n')}
${systemObservations.length > 0 ? `\nLetzte Aktionsergebnisse:\n${systemObservations.join('\n\n')}` : ''}`;
      }
    } else if (systemObservations.length > 0) {
      basePrompt = uiLang === 'en'
        ? `Last observations from your actions:\n${systemObservations.join('\n\n')}\n\nAnalyse these results and continue.`
        : `Letzte Beobachtungen deiner Aktionen:\n${systemObservations.join('\n\n')}\n\nAnalysiere diese Ergebnisse und fahre fort.`;
    } else {
      basePrompt = uiLang === 'en'
        ? `Work cycle. Evaluate your tasks and move them forward.`
        : `Arbeitszyklus. Evaluiere deine Aufgaben und treibe sie voran.`;
    }

    // ── Orchestrator Mode Override ──────────────────────────────────────────
    // When an orchestrator is woken by the scheduler or board (not P2P), replace
    // the generic basePrompt with a coordination-focused prompt.
    if (expert.isOrchestrator && !isPeerTriggered) {
      const boardSection = chatContext.length > 0
        ? `\n\nNachricht vom Board:\n${chatContext.join('\n')}`
        : '';
      const obsSection = systemObservations.length > 0
        ? `\n\nLetzte Aktionsergebnisse:\n${systemObservations.join('\n\n')}`
        : '';
      const ownTaskSection = tasksStrings.length > 0
        ? `\n\nDeine eigenen Aufgaben (${tasksStrings.length}):\n${tasksStrings.join('\n')}`
        : '\n\nKeine eigenen Aufgaben in der Queue.';

      // Load active goals with live task progress for orchestrator
      let goalsSection = '';
      try {
        const activeGoals = db.select({
          id: goals.id, titel: goals.title, beschreibung: goals.description,
        }).from(goals)
          .where(and(eq(goals.companyId, companyId), inArray(goals.status, ['active', 'planned'])))
          .orderBy(asc(goals.createdAt))
          .limit(5).all();

        if (activeGoals.length > 0) {
          const goalLines = activeGoals.map(g => {
            const linked = db.select({ status: tasks.status })
              .from(tasks).where(and(eq(tasks.goalId, g.id), eq(tasks.companyId, companyId))).all();
            const done = linked.filter(t => t.status === 'done').length;
            const total = linked.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
            const open = linked.filter(t => t.status !== 'done');
            const openList = open.slice(0, 3).map((t: any) => `    - ${(t as any).title || '?'}`).join('\n');
            return `  • ${g.title} [${bar}] ${pct}% (${done}/${total} Tasks)${openList ? `\n    Offene Tasks:\n${openList}` : ''}`;
          });
          goalsSection = `\n\n🎯 STRATEGISCHE ZIELE:\n${goalLines.join('\n')}`;
        }
      } catch {}

      // Load unassigned tasks with goal links for delegation recommendations
      const unassigned = db.select({
        id: tasks.id, titel: tasks.title, prioritaet: tasks.priority, zielId: tasks.goalId,
      }).from(tasks)
        .where(and(eq(tasks.companyId, companyId), isNull(tasks.assignedTo), inArray(tasks.status, ['todo', 'backlog'])))
        .limit(8).all();

      const unassignedSection = unassigned.length > 0
        ? `\n\n📋 UNDELEGIERTE AUFGABEN (${unassigned.length}):\n${unassigned.map(t => `  • [${t.priority.toUpperCase()}] ${t.title} (ID: ${t.id})${t.goalId ? ' 🎯' : ''}`).join('\n')}`
        : '';

      // ── Risk Signals: computed situation awareness for the CEO ─────────────
      // Surfaces actionable problems the CEO should address this cycle.
      let riskSection = '';
      try {
        const risks: string[] = [];
        const now_ts = Date.now();

        // 1. Stale in-progress tasks (>24h without update → agent might be stuck)
        const staleThreshold = now_ts - 24 * 60 * 60 * 1000;
        const staleTasks = db.select({
          id: tasks.id, titel: tasks.title, zugewiesenAn: tasks.assignedTo, aktualisiertAm: tasks.updatedAt,
        }).from(tasks)
          .where(and(eq(tasks.companyId, companyId), eq(tasks.status, 'in_progress')))
          .all()
          .filter((t: any) => t.updatedAt && new Date(t.updatedAt).getTime() < staleThreshold);

        if (staleTasks.length > 0) {
          const staleLines = staleTasks.slice(0, 3).map((t: any) => {
            const agent = alleExperten.find((e: any) => e.id === t.assignedTo);
            const hoursAgo = Math.round((now_ts - new Date(t.updatedAt).getTime()) / 3_600_000);
            return `  ⚠️ "${sanitizeForPrompt(t.title, 60)}" → ${agent?.name || '?'} (${hoursAgo}h ohne Update)`;
          }).join('\n');
          risks.push(`STALE TASKS (${staleTasks.length}):\n${staleLines}`);
        }

        // 2. Budget-critical agents with open work
        const budgetCritical = db.select({
          id: agents.id, name: agents.name, budgetMonatCent: agents.monthlyBudgetCent, monthlySpendCent: agents.monthlySpendCent,
        }).from(agents)
          .where(and(eq(agents.companyId, companyId), ne(agents.monthlyBudgetCent, 0)))
          .all()
          .filter((a: any) => a.monthlyBudgetCent > 0 && a.monthlySpendCent / a.monthlyBudgetCent >= 0.85);

        if (budgetCritical.length > 0) {
          const budgetLines = budgetCritical.map((a: any) =>
            `  💸 ${a.name}: ${Math.round(a.monthlySpendCent / a.monthlyBudgetCent * 100)}% Budget verbraucht`
          ).join('\n');
          risks.push(`BUDGET-WARNUNG:\n${budgetLines}`);
        }

        // 3. Goals with 0 progress and no assigned tasks (gap in planning)
        const goalsWithNoWork = db.select({ id: goals.id, titel: goals.title }).from(goals)
          .where(and(eq(goals.companyId, companyId), eq(goals.status, 'active')))
          .all()
          .filter((g: any) => {
            const linked = db.select({ status: tasks.status }).from(tasks)
              .where(and(eq(tasks.goalId, g.id), inArray(tasks.status, ['todo', 'in_progress']))).all();
            return linked.length === 0;
          });

        if (goalsWithNoWork.length > 0) {
          const goalLines = goalsWithNoWork.slice(0, 3).map((g: any) => `  🎯 "${sanitizeForPrompt(g.title, 60)}" — keine aktiven Tasks!`).join('\n');
          risks.push(`ZIELE OHNE AKTIVE TASKS:\n${goalLines}`);
        }

        if (risks.length > 0) {
          riskSection = uiLang === 'en'
            ? `\n\n🚨 SITUATION RISKS (address these this cycle):\n${risks.join('\n\n')}`
            : `\n\n🚨 RISIKO-SIGNALE (in diesem Zyklus angehen):\n${risks.join('\n\n')}`;
        }
      } catch { /* non-critical — risk analysis must not break the orchestrator */ }

      basePrompt = uiLang === 'en'
        ? `You are ${expert.name}, Orchestrator and strategic manager of your team.
Your primary task is coordination and delegation — NOT technical execution yourself.${goalsSection}${riskSection}${boardSection}${obsSection}${ownTaskSection}${unassignedSection}

YOUR TASKS AS ORCHESTRATOR:
1. 🎯 GOAL ALIGNMENT: Prioritize tasks that advance active goals
2. 📤 DELEGATION: Assign unassigned tasks to suitable agents (→ delegate_task with agentId + taskId)
3. 💬 COMMUNICATION: Send briefings to agents when needed (→ chat)
4. 🔍 IDENTIFY BLOCKERS: Proactively address blocked agents (→ chat or call_meeting)
5. ➕ CLOSE GAPS: Create missing sub-tasks when goals aren't covered (→ create_task)
6. 📣 REPORT TO BOARD: Use chat (no empfaenger) to notify the board when:
   - A major milestone or deliverable is completed
   - You need more tasks, budget or decisions from the board
   - Something is blocked that you cannot resolve yourself
   - You have an important status update (weekly summary, etc.)
   The board receives your chat messages on Telegram — use this for anything they need to know.

${li}
Respond with a brief strategic situation analysis (2-3 sentences) and concrete JSON actions.
If everything runs optimally: short status text without JSON.`
        : `Du bist ${expert.name}, Orchestrator und strategischer Manager deines Teams.
Deine Hauptaufgabe ist Koordination und Delegation — NICHT die eigene technische Ausführung.${goalsSection}${riskSection}${boardSection}${obsSection}${ownTaskSection}${unassignedSection}

DEINE AUFGABEN ALS ORCHESTRATOR:
1. 🎯 ZIEL-AUSRICHTUNG: Priorisiere Aufgaben die aktive Ziele voranbringen
2. 📤 DELEGATION: Weise unzugewiesene Tasks an passende Agenten zu (→ delegate_task mit agentId + taskId)
3. 💬 KOMMUNIKATION: Briefings an Agenten senden wenn nötig (→ chat)
4. 🔍 BLOCKER ERKENNEN: Blockierte Agenten aktiv ansprechen (→ chat oder call_meeting)
5. ➕ LÜCKEN SCHLIESSEN: Fehlende Sub-Tasks erstellen wenn Ziele nicht abgedeckt sind (→ create_task)
6. 📣 BOARD INFORMIEREN: Nutze chat (ohne empfaenger) um das Board zu benachrichtigen wenn:
   - Ein wichtiger Meilenstein oder ein Ergebnis fertig ist (z.B. "Landing Page ist live")
   - Du neue Aufgaben, Budget oder Entscheidungen vom Board brauchst
   - Etwas blockiert ist das du nicht selbst lösen kannst
   - Du einen wichtigen Status-Update hast
   Das Board erhält deine Chat-Nachrichten per Telegram — nutze das für alles Relevante.

${li}
Wenn alles optimal läuft: kurzer Status-Text ohne JSON.`;
    }

    // Maximizer Mode Injection: Agent wird aggressiver und autonomer
    if (isMaximizerActive) {
      basePrompt += `\n\n⚡ MAXIMIZER MODE AKTIV ⚡
Du arbeitest im Maximizer-Modus. Budget-Limits sind aufgehoben.
- Arbeite mit maximaler Geschwindigkeit und Entschlossenheit.
- Du darfst autonom Sub-Tasks erstellen und an Kollegen delegieren, ohne Board-Genehmigung.
- Wenn ein Blocker existiert, eskaliere sofort oder finde einen Workaround.
- Ziel ist: Um jeden Preis das Ergebnis liefern.`;
    }

    // ── Context length guard (rough estimate: 1 token ≈ 4 chars) ──────────────
    // Most free OpenRouter models cap at 128k–262k tokens. Cap total context at
    // ~200k tokens (~800k chars) to leave room for output and system prompt.
    const MAX_CONTEXT_CHARS = 800_000;
    const totalContextChars =
      basePrompt.length +
      ((expert.skills || '').length) +
      skillContext.length + toolsContext.length +
      teamContext.length;
    if (totalContextChars > MAX_CONTEXT_CHARS) {
      // First truncate basePrompt (least critical parts), then skillContext
      const overhead = totalContextChars - MAX_CONTEXT_CHARS;
      if (basePrompt.length > overhead + 2000) {
        basePrompt = basePrompt.slice(0, basePrompt.length - overhead - 1000) + '\n...[Kontext gekürzt — zu lang]';
      } else {
        // Last resort: truncate skill context
        skillContext = skillContext.slice(0, Math.max(500, skillContext.length - overhead));
      }
      trace(agentId, companyId, 'info', 'Kontext gekürzt', `Gesamtkontext war ${Math.round(totalContextChars/4000)}k tokens — auf ${Math.round(MAX_CONTEXT_CHARS/4000)}k tokens reduziert`, laufId);
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Führe Adapter aus
    let result: Awaited<ReturnType<typeof adapter.run>>;
    try {
      result = await adapter.run({
        agentId,
        expertName: expert.name,
        companyId,
        companyName: company.name,
        role: expert.role,
        skills: (expert.skills || '') + skillContext + toolsContext,
        prompt: basePrompt,
        tasks: tasksStrings,
        teamContext,
        teamMembers: alleExperten,
        chatMessages: chatContext,
        apiKey,
        apiBaseUrl: API_BASE_URL,
        connectionType: adapterType,
        connectionConfig: expert.connectionConfig,
        globalDefaultModel,
      });
    } catch (adapterErr: any) {
      console.error(`[Scheduler] adapter.run() threw for ${expert.name}:`, adapterErr?.message);
      trace(agentId, companyId, 'error', `Adapter-Exception`, adapterErr?.message ?? 'Unbekannt', laufId);
      db.update(workCycles).set({ status: 'failed', beendetAm: now(), fehler: adapterErr?.message }).where(eq(workCycles.id, laufId)).run();
      db.update(agents).set({ status: 'error' as any, updatedAt: now() }).where(eq(agents.id, agentId)).run();
      return;
    }

    // Nachbehandlung
    let newStatus = expert.status;
    if (result.success) {
      newStatus = 'active';
      trace(agentId, companyId, 'result', `Antwort erhalten`, result.output?.slice(0, 300) + (result.output?.length > 300 ? '…' : ''), laufId);

      // Extract JSON actions from output
      const chatAction = this.extractChatAction(result.output);

      const replyText = chatAction || result.output || '(Keine Antwort)';

      // ── CEO Meeting Synthesis: save result to agentMeetings.result ────
      if (meetingId && !vonExpertId && replyText.trim()) {
        db.update(agentMeetings)
          .set({ result: replyText.trim() })
          .where(eq(agentMeetings.id, meetingId))
          .run();
        broadcast('meeting_updated', { companyId, meetingId, ergebnis: replyText.trim(), status: 'completed' });
        trace(agentId, companyId, 'info', `Meeting Synthesis gespeichert`, `"${replyText.slice(0, 80)}…"`);
      }

      if (isPeerTriggered && vonExpertId) {
        // ── P2P / Meeting: route response back to sender ──────────────────
        const responseMsg = {
          id: uuid(),
          companyId,
          agentId: vonExpertId,
          vonExpertId: agentId,
          threadId: meetingId || null,
          absenderTyp: 'agent' as const,
          absenderName: expert.name,
          nachricht: replyText.trim(),
          gelesen: false,
          erstelltAm: now(),
        };
        db.insert(chatMessages).values(responseMsg).run();
        broadcast('chat_message', responseMsg);

        // For simple P2P (no meeting): re-trigger the sender so they can
        // synthesize the reply and report back to the board.
        if (!meetingId) {
          setTimeout(() => {
            this.triggerZyklus(vonExpertId, companyId, 'manual').catch(console.error);
          }, 800);
        }

        if (meetingId) {
          // Update meeting answers; check if all participants have replied
          const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, meetingId)).get() as any;
          if (meeting && meeting.status === 'running') {
            let antworten: Record<string, string> = {};
            let allTeilnehmer: string[] = [];
            try { antworten = JSON.parse(meeting.responses || '{}'); } catch {}
            try { allTeilnehmer = JSON.parse(meeting.participantIds || '[]'); } catch {}
            antworten[agentId] = replyText.trim();
            const agentOnly = allTeilnehmer.filter((id: string) => id !== '__board__' && !id.startsWith('__board__'));
            const alleDa = agentOnly.length > 0 && agentOnly.every((id: string) => antworten[id]);

            db.update(agentMeetings)
              .set({
                replies: JSON.stringify(antworten),
                ...(alleDa ? { status: 'completed', completedAt: now() } : {}),
              })
              .where(and(eq(agentMeetings.id, meetingId), eq(agentMeetings.status, 'running')))
              .run();

            broadcast('meeting_updated', { companyId, meetingId, antworten, alleDa, status: alleDa ? 'completed' : 'running' });

            if (alleDa) {
              trace(agentId, companyId, 'info', `Meeting abgeschlossen`, `"${meeting.title}" — alle ${agentOnly.length} Antworten eingegangen`);

              // Build synthesis message for CEO/organizer
              const antwortenText = agentOnly.map((id: string) => {
                const a = db.select({ name: agents.name }).from(agents).where(eq(agents.id, id)).get() as any;
                return `**${a?.name || id}:** ${antworten[id]}`;
              }).join('\n\n');

              const synthMsg = {
                id: uuid(),
                companyId,
                agentId: meeting.organizerAgentId,
                threadId: meetingId,
                absenderTyp: 'system' as const,
                nachricht: `📊 **Meeting abgeschlossen: "${meeting.title}"**\n\nAlle Teilnehmer haben geantwortet:\n\n${antwortenText}\n\nBitte erstelle eine Zusammenfassung für das Board.`,
                gelesen: false,
                erstelltAm: now(),
              };
              db.insert(chatMessages).values(synthMsg).run();
              broadcast('chat_message', synthMsg);

              // Archive meeting to Memory (non-blocking)
              saveMeetingResult(
                meetingId,
                meeting.title,
                antworten,
                agentOnly,
                meeting.organizerAgentId,
                companyId,
              ).catch(() => {});

              // Trigger organizer (CEO) for synthesis
              // Pass meetingId (no vonExpertId) so the success handler saves the synthesis to ergebnis
              setTimeout(() => {
                this.triggerZyklus(meeting.organizerAgentId, companyId, 'manual', undefined, meetingId).catch(console.error);
              }, 600);
            }
          }
        }
      } else if (quelle === 'manual' || quelle === 'telegram') {
        // ── Board-triggered or Telegram-triggered: send chat reply ────────
        const msg = {
          id: uuid(),
          companyId,
          agentId,
          absenderTyp: 'agent' as const,
          absenderName: expert.name,
          nachricht: replyText.trim(),
          gelesen: false,
          erstelltAm: now(),
        };
        db.insert(chatMessages).values(msg).run();
        broadcast('chat_message', msg);

        // Only forward to Telegram when the message came FROM Telegram
        if (quelle === 'telegram') {
          messagingService.sendTelegram(companyId, `*${expert.name}*: ${replyText}`).catch(console.error);
        }

        // ── Meeting context: also save answer to meeting.responses ─────────
        if (meetingId) {
          const mtg = db.select().from(agentMeetings).where(eq(agentMeetings.id, meetingId)).get() as any;
          if (mtg && mtg.status === 'running') {
            let antworten: Record<string, string> = {};
            let allTeilnehmer: string[] = [];
            try { antworten = JSON.parse(mtg.responses || '{}'); } catch {}
            try { allTeilnehmer = JSON.parse(mtg.participantIds || '[]'); } catch {}
            antworten[agentId] = replyText.trim();
            const agentTeilnehmer = allTeilnehmer.filter((id: string) => id !== '__board__' && !id.startsWith('__board__'));
            const alleDa = agentTeilnehmer.every((id: string) => antworten[id]);

            db.update(agentMeetings).set({
              replies: JSON.stringify(antworten),
              ...(alleDa ? { status: 'completed', completedAt: now() } : {}),
            }).where(and(eq(agentMeetings.id, meetingId), eq(agentMeetings.status, 'running'))).run();

            broadcast('meeting_updated', { companyId, meetingId, status: alleDa ? 'completed' : 'running' });

            if (alleDa) {
              trace(agentId, companyId, 'info', `Meeting abgeschlossen (Board-Round)`, `"${mtg.title}" — alle Antworten da`);
              const synthMsg = {
                id: uuid(), companyId,
                agentId: mtg.organizerAgentId,
                threadId: meetingId,
                absenderTyp: 'system' as const,
                nachricht: `📊 **Meeting abgeschlossen: "${mtg.title}"**\n\nAlle Antworten eingegangen. Bitte erstelle eine Zusammenfassung für das Board.`,
                gelesen: false, erstelltAm: now(),
              };
              db.insert(chatMessages).values(synthMsg).run();
              broadcast('chat_message', synthMsg);
              setTimeout(() => {
                this.triggerZyklus(mtg.organizerAgentId, companyId, 'manual', undefined, meetingId).catch(console.error);
              }, 600);
            }
          }
        }
      }

      this.triggerExpertActions(companyId, agentId, result.output, effectiveWorkDir, quelle === 'manual' || quelle === 'telegram');
    } else {
      newStatus = 'error';
      trace(agentId, companyId, 'error', `Fehler`, result.error ?? 'Unbekannter Fehler', laufId);

      // Also send error as chat message on manual/telegram trigger
      if (quelle === 'manual' || quelle === 'telegram') {
        const errMsg = {
          id: uuid(),
          companyId,
          agentId,
          absenderTyp: 'system' as const,
          absenderName: expert.name,
          nachricht: `⚠ Fehler: ${result.error ?? 'Unbekannter Fehler'}`,
          gelesen: true,
          erstelltAm: now(),
        };
        db.insert(chatMessages).values(errMsg).run();
        broadcast('chat_message', errMsg);
        // Forward error to Telegram only if message originated there
        if (quelle === 'telegram') {
          messagingService.notify(companyId, `${expert.name}: Fehler`, result.error ?? 'Unbekannter Fehler', 'warning').catch(console.error);
        }
      }
    }

    db.update(workCycles).set({
      status: result.success ? 'succeeded' : 'failed',
      beendetAm: now(),
      ausgabe: result.output,
      fehler: result.error,
    }).where(eq(workCycles.id, laufId)).run();

    db.update(agents).set({ 
      status: newStatus as any, 
      updatedAt: now(),
    }).where(eq(agents.id, agentId)).run();

    // --- AUTO-SAVE HOOK (Memory) ---
    // Inkrementiere Nachrichtencounter und speichere alle 15 Nachrichtenwechsel
    if (result.success) {
      const neuCount = (expert.messageCount || 0) + 1;
      db.update(agents).set({ nachrichtenCount: neuCount }).where(eq(agents.id, agentId)).run();
      
      if (neuCount >= 15) {
        this.saveMemoryHistory(agentId, companyId, result.output).catch(e => {
          console.warn(`⚠️ Memory Auto-Save für ${agentId} fehlgeschlagen:`, e);
        });
      }
    }

    // --- MEMORY AUTO-SAVE (Erkenntnisse aus dem Zyklus extrahieren) ---
    if (result.success) {
      const currentTaskTitle = expertAufgaben[0]?.title;
      autoSaveInsights(agentId, companyId, result.output || '', currentTaskTitle).catch(() => {});
    }

    // --- LEARNING LOOP ---
    // Extrahiere Skills, aktualisiere Konfidenz, räume schlechte Skills auf
    try {
      const taskTitel = expertAufgaben[0]?.title || 'Arbeitszyklus';
      const learningLoopResult = nachZyklusVerarbeitung(
        agentId, companyId, taskTitel, result.output || '', result.success
      );
      if (learningLoopResult.neueSkills > 0 || learningLoopResult.deprecatedSkills > 0) {
        trace(agentId, companyId, 'info', '🧬 Learning Loop',
          `+${learningLoopResult.neueSkills} neue Skills, ${learningLoopResult.aktualisiertSkills} aktualisiert, -${learningLoopResult.deprecatedSkills} deprecated`);
      }
    } catch (e: any) {
      console.warn(`⚠️ Learning Loop Hook Fehler: ${e.message}`);
    }

    // --- BACKGROUND REVIEW (Learning Loop async self-review) ---
    // Non-blocking: Spawnt async Prozess der Memory + Skills reviewed
    if (result.success) {
      const zyklusNummer = (expert.messageCount || 0) + 1;
      const { memory, skills } = sollteReviewen(zyklusNummer);
      if (memory || skills) {
        spawnBackgroundReview({
          agentId,
          companyId,
          agentOutput: result.output || '',
          zyklusNummer,
          reviewMemory: memory,
          reviewSkills: skills,
        });
        trace(agentId, companyId, 'info', '🔍 Background Review gestartet',
          `Memory: ${memory}, Skills: ${skills} (Zyklus #${zyklusNummer})`);
      }
    }

    // Kosten buchen
    if (result.tokenUsage && result.tokenUsage.costCent > 0) {
      const kostenId = uuid();
      db.insert(costEntries).values({
        id: kostenId,
        companyId,
        agentId,
        anbieter: expert.connectionType,
        modell: expert.connectionType,
        inputTokens: result.tokenUsage.inputTokens,
        outputTokens: result.tokenUsage.outputTokens,
        costCent: result.tokenUsage.costCent,
        zeitpunkt: now(),
        createdAt: now()
      }).run();

      // Check Budget Limit (Maximizer Mode überspringt dies)
      // Atomic SQL update to prevent race condition with concurrent heartbeat writes
      db.update(agents)
        .set({ monthlySpendCent: sql`${agents.monthlySpendCent} + ${result.tokenUsage.costCent}` })
        .where(eq(agents.id, agentId)).run();
      const updatedExpert = db.select().from(agents).where(eq(agents.id, agentId)).get();
      if (updatedExpert) {
        const neuesVerbraucht = updatedExpert.monthlySpendCent;

        if (updatedExpert.monthlyBudgetCent > 0 && !isMaximizerActive) {
           const percent = (neuesVerbraucht / updatedExpert.monthlyBudgetCent) * 100;
           // Read pause threshold from company settings (default 100%)
           const thresholdRow = db.select().from(settings)
             .where(and(eq(settings.key, 'budget_pause_threshold'), inArray(settings.companyId, ['', companyId])))
             .all()
             .sort((a, b) => (a.companyId === '' ? -1 : 1))[0];
           const pauseThreshold = thresholdRow ? Number(thresholdRow.value) : 100;
           if (percent >= pauseThreshold && updatedExpert.status !== 'paused') {
              db.update(agents).set({ status: 'paused', updatedAt: now() }).where(eq(agents.id, agentId)).run();
              db.insert(activityLog).values({
                id: uuid(),
                companyId,
                actorType: 'system',
                actorId: 'system',
                actorName: 'System',
                action: `${updatedExpert.name} pausiert (Budget ${percent.toFixed(0)}% ≥ ${pauseThreshold}% Schwellwert)`,
                entitaetTyp: 'agents',
                entitaetId: agentId,
                erstelltAm: now()
              }).run();
           }
        } else if (isMaximizerActive && updatedExpert.monthlyBudgetCent > 0) {
           const percent = (neuesVerbraucht / updatedExpert.monthlyBudgetCent) * 100;
           if (percent >= 100) {
             trace(agentId, companyId, 'warning', `MAXIMIZER MODE`, `Budget bei ${percent.toFixed(0)}% — Limit wird ignoriert!`);
           }
        }
      }
    }


    // --- Message Queue Loop (Posteingang prüfen) ---
    // Only re-trigger if there are NEW board messages (user/Telegram messages).
    // Agent's own replies (absenderTyp:'agent') must NOT re-trigger — that would cause infinite loops.
    const unreadBoardMsgs = db.select().from(chatMessages)
      .where(and(
        eq(chatMessages.agentId, agentId),
        eq(chatMessages.read, false),
        eq(chatMessages.senderType, 'board') // Only real user messages trigger another cycle
      ))
      .all();

    if (unreadBoardMsgs.length > 0) {
      console.log(`🔄 Agent ${agentId} hat ${unreadBoardMsgs.length} neue Board-Nachricht(en). Starte nächsten Loop...`);
      setTimeout(() => {
        // Use 'manual' so Telegram/chat reply is always sent back to the user
        this.triggerZyklus(agentId, companyId, 'manual').catch(e => {
          console.error(`Fehler beim Auto-Loop für ${agentId}:`, e);
        });
      }, 1000); // 1 Sekunde Puffer zwischen den Zyklen
    }
    // ---------------------------------------------
  }

  // PreCompact Hook entfernt — ersetzt durch iterative Context-Kompression (background-review.ts)

  /**
   * Auto-Save Hook: Speichert den aktuellen Status und Verlauf in Memory.
   */
  private async saveMemoryHistory(agentId: string, companyId: string, lastOutput: string): Promise<void> {
    const expert = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!expert) return;

    // 1. Hole letzte 15 Nachrichten für den Drawer (Input/Output History)
    const msgs = db.select().from(chatMessages)
      .where(eq(chatMessages.agentId, agentId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(15)
      .all();

    const historyText = msgs.reverse().map(m => `${m.senderType === 'agent' ? 'AGENT' : 'BOARD/SYSTEM'}: ${m.message}`).join('\n\n');

    try {
      // 2. Drawer schreiben (Roher Verlauf)
      await mcpClient.callTool('memory_add_drawer', {
        wing: expert.name.toLowerCase().replace(/\s+/g, '_'),
        room: 'chat_history',
        content: `### HISTORIE (BATCH SAVE)\n\n${historyText}\n\n### LETZTE AUSGABE\n${lastOutput}`
      });

      // 3. Tagebuch schreiben (AAAK-Dialekt Zusammenfassung)
      // Wir nutzen hier einen standardisierten AAAK-Eintrag
      await mcpClient.callTool('memory_diary_write', {
        date: new Date().toISOString().split('T')[0],
        thought: `Automatischer Speicherpunkt nach 15 Zyklen erreicht. Fokus war zuletzt auf: ${lastOutput.slice(0, 100)}...`,
        action: "Batch-Saved history to Memory Wing.",
        knowledge: "Context preserved before rotating."
      });

      // 4. Counter zurücksetzen
      db.update(agents).set({ nachrichtenCount: 0 }).where(eq(agents.id, agentId)).run();
      
      trace(agentId, companyId, 'info', '💾 Memory Save', 'Verlauf und Tagebuch erfolgreich gesichert.');
    } catch (err: any) {
      console.error(`Memory Hook Error: ${err.message}`);
    }
  }

  private extractChatAction(ausgabe: string): string | null {
    if (!ausgabe) return null;
    const match = ausgabe.match(/```json\s*(\{[\s\S]*?\})\s*```/) ||
                  ausgabe.match(/(\{[\s\S]*?"action"\s*:\s*"chat"[\s\S]*?\})/);
    if (!match) return null;
    try {
      const data = JSON.parse(match[1] || match[0]);
      if (data?.action === 'chat' && (data?.params?.message || data?.params?.message)) return data.params.message || data.params.message;
    } catch {}
    return null;
  }

  // Hilfsfunktion: Überprüft, ob der Experte in seiner Ausgabe JSON-Aktionen gepostet hat
  // fromBoard=true: Board/Telegram hat die Aktion ausgelöst → Autonomy-Check überspringen
  private async triggerExpertActions(companyId: string, agentId: string, ausgabe: string, workspacePath?: string, fromBoard = false) {
    if (!ausgabe) return;

    const expert = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!expert) return;

    // Extrahiere JSON-Blöcke aus Markdown-Codeblöcken
    const blockMatches = [...ausgabe.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g)].map(m => m[1]);
    // Fallback: bare JSON objects mit "action"-Key
    const bareMatches = blockMatches.length === 0
      ? [...ausgabe.matchAll(/(\{[^`]*"action"\s*:\s*"[^"]+[^`]*\})/g)].map(m => m[1])
      : [];
    const allMatches = [...blockMatches, ...bareMatches];

    if (allMatches.length === 0) return;

    for (const jsonStr of allMatches) {
      try {
        const data = JSON.parse(jsonStr.trim());
        if (data && data.action) {
          // Normalize German param keys → English (prompts use DE, handlers expect EN)
          const params = data.params || {};
          if (params.titel !== undefined && params.title === undefined) params.title = params.titel;
          if (params.beschreibung !== undefined && params.description === undefined) params.description = params.beschreibung;
          if (params.prioritaet !== undefined && params.priority === undefined) params.priority = params.prioritaet;
          if (params.zugewiesenAn !== undefined && params.assignedTo === undefined) params.assignedTo = params.zugewiesenAn;
          if (params.rolle !== undefined && params.role === undefined) params.role = params.rolle;
          if (params.faehigkeiten !== undefined && params.skills === undefined) params.skills = params.faehigkeiten;
          await this.executeAgentAction(companyId, agentId, data.action, params, fromBoard, workspacePath);
        }
      } catch (e) {
        console.error("Konnte Agent Action JSON nicht parsen:", e);
      }
    }
  }

  /**
   * Führt eine spezifische Agent-Aktion aus. 
   * Prüft dabei das Autonomie-Level und erstellt bei Bedarf eine Genehmigungsanfrage.
   */
  async executeAgentAction(companyId: string, agentId: string, action: string, params: any, skipAutonomyCheck = false, workspacePath?: string) {
    const expert = db.select().from(agents).where(eq(agents.id, agentId)).get();
    if (!expert) return;

    let config: any = {};
    try { config = JSON.parse(expert.connectionConfig || '{}'); } catch {}
    const autonomyLevel = config.autonomyLevel || 'copilot';

    // --- AUTONOMY LEVEL CHECK ---
    if (!skipAutonomyCheck) {
      let isBlocked = false;
      if (autonomyLevel === 'copilot' && action !== 'chat') {
         isBlocked = true; // Copilot darf nur chatten, alle Tools gesperrt
      } else if (autonomyLevel === 'teamplayer' && ['file_write', 'file_delete', 'update_task_status'].includes(action)) {
         isBlocked = true; // Teamplayer darf lesen und Tasks anlegen, aber nicht modifizieren
      }

      if (isBlocked) {
         const nachricht = `⚠️ **Genehmigung erforderlich** (Autonomie-Level: ${autonomyLevel})\nAgent möchte Aktion '${action}' ausführen.\n\nGewünschte Parameter:\n\`\`\`json\n${JSON.stringify(params, null, 2)}\n\`\`\``;
         
         // 1. Chat-Deduplisierung: selbe Nachricht in den letzten 10 Min. → kein Duplikat
         const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
         const existingMsg = db.select().from(chatMessages)
           .where(and(
             eq(chatMessages.agentId, agentId),
             eq(chatMessages.message, nachricht)
           ))
           .all()
           .find(m => m.createdAt > tenMinutesAgo);
           
         if (!existingMsg) {
           const msg = {
             id: uuid(),
             companyId,
             agentId,
             absenderTyp: 'system' as const,
             nachricht,
             gelesen: false,
             erstelltAm: new Date().toISOString()
           };
           db.insert(chatMessages).values(msg).run();
           broadcast('chat_message', msg);
         }

         // 2. Formale Genehmigung erstellen (falls noch nicht vorhanden)
         const existingApproval = db.select().from(approvals)
           .where(and(
             eq(approvals.companyId, companyId),
             eq(approvals.type, 'agent_action'),
             eq(approvals.requestedBy, agentId),
             eq(approvals.status, 'pending')
           ))
           .all()
           .find(g => {
              try {
                const p = JSON.parse(g.payload || '{}');
                return p.action === action && JSON.stringify(p.params) === JSON.stringify(params);
              } catch { return false; }
           });

         if (!existingApproval) {
           db.insert(approvals).values({
             id: uuid(),
             companyId,
             type: 'agent_action',
             title: `Aktion freigeben: ${action}`,
             beschreibung: `Agent ${expert.name} möchte folgende Aktion ausführen: ${action}`,
             angefordertVon: agentId,
             status: 'pending',
             payload: JSON.stringify({ action, params }),
             erstelltAm: new Date().toISOString(),
             aktualisiertAm: new Date().toISOString()
           }).run();
           broadcast('approval_created', { companyId, agentName: expert.name, action, titel: `Aktion freigeben: ${action}` });
         }

         return; // Überspringe die physische Ausführung!
      }
    }
    // -----------------------------
    
    if (action === 'create_task') {
       // Permission check: only agents with darfAufgabenErstellen may create tasks
       const perms = db.select({ darfAufgabenErstellen: agentPermissions.darfAufgabenErstellen })
         .from(agentPermissions)
         .where(eq(agentPermissions.agentId, agentId))
         .get();
       // Default is true (no row = permitted), but explicit false = blocked
       if (perms && perms.darfAufgabenErstellen === false) {
         trace(agentId, companyId, 'error', 'create_task verweigert', 'Agent hat keine Berechtigung Aufgaben zu erstellen');
         return;
       }

       const newTaskId = uuid();
       const assignTo = params.assignedTo || null;
       
       // Auto-assign to active project if no projektId specified
       let projektId = params.projectId || null;
       if (!projektId) {
         const activeProject = db.select().from(projects)
           .where(and(eq(projects.companyId, companyId), eq(projects.status, 'aktiv')))
           .orderBy(desc(projects.createdAt))
           .get();
         if (activeProject) {
           projektId = activeProject.id;
         }
       }
       
       db.insert(tasks).values({
         id: newTaskId,
         companyId,
         title: params.title || 'Neue Aufgabe',
         description: params.description || '',
         assignedTo: assignTo,
         projektId,
         status: 'todo',
         priority: (params.priority || 'medium') as any,
         createdAt: new Date().toISOString(),
         updatedAt: new Date().toISOString()
       }).run();

       broadcast('task_updated', { companyId, taskId: newTaskId, titel: params.title });
       trace(agentId, companyId, 'action', `Aufgabe erstellt`, `"${params.title}"${assignTo ? ` → zugewiesen an ${assignTo}` : ''}`);

       // Confirmation in board chat
       let assigneeName = '';
       if (assignTo) {
         const assignee = db.select({ name: agents.name }).from(agents).where(eq(agents.id, assignTo)).get() as any;
         assigneeName = assignee?.name ? ` — zugewiesen an **${assignee.name}**` : '';
       }
       const confirmMsg = {
         id: uuid(),
         companyId,
         agentId,
         absenderTyp: 'system' as const,
         nachricht: `✅ Aufgabe erstellt: **${params.title || 'Neue Aufgabe'}**${assigneeName}`,
         gelesen: false,
         erstelltAm: new Date().toISOString(),
       };
       db.insert(chatMessages).values(confirmMsg).run();
       broadcast('chat_message', confirmMsg);
    } else if (action === 'delegate_task') {
       // ─── Task Delegation (Orchestrator assigns an existing task to an agent) ─
       const { taskId, agentId, message } = params;
       if (!taskId || !agentId) {
         trace(agentId, companyId, 'error', 'delegate_task fehlgeschlagen', 'taskId und agentId erforderlich');
         return;
       }

       const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
       const targetAgent = db.select().from(agents).where(eq(agents.id, agentId)).get() as any;

       if (!task) {
         trace(agentId, companyId, 'error', 'delegate_task fehlgeschlagen', `Task ${taskId} nicht gefunden`);
         return;
       }
       if (!targetAgent) {
         trace(agentId, companyId, 'error', 'delegate_task fehlgeschlagen', `Agent ${agentId} nicht gefunden`);
         return;
       }

       // Assign task
       db.update(tasks)
         .set({ assignedTo: agentId, status: 'todo', updatedAt: new Date().toISOString() })
         .where(eq(tasks.id, taskId))
         .run();

       trace(agentId, companyId, 'action', `Aufgabe delegiert`, `"${task.title}" → ${targetAgent.name}`);
       broadcast('task_updated', { companyId, taskId, assignedTo: agentId, agentName: targetAgent.name });

       // Send briefing message to the target agent
       const briefing = message
         ? message
         : `Neue Aufgabe delegiert von ${expert.name}:\n\n**${task.title}**${task.description ? '\n' + task.description : ''}`;

       const delegateMsg = {
         id: uuid(),
         companyId,
         agentId: agentId,
         vonExpertId: agentId,
         absenderTyp: 'agent' as const,
         absenderName: expert.name,
         nachricht: briefing,
         gelesen: false,
         erstelltAm: new Date().toISOString(),
       };
       db.insert(chatMessages).values(delegateMsg).run();
       broadcast('chat_message', delegateMsg);

       // Notify board
       const boardMsg = {
         id: uuid(),
         companyId,
         agentId,
         absenderTyp: 'system' as const,
         nachricht: `📋 ${expert.name} hat "${task.title}" an ${targetAgent.name} delegiert.`,
         gelesen: false,
         erstelltAm: new Date().toISOString(),
       };
       db.insert(chatMessages).values(boardMsg).run();
       broadcast('chat_message', boardMsg);

       // Wake up the target agent so it picks up the task
       setTimeout(() => {
         this.triggerZyklus(agentId, companyId, 'manual', agentId).catch(e => {
           console.error(`delegate_task wakeup error for ${agentId}:`, e);
         });
       }, 300);

    } else if (action === 'invoke_device_sensor') {
       if (!params.nodeId || !params.action) {
         throw new Error('nodeId und action sind erforderlich für invoke_device_sensor');
       }
       
       try {
         trace(agentId, companyId, 'action', `Invoke Device Node`, `${params.action} an ${params.nodeId}`);
         const result = await nodeManager.invokeNode(params.nodeId, params.action, params.params);
         
         const msg = {
           id: uuid(),
           companyId,
           agentId,
           absenderTyp: 'system' as const,
           nachricht: `✅ Gerät ${params.nodeId} antwortet auf '${params.action}':\n${JSON.stringify(result, null, 2)}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatMessages).values(msg).run();
         broadcast('chat_message', msg);
       } catch (err: any) {
         let errorMsg = err.message;
         if (errorMsg.includes('PERMISSION_MISSING')) {
           errorMsg = `⚠️ Zugriff verweigert: Das Betriebssystem des Endgeräts (TCC) hat den Zugriff auf '${params.action}' blockiert. Bitte den Nutzer bitten, die Berechtigungen in den Systemeinstellungen freizugeben.`;
         }
         
         const msg = {
           id: uuid(),
           companyId,
           agentId,
           absenderTyp: 'system' as const,
           nachricht: `❌ Fehler bei Geräte-Aktion '${params.action}': ${errorMsg}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatMessages).values(msg).run();
         broadcast('chat_message', msg);
       }
    } else if (action === 'send_channel_message') {
       const { channel, text, recipient } = params;
       if (!text) throw new Error('text ist erforderlich für send_channel_message');
       
       try {
         if (channel === 'telegram') {
           trace(agentId, companyId, 'action', `Sending Telegram`, text.slice(0, 50) + (text.length > 50 ? '...' : ''));
           await messagingService.sendTelegram(companyId, `*${expert.name}*: ${text}`);
           
           const msg = {
             id: uuid(),
             companyId,
             agentId,
             absenderTyp: 'agent' as const,
             nachricht: `[Gesendet via Telegram]: ${text}`,
             gelesen: true,
             erstelltAm: new Date().toISOString()
           };
           db.insert(chatMessages).values(msg).run();
         } else {
           throw new Error(`Channel ${channel} wird aktuell nicht unterstützt.`);
         }
       } catch (err: any) {
         console.error('❌ Fehler beim Senden der Channel-Nachricht:', err);
         throw err;
       }
    } else if (action === 'update_task_status') {
       // Accept both "id" and "taskId" for flexibility across models
       if (!params.id && params.taskId) params.id = params.taskId;
       if (params.id && params.status) {
         // Normalize status: map German/legacy values to canonical English
         const statusMap: Record<string, string> = {
           'abgeschlossen': 'done', 'erledigt': 'done', 'fertig': 'done', 'completed': 'done',
           'in_arbeit': 'in_progress', 'in arbeit': 'in_progress', 'laufend': 'in_progress',
           'blockiert': 'blocked', 'offen': 'todo',
           'abgebrochen': 'cancelled', 'storniert': 'cancelled',
           // 'review' is the legacy/short form; canonical DB value is 'in_review'
           'review': 'in_review', 'in prüfung': 'in_review', 'prüfung': 'in_review',
         };
         const normalizedStatus = statusMap[params.status.toLowerCase()] || params.status;
         const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'];
         if (!VALID_STATUSES.includes(normalizedStatus)) {
           trace(agentId, companyId, 'error', `Ungültiger Task-Status`, `"${params.status}" ist kein gültiger Status. Erlaubt: ${VALID_STATUSES.join(', ')}`);
           return;
         }
         const taskBefore = db.select().from(tasks).where(eq(tasks.id, params.id)).get();

         // ─── Critic gate: run review before finalising 'done' ───────────────
         if (normalizedStatus === 'done' && taskBefore && taskBefore.status !== 'done') {
           // Best-effort: use most recent task comment as agent output proxy; fall
           // back to last workCycles output for this expert if none exists.
           let agentOutputProxy = '';
           try {
             const lastComment = db.select({ content: comments.content })
               .from(comments).where(eq(comments.taskId, params.id))
               .orderBy(desc(comments.createdAt)).limit(1).get() as any;
             if (lastComment?.content) {
               agentOutputProxy = lastComment.content;
             } else {
               const lastCycle = db.select({ ausgabe: workCycles.output })
                 .from(workCycles).where(eq(workCycles.agentId, agentId))
                 .orderBy(desc(workCycles.createdAt)).limit(1).get() as any;
               agentOutputProxy = lastCycle?.output || '';
             }
           } catch { /* ignore — critic will auto-approve on empty output */ }

           try {
             const criticResult = await heartbeatService.runCriticReview(
               params.id,
               taskBefore.title,
               (taskBefore as any).description || '',
               agentOutputProxy,
               agentId,
               companyId,
             );

             if (!criticResult.approved) {
               const finalStatus = criticResult.escalate ? 'blocked' : 'in_progress';
               const commentPrefix = criticResult.escalate
                 ? '🚨 **Critic Review — Manuelle Prüfung erforderlich**'
                 : '🔍 **Critic Review — Überarbeitung erforderlich**';
               const commentSuffix = criticResult.escalate
                 ? '*Bitte prüfe manuell.*'
                 : '*Bitte überarbeite die Aufgabe.*';

               db.insert(comments).values({
                 id: uuid(),
                 companyId,
                 taskId: params.id,
                 authorAgentId: agentId,
                 authorType: 'agent',
                 content: `${commentPrefix}\n\n${criticResult.feedback}\n\n${commentSuffix}`,
                 erstelltAm: new Date().toISOString(),
               }).run();

               db.update(tasks).set({ status: finalStatus, updatedAt: new Date().toISOString() }).where(eq(tasks.id, params.id)).run();
               trace(agentId, companyId, criticResult.escalate ? 'warning' : 'info',
                 `Critic: ${criticResult.escalate ? 'Eskaliert' : 'Überarbeitung nötig'} — ${taskBefore.title}`,
                 criticResult.feedback);
               return; // skip the normal done path below
             }
           } catch (criticErr: any) {
             console.warn(`[Scheduler] Critic review failed for task ${params.id}:`, criticErr?.message);
             // fail open — proceed to done
           }
         }
         // ────────────────────────────────────────────────────────────────────

         db.update(tasks).set({ status: normalizedStatus, updatedAt: new Date().toISOString() }).where(eq(tasks.id, params.id)).run();
         // Broadcast + Telegram notification when a task is completed
         if (normalizedStatus === 'done' && taskBefore && taskBefore.status !== 'done') {
           broadcast('task_completed', { companyId, taskId: params.id, titel: taskBefore.title, agentName: expert.name });
           messagingService.sendTelegram(companyId,
             `✅ *Aufgabe erledigt*\n\n*${taskBefore.title}*\n_Abgeschlossen von ${expert.name}_`
           ).catch(() => {});
         } else if (normalizedStatus === 'in_progress' && taskBefore && taskBefore.status !== 'in_progress') {
           broadcast('task_started', { companyId, taskId: params.id, titel: taskBefore?.title, agentName: expert.name });
         }
       }
    } else if (action === 'call_meeting') {
       // ── Multi-Agent Meeting (CEO koordiniert mehrere Agents) ──────────────
       const { frage, teilnehmer } = params;
       if (!frage || !Array.isArray(teilnehmer) || teilnehmer.length === 0) {
         trace(agentId, companyId, 'error', `call_meeting fehlgeschlagen`, 'frage und teilnehmer[] erforderlich');
         return;
       }

       // Validate participant IDs
       const validTeilnehmer = teilnehmer.filter((id: string) => {
         const a = db.select({ id: agents.id }).from(agents).where(eq(agents.id, id)).get();
         return !!a && id !== agentId;
       });

       if (validTeilnehmer.length === 0) {
         trace(agentId, companyId, 'error', `call_meeting fehlgeschlagen`, 'Keine gültigen Teilnehmer gefunden');
         return;
       }

       const meetingId = uuid();
       db.insert(agentMeetings).values({
         id: meetingId,
         companyId,
         title: frage,
         organizerAgentId: agentId,
         participantIds: JSON.stringify(validTeilnehmer),
         replies: '{}',
         status: 'running',
         erstelltAm: now(),
       }).run();

       trace(agentId, companyId, 'action', `Meeting gestartet`, `"${frage}" · ${validTeilnehmer.length} Teilnehmer`);
       broadcast('meeting_created', { companyId, meetingId, titel: frage, veranstalterName: expert.name, teilnehmerIds: validTeilnehmer });

       // Notify board
       const statusMsg = {
         id: uuid(),
         companyId,
         agentId,
         absenderTyp: 'system' as const,
         nachricht: `📋 Meeting gestartet: "${frage}"\n${validTeilnehmer.length} Teilnehmer eingeladen.`,
         gelesen: false,
         erstelltAm: now(),
       };
       db.insert(chatMessages).values(statusMsg).run();
       broadcast('chat_message', statusMsg);

       // Send question to each participant (staggered to avoid race)
       validTeilnehmer.forEach((teilnehmerId: string, idx: number) => {
         const frageMsg = {
           id: uuid(),
           companyId,
           agentId: teilnehmerId,
           vonExpertId: agentId,
           threadId: meetingId,
           absenderTyp: 'agent' as const,
           absenderName: expert.name,
           nachricht: `📋 **Meeting-Anfrage von ${expert.name}**\n\n${frage}\n\nBitte antworte kurz und direkt.`,
           gelesen: false,
           erstelltAm: now(),
         };
         db.insert(chatMessages).values(frageMsg).run();
         broadcast('chat_message', frageMsg);

         setTimeout(() => {
           this.triggerZyklus(teilnehmerId, companyId, 'manual', agentId, meetingId).catch(e => {
             console.error(`Meeting wakeup error for ${teilnehmerId}:`, e);
           });
         }, (idx + 1) * 600);
       });

    } else if (action === 'chat') {
       const text = params.message || params.message || params.content || params.text;
       if (text) {
          // If empfaenger (recipient agent ID) is set, store as P2P message for that agent
          const empfaenger = params.empfaenger || params.recipient || null;
          const targetExpertId = empfaenger || agentId;
          const msg = {
             id: uuid(),
             companyId,
             agentId: targetExpertId,
             vonExpertId: empfaenger ? agentId : null,   // track sender for P2P routing
             absenderTyp: 'agent' as const,
             absenderName: expert.name,
             nachricht: empfaenger
               ? `[Von ${expert.name}]: ${text}`
               : text,
             gelesen: false,
             erstelltAm: new Date().toISOString()
           };
           db.insert(chatMessages).values(msg).run();
           broadcast('chat_message', msg);

           if (empfaenger && empfaenger !== agentId) {
             // P2P: wake target agent
             trace(agentId, companyId, 'info', `P2P Nachricht an Kollege`, `→ ${empfaenger.slice(0,8)}: ${text.slice(0,50)}`);
             setTimeout(() => {
               this.triggerZyklus(empfaenger, companyId, 'manual', agentId).catch(e => {
                 console.error('P2P Wakeup Error:', e);
               });
             }, 100);
           } else {
             // Board message (no recipient) → also push to Telegram so user gets notified
             messagingService.sendTelegram(
               companyId,
               `💬 *${expert.name}*:\n${text}`
             ).catch(() => {});
             trace(agentId, companyId, 'info', `Board-Nachricht`, text.slice(0, 80));
           }
       }
    } else if (action === 'hire_agent') {
       // ─── Agent Spawning (Task-Manager-Vorbild) ──────────────────────────
       const { hireAgent } = await import('./services/agent-spawning.js');
       const hireResult = hireAgent({
         companyId,
         requestedBy: agentId,
         name: params.name || 'Neuer Agent',
         role: params.role || 'Assistent',
         skills: params.skills,
         connectionType: params.connectionType || 'openrouter',
         budgetMonatCent: 0, // 0 = unlimited; agent-specific budgets set manually
         requireApproval: true, // Default: require board approval for agent hiring
       });
       if (hireResult.success) {
         trace(agentId, companyId, 'action', `Agent eingestellt: ${params.name}`,
           hireResult.approvalId ? `Genehmigung ausstehend (${hireResult.approvalId})` : `ID: ${hireResult.agentId}`);
       }
       const msg = {
         id: uuid(), companyId, agentId,
         absenderTyp: 'system' as const,
         nachricht: hireResult.success
           ? (hireResult.approvalId ? `⏳ Hiring von "${params.name}" wartet auf Board-Genehmigung.` : `✅ "${params.name}" (${params.role}) erfolgreich eingestellt.`)
           : `❌ Hiring fehlgeschlagen: ${hireResult.error}`,
         gelesen: false, erstelltAm: new Date().toISOString()
       };
       db.insert(chatMessages).values(msg).run();
       broadcast('chat_message', msg);
    } else if (action === 'add_dependency') {
       // ─── Issue Dependencies (Task-Manager-Vorbild) ──────────────────────
       const { addBlocker: addDep } = await import('./services/issue-dependencies.js');
       const depResult = addDep(params.blockerId, params.blockedId, agentId);
       const msg = {
         id: uuid(), companyId, agentId,
         absenderTyp: 'system' as const,
         nachricht: depResult.success
           ? `🔗 Dependency erstellt: ${params.blockerId.slice(0,8)} blockiert ${params.blockedId.slice(0,8)}`
           : `❌ Dependency Fehler: ${depResult.error}`,
         gelesen: false, erstelltAm: new Date().toISOString()
       };
       db.insert(chatMessages).values(msg).run();
       broadcast('chat_message', msg);
    } else if (action.startsWith('canvas_') || action === 'camera_snap' || action === 'screen_record' || action === 'location_get' || action === 'clipboard_read') {
       // ─── Canvas + erweiterte Node Capabilities ─────────────────────
       try {
         const nodeId = params.nodeId;
         if (!nodeId) throw new Error('nodeId ist erforderlich');

         let result: any;
         let beschreibung = '';

         if (action === 'canvas_present') {
           const { canvasPresent } = await import('./services/canvas.js');
           result = await canvasPresent(nodeId, { url: params.url, html: params.html }, params);
           beschreibung = `Canvas: ${params.url || 'HTML'} auf ${nodeId}`;
         } else if (action === 'canvas_present_html') {
           const { canvasPresent } = await import('./services/canvas.js');
           result = await canvasPresent(nodeId, { html: params.html }, params);
           beschreibung = `Canvas HTML auf ${nodeId}`;
         } else if (action === 'canvas_snapshot') {
           const { canvasSnapshot } = await import('./services/canvas.js');
           result = await canvasSnapshot(nodeId);
           beschreibung = `Canvas Screenshot von ${nodeId}`;
         } else if (action === 'canvas_eval') {
           const { canvasEval } = await import('./services/canvas.js');
           result = await canvasEval(nodeId, params.script || '');
           beschreibung = `Canvas JS Eval auf ${nodeId}`;
         } else if (action === 'canvas_clear') {
           const { canvasClear } = await import('./services/canvas.js');
           result = await canvasClear(nodeId);
           beschreibung = `Canvas geschlossen auf ${nodeId}`;
         } else if (action === 'camera_snap') {
           result = await nodeManager.invokeNode(nodeId, 'camera.snap', params);
           beschreibung = `Foto aufgenommen auf ${nodeId}`;
         } else if (action === 'screen_record') {
           result = await nodeManager.invokeNode(nodeId, 'screen.record', { duration: params.durationSec || 10 });
           beschreibung = `Bildschirmaufnahme auf ${nodeId} (${params.durationSec || 10}s)`;
         } else if (action === 'location_get') {
           result = await nodeManager.invokeNode(nodeId, 'location.get', params);
           beschreibung = `Standort abgerufen von ${nodeId}`;
         } else if (action === 'clipboard_read') {
           result = await nodeManager.invokeNode(nodeId, 'clipboard.read', {});
           beschreibung = `Zwischenablage gelesen von ${nodeId}`;
         }

         trace(agentId, companyId, 'action', beschreibung);
         const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
         const msg = {
           id: uuid(), companyId, agentId,
           absenderTyp: 'system' as const,
           nachricht: `🖥️ ${beschreibung}:\n${resultText.slice(0, 1500)}`,
           gelesen: false, erstelltAm: new Date().toISOString()
         };
         db.insert(chatMessages).values(msg).run();
         broadcast('chat_message', msg);
       } catch (err: any) {
         let errorMsg = err.message;
         if (errorMsg.includes('PERMISSION_MISSING')) {
           errorMsg = `Zugriff verweigert: Das Betriebssystem hat den Zugriff auf '${action}' blockiert.`;
         }
         const msg = {
           id: uuid(), companyId, agentId,
           absenderTyp: 'system' as const,
           nachricht: `❌ ${action} fehlgeschlagen: ${errorMsg}`,
           gelesen: false, erstelltAm: new Date().toISOString()
         };
         db.insert(chatMessages).values(msg).run();
         broadcast('chat_message', msg);
       }
    } else if (action === 'session_search') {
       // ─── FTS5 Session Search (Learning Loop-Vorbild) ────────────────────────
       const query = params.query || '';
       const searchResult = sessionSearch(query, agentId);
       trace(agentId, companyId, 'action', `Session Search: "${query}"`, `${searchResult.length} Zeichen Ergebnis`);
       const msg = {
         id: uuid(),
         companyId,
         agentId,
         absenderTyp: 'system' as const,
         nachricht: `🔍 ${searchResult.slice(0, 1500)}`,
         gelesen: false,
         erstelltAm: new Date().toISOString()
       };
       db.insert(chatMessages).values(msg).run();
       broadcast('chat_message', msg);
    } else if (action.startsWith('memory_')) {
       // ─── Memory Tools (via MCP) ────────────────────────────────────
       try {
         trace(agentId, companyId, 'action', `Memory: ${action}`, JSON.stringify(params).slice(0, 200));
         const result = await mcpClient.callTool(action, params);
         const resultText = result?.content?.[0]?.text || JSON.stringify(result);

         const msg = {
           id: uuid(),
           companyId,
           agentId,
           absenderTyp: 'system' as const,
           nachricht: `🧠 Memory (${action}):\n${resultText.slice(0, 1500)}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatMessages).values(msg).run();
         broadcast('chat_message', msg);
       } catch (err: any) {
         const msg = {
           id: uuid(),
           companyId,
           agentId,
           absenderTyp: 'system' as const,
           nachricht: `⚠️ Memory Fehler (${action}): ${err.message}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatMessages).values(msg).run();
         broadcast('chat_message', msg);
       }
    } else if (action === 'create_routine') {
       // ─── Autonome Routine-Erstellung (Agent kann eigene Schedules anlegen) ─
       // params: { titel, beschreibung, cronExpression, assignToSelf?, timezone? }
       const { titel: rtitel, beschreibung: rbeschr, cronExpression, assignToSelf, timezone } = params;
       if (!rtitel || !cronExpression) {
         const errMsg = { id: uuid(), companyId, agentId, absenderTyp: 'system' as const,
           nachricht: `❌ create_routine: titel und cronExpression sind erforderlich`, gelesen: false, erstelltAm: new Date().toISOString() };
         db.insert(chatMessages).values(errMsg).run();
         broadcast('chat_message', errMsg);
         return;
       }

       const routineId = uuid();
       const triggerId = uuid();
       const ts = new Date().toISOString();
       db.insert(routines).values({
         id: routineId,
         companyId,
         title: rtitel,
         description: rbeschr || '',
         assignedTo: assignToSelf !== false ? agentId : null,
         priority: (params.priority || 'medium') as any,
         status: 'active',
         createdAt: ts,
         updatedAt: ts,
       }).run();

       db.insert(routineTrigger).values({
         id: triggerId,
         companyId,
         routineId,
         kind: 'schedule',
         active: true,
         cronExpression,
         timezone: timezone || 'Europe/Berlin',
         createdAt: ts,
       }).run();

       trace(agentId, companyId, 'action', `Routine erstellt`, `"${rtitel}" (${cronExpression})`);
       broadcast('routine_created', { companyId, routineId, titel: rtitel, cronExpression });

       const confirmMsg = {
         id: uuid(), companyId, agentId, absenderTyp: 'system' as const,
         nachricht: `✅ Routine eingerichtet: **${rtitel}**\n⏰ Zeitplan: \`${cronExpression}\` (${timezone || 'Europe/Berlin'})\nID: \`${routineId}\``,
         gelesen: false, erstelltAm: ts,
       };
       db.insert(chatMessages).values(confirmMsg).run();
       broadcast('chat_message', confirmMsg);

    } else if (action === 'store_secret') {
       // ─── Secrets/Credentials verschlüsselt speichern ─────────────────────
       // params: { name, value, description? }
       // Gespeichert als "secret_<name>" in settings — verschlüsselt mit AES-256-GCM
       const { name: secretName, value: secretValue, description: secretDesc } = params;
       if (!secretName || !secretValue) {
         const errMsg = { id: uuid(), companyId, agentId, absenderTyp: 'system' as const,
           nachricht: `❌ store_secret: name und value sind erforderlich`, gelesen: false, erstelltAm: new Date().toISOString() };
         db.insert(chatMessages).values(errMsg).run();
         broadcast('chat_message', errMsg);
         return;
       }

       const { encryptValue } = await import('./utils/crypto.js');
       const key = `secret_${secretName.toLowerCase().replace(/\s+/g, '_')}`;
       const encryptedValue = encryptValue(String(secretValue));

       db.insert(settings).values({ key, value: encryptedValue, companyId, updatedAt: new Date().toISOString() })
         .onConflictDoUpdate({ target: [settings.key, settings.companyId], set: { value: encryptedValue, updatedAt: new Date().toISOString() } })
         .run();

       trace(agentId, companyId, 'action', `Secret gespeichert`, `Schlüssel: ${key}`);

       const confirmMsg = {
         id: uuid(), companyId, agentId, absenderTyp: 'system' as const,
         nachricht: `🔐 Credential gespeichert: **${secretName}**\nVerschlüsselt abgelegt — Agenten können es mit Schlüssel \`${key}\` abrufen.`,
         gelesen: false, erstelltAm: new Date().toISOString(),
       };
       db.insert(chatMessages).values(confirmMsg).run();
       broadcast('chat_message', confirmMsg);

    } else {
       // Alle anderen Aktionen werden als "Skills" behandelt — mit task-spezifischem Workspace
       await executeSkill(agentId, companyId, action, params, workspacePath);
    }
  }

}

export const scheduler = new Scheduler();

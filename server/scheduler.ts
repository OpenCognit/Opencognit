import { db } from './db/client.js';
import { experten, unternehmen, aufgaben, arbeitszyklen, kostenbuchungen, aktivitaetslog, einstellungen, chatNachrichten, skillsLibrary, expertenSkills, genehmigungen, agentMeetings, ziele, routinen, routineTrigger, kommentare, agentPermissions, traceEreignisse } from './db/schema.js';
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
let _emitTrace: ((expertId: string, unternehmenId: string, typ: string, titel: string, details?: string, runId?: string) => void) | null = null;
export function setEmitTrace(fn: typeof _emitTrace) { _emitTrace = fn; }
function trace(expertId: string, unternehmenId: string, typ: string, titel: string, details?: string, runId?: string) {
  if (_emitTrace) _emitTrace(expertId, unternehmenId, typ, titel, details, runId);
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
function getUiLanguage(unternehmenId: string): 'de' | 'en' {
  try {
    // Try company-specific first, then global ('')
    const row = db.select({ wert: einstellungen.wert })
      .from(einstellungen)
      .where(and(eq(einstellungen.schluessel, 'ui_language'), eq(einstellungen.unternehmenId, unternehmenId)))
      .get()
      ?? db.select({ wert: einstellungen.wert })
        .from(einstellungen)
        .where(and(eq(einstellungen.schluessel, 'ui_language'), eq(einstellungen.unternehmenId, '')))
        .get();
    if (row?.wert) {
      const lang = decryptSetting('ui_language', row.wert);
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
  private async getExpertApiKey(unternehmenId: string, verbindungsTyp: string): Promise<string> {
    const keys: Record<string, string> = {
      'openrouter': 'openrouter_api_key',
      'claude': 'anthropic_api_key',
      'anthropic': 'anthropic_api_key',
      'openai': 'openai_api_key',
      'ollama': 'ollama_base_url'
    };

    const sKey = keys[verbindungsTyp];
    if (!sKey) return `ak_${crypto.randomBytes(16).toString('hex')}`;

    // 1. Try company-specific key
    if (unternehmenId) {
       const uSetting = db.select().from(einstellungen)
         .where(and(eq(einstellungen.schluessel, sKey), eq(einstellungen.unternehmenId, unternehmenId)))
         .get();
       if (uSetting?.wert) return sKey === 'ollama_base_url' ? uSetting.wert : decryptSetting(sKey, uSetting.wert);
    }

    // 2. Fallback to global key
    const gSetting = db.select().from(einstellungen)
      .where(and(eq(einstellungen.schluessel, sKey), eq(einstellungen.unternehmenId, '')))
      .get();
    
    if (gSetting?.wert) return sKey === 'ollama_base_url' ? gSetting.wert : decryptSetting(sKey, gSetting.wert);
    
    return verbindungsTyp === 'ollama' ? 'http://localhost:11434' : '';
  }

  // Ermittelt den effektiven Adapter + Key — fällt auf verfügbare Alternativen zurück
  private async resolveAdapter(verbindungsTyp: string, config?: string, unternehmenId?: string): Promise<{ adapterType: string; apiKey: string }> {
    // CLI-Subscription-Adapter brauchen keinen API-Key → direkt zurückgeben
    if (['claude-code', 'codex-cli', 'gemini-cli', 'bash', 'http'].includes(verbindungsTyp)) {
      return { adapterType: verbindungsTyp, apiKey: '' };
    }

    // Wenn Ollama (Lokal oder Cloud), prüfe zuerst die Agenten-spezifische Config
    if (verbindungsTyp === 'ollama' || verbindungsTyp === 'ollama_cloud') {
      try {
        if (config) {
          const cfg = JSON.parse(config);
          if (cfg.baseUrl) return { adapterType: verbindungsTyp, apiKey: cfg.baseUrl };
        }
      } catch { /* ignore */ }
    }

    // Try company-specific key first, then global
    const key = unternehmenId
      ? await this.getExpertApiKey(unternehmenId, verbindungsTyp) || await this.getExpertApiKey('', verbindungsTyp)
      : await this.getExpertApiKey('', verbindungsTyp);
    if (key) return { adapterType: verbindungsTyp, apiKey: key };

    // Fallback priority: anthropic → openrouter → openai → ollama
    const fallbacks: Array<{ type: string; settingsKey: string }> = [
      { type: 'anthropic', settingsKey: 'anthropic_api_key' },
      { type: 'openrouter', settingsKey: 'openrouter_api_key' },
      { type: 'openai', settingsKey: 'openai_api_key' },
    ];

    for (const fb of fallbacks) {
      if (fb.type === verbindungsTyp) continue; // already tried
      const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, fb.settingsKey)).get();
      if (e?.wert) {
        const fbKey = decryptSetting(fb.settingsKey, e.wert);
        if (fbKey) return { adapterType: fb.type, apiKey: fbKey };
      }
    }

    // Ollama as last resort (no key required)
    const ollamaE = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'ollama_base_url')).get();
    if (ollamaE?.wert) return { adapterType: 'ollama', apiKey: ollamaE.wert };

    return { adapterType: verbindungsTyp, apiKey: '' };
  }

  private async runTick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // Finde Experten, die aktiv/running sind und einen Zyklus brauchen
      const activeExperts = db.select().from(experten).where(
         inArray(experten.status, ['active', 'idle'])
      ).all();

      const currentTime = new Date().getTime();

      for (const a of activeExperts) {
        if (!a.zyklusAktiv || !a.zyklusIntervallSek) continue;

        let needsZyklus = false;
        if (!a.letzterZyklus) {
          needsZyklus = true;
        } else {
          const lastTime = new Date(a.letzterZyklus).getTime();
          if (currentTime - lastTime > a.zyklusIntervallSek * 1000) {
            needsZyklus = true;
          }
        }

        // budget=0 means "unlimited" — only block when budget is set AND exceeded
        const budgetOk = a.budgetMonatCent === 0 || a.budgetMonatCent > a.verbrauchtMonatCent;
        if (needsZyklus && budgetOk) {
          // Fire and forget, damit der Scheduler nicht blockiert wird
          this.triggerZyklus(a.id, a.unternehmenId, 'scheduler').catch(e => {
            console.error(`Fehler bei Arbeitszyklus für ${a.id}:`, e);
          });
        }
      }

      // CEO auto-wakeup: wenn unzugewiesene Tasks existieren, CEO triggern
      this.wakeupCEOIfNeeded(activeExperts);
    } finally {
      this.isRunning = false;
    }
  }

  private wakeupCEOIfNeeded(activeExperts: any[]) {
    // Find CEO agent (verbindungsTyp === 'ceo' OR rolle matches CEO/Manager)
    const ceoAgent = activeExperts.find(a =>
      a.verbindungsTyp === 'ceo' ||
      /ceo|geschäftsführer|projektmanager|manager/i.test(a.rolle)
    );
    if (!ceoAgent) return;

    // Check for unassigned tasks in this company
    const unassigned = db.select().from(aufgaben)
      .where(and(
        eq(aufgaben.unternehmenId, ceoAgent.unternehmenId),
        isNull(aufgaben.zugewiesenAn),
      ))
      .all()
      .filter((t: any) => t.status !== 'done' && t.status !== 'cancelled');

    if (unassigned.length === 0) return;

    // Don't re-wake if already running
    if (ceoAgent.status === 'running') return;

    // Check CEO was not triggered in the last 60s
    if (ceoAgent.letzterZyklus) {
      const elapsed = Date.now() - new Date(ceoAgent.letzterZyklus).getTime();
      if (elapsed < 60000) return;
    }

    console.log(`🧠 CEO auto-wakeup: ${unassigned.length} unzugewiesene Task(s) erkannt`);
    this.triggerZyklus(ceoAgent.id, ceoAgent.unternehmenId, 'scheduler').catch(e => {
      console.error('CEO wakeup error:', e);
    });
  }

  // Public: trigger CEO wakeup for a company (called when a new task is created)
  triggerCEOForCompany(unternehmenId: string) {
    // Include 'idle' agents — CEO is normally idle between cycles, not 'active'
    const agents = db.select().from(experten)
      .where(and(
        eq(experten.unternehmenId, unternehmenId),
        inArray(experten.status, ['active', 'idle']),
      ))
      .all();
    this.wakeupCEOIfNeeded(agents);
  }

  async triggerZyklus(
    expertId: string,
    unternehmenId: string,
    quelle: 'scheduler' | 'manual' | 'callback' | 'telegram' = 'manual',
    vonExpertId?: string,   // set when triggered by a peer agent (P2P / meeting)
    meetingId?: string,     // set when this cycle is part of a meeting
  ) {
    const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
    const company = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();

    if (!expert || !company) return;

    // Asynchroner Workflow: Blockiere parallele Zyklen, wenn der Experte bereits arbeitet
    if (expert.status === 'running') {
      let isStuck = false;
      if (expert.letzterZyklus) {
        const elapsed = Date.now() - new Date(expert.letzterZyklus).getTime();
        // Wenn länger als 5 Minuten "running", gehen wir von einem Crash aus und starten neu
        if (elapsed > 300000) {
          isStuck = true;
        }
      }
      
      if (!isStuck) {
        console.log(`⏱️  Agent ${expertId} arbeitet bereits. Eingangssignal (Quelle: ${quelle}) wird in die Warteschlange gestellt.`);
        // Optional: Einen Info-Trace absetzen, damit der User das sieht
        trace(expertId, unternehmenId, 'info', `Eingangswarteschlange (Queue)`, `Neue Aufgabe/Nachricht empfangen. Agent arbeitet dies sofort nach aktuellem Task ab.`);
        return;
      } else {
        console.log(`⚠️ Agent ${expertId} war >5 Min blockiert. Neustart erzwungen.`);
        trace(expertId, unternehmenId, 'warning', `Blockierung erkannt`, `Letzter Zyklus dauerte zu lange. Task-Prozess wird neu gestartet.`);
      }
    }

    // Resolve effective adapter + key (check company-specific key first, then global)
    const { adapterType, apiKey: resolvedApiKey } = await this.resolveAdapter(expert.verbindungsTyp, expert.verbindungsConfig || undefined, unternehmenId);

    let isOrchestrator = false;
    let parsedConfig: any = {};
    try {
      parsedConfig = JSON.parse(expert.verbindungsConfig || '{}');
      isOrchestrator = parsedConfig.isOrchestrator === true;
    } catch (e) {}

    // Guard: Blockiere Free Models — verursachen Halluzinationen und Context-Overflows
    const configuredModel: string = parsedConfig.model || '';
    if (configuredModel.endsWith(':free') || configuredModel === 'auto:free') {
      console.error(`[Scheduler] Agent ${expert.name} hat ein Free-Model (${configuredModel}) konfiguriert. Ausführung blockiert.`);
      trace(expertId, unternehmenId, 'error', 'Free-Model blockiert',
        `Modell "${configuredModel}" ist ein kostenloses Modell und wurde aus Stabilitätsgründen blockiert. Bitte wechsle zu einem bezahlten Modell.`);
      return;
    }

    // CEO-Agenten: 'ceo' Verbindung ODER Orchestrator-Flag gesetzt.
    // Ausnahme: Wenn der Nutzer explizit 'claude-code' oder 'anthropic' wählt,
    // wird die Wahl respektiert — diese haben eigene Adapter und brauchen keinen API-Key.
    const explicitAdapter = ['claude-code', 'anthropic', 'gemini-cli', 'codex-cli', 'ollama', 'ollama_cloud', 'bash', 'http'];
    const useExplicitAdapter = explicitAdapter.includes(expert.verbindungsTyp || '');
    const isCEO = !useExplicitAdapter && (expert.verbindungsTyp === 'ceo' || isOrchestrator);

    const finalAdapterType = isCEO ? 'ceo' : adapterType;
    const adapter = getAdapter(finalAdapterType);

    if (!adapter) {
      trace(expertId, unternehmenId, 'error', `Adapter nicht gefunden: ${finalAdapterType}`);
      console.error(`Adapter ${finalAdapterType} nicht gefunden für Experte ${expertId}`);
      return;
    }

    const laufId = uuid();
    db.insert(arbeitszyklen).values({
      id: laufId,
      unternehmenId,
      expertId,
      quelle,
      status: 'running',
      gestartetAm: now(),
      erstelltAm: now(),
    }).run();

    // Status auf 'running' setzen
    db.update(experten).set({ status: 'running', letzterZyklus: now(), aktualisiertAm: now() }).where(eq(experten.id, expertId)).run();
    trace(expertId, unternehmenId, 'info', `Arbeitszyklus gestartet`, `Quelle: ${quelle} · Adapter: ${expert.verbindungsTyp}`, laufId);

    // Kontext sammeln
    // Load todo + in_progress tasks (so agent knows what to work on next)
    const expertAufgaben = db.select().from(aufgaben)
      .where(and(
        eq(aufgaben.zugewiesenAn, expertId),
      ))
      .all()
      .filter((a: any) => a.status === 'todo' || a.status === 'in_progress' || a.status === 'blocked');
    // Maximizer Mode: Wenn mindestens eine zugewiesene Aufgabe isMaximizerMode hat, gelten keine Limits
    const isMaximizerActive = expertAufgaben.some((a: any) => a.isMaximizerMode);

    const tasksStrings = expertAufgaben.map((a: any) => `[${a.id.slice(0,8)}] ${sanitizeForPrompt(a.titel, 120)} (${a.status}${(a as any).isMaximizerMode ? ' MAXIMIZER' : ''}${a.beschreibung ? ': ' + sanitizeForPrompt(a.beschreibung, 80) : ''})`);
    if (tasksStrings.length > 0) {
      trace(expertId, unternehmenId, 'thinking', `Aufgaben laden`, `${tasksStrings.length} aktive Aufgabe(n): ${tasksStrings.slice(0, 3).join(', ')}${tasksStrings.length > 3 ? '…' : ''}`, laufId);
    }

    // Load team members for agent-to-agent messaging
    const alleExperten = db.select({
      id: experten.id, name: experten.name, rolle: experten.rolle,
      status: experten.status, letzterZyklus: experten.letzterZyklus,
      reportsTo: experten.reportsTo, isOrchestrator: experten.isOrchestrator,
    }).from(experten).where(eq(experten.unternehmenId, unternehmenId)).all()
      .filter((e: any) => e.id !== expertId);

    // Build team context string
    let teamKontext = '';
    if (expert.reportsTo) {
      const supervisor = alleExperten.find((e: any) => e.id === expert.reportsTo);
      teamKontext = supervisor
        ? `Vorgesetzter: ${supervisor.name} (${supervisor.rolle})`
        : `Vorgesetzter-ID: ${expert.reportsTo}`;
    } else {
      teamKontext = 'Vorgesetzter: Board (oberste Ebene)';
    }

    // ── Orchestrator: rich team status context ─────────────────────────────
    if (expert.isOrchestrator) {
      // Direct reports (agents that report to this orchestrator)
      const directReports = alleExperten.filter((e: any) => e.reportsTo === expertId);

      if (directReports.length > 0) {
        // Load active task counts per report
        const now_ts = new Date().toISOString();
        const reportIds = directReports.map((e: any) => e.id);
        const teamTasks = db.select({
          zugewiesenAn: aufgaben.zugewiesenAn,
          status: aufgaben.status,
          titel: aufgaben.titel,
          prioritaet: aufgaben.prioritaet,
        }).from(aufgaben)
          .where(and(eq(aufgaben.unternehmenId, unternehmenId), inArray(aufgaben.zugewiesenAn, reportIds)))
          .all();

        const tasksByAgent: Record<string, any[]> = {};
        for (const t of teamTasks) {
          if (!tasksByAgent[t.zugewiesenAn]) tasksByAgent[t.zugewiesenAn] = [];
          tasksByAgent[t.zugewiesenAn].push(t);
        }

        // Load latest trace event per direct report for accurate status
        const latestTraceByAgent: Record<string, string> = {};
        for (const e of directReports) {
          try {
            const latestTrace = db.select({
              typ: traceEreignisse.typ,
              titel: traceEreignisse.titel,
              erstelltAm: traceEreignisse.erstelltAm,
            }).from(traceEreignisse)
              .where(eq(traceEreignisse.expertId, e.id))
              .orderBy(desc(traceEreignisse.erstelltAm))
              .limit(1)
              .get() as any;
            if (latestTrace) {
              const diffMin = Math.floor((Date.now() - new Date(latestTrace.erstelltAm).getTime()) / 60000);
              latestTraceByAgent[e.id] = `last action ${diffMin}m ago: ${sanitizeForPrompt(latestTrace.titel, 80)}`;
            }
          } catch { /* skip */ }
        }

        const reportLines = directReports.map((e: any) => {
          const agentTasks = tasksByAgent[e.id] || [];
          const activeTasks = agentTasks.filter((t: any) => !['done', 'abgeschlossen', 'cancelled'].includes(t.status));
          const inProgressTasks = activeTasks.filter((t: any) => t.status === 'in_progress');
          const doneTasks = agentTasks.filter((t: any) => ['done', 'abgeschlossen'].includes(t.status));
          const statusEmoji: Record<string, string> = { active: '🟢', running: '⚡', idle: '⏸', paused: '🔴', error: '❌', terminated: '💀' };
          const lastSeen = e.letzterZyklus
            ? (() => { const diff = Date.now() - new Date(e.letzterZyklus).getTime(); const m = Math.floor(diff/60000); return m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`; })()
            : 'never';
          const currentTask = inProgressTasks[0] || activeTasks[0];
          const topTask = currentTask ? ` | CURRENTLY: "${sanitizeForPrompt(currentTask.titel, 100)}" [${currentTask.status}/${currentTask.prioritaet}]` : ' | NO ACTIVE TASK';
          const lastTrace = latestTraceByAgent[e.id] ? ` | ${latestTraceByAgent[e.id]}` : '';
          return `  ${statusEmoji[e.status] || '⬜'} ${e.name} (${e.rolle}) [ID:${e.id.slice(0,8)}] — status:${e.status}, ${activeTasks.length} open tasks (${inProgressTasks.length} in_progress), ${doneTasks.length} done, last_seen:${lastSeen}${topTask}${lastTrace}`;
        }).join('\n');

        teamKontext += `\n\n═══ DEIN TEAM (DIREKTE BERICHTE) ═══\n${reportLines}`;

        // Unassigned tasks in the company (orchestrator can delegate these)
        const unassigned = db.select({ id: aufgaben.id, titel: aufgaben.titel, prioritaet: aufgaben.prioritaet, status: aufgaben.status })
          .from(aufgaben)
          .where(and(eq(aufgaben.unternehmenId, unternehmenId), isNull(aufgaben.zugewiesenAn)))
          .all()
          .filter((t: any) => !['done', 'cancelled'].includes(t.status));

        if (unassigned.length > 0) {
          teamKontext += `\n\n═══ NICHT ZUGEWIESENE AUFGABEN ═══\n${unassigned.slice(0, 10).map((t: any) => `  [${t.id.slice(0,8)}] ${sanitizeForPrompt(t.titel, 120)} (${t.prioritaet}/${t.status})`).join('\n')}`;
        }
      }
    }

    // Skill Library: Smart RAG — score skills by relevance to current tasks
    const allAssignedSkills = db.select({ skill: skillsLibrary }).from(expertenSkills)
      .innerJoin(skillsLibrary, eq(expertenSkills.skillId, skillsLibrary.id))
      .where(eq(expertenSkills.expertId, expertId)).all().map((r: any) => r.skill);

    let skillContext = '';
    if (allAssignedSkills.length > 0) {
      // Build query from current tasks + agent role for relevance scoring
      const queryText = (tasksStrings.join(' ') + ' ' + expert.rolle + ' ' + (expert.faehigkeiten || '')).toLowerCase();

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
          const skillText = `${skill.name} ${skill.beschreibung ?? ''} ${skill.inhalt}`.toLowerCase();
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
        trace(expertId, unternehmenId, 'action', `Skills (RAG/${matchMethod})`, `${toInject.length}/${allAssignedSkills.length} Skill(s) relevant: ${toInject.map((s: any) => s.skill.name).join(', ')}`, laufId);
        skillContext = '\n\nWISSENSBASIS (Skills, nach Relevanz):\n' + toInject.map((s: any) =>
          `### ${s.skill.name}\n${s.skill.inhalt.slice(0, 1500)}`
        ).join('\n\n');
      }
    }

    
    // Task workspace: prefer task-specific path, fall back to agent/company/root
    const activeTaskWorkspace = expertAufgaben.find((t: any) => t.workspacePath)?.workspacePath || null;
    const effectiveWorkDir = resolveWorkDir(expertId, unternehmenId, activeTaskWorkspace);
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
- { "action": "hire_agent", "params": { "name": "...", "rolle": "...", "faehigkeiten": "...", "verbindungsTyp": "openrouter" } }
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
    const unreadMsgs = db.select().from(chatNachrichten)
      .where(and(eq(chatNachrichten.expertId, expertId), eq(chatNachrichten.gelesen, false)))
      .all();

    // P2P: messages from a peer agent (vonExpertId set) — these are direct agent-to-agent messages
    const peerMsgs = unreadMsgs.filter((m: any) => m.absenderTyp === 'agent' && m.vonExpertId);
    // Board / normal chat messages
    const boardMsgs = unreadMsgs.filter((m: any) => m.absenderTyp === 'board' || (m.absenderTyp === 'agent' && !m.vonExpertId));

    const chatContext = boardMsgs.map((m: any) =>
      m.absenderTyp === 'board' ? `CEO: ${m.nachricht}` : `Kollege: ${m.nachricht}`
    );

    const systemObservations = unreadMsgs
      .filter((m: any) => m.absenderTyp === 'system')
      .map((m: any) => m.nachricht);

    const isPeerTriggered = vonExpertId != null || peerMsgs.length > 0;

    if (isPeerTriggered) {
      const senderLabel = vonExpertId
        ? (db.select({ name: experten.name }).from(experten).where(eq(experten.id, vonExpertId)).get() as any)?.name || 'Kollege'
        : 'Kollege';
      trace(expertId, unternehmenId, 'thinking', `P2P Nachricht von ${senderLabel}`, `${peerMsgs.length} Nachricht(en)${meetingId ? ` · Meeting ${meetingId.slice(0,8)}` : ''}`, laufId);
    } else if (chatContext.length > 0) {
      trace(expertId, unternehmenId, 'thinking', `Neue Nachrichten`, `${chatContext.length} Nachricht(en) vom Board`, laufId);
    }

    if (unreadMsgs.length > 0) {
      for (const m of unreadMsgs) {
        db.update(chatNachrichten).set({ gelesen: true }).where(eq(chatNachrichten.id, m.id)).run();
      }
    }

    const apiKey = resolvedApiKey;

    // Load global default model for agents without a specific model configured
    let globalDefaultModel: string | undefined;
    const defaultModelKey = adapterType === 'ollama' ? 'ollama_default_model' : 'openrouter_default_model';
    if (adapterType === 'openrouter' || adapterType === 'ollama') {
      try {
        const defaultModelRow = db.select({ wert: einstellungen.wert })
          .from(einstellungen)
          .where(and(eq(einstellungen.schluessel, defaultModelKey), eq(einstellungen.unternehmenId, unternehmenId)))
          .get()
          ?? db.select({ wert: einstellungen.wert })
            .from(einstellungen)
            .where(and(eq(einstellungen.schluessel, defaultModelKey), eq(einstellungen.unternehmenId, '')))
            .get();
        if (defaultModelRow?.wert) {
          globalDefaultModel = decryptSetting(defaultModelKey, defaultModelRow.wert);
        }
      } catch { /* ignore */ }
    }

    trace(expertId, unternehmenId, 'action', `LLM-Anfrage senden`, `Modell: ${adapterType}`, laufId);

    // --- ITERATIVE CONTEXT-KOMPRESSION (Learning Loop-Vorbild) ---
    // Statt Kontext zu verwerfen, wird eine strukturierte Zusammenfassung erstellt/aktualisiert.
    const kontextLaenge = chatContext.join('\n').length + systemObservations.join('\n').length;
    if (sollteKomprimieren(kontextLaenge)) {
      const turnText = [...chatContext, ...systemObservations].join('\n\n');
      komprimiereKontext(expertId, unternehmenId, turnText);
      trace(expertId, unternehmenId, 'info', '📋 Kontext komprimiert', `${kontextLaenge} Zeichen → iterative Summary aktualisiert`);
    }

    // Summary in den Kontext laden (wenn vorhanden)
    const existingSummary = ladeSummary(expertId);
    if (existingSummary) {
      teamKontext += `\n\n${existingSummary}`;
    }

    // --- MEMORY AUTO-LOAD (relevante Erinnerungen injizieren) ---
    const taskKeywords = tasksStrings
      .concat(chatContext)
      .join(' ')
      .split(/\W+/)
      .filter(w => w.length > 4)
      .slice(0, 15);
    const memoryContext = loadRelevantMemory(expertId, taskKeywords);
    if (memoryContext) {
      teamKontext += memoryContext;
    }

    // Determine UI language for this company → agents respond accordingly
    const uiLang = getUiLanguage(unternehmenId);
    const li = langInstruction(uiLang);

    // Build prompt — priority: peer message > board message > observations > default cycle
    let basePrompt: string;
    if (isPeerTriggered && (peerMsgs.length > 0 || vonExpertId)) {
      // Responding to a peer agent (P2P or meeting)
      const senderName = vonExpertId
        ? (db.select({ name: experten.name }).from(experten).where(eq(experten.id, vonExpertId)).get() as any)?.name || (uiLang === 'en' ? 'Colleague' : 'Kollege')
        : (uiLang === 'en' ? 'Colleague' : 'Kollege');
      const peerText = peerMsgs.length > 0
        ? peerMsgs.map((m: any) => m.nachricht).join('\n')
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
        .filter((e: any) => e.id !== expertId)
        .map((e: any) => `  • ${e.name} (ID: ${e.id}) — ${e.rolle}`)
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
{"action": "hire_agent", "params": {"name": "Social Media Manager", "rolle": "Content & Social Media", "faehigkeiten": "Instagram, Content Creation", "verbindungsTyp": "openrouter"}}
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
{"action": "hire_agent", "params": {"name": "Social Media Manager", "rolle": "Content & Social Media", "faehigkeiten": "Instagram, Content Creation", "verbindungsTyp": "openrouter"}}
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
          id: ziele.id, titel: ziele.titel, beschreibung: ziele.beschreibung,
        }).from(ziele)
          .where(and(eq(ziele.unternehmenId, unternehmenId), inArray(ziele.status, ['active', 'planned'])))
          .orderBy(asc(ziele.erstelltAm))
          .limit(5).all();

        if (activeGoals.length > 0) {
          const goalLines = activeGoals.map(g => {
            const linked = db.select({ status: aufgaben.status })
              .from(aufgaben).where(and(eq(aufgaben.zielId, g.id), eq(aufgaben.unternehmenId, unternehmenId))).all();
            const done = linked.filter(t => t.status === 'done').length;
            const total = linked.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
            const open = linked.filter(t => t.status !== 'done');
            const openList = open.slice(0, 3).map((t: any) => `    - ${(t as any).titel || '?'}`).join('\n');
            return `  • ${g.titel} [${bar}] ${pct}% (${done}/${total} Tasks)${openList ? `\n    Offene Tasks:\n${openList}` : ''}`;
          });
          goalsSection = `\n\n🎯 STRATEGISCHE ZIELE:\n${goalLines.join('\n')}`;
        }
      } catch {}

      // Load unassigned tasks with goal links for delegation recommendations
      const unassigned = db.select({
        id: aufgaben.id, titel: aufgaben.titel, prioritaet: aufgaben.prioritaet, zielId: aufgaben.zielId,
      }).from(aufgaben)
        .where(and(eq(aufgaben.unternehmenId, unternehmenId), isNull(aufgaben.zugewiesenAn), inArray(aufgaben.status, ['todo', 'backlog'])))
        .limit(8).all();

      const unassignedSection = unassigned.length > 0
        ? `\n\n📋 UNDELEGIERTE AUFGABEN (${unassigned.length}):\n${unassigned.map(t => `  • [${t.prioritaet.toUpperCase()}] ${t.titel} (ID: ${t.id})${t.zielId ? ' 🎯' : ''}`).join('\n')}`
        : '';

      basePrompt = uiLang === 'en'
        ? `You are ${expert.name}, Orchestrator and strategic manager of your team.
Your primary task is coordination and delegation — NOT technical execution yourself.${goalsSection}${boardSection}${obsSection}${ownTaskSection}${unassignedSection}

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
Deine Hauptaufgabe ist Koordination und Delegation — NICHT die eigene technische Ausführung.${goalsSection}${boardSection}${obsSection}${ownTaskSection}${unassignedSection}

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
      ((expert.faehigkeiten || '').length) +
      skillContext.length + toolsContext.length +
      teamKontext.length;
    if (totalContextChars > MAX_CONTEXT_CHARS) {
      // First truncate basePrompt (least critical parts), then skillContext
      const overhead = totalContextChars - MAX_CONTEXT_CHARS;
      if (basePrompt.length > overhead + 2000) {
        basePrompt = basePrompt.slice(0, basePrompt.length - overhead - 1000) + '\n...[Kontext gekürzt — zu lang]';
      } else {
        // Last resort: truncate skill context
        skillContext = skillContext.slice(0, Math.max(500, skillContext.length - overhead));
      }
      trace(expertId, unternehmenId, 'info', 'Kontext gekürzt', `Gesamtkontext war ${Math.round(totalContextChars/4000)}k tokens — auf ${Math.round(MAX_CONTEXT_CHARS/4000)}k tokens reduziert`, laufId);
    }
    // ────────────────────────────────────────────────────────────────────────────

    // Führe Adapter aus
    let result: Awaited<ReturnType<typeof adapter.run>>;
    try {
      result = await adapter.run({
        expertId,
        expertName: expert.name,
        unternehmenId,
        unternehmenName: company.name,
        rolle: expert.rolle,
        faehigkeiten: (expert.faehigkeiten || '') + skillContext + toolsContext,
        prompt: basePrompt,
        aufgaben: tasksStrings,
        teamKontext,
        teamMitglieder: alleExperten,
        chatNachrichten: chatContext,
        apiKey,
        apiBaseUrl: API_BASE_URL,
        verbindungsTyp: adapterType,
        verbindungsConfig: expert.verbindungsConfig,
        globalDefaultModel,
      });
    } catch (adapterErr: any) {
      console.error(`[Scheduler] adapter.run() threw for ${expert.name}:`, adapterErr?.message);
      trace(expertId, unternehmenId, 'error', `Adapter-Exception`, adapterErr?.message ?? 'Unbekannt', laufId);
      db.update(arbeitszyklen).set({ status: 'failed', beendetAm: now(), fehler: adapterErr?.message }).where(eq(arbeitszyklen.id, laufId)).run();
      db.update(experten).set({ status: 'error' as any, aktualisiertAm: now() }).where(eq(experten.id, expertId)).run();
      return;
    }

    // Nachbehandlung
    let newStatus = expert.status;
    if (result.success) {
      newStatus = 'active';
      trace(expertId, unternehmenId, 'result', `Antwort erhalten`, result.ausgabe?.slice(0, 300) + (result.ausgabe?.length > 300 ? '…' : ''), laufId);

      // Extract JSON actions from output
      const chatAction = this.extractChatAction(result.ausgabe);

      const replyText = chatAction || result.ausgabe || '(Keine Antwort)';

      // ── CEO Meeting Synthesis: save result to agentMeetings.ergebnis ────
      if (meetingId && !vonExpertId && replyText.trim()) {
        db.update(agentMeetings)
          .set({ ergebnis: replyText.trim() })
          .where(eq(agentMeetings.id, meetingId))
          .run();
        broadcast('meeting_updated', { unternehmenId, meetingId, ergebnis: replyText.trim(), status: 'completed' });
        trace(expertId, unternehmenId, 'info', `Meeting Synthesis gespeichert`, `"${replyText.slice(0, 80)}…"`);
      }

      if (isPeerTriggered && vonExpertId) {
        // ── P2P / Meeting: route response back to sender ──────────────────
        const responseMsg = {
          id: uuid(),
          unternehmenId,
          expertId: vonExpertId,
          vonExpertId: expertId,
          threadId: meetingId || null,
          absenderTyp: 'agent' as const,
          absenderName: expert.name,
          nachricht: replyText.trim(),
          gelesen: false,
          erstelltAm: now(),
        };
        db.insert(chatNachrichten).values(responseMsg).run();
        broadcast('chat_message', responseMsg);

        // For simple P2P (no meeting): re-trigger the sender so they can
        // synthesize the reply and report back to the board.
        if (!meetingId) {
          setTimeout(() => {
            this.triggerZyklus(vonExpertId, unternehmenId, 'manual').catch(console.error);
          }, 800);
        }

        if (meetingId) {
          // Update meeting answers; check if all participants have replied
          const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, meetingId)).get() as any;
          if (meeting && meeting.status === 'running') {
            let antworten: Record<string, string> = {};
            let allTeilnehmer: string[] = [];
            try { antworten = JSON.parse(meeting.antworten || '{}'); } catch {}
            try { allTeilnehmer = JSON.parse(meeting.teilnehmerIds || '[]'); } catch {}
            antworten[expertId] = replyText.trim();
            const agentOnly = allTeilnehmer.filter((id: string) => id !== '__board__' && !id.startsWith('__board__'));
            const alleDa = agentOnly.length > 0 && agentOnly.every((id: string) => antworten[id]);

            db.update(agentMeetings)
              .set({
                antworten: JSON.stringify(antworten),
                ...(alleDa ? { status: 'completed', abgeschlossenAm: now() } : {}),
              })
              .where(and(eq(agentMeetings.id, meetingId), eq(agentMeetings.status, 'running')))
              .run();

            broadcast('meeting_updated', { unternehmenId, meetingId, antworten, alleDa, status: alleDa ? 'completed' : 'running' });

            if (alleDa) {
              trace(expertId, unternehmenId, 'info', `Meeting abgeschlossen`, `"${meeting.titel}" — alle ${agentOnly.length} Antworten eingegangen`);

              // Build synthesis message for CEO/organizer
              const antwortenText = agentOnly.map((id: string) => {
                const a = db.select({ name: experten.name }).from(experten).where(eq(experten.id, id)).get() as any;
                return `**${a?.name || id}:** ${antworten[id]}`;
              }).join('\n\n');

              const synthMsg = {
                id: uuid(),
                unternehmenId,
                expertId: meeting.veranstalterExpertId,
                threadId: meetingId,
                absenderTyp: 'system' as const,
                nachricht: `📊 **Meeting abgeschlossen: "${meeting.titel}"**\n\nAlle Teilnehmer haben geantwortet:\n\n${antwortenText}\n\nBitte erstelle eine Zusammenfassung für das Board.`,
                gelesen: false,
                erstelltAm: now(),
              };
              db.insert(chatNachrichten).values(synthMsg).run();
              broadcast('chat_message', synthMsg);

              // Archive meeting to Memory (non-blocking)
              saveMeetingResult(
                meetingId,
                meeting.titel,
                antworten,
                agentOnly,
                meeting.veranstalterExpertId,
                unternehmenId,
              ).catch(() => {});

              // Trigger organizer (CEO) for synthesis
              // Pass meetingId (no vonExpertId) so the success handler saves the synthesis to ergebnis
              setTimeout(() => {
                this.triggerZyklus(meeting.veranstalterExpertId, unternehmenId, 'manual', undefined, meetingId).catch(console.error);
              }, 600);
            }
          }
        }
      } else if (quelle === 'manual' || quelle === 'telegram') {
        // ── Board-triggered or Telegram-triggered: send chat reply ────────
        const msg = {
          id: uuid(),
          unternehmenId,
          expertId,
          absenderTyp: 'agent' as const,
          absenderName: expert.name,
          nachricht: replyText.trim(),
          gelesen: false,
          erstelltAm: now(),
        };
        db.insert(chatNachrichten).values(msg).run();
        broadcast('chat_message', msg);

        // Only forward to Telegram when the message came FROM Telegram
        if (quelle === 'telegram') {
          messagingService.sendTelegram(unternehmenId, `*${expert.name}*: ${replyText}`).catch(console.error);
        }

        // ── Meeting context: also save answer to meeting.antworten ─────────
        if (meetingId) {
          const mtg = db.select().from(agentMeetings).where(eq(agentMeetings.id, meetingId)).get() as any;
          if (mtg && mtg.status === 'running') {
            let antworten: Record<string, string> = {};
            let allTeilnehmer: string[] = [];
            try { antworten = JSON.parse(mtg.antworten || '{}'); } catch {}
            try { allTeilnehmer = JSON.parse(mtg.teilnehmerIds || '[]'); } catch {}
            antworten[expertId] = replyText.trim();
            const agentTeilnehmer = allTeilnehmer.filter((id: string) => id !== '__board__' && !id.startsWith('__board__'));
            const alleDa = agentTeilnehmer.every((id: string) => antworten[id]);

            db.update(agentMeetings).set({
              antworten: JSON.stringify(antworten),
              ...(alleDa ? { status: 'completed', abgeschlossenAm: now() } : {}),
            }).where(and(eq(agentMeetings.id, meetingId), eq(agentMeetings.status, 'running'))).run();

            broadcast('meeting_updated', { unternehmenId, meetingId, status: alleDa ? 'completed' : 'running' });

            if (alleDa) {
              trace(expertId, unternehmenId, 'info', `Meeting abgeschlossen (Board-Round)`, `"${mtg.titel}" — alle Antworten da`);
              const synthMsg = {
                id: uuid(), unternehmenId,
                expertId: mtg.veranstalterExpertId,
                threadId: meetingId,
                absenderTyp: 'system' as const,
                nachricht: `📊 **Meeting abgeschlossen: "${mtg.titel}"**\n\nAlle Antworten eingegangen. Bitte erstelle eine Zusammenfassung für das Board.`,
                gelesen: false, erstelltAm: now(),
              };
              db.insert(chatNachrichten).values(synthMsg).run();
              broadcast('chat_message', synthMsg);
              setTimeout(() => {
                this.triggerZyklus(mtg.veranstalterExpertId, unternehmenId, 'manual', undefined, meetingId).catch(console.error);
              }, 600);
            }
          }
        }
      }

      this.triggerExpertActions(unternehmenId, expertId, result.ausgabe, effectiveWorkDir, quelle === 'manual' || quelle === 'telegram');
    } else {
      newStatus = 'error';
      trace(expertId, unternehmenId, 'error', `Fehler`, result.fehler ?? 'Unbekannter Fehler', laufId);

      // Also send error as chat message on manual/telegram trigger
      if (quelle === 'manual' || quelle === 'telegram') {
        const errMsg = {
          id: uuid(),
          unternehmenId,
          expertId,
          absenderTyp: 'system' as const,
          absenderName: expert.name,
          nachricht: `⚠ Fehler: ${result.fehler ?? 'Unbekannter Fehler'}`,
          gelesen: true,
          erstelltAm: now(),
        };
        db.insert(chatNachrichten).values(errMsg).run();
        broadcast('chat_message', errMsg);
        // Forward error to Telegram only if message originated there
        if (quelle === 'telegram') {
          messagingService.sendTelegram(unternehmenId, `⚠️ *${expert.name}*: ${result.fehler ?? 'Unbekannter Fehler'}`).catch(console.error);
        }
      }
    }

    db.update(arbeitszyklen).set({
      status: result.success ? 'succeeded' : 'failed',
      beendetAm: now(),
      ausgabe: result.ausgabe,
      fehler: result.fehler,
    }).where(eq(arbeitszyklen.id, laufId)).run();

    db.update(experten).set({ 
      status: newStatus as any, 
      aktualisiertAm: now(),
    }).where(eq(experten.id, expertId)).run();

    // --- AUTO-SAVE HOOK (Memory) ---
    // Inkrementiere Nachrichtencounter und speichere alle 15 Nachrichtenwechsel
    if (result.success) {
      const neuCount = (expert.nachrichtenCount || 0) + 1;
      db.update(experten).set({ nachrichtenCount: neuCount }).where(eq(experten.id, expertId)).run();
      
      if (neuCount >= 15) {
        this.saveMemoryHistory(expertId, unternehmenId, result.ausgabe).catch(e => {
          console.warn(`⚠️ Memory Auto-Save für ${expertId} fehlgeschlagen:`, e);
        });
      }
    }

    // --- MEMORY AUTO-SAVE (Erkenntnisse aus dem Zyklus extrahieren) ---
    if (result.success) {
      const currentTaskTitle = expertAufgaben[0]?.titel;
      autoSaveInsights(expertId, unternehmenId, result.ausgabe || '', currentTaskTitle).catch(() => {});
    }

    // --- LEARNING LOOP ---
    // Extrahiere Skills, aktualisiere Konfidenz, räume schlechte Skills auf
    try {
      const taskTitel = expertAufgaben[0]?.titel || 'Arbeitszyklus';
      const learningLoopResult = nachZyklusVerarbeitung(
        expertId, unternehmenId, taskTitel, result.ausgabe || '', result.success
      );
      if (learningLoopResult.neueSkills > 0 || learningLoopResult.deprecatedSkills > 0) {
        trace(expertId, unternehmenId, 'info', '🧬 Learning Loop',
          `+${learningLoopResult.neueSkills} neue Skills, ${learningLoopResult.aktualisiertSkills} aktualisiert, -${learningLoopResult.deprecatedSkills} deprecated`);
      }
    } catch (e: any) {
      console.warn(`⚠️ Learning Loop Hook Fehler: ${e.message}`);
    }

    // --- BACKGROUND REVIEW (Learning Loop async self-review) ---
    // Non-blocking: Spawnt async Prozess der Memory + Skills reviewed
    if (result.success) {
      const zyklusNummer = (expert.nachrichtenCount || 0) + 1;
      const { memory, skills } = sollteReviewen(zyklusNummer);
      if (memory || skills) {
        spawnBackgroundReview({
          expertId,
          unternehmenId,
          agentOutput: result.ausgabe || '',
          zyklusNummer,
          reviewMemory: memory,
          reviewSkills: skills,
        });
        trace(expertId, unternehmenId, 'info', '🔍 Background Review gestartet',
          `Memory: ${memory}, Skills: ${skills} (Zyklus #${zyklusNummer})`);
      }
    }

    // Kosten buchen
    if (result.tokenVerbrauch && result.tokenVerbrauch.kostenCent > 0) {
      const kostenId = uuid();
      db.insert(kostenbuchungen).values({
        id: kostenId,
        unternehmenId,
        expertId,
        anbieter: expert.verbindungsTyp,
        modell: expert.verbindungsTyp,
        inputTokens: result.tokenVerbrauch.inputTokens,
        outputTokens: result.tokenVerbrauch.outputTokens,
        kostenCent: result.tokenVerbrauch.kostenCent,
        zeitpunkt: now(),
        erstelltAm: now()
      }).run();

      // Check Budget Limit (Maximizer Mode überspringt dies)
      // Atomic SQL update to prevent race condition with concurrent heartbeat writes
      db.update(experten)
        .set({ verbrauchtMonatCent: sql`${experten.verbrauchtMonatCent} + ${result.tokenVerbrauch.kostenCent}` })
        .where(eq(experten.id, expertId)).run();
      const updatedExpert = db.select().from(experten).where(eq(experten.id, expertId)).get();
      if (updatedExpert) {
        const neuesVerbraucht = updatedExpert.verbrauchtMonatCent;

        if (updatedExpert.budgetMonatCent > 0 && !isMaximizerActive) {
           const percent = (neuesVerbraucht / updatedExpert.budgetMonatCent) * 100;
           // Read pause threshold from company settings (default 100%)
           const thresholdRow = db.select().from(einstellungen)
             .where(and(eq(einstellungen.schluessel, 'budget_pause_threshold'), inArray(einstellungen.unternehmenId, ['', unternehmenId])))
             .all()
             .sort((a, b) => (a.unternehmenId === '' ? -1 : 1))[0];
           const pauseThreshold = thresholdRow ? Number(thresholdRow.wert) : 100;
           if (percent >= pauseThreshold && updatedExpert.status !== 'paused') {
              db.update(experten).set({ status: 'paused', aktualisiertAm: now() }).where(eq(experten.id, expertId)).run();
              db.insert(aktivitaetslog).values({
                id: uuid(),
                unternehmenId,
                akteurTyp: 'system',
                akteurId: 'system',
                akteurName: 'System',
                aktion: `${updatedExpert.name} pausiert (Budget ${percent.toFixed(0)}% ≥ ${pauseThreshold}% Schwellwert)`,
                entitaetTyp: 'experten',
                entitaetId: expertId,
                erstelltAm: now()
              }).run();
           }
        } else if (isMaximizerActive && updatedExpert.budgetMonatCent > 0) {
           const percent = (neuesVerbraucht / updatedExpert.budgetMonatCent) * 100;
           if (percent >= 100) {
             trace(expertId, unternehmenId, 'warning', `MAXIMIZER MODE`, `Budget bei ${percent.toFixed(0)}% — Limit wird ignoriert!`);
           }
        }
      }
    }


    // --- Message Queue Loop (Posteingang prüfen) ---
    // Only re-trigger if there are NEW board messages (user/Telegram messages).
    // Agent's own replies (absenderTyp:'agent') must NOT re-trigger — that would cause infinite loops.
    const unreadBoardMsgs = db.select().from(chatNachrichten)
      .where(and(
        eq(chatNachrichten.expertId, expertId),
        eq(chatNachrichten.gelesen, false),
        eq(chatNachrichten.absenderTyp, 'board') // Only real user messages trigger another cycle
      ))
      .all();

    if (unreadBoardMsgs.length > 0) {
      console.log(`🔄 Agent ${expertId} hat ${unreadBoardMsgs.length} neue Board-Nachricht(en). Starte nächsten Loop...`);
      setTimeout(() => {
        // Use 'manual' so Telegram/chat reply is always sent back to the user
        this.triggerZyklus(expertId, unternehmenId, 'manual').catch(e => {
          console.error(`Fehler beim Auto-Loop für ${expertId}:`, e);
        });
      }, 1000); // 1 Sekunde Puffer zwischen den Zyklen
    }
    // ---------------------------------------------
  }

  // PreCompact Hook entfernt — ersetzt durch iterative Context-Kompression (background-review.ts)

  /**
   * Auto-Save Hook: Speichert den aktuellen Status und Verlauf in Memory.
   */
  private async saveMemoryHistory(expertId: string, unternehmenId: string, lastOutput: string): Promise<void> {
    const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
    if (!expert) return;

    // 1. Hole letzte 15 Nachrichten für den Drawer (Input/Output History)
    const msgs = db.select().from(chatNachrichten)
      .where(eq(chatNachrichten.expertId, expertId))
      .orderBy(desc(chatNachrichten.erstelltAm))
      .limit(15)
      .all();

    const historyText = msgs.reverse().map(m => `${m.absenderTyp === 'agent' ? 'AGENT' : 'BOARD/SYSTEM'}: ${m.nachricht}`).join('\n\n');

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
      db.update(experten).set({ nachrichtenCount: 0 }).where(eq(experten.id, expertId)).run();
      
      trace(expertId, unternehmenId, 'info', '💾 Memory Save', 'Verlauf und Tagebuch erfolgreich gesichert.');
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
      if (data?.action === 'chat' && (data?.params?.nachricht || data?.params?.message)) return data.params.nachricht || data.params.message;
    } catch {}
    return null;
  }

  // Hilfsfunktion: Überprüft, ob der Experte in seiner Ausgabe JSON-Aktionen gepostet hat
  // fromBoard=true: Board/Telegram hat die Aktion ausgelöst → Autonomy-Check überspringen
  private async triggerExpertActions(unternehmenId: string, expertId: string, ausgabe: string, workspacePath?: string, fromBoard = false) {
    if (!ausgabe) return;

    const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
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
          await this.executeAgentAction(unternehmenId, expertId, data.action, data.params, fromBoard, workspacePath);
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
  async executeAgentAction(unternehmenId: string, expertId: string, action: string, params: any, skipAutonomyCheck = false, workspacePath?: string) {
    const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
    if (!expert) return;

    let config: any = {};
    try { config = JSON.parse(expert.verbindungsConfig || '{}'); } catch {}
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
         const existingMsg = db.select().from(chatNachrichten)
           .where(and(
             eq(chatNachrichten.expertId, expertId),
             eq(chatNachrichten.nachricht, nachricht)
           ))
           .all()
           .find(m => m.erstelltAm > tenMinutesAgo);
           
         if (!existingMsg) {
           const msg = {
             id: uuid(),
             unternehmenId,
             expertId,
             absenderTyp: 'system' as const,
             nachricht,
             gelesen: false,
             erstelltAm: new Date().toISOString()
           };
           db.insert(chatNachrichten).values(msg).run();
           broadcast('chat_message', msg);
         }

         // 2. Formale Genehmigung erstellen (falls noch nicht vorhanden)
         const existingApproval = db.select().from(genehmigungen)
           .where(and(
             eq(genehmigungen.unternehmenId, unternehmenId),
             eq(genehmigungen.typ, 'agent_action'),
             eq(genehmigungen.angefordertVon, expertId),
             eq(genehmigungen.status, 'pending')
           ))
           .all()
           .find(g => {
              try {
                const p = JSON.parse(g.payload || '{}');
                return p.action === action && JSON.stringify(p.params) === JSON.stringify(params);
              } catch { return false; }
           });

         if (!existingApproval) {
           db.insert(genehmigungen).values({
             id: uuid(),
             unternehmenId,
             typ: 'agent_action',
             titel: `Aktion freigeben: ${action}`,
             beschreibung: `Agent ${expert.name} möchte folgende Aktion ausführen: ${action}`,
             angefordertVon: expertId,
             status: 'pending',
             payload: JSON.stringify({ action, params }),
             erstelltAm: new Date().toISOString(),
             aktualisiertAm: new Date().toISOString()
           }).run();
           broadcast('approval_created', { unternehmenId, agentName: expert.name, action, titel: `Aktion freigeben: ${action}` });
         }

         return; // Überspringe die physische Ausführung!
      }
    }
    // -----------------------------
    
    if (action === 'create_task') {
       // Permission check: only agents with darfAufgabenErstellen may create tasks
       const perms = db.select({ darfAufgabenErstellen: agentPermissions.darfAufgabenErstellen })
         .from(agentPermissions)
         .where(eq(agentPermissions.expertId, expertId))
         .get();
       // Default is true (no row = permitted), but explicit false = blocked
       if (perms && perms.darfAufgabenErstellen === false) {
         trace(expertId, unternehmenId, 'error', 'create_task verweigert', 'Agent hat keine Berechtigung Aufgaben zu erstellen');
         return;
       }

       const newTaskId = uuid();
       const assignTo = params.zugewiesenAn || null;
       db.insert(aufgaben).values({
         id: newTaskId,
         unternehmenId,
         titel: params.titel || 'Neue Aufgabe',
         beschreibung: params.beschreibung || '',
         zugewiesenAn: assignTo,
         status: 'todo',
         prioritaet: (params.prioritaet || 'medium') as any,
         erstelltAm: new Date().toISOString(),
         aktualisiertAm: new Date().toISOString()
       }).run();

       broadcast('task_updated', { unternehmenId, taskId: newTaskId, titel: params.titel });
       trace(expertId, unternehmenId, 'action', `Aufgabe erstellt`, `"${params.titel}"${assignTo ? ` → zugewiesen an ${assignTo}` : ''}`);

       // Confirmation in board chat
       let assigneeName = '';
       if (assignTo) {
         const assignee = db.select({ name: experten.name }).from(experten).where(eq(experten.id, assignTo)).get() as any;
         assigneeName = assignee?.name ? ` — zugewiesen an **${assignee.name}**` : '';
       }
       const confirmMsg = {
         id: uuid(),
         unternehmenId,
         expertId,
         absenderTyp: 'system' as const,
         nachricht: `✅ Aufgabe erstellt: **${params.titel || 'Neue Aufgabe'}**${assigneeName}`,
         gelesen: false,
         erstelltAm: new Date().toISOString(),
       };
       db.insert(chatNachrichten).values(confirmMsg).run();
       broadcast('chat_message', confirmMsg);
    } else if (action === 'delegate_task') {
       // ─── Task Delegation (Orchestrator assigns an existing task to an agent) ─
       const { taskId, agentId, message } = params;
       if (!taskId || !agentId) {
         trace(expertId, unternehmenId, 'error', 'delegate_task fehlgeschlagen', 'taskId und agentId erforderlich');
         return;
       }

       const task = db.select().from(aufgaben).where(eq(aufgaben.id, taskId)).get() as any;
       const targetAgent = db.select().from(experten).where(eq(experten.id, agentId)).get() as any;

       if (!task) {
         trace(expertId, unternehmenId, 'error', 'delegate_task fehlgeschlagen', `Task ${taskId} nicht gefunden`);
         return;
       }
       if (!targetAgent) {
         trace(expertId, unternehmenId, 'error', 'delegate_task fehlgeschlagen', `Agent ${agentId} nicht gefunden`);
         return;
       }

       // Assign task
       db.update(aufgaben)
         .set({ zugewiesenAn: agentId, status: 'todo', aktualisiertAm: new Date().toISOString() })
         .where(eq(aufgaben.id, taskId))
         .run();

       trace(expertId, unternehmenId, 'action', `Aufgabe delegiert`, `"${task.titel}" → ${targetAgent.name}`);
       broadcast('task_updated', { unternehmenId, taskId, assignedTo: agentId, agentName: targetAgent.name });

       // Send briefing message to the target agent
       const briefing = message
         ? message
         : `Neue Aufgabe delegiert von ${expert.name}:\n\n**${task.titel}**${task.beschreibung ? '\n' + task.beschreibung : ''}`;

       const delegateMsg = {
         id: uuid(),
         unternehmenId,
         expertId: agentId,
         vonExpertId: expertId,
         absenderTyp: 'agent' as const,
         absenderName: expert.name,
         nachricht: briefing,
         gelesen: false,
         erstelltAm: new Date().toISOString(),
       };
       db.insert(chatNachrichten).values(delegateMsg).run();
       broadcast('chat_message', delegateMsg);

       // Notify board
       const boardMsg = {
         id: uuid(),
         unternehmenId,
         expertId,
         absenderTyp: 'system' as const,
         nachricht: `📋 ${expert.name} hat "${task.titel}" an ${targetAgent.name} delegiert.`,
         gelesen: false,
         erstelltAm: new Date().toISOString(),
       };
       db.insert(chatNachrichten).values(boardMsg).run();
       broadcast('chat_message', boardMsg);

       // Wake up the target agent so it picks up the task
       setTimeout(() => {
         this.triggerZyklus(agentId, unternehmenId, 'manual', expertId).catch(e => {
           console.error(`delegate_task wakeup error for ${agentId}:`, e);
         });
       }, 300);

    } else if (action === 'invoke_device_sensor') {
       if (!params.nodeId || !params.action) {
         throw new Error('nodeId und action sind erforderlich für invoke_device_sensor');
       }
       
       try {
         trace(expertId, unternehmenId, 'action', `Invoke Device Node`, `${params.action} an ${params.nodeId}`);
         const result = await nodeManager.invokeNode(params.nodeId, params.action, params.params);
         
         const msg = {
           id: uuid(),
           unternehmenId,
           expertId,
           absenderTyp: 'system' as const,
           nachricht: `✅ Gerät ${params.nodeId} antwortet auf '${params.action}':\n${JSON.stringify(result, null, 2)}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatNachrichten).values(msg).run();
         broadcast('chat_message', msg);
       } catch (err: any) {
         let errorMsg = err.message;
         if (errorMsg.includes('PERMISSION_MISSING')) {
           errorMsg = `⚠️ Zugriff verweigert: Das Betriebssystem des Endgeräts (TCC) hat den Zugriff auf '${params.action}' blockiert. Bitte den Nutzer bitten, die Berechtigungen in den Systemeinstellungen freizugeben.`;
         }
         
         const msg = {
           id: uuid(),
           unternehmenId,
           expertId,
           absenderTyp: 'system' as const,
           nachricht: `❌ Fehler bei Geräte-Aktion '${params.action}': ${errorMsg}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatNachrichten).values(msg).run();
         broadcast('chat_message', msg);
       }
    } else if (action === 'send_channel_message') {
       const { channel, text, recipient } = params;
       if (!text) throw new Error('text ist erforderlich für send_channel_message');
       
       try {
         if (channel === 'telegram') {
           trace(expertId, unternehmenId, 'action', `Sending Telegram`, text.slice(0, 50) + (text.length > 50 ? '...' : ''));
           await messagingService.sendTelegram(unternehmenId, `*${expert.name}*: ${text}`);
           
           const msg = {
             id: uuid(),
             unternehmenId,
             expertId,
             absenderTyp: 'agent' as const,
             nachricht: `[Gesendet via Telegram]: ${text}`,
             gelesen: true,
             erstelltAm: new Date().toISOString()
           };
           db.insert(chatNachrichten).values(msg).run();
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
           trace(expertId, unternehmenId, 'error', `Ungültiger Task-Status`, `"${params.status}" ist kein gültiger Status. Erlaubt: ${VALID_STATUSES.join(', ')}`);
           return;
         }
         const taskBefore = db.select().from(aufgaben).where(eq(aufgaben.id, params.id)).get();

         // ─── Critic gate: run review before finalising 'done' ───────────────
         if (normalizedStatus === 'done' && taskBefore && taskBefore.status !== 'done') {
           // Best-effort: use most recent task comment as agent output proxy; fall
           // back to last arbeitszyklen output for this expert if none exists.
           let agentOutputProxy = '';
           try {
             const lastComment = db.select({ inhalt: kommentare.inhalt })
               .from(kommentare).where(eq(kommentare.aufgabeId, params.id))
               .orderBy(desc(kommentare.erstelltAm)).limit(1).get() as any;
             if (lastComment?.inhalt) {
               agentOutputProxy = lastComment.inhalt;
             } else {
               const lastCycle = db.select({ ausgabe: arbeitszyklen.ausgabe })
                 .from(arbeitszyklen).where(eq(arbeitszyklen.expertId, expertId))
                 .orderBy(desc(arbeitszyklen.erstelltAm)).limit(1).get() as any;
               agentOutputProxy = lastCycle?.ausgabe || '';
             }
           } catch { /* ignore — critic will auto-approve on empty output */ }

           try {
             const criticResult = await heartbeatService.runCriticReview(
               params.id,
               taskBefore.titel,
               (taskBefore as any).beschreibung || '',
               agentOutputProxy,
               expertId,
               unternehmenId,
             );

             if (!criticResult.approved) {
               const finalStatus = criticResult.escalate ? 'blocked' : 'in_progress';
               const commentPrefix = criticResult.escalate
                 ? '🚨 **Critic Review — Manuelle Prüfung erforderlich**'
                 : '🔍 **Critic Review — Überarbeitung erforderlich**';
               const commentSuffix = criticResult.escalate
                 ? '*Bitte prüfe manuell.*'
                 : '*Bitte überarbeite die Aufgabe.*';

               db.insert(kommentare).values({
                 id: uuid(),
                 unternehmenId,
                 aufgabeId: params.id,
                 autorExpertId: expertId,
                 autorTyp: 'agent',
                 inhalt: `${commentPrefix}\n\n${criticResult.feedback}\n\n${commentSuffix}`,
                 erstelltAm: new Date().toISOString(),
               }).run();

               db.update(aufgaben).set({ status: finalStatus, aktualisiertAm: new Date().toISOString() }).where(eq(aufgaben.id, params.id)).run();
               trace(expertId, unternehmenId, criticResult.escalate ? 'warning' : 'info',
                 `Critic: ${criticResult.escalate ? 'Eskaliert' : 'Überarbeitung nötig'} — ${taskBefore.titel}`,
                 criticResult.feedback);
               return; // skip the normal done path below
             }
           } catch (criticErr: any) {
             console.warn(`[Scheduler] Critic review failed for task ${params.id}:`, criticErr?.message);
             // fail open — proceed to done
           }
         }
         // ────────────────────────────────────────────────────────────────────

         db.update(aufgaben).set({ status: normalizedStatus, aktualisiertAm: new Date().toISOString() }).where(eq(aufgaben.id, params.id)).run();
         // Broadcast + Telegram notification when a task is completed
         if (normalizedStatus === 'done' && taskBefore && taskBefore.status !== 'done') {
           broadcast('task_completed', { unternehmenId, taskId: params.id, titel: taskBefore.titel, agentName: expert.name });
           messagingService.sendTelegram(unternehmenId,
             `✅ *Aufgabe erledigt*\n\n*${taskBefore.titel}*\n_Abgeschlossen von ${expert.name}_`
           ).catch(() => {});
         } else if (normalizedStatus === 'in_progress' && taskBefore && taskBefore.status !== 'in_progress') {
           broadcast('task_started', { unternehmenId, taskId: params.id, titel: taskBefore?.titel, agentName: expert.name });
         }
       }
    } else if (action === 'call_meeting') {
       // ── Multi-Agent Meeting (CEO koordiniert mehrere Agents) ──────────────
       const { frage, teilnehmer } = params;
       if (!frage || !Array.isArray(teilnehmer) || teilnehmer.length === 0) {
         trace(expertId, unternehmenId, 'error', `call_meeting fehlgeschlagen`, 'frage und teilnehmer[] erforderlich');
         return;
       }

       // Validate participant IDs
       const validTeilnehmer = teilnehmer.filter((id: string) => {
         const a = db.select({ id: experten.id }).from(experten).where(eq(experten.id, id)).get();
         return !!a && id !== expertId;
       });

       if (validTeilnehmer.length === 0) {
         trace(expertId, unternehmenId, 'error', `call_meeting fehlgeschlagen`, 'Keine gültigen Teilnehmer gefunden');
         return;
       }

       const meetingId = uuid();
       db.insert(agentMeetings).values({
         id: meetingId,
         unternehmenId,
         titel: frage,
         veranstalterExpertId: expertId,
         teilnehmerIds: JSON.stringify(validTeilnehmer),
         antworten: '{}',
         status: 'running',
         erstelltAm: now(),
       }).run();

       trace(expertId, unternehmenId, 'action', `Meeting gestartet`, `"${frage}" · ${validTeilnehmer.length} Teilnehmer`);
       broadcast('meeting_created', { unternehmenId, meetingId, titel: frage, veranstalterName: expert.name, teilnehmerIds: validTeilnehmer });

       // Notify board
       const statusMsg = {
         id: uuid(),
         unternehmenId,
         expertId,
         absenderTyp: 'system' as const,
         nachricht: `📋 Meeting gestartet: "${frage}"\n${validTeilnehmer.length} Teilnehmer eingeladen.`,
         gelesen: false,
         erstelltAm: now(),
       };
       db.insert(chatNachrichten).values(statusMsg).run();
       broadcast('chat_message', statusMsg);

       // Send question to each participant (staggered to avoid race)
       validTeilnehmer.forEach((teilnehmerId: string, idx: number) => {
         const frageMsg = {
           id: uuid(),
           unternehmenId,
           expertId: teilnehmerId,
           vonExpertId: expertId,
           threadId: meetingId,
           absenderTyp: 'agent' as const,
           absenderName: expert.name,
           nachricht: `📋 **Meeting-Anfrage von ${expert.name}**\n\n${frage}\n\nBitte antworte kurz und direkt.`,
           gelesen: false,
           erstelltAm: now(),
         };
         db.insert(chatNachrichten).values(frageMsg).run();
         broadcast('chat_message', frageMsg);

         setTimeout(() => {
           this.triggerZyklus(teilnehmerId, unternehmenId, 'manual', expertId, meetingId).catch(e => {
             console.error(`Meeting wakeup error for ${teilnehmerId}:`, e);
           });
         }, (idx + 1) * 600);
       });

    } else if (action === 'chat') {
       const text = params.nachricht || params.message || params.inhalt || params.text;
       if (text) {
          // If empfaenger (recipient agent ID) is set, store as P2P message for that agent
          const empfaenger = params.empfaenger || params.recipient || null;
          const targetExpertId = empfaenger || expertId;
          const msg = {
             id: uuid(),
             unternehmenId,
             expertId: targetExpertId,
             vonExpertId: empfaenger ? expertId : null,   // track sender for P2P routing
             absenderTyp: 'agent' as const,
             absenderName: expert.name,
             nachricht: empfaenger
               ? `[Von ${expert.name}]: ${text}`
               : text,
             gelesen: false,
             erstelltAm: new Date().toISOString()
           };
           db.insert(chatNachrichten).values(msg).run();
           broadcast('chat_message', msg);

           if (empfaenger && empfaenger !== expertId) {
             // P2P: wake target agent
             trace(expertId, unternehmenId, 'info', `P2P Nachricht an Kollege`, `→ ${empfaenger.slice(0,8)}: ${text.slice(0,50)}`);
             setTimeout(() => {
               this.triggerZyklus(empfaenger, unternehmenId, 'manual', expertId).catch(e => {
                 console.error('P2P Wakeup Error:', e);
               });
             }, 100);
           } else {
             // Board message (no recipient) → also push to Telegram so user gets notified
             messagingService.sendTelegram(
               unternehmenId,
               `💬 *${expert.name}*:\n${text}`
             ).catch(() => {});
             trace(expertId, unternehmenId, 'info', `Board-Nachricht`, text.slice(0, 80));
           }
       }
    } else if (action === 'hire_agent') {
       // ─── Agent Spawning (Task-Manager-Vorbild) ──────────────────────────
       const { hireAgent } = await import('./services/agent-spawning.js');
       const hireResult = hireAgent({
         unternehmenId,
         requestedBy: expertId,
         name: params.name || 'Neuer Agent',
         rolle: params.rolle || 'Assistent',
         faehigkeiten: params.faehigkeiten,
         verbindungsTyp: params.verbindungsTyp || 'openrouter',
         budgetMonatCent: 0, // 0 = unlimited; agent-specific budgets set manually
         requireApproval: true, // Default: require board approval for agent hiring
       });
       if (hireResult.success) {
         trace(expertId, unternehmenId, 'action', `Agent eingestellt: ${params.name}`,
           hireResult.approvalId ? `Genehmigung ausstehend (${hireResult.approvalId})` : `ID: ${hireResult.expertId}`);
       }
       const msg = {
         id: uuid(), unternehmenId, expertId,
         absenderTyp: 'system' as const,
         nachricht: hireResult.success
           ? (hireResult.approvalId ? `⏳ Hiring von "${params.name}" wartet auf Board-Genehmigung.` : `✅ "${params.name}" (${params.rolle}) erfolgreich eingestellt.`)
           : `❌ Hiring fehlgeschlagen: ${hireResult.error}`,
         gelesen: false, erstelltAm: new Date().toISOString()
       };
       db.insert(chatNachrichten).values(msg).run();
       broadcast('chat_message', msg);
    } else if (action === 'add_dependency') {
       // ─── Issue Dependencies (Task-Manager-Vorbild) ──────────────────────
       const { erstelleAbhaengigkeit: addDep } = await import('./services/issue-dependencies.js');
       const depResult = addDep(params.blockerId, params.blockedId, expertId);
       const msg = {
         id: uuid(), unternehmenId, expertId,
         absenderTyp: 'system' as const,
         nachricht: depResult.success
           ? `🔗 Dependency erstellt: ${params.blockerId.slice(0,8)} blockiert ${params.blockedId.slice(0,8)}`
           : `❌ Dependency Fehler: ${depResult.error}`,
         gelesen: false, erstelltAm: new Date().toISOString()
       };
       db.insert(chatNachrichten).values(msg).run();
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

         trace(expertId, unternehmenId, 'action', beschreibung);
         const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
         const msg = {
           id: uuid(), unternehmenId, expertId,
           absenderTyp: 'system' as const,
           nachricht: `🖥️ ${beschreibung}:\n${resultText.slice(0, 1500)}`,
           gelesen: false, erstelltAm: new Date().toISOString()
         };
         db.insert(chatNachrichten).values(msg).run();
         broadcast('chat_message', msg);
       } catch (err: any) {
         let errorMsg = err.message;
         if (errorMsg.includes('PERMISSION_MISSING')) {
           errorMsg = `Zugriff verweigert: Das Betriebssystem hat den Zugriff auf '${action}' blockiert.`;
         }
         const msg = {
           id: uuid(), unternehmenId, expertId,
           absenderTyp: 'system' as const,
           nachricht: `❌ ${action} fehlgeschlagen: ${errorMsg}`,
           gelesen: false, erstelltAm: new Date().toISOString()
         };
         db.insert(chatNachrichten).values(msg).run();
         broadcast('chat_message', msg);
       }
    } else if (action === 'session_search') {
       // ─── FTS5 Session Search (Learning Loop-Vorbild) ────────────────────────
       const query = params.query || '';
       const searchResult = sessionSearch(query, expertId);
       trace(expertId, unternehmenId, 'action', `Session Search: "${query}"`, `${searchResult.length} Zeichen Ergebnis`);
       const msg = {
         id: uuid(),
         unternehmenId,
         expertId,
         absenderTyp: 'system' as const,
         nachricht: `🔍 ${searchResult.slice(0, 1500)}`,
         gelesen: false,
         erstelltAm: new Date().toISOString()
       };
       db.insert(chatNachrichten).values(msg).run();
       broadcast('chat_message', msg);
    } else if (action.startsWith('memory_')) {
       // ─── Memory Tools (via MCP) ────────────────────────────────────
       try {
         trace(expertId, unternehmenId, 'action', `Memory: ${action}`, JSON.stringify(params).slice(0, 200));
         const result = await mcpClient.callTool(action, params);
         const resultText = result?.content?.[0]?.text || JSON.stringify(result);

         const msg = {
           id: uuid(),
           unternehmenId,
           expertId,
           absenderTyp: 'system' as const,
           nachricht: `🧠 Memory (${action}):\n${resultText.slice(0, 1500)}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatNachrichten).values(msg).run();
         broadcast('chat_message', msg);
       } catch (err: any) {
         const msg = {
           id: uuid(),
           unternehmenId,
           expertId,
           absenderTyp: 'system' as const,
           nachricht: `⚠️ Memory Fehler (${action}): ${err.message}`,
           gelesen: false,
           erstelltAm: new Date().toISOString()
         };
         db.insert(chatNachrichten).values(msg).run();
         broadcast('chat_message', msg);
       }
    } else if (action === 'create_routine') {
       // ─── Autonome Routine-Erstellung (Agent kann eigene Schedules anlegen) ─
       // params: { titel, beschreibung, cronExpression, assignToSelf?, timezone? }
       const { titel: rtitel, beschreibung: rbeschr, cronExpression, assignToSelf, timezone } = params;
       if (!rtitel || !cronExpression) {
         const errMsg = { id: uuid(), unternehmenId, expertId, absenderTyp: 'system' as const,
           nachricht: `❌ create_routine: titel und cronExpression sind erforderlich`, gelesen: false, erstelltAm: new Date().toISOString() };
         db.insert(chatNachrichten).values(errMsg).run();
         broadcast('chat_message', errMsg);
         return;
       }

       const routineId = uuid();
       const triggerId = uuid();
       const ts = new Date().toISOString();
       db.insert(routinen).values({
         id: routineId,
         unternehmenId,
         titel: rtitel,
         beschreibung: rbeschr || '',
         zugewiesenAn: assignToSelf !== false ? expertId : null,
         prioritaet: (params.prioritaet || 'medium') as any,
         status: 'active',
         erstelltAm: ts,
         aktualisiertAm: ts,
       }).run();

       db.insert(routineTrigger).values({
         id: triggerId,
         unternehmenId,
         routineId,
         kind: 'schedule',
         aktiv: true,
         cronExpression,
         timezone: timezone || 'Europe/Berlin',
         erstelltAm: ts,
       }).run();

       trace(expertId, unternehmenId, 'action', `Routine erstellt`, `"${rtitel}" (${cronExpression})`);
       broadcast('routine_created', { unternehmenId, routineId, titel: rtitel, cronExpression });

       const confirmMsg = {
         id: uuid(), unternehmenId, expertId, absenderTyp: 'system' as const,
         nachricht: `✅ Routine eingerichtet: **${rtitel}**\n⏰ Zeitplan: \`${cronExpression}\` (${timezone || 'Europe/Berlin'})\nID: \`${routineId}\``,
         gelesen: false, erstelltAm: ts,
       };
       db.insert(chatNachrichten).values(confirmMsg).run();
       broadcast('chat_message', confirmMsg);

    } else if (action === 'store_secret') {
       // ─── Secrets/Credentials verschlüsselt speichern ─────────────────────
       // params: { name, value, description? }
       // Gespeichert als "secret_<name>" in einstellungen — verschlüsselt mit AES-256-GCM
       const { name: secretName, value: secretValue, description: secretDesc } = params;
       if (!secretName || !secretValue) {
         const errMsg = { id: uuid(), unternehmenId, expertId, absenderTyp: 'system' as const,
           nachricht: `❌ store_secret: name und value sind erforderlich`, gelesen: false, erstelltAm: new Date().toISOString() };
         db.insert(chatNachrichten).values(errMsg).run();
         broadcast('chat_message', errMsg);
         return;
       }

       const { encryptValue } = await import('./utils/crypto.js');
       const key = `secret_${secretName.toLowerCase().replace(/\s+/g, '_')}`;
       const encryptedValue = encryptValue(String(secretValue));

       db.insert(einstellungen).values({ schluessel: key, wert: encryptedValue, unternehmenId })
         .onConflictDoUpdate({ target: [einstellungen.schluessel, einstellungen.unternehmenId], set: { wert: encryptedValue } })
         .run();

       trace(expertId, unternehmenId, 'action', `Secret gespeichert`, `Schlüssel: ${key}`);

       const confirmMsg = {
         id: uuid(), unternehmenId, expertId, absenderTyp: 'system' as const,
         nachricht: `🔐 Credential gespeichert: **${secretName}**\nVerschlüsselt abgelegt — Agenten können es mit Schlüssel \`${key}\` abrufen.`,
         gelesen: false, erstelltAm: new Date().toISOString(),
       };
       db.insert(chatNachrichten).values(confirmMsg).run();
       broadcast('chat_message', confirmMsg);

    } else {
       // Alle anderen Aktionen werden als "Skills" behandelt — mit task-spezifischem Workspace
       await executeSkill(expertId, unternehmenId, action, params, workspacePath);
    }
  }

}

export const scheduler = new Scheduler();

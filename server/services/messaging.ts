import { db } from '../db/client.js';
import { einstellungen, experten, chatNachrichten, unternehmen, ziele, kostenbuchungen } from '../db/schema.js';
import { eq, and, desc, asc, gte } from 'drizzle-orm';
import { decryptSetting, encryptSetting } from '../utils/crypto.js';
import { v4 as uuid } from 'uuid';
import { scheduler } from '../scheduler.js';
import { traceEreignisse, aufgaben as aufgabenTable, genehmigungen as genehmigungenTable, agentPermissions } from '../db/schema.js';
import { appEvents } from '../events.js';
import { runClaudeDirectChat } from '../adapters/claude-code.js';

// ─── Shared: Build CEO config context for system prompts ─────────────────────

export function buildConfigContext(unternehmenId: string): string {
  const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
  const allSettings = db.select().from(einstellungen).all();

  const getKey = (key: string) =>
    allSettings.find(s => s.schluessel === key && s.unternehmenId === unternehmenId) ||
    allSettings.find(s => s.schluessel === key && (!s.unternehmenId || s.unternehmenId === ''));

  const keyStatus = (key: string) => (getKey(key)?.wert ? '✅' : '❌ nicht hinterlegt');

  const agentLines = (agents as any[]).map(a => {
    let cfg: any = {};
    try { cfg = JSON.parse(a.verbindungsConfig || '{}'); } catch {}
    const model = cfg.model || '(Standard)';
    return `  • ${a.name} [${a.id.slice(0,8)}] — Typ: ${a.verbindungsTyp || 'claude-code'}, Modell: ${model}`;
  }).join('\n');

  return `
SYSTEM-KONFIGURATION (du kannst diese per Aktion ändern):

Agenten:
${agentLines}

API Keys:
  • OpenRouter:  ${keyStatus('openrouter_api_key')}
  • Anthropic:   ${keyStatus('anthropic_api_key')}
  • OpenAI:      ${keyStatus('openai_api_key')}

Verfügbare Verbindungstypen:
  • claude-code  — Lokale Claude CLI (Pro/Max Abo, kein API Key nötig)
  • openrouter   — OpenRouter API (benötigt openrouter_api_key)
  • anthropic    — Anthropic direkt (benötigt anthropic_api_key)
  • openai       — OpenAI direkt (benötigt openai_api_key)
  • ollama       — Lokales Ollama (kein API Key, braucht laufende Instanz)

KONFIGURATIONSAKTIONEN (am Ende der Antwort, falls nötig):
[ACTION]{"type": "configure_agent", "agentId": "8-Zeichen-ID", "verbindungsTyp": "openrouter", "model": "anthropic/claude-opus-4"}[/ACTION]
[ACTION]{"type": "save_setting", "key": "openrouter_api_key", "value": "sk-or-..."}[/ACTION]
[ACTION]{"type": "create_agent", "name": "Name", "rolle": "Rolle", "faehigkeiten": "React, Node.js", "verbindungsTyp": "claude-code"}[/ACTION]
[ACTION]{"type": "set_company_workdir", "path": "/absoluter/pfad/zum/projekt"}[/ACTION]`;
}

// ─── Shared: Execute config actions ──────────────────────────────────────────

export function executeConfigAction(action: any, unternehmenId: string): string | null {
  if (action.type === 'configure_agent') {
    const agent = db.select().from(experten)
      .where(and(eq(experten.unternehmenId, unternehmenId)))
      .all()
      .find((a: any) => a.id.startsWith(action.agentId));
    if (!agent) return `❌ Agent "${action.agentId}" nicht gefunden.`;

    let cfg: any = {};
    try { cfg = JSON.parse((agent as any).verbindungsConfig || '{}'); } catch {}
    if (action.model) cfg.model = action.model;

    db.update(experten).set({
      verbindungsTyp: action.verbindungsTyp || (agent as any).verbindungsTyp,
      verbindungsConfig: JSON.stringify(cfg),
      aktualisiertAm: new Date().toISOString(),
    }).where(eq(experten.id, (agent as any).id)).run();

    return `✅ ${(agent as any).name} konfiguriert: ${action.verbindungsTyp}${action.model ? ` / ${action.model}` : ''}`;
  }

  if (action.type === 'save_setting') {
    if (!action.key || !action.value) return '❌ Key oder Value fehlt.';
    const ALLOWED_KEYS = ['openrouter_api_key', 'anthropic_api_key', 'openai_api_key', 'ollama_base_url', 'telegram_bot_token'];
    if (!ALLOWED_KEYS.includes(action.key)) return `❌ Key "${action.key}" nicht erlaubt.`;

    const encrypted = encryptSetting(action.key, action.value);
    const existing = db.select().from(einstellungen)
      .where(and(eq(einstellungen.schluessel, action.key), eq(einstellungen.unternehmenId, unternehmenId))).get();

    if (existing) {
      db.update(einstellungen).set({ wert: encrypted, aktualisiertAm: new Date().toISOString() })
        .where(and(eq(einstellungen.schluessel, action.key), eq(einstellungen.unternehmenId, unternehmenId))).run();
    } else {
      db.insert(einstellungen).values({
        unternehmenId, schluessel: action.key, wert: encrypted,
        aktualisiertAm: new Date().toISOString(),
      }).run();
    }
    return `✅ Setting "${action.key}" gespeichert.`;
  }

  if (action.type === 'create_agent') {
    if (!action.name || !action.rolle) return '❌ Name und Rolle sind erforderlich.';
    const newId = uuid();
    const verbindungsTyp = action.verbindungsTyp || 'claude-code';
    const cfg = { model: action.model || 'claude-sonnet-4-6', autonomyLevel: action.autonomyLevel || 'autonomous' };
    db.insert(experten).values({
      id: newId,
      unternehmenId,
      name: action.name,
      rolle: action.rolle,
      titel: action.titel || action.rolle,
      faehigkeiten: action.faehigkeiten || action.skills || null,
      verbindungsTyp,
      verbindungsConfig: JSON.stringify(cfg),
      status: 'idle',
      zyklusAktiv: action.zyklusAktiv !== false,
      zyklusIntervallSek: action.zyklusIntervallSek || 300,
      isOrchestrator: false,
      erstelltAm: new Date().toISOString(),
      aktualisiertAm: new Date().toISOString(),
    }).run();
    return `✅ Agent *${action.name}* erstellt (${action.rolle}) — Verbindung: ${verbindungsTyp}`;
  }

  if (action.type === 'set_company_workdir') {
    if (!action.path) return '❌ Pfad fehlt.';
    db.update(unternehmen as any)
      .set({ workDir: action.path, aktualisiertAm: new Date().toISOString() } as any)
      .where(eq((unternehmen as any).id, unternehmenId)).run();
    return `✅ Arbeitsverzeichnis gesetzt: \`${action.path}\``;
  }

  return null;
}

// ─── Language helpers ─────────────────────────────────────────────────────────

export function getUiLanguage(unternehmenId: string): 'de' | 'en' {
  try {
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
  return 'de';
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

function getBotConfig(unternehmenId: string): BotConfig | null {
  const all = db.select().from(einstellungen).all();
  const get = (key: string) =>
    all.find(s => s.schluessel === key && s.unternehmenId === unternehmenId) ||
    all.find(s => s.schluessel === key && (!s.unternehmenId || s.unternehmenId === ''));

  const tokenEntry = get('telegram_bot_token');
  const chatEntry  = get('telegram_chat_id');
  if (!tokenEntry?.wert || !chatEntry?.wert) return null;

  const token = decryptSetting('telegram_bot_token', tokenEntry.wert);
  if (!token) return null;
  return { token, chatId: chatEntry.wert };
}

// ─── Main service ─────────────────────────────────────────────────────────────

export const messagingService = {

  // ── Public send (used by the rest of the app) ──────────────────────────────

  async sendTelegram(unternehmenId: string, text: string, keyboard?: InlineKeyboard) {
    try {
      const cfg = getBotConfig(unternehmenId);
      if (!cfg) return;
      await sendMsg(cfg.token, cfg.chatId, text, keyboard);
    } catch (e) {
      console.error(`[Telegram] sendTelegram error (${unternehmenId}):`, e);
    }
  },

  // ── Command handler ────────────────────────────────────────────────────────

  async handleCommand(unternehmenId: string, chatId: string, token: string, text: string): Promise<boolean> {
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
      const agents    = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
      const active    = agents.filter((a: any) => a.status === 'active' || a.status === 'busy');
      const allTasks  = db.select().from(aufgabenTable).where(eq(aufgabenTable.unternehmenId, unternehmenId)).all();
      const inProg    = allTasks.filter((t: any) => t.status === 'in_progress');
      const todo      = allTasks.filter((t: any) => t.status === 'todo');
      const done      = allTasks.filter((t: any) => t.status === 'done');
      const pending   = db.select().from(genehmigungenTable)
        .where(and(eq(genehmigungenTable.unternehmenId, unternehmenId), eq(genehmigungenTable.status, 'pending'))).all();
      const traces    = db.select().from(traceEreignisse)
        .where(eq(traceEreignisse.unternehmenId, unternehmenId))
        .orderBy(desc(traceEreignisse.erstelltAm)).limit(4).all();
      const comp      = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();

      let msg = `📊 *${comp?.name || 'OpenCognit'}*\n\n`;
      msg += `🤖 Team: ${agents.length} Agenten (${active.length} aktiv)\n`;
      msg += `🏗️ Laufend: ${inProg.length}  📋 Todo: ${todo.length}  ✅ Erledigt: ${done.length}\n`;
      if (pending.length > 0) msg += `⚖️ *${pending.length} Genehmigung${pending.length > 1 ? 'en' : ''} offen!*\n`;
      if (traces.length > 0) {
        msg += `\n📜 *Letzte Aktivitäten*\n`;
        traces.forEach((t: any) => { msg += `  · ${t.titel}\n`; });
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
      const tasks = db.select().from(aufgabenTable)
        .where(and(eq(aufgabenTable.unternehmenId, unternehmenId), eq(aufgabenTable.status, 'todo')))
        .orderBy(desc(aufgabenTable.erstelltAm)).limit(8).all();
      const agents = db.select().from(experten).where(eq(aufgabenTable.unternehmenId, unternehmenId)).all();

      if (tasks.length === 0) {
        await sendMsg(token, chatId, '📋 Keine offenen Aufgaben. 🎉');
        return true;
      }

      let msg = `📋 *Offene Aufgaben (${tasks.length})*\n\n`;
      const keyboard: InlineKeyboard = [];

      (tasks as any[]).forEach(t => {
        const assignee = agents.find((a: any) => a.id === t.zugewiesenAn)?.name || '—';
        msg += `${prioEmoji(t.prioritaet)} \`${shortId(t.id)}\` *${t.titel}*\n`;
        msg += `   👤 ${assignee}\n`;
        keyboard.push([
          { text: `✅ ${t.titel.slice(0, 20)}`, callback_data: `dn:${shortId(t.id)}` },
        ]);
      });

      await sendMsg(token, chatId, msg, keyboard);
      return true;
    }

    // ── /approvals ───────────────────────────────────────────────────────────
    if (cmd === '/approvals') {
      const approvals = db.select().from(genehmigungenTable)
        .where(and(eq(genehmigungenTable.unternehmenId, unternehmenId), eq(genehmigungenTable.status, 'pending')))
        .limit(5).all();

      if (approvals.length === 0) {
        await sendMsg(token, chatId, '✅ Keine offenen Genehmigungen.');
        return true;
      }

      let msg = `⚖️ *Offene Genehmigungen (${approvals.length})*\n\n`;
      const keyboard: InlineKeyboard = [];

      (approvals as any[]).forEach(a => {
        msg += `\`${shortId(a.id)}\` *${a.titel}*\n`;
        if (a.beschreibung) msg += `_${a.beschreibung.slice(0, 80)}_\n`;
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
      const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
      if (agents.length === 0) {
        await sendMsg(token, chatId, '🤖 Noch keine Agenten vorhanden.');
        return true;
      }

      let msg = `🤖 *Dein Team (${agents.length})*\n\n`;
      const keyboard: InlineKeyboard = [];

      (agents as any[]).forEach(a => {
        const s = a.status === 'active' ? '🟢' : a.status === 'busy' ? '🟡' : '⚫';
        msg += `${s} *${a.name}* — ${a.rolle}\n`;
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
      const goals = db.select().from(ziele)
        .where(and(eq(ziele.unternehmenId, unternehmenId), eq(ziele.status, 'active')))
        .orderBy(desc((ziele as any).fortschritt)).limit(8).all();

      if (goals.length === 0) {
        await sendMsg(token, chatId, '🎯 Keine aktiven Ziele. Erstell welche im Dashboard.');
        return true;
      }

      let msg = `🎯 *Aktive Ziele*\n\n`;
      (goals as any[]).forEach(g => {
        const bar = progressBar(g.fortschritt || 0);
        const pct = g.fortschritt || 0;
        const lvl = g.ebene === 'company' ? '🏢' : g.ebene === 'team' ? '👥' : g.ebene === 'agent' ? '🤖' : '📋';
        msg += `${lvl} *${g.titel}*\n`;
        msg += `\`${bar}\` ${pct}%\n\n`;
      });

      await sendMsg(token, chatId, msg);
      return true;
    }

    // ── /costs ───────────────────────────────────────────────────────────────
    if (cmd === '/costs') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const allCosts = db.select().from(kostenbuchungen)
        .where(and(eq(kostenbuchungen.unternehmenId, unternehmenId), gte(kostenbuchungen.zeitpunkt, monthAgo)))
        .all();

      const weekCosts = allCosts.filter((c: any) => c.zeitpunkt >= weekAgo);
      const monthTotal = allCosts.reduce((sum: number, c: any) => sum + (c.kostenCent || 0), 0);
      const weekTotal  = weekCosts.reduce((sum: number, c: any) => sum + (c.kostenCent || 0), 0);

      // Per-agent breakdown (last 30d)
      const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
      const perAgent: Record<string, number> = {};
      allCosts.forEach((c: any) => { perAgent[c.expertId] = (perAgent[c.expertId] || 0) + (c.kostenCent || 0); });

      let msg = `💰 *Kosten-Überblick*\n\n`;
      msg += `Diese Woche: *$${(weekTotal / 100).toFixed(3)}*\n`;
      msg += `Letzter Monat: *$${(monthTotal / 100).toFixed(3)}*\n\n`;

      if (Object.keys(perAgent).length > 0) {
        msg += `*Aufschlüsselung nach Agent (30d):*\n`;
        const sorted = Object.entries(perAgent).sort(([, a], [, b]) => b - a).slice(0, 6);
        sorted.forEach(([agentId, cents]) => {
          const name = (agents as any[]).find((a: any) => a.id === agentId)?.name || agentId.slice(0, 8);
          msg += `  · ${name}: $${(cents / 100).toFixed(3)}\n`;
        });
      }

      await sendMsg(token, chatId, msg);
      return true;
    }

    // ── /report ──────────────────────────────────────────────────────────────
    if (cmd === '/report') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const allTasks = db.select().from(aufgabenTable).where(eq(aufgabenTable.unternehmenId, unternehmenId)).all();
      const agents   = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
      const goals    = db.select().from(ziele).where(and(eq(ziele.unternehmenId, unternehmenId), eq(ziele.status, 'active'))).all();
      const weekCosts = db.select().from(kostenbuchungen)
        .where(and(eq(kostenbuchungen.unternehmenId, unternehmenId), gte(kostenbuchungen.zeitpunkt, weekAgo))).all();

      const doneTasks = allTasks.filter((t: any) => t.status === 'done' && t.aktualisiertAm >= weekAgo);
      const openTasks = allTasks.filter((t: any) => t.status === 'todo' || t.status === 'in_progress');
      const totalCost = weekCosts.reduce((s: number, c: any) => s + (c.kostenCent || 0), 0);

      // Top agent by tasks done
      const agentDone: Record<string, number> = {};
      doneTasks.forEach((t: any) => { if (t.zugewiesenAn) agentDone[t.zugewiesenAn] = (agentDone[t.zugewiesenAn] || 0) + 1; });
      const topAgentId = Object.entries(agentDone).sort(([,a],[,b]) => b-a)[0]?.[0];
      const topAgent = (agents as any[]).find((a: any) => a.id === topAgentId)?.name;

      const now = new Date();
      const week = `KW ${Math.ceil(now.getDate() / 7)} · ${now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;

      let msg = `📈 *Wochenbericht — ${week}*\n\n`;
      msg += `✅ Erledigt: *${doneTasks.length} Tasks*\n`;
      msg += `📋 Offen: *${openTasks.length} Tasks*\n`;
      msg += `💰 KI-Kosten: *$${(totalCost / 100).toFixed(3)}*\n`;
      if (topAgent) msg += `🏆 Top-Agent: *${topAgent}* (${agentDone[topAgentId!]} Tasks)\n`;
      msg += `🎯 Aktive Ziele: *${goals.length}*\n`;

      if (goals.length > 0) {
        msg += `\n*Ziel-Fortschritt:*\n`;
        (goals as any[]).slice(0, 3).forEach(g => {
          msg += `  · ${g.titel}: ${progressBar(g.fortschritt || 0, 8)} ${g.fortschritt || 0}%\n`;
        });
      }

      await sendMsg(token, chatId, msg);
      return true;
    }

    // ── /wake ────────────────────────────────────────────────────────────────
    if (cmd === '/wake') {
      const query = parts.slice(1).join(' ').toLowerCase();
      const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();

      if (!query) {
        // Show all agents with wake buttons
        let msg = `⚡ *Wen aufwecken?*\n`;
        const keyboard: InlineKeyboard = (agents as any[]).map(a => ([
          { text: `⚡ ${a.name}`, callback_data: `wk:${a.id.slice(0, 8)}` }
        ]));
        await sendMsg(token, chatId, msg, keyboard);
        return true;
      }

      const agent = (agents as any[]).find((a: any) =>
        a.name.toLowerCase().includes(query) || a.rolle.toLowerCase().includes(query)
      );
      if (!agent) {
        await sendMsg(token, chatId, `❌ Agent "${query}" nicht gefunden.`);
        return true;
      }

      scheduler.triggerZyklus(agent.id, unternehmenId, 'telegram').catch(console.error);
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
      const all = db.select().from(aufgabenTable).where(eq(aufgabenTable.unternehmenId, unternehmenId)).all();
      const task = (all as any[]).find((t: any) => t.id.startsWith(idPrefix));
      if (!task) {
        await sendMsg(token, chatId, `❌ Task \`${idPrefix}\` nicht gefunden.`);
        return true;
      }
      db.update(aufgabenTable).set({ status: 'done', aktualisiertAm: new Date().toISOString() })
        .where(eq(aufgabenTable.id, task.id)).run();
      await sendMsg(token, chatId, `✅ *"${task.titel}"* abgeschlossen!`);
      return true;
    }

    // ── /new ─────────────────────────────────────────────────────────────────
    if (cmd === '/new') {
      const titel = text.slice('/new'.length).trim();
      if (!titel) {
        await sendMsg(token, chatId, '❌ Bitte Titel angeben: `/new Meine Aufgabe`');
        return true;
      }
      const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
      const ceo = (agents as any[]).find(a =>
        a.isOrchestrator === true || a.isOrchestrator === 1 ||
        a.verbindungsTyp === 'ceo' ||
        /ceo|manager|geschäftsführer/i.test(a.rolle)
      ) || agents[0];

      const newTask = {
        id: uuid(), unternehmenId, titel,
        beschreibung: `Erstellt via Telegram von Chat-ID ${chatId}`,
        status: 'todo' as const, prioritaet: 'medium' as const,
        zugewiesenAn: ceo?.id || null,
        erstelltAm: new Date().toISOString(), aktualisiertAm: new Date().toISOString(),
      };
      db.insert(aufgabenTable).values(newTask).run();
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
      const all = db.select().from(genehmigungenTable)
        .where(and(eq(genehmigungenTable.unternehmenId, unternehmenId), eq(genehmigungenTable.status, 'pending'))).all();
      const approval = (all as any[]).find(a => a.id.startsWith(idPrefix));
      if (!approval) {
        await sendMsg(token, chatId, `❌ Genehmigung \`${idPrefix}\` nicht gefunden.`);
        return true;
      }
      const newStatus = cmd === '/approve' ? 'approved' : 'rejected';
      db.update(genehmigungenTable).set({ status: newStatus, aktualisiertAm: new Date().toISOString() })
        .where(eq(genehmigungenTable.id, approval.id)).run();
      await sendMsg(token, chatId,
        `${cmd === '/approve' ? '✅ Genehmigt' : '❌ Abgelehnt'}: *${approval.titel}*`
      );
      return true;
    }

    // ── /me ──────────────────────────────────────────────────────────────────
    if (cmd === '/me') {
      const comp = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();
      await sendMsg(token, chatId,
        `👤 *Verbindungsinfos*\n\nTelegram Chat-ID: \`${chatId}\`\nUnternehmen: *${(comp as any)?.name || unternehmenId}*\nID: \`${unternehmenId}\``
      );
      return true;
    }

    return false;
  },

  // ── Callback query handler (inline button presses) ─────────────────────────

  async handleCallbackQuery(
    unternehmenId: string,
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
      await this.handleCommand(unternehmenId, chatId, token, `/${payload}`);
      return;
    }

    // Approve
    if (action === 'ap') {
      const all = db.select().from(genehmigungenTable)
        .where(and(eq(genehmigungenTable.unternehmenId, unternehmenId), eq(genehmigungenTable.status, 'pending'))).all();
      const approval = (all as any[]).find(a => a.id.startsWith(payload));
      if (!approval) { await answerCbq(token, callbackQueryId, '❌ Nicht gefunden'); return; }
      db.update(genehmigungenTable).set({ status: 'approved', aktualisiertAm: new Date().toISOString() })
        .where(eq(genehmigungenTable.id, approval.id)).run();
      await answerCbq(token, callbackQueryId, '✅ Genehmigt!');
      await editMsg(token, chatId, messageId, `✅ *Genehmigt:* ${approval.titel}`);
      return;
    }

    // Reject
    if (action === 'rj') {
      const all = db.select().from(genehmigungenTable)
        .where(and(eq(genehmigungenTable.unternehmenId, unternehmenId), eq(genehmigungenTable.status, 'pending'))).all();
      const approval = (all as any[]).find(a => a.id.startsWith(payload));
      if (!approval) { await answerCbq(token, callbackQueryId, '❌ Nicht gefunden'); return; }
      db.update(genehmigungenTable).set({ status: 'rejected', aktualisiertAm: new Date().toISOString() })
        .where(eq(genehmigungenTable.id, approval.id)).run();
      await answerCbq(token, callbackQueryId, '❌ Abgelehnt');
      await editMsg(token, chatId, messageId, `❌ *Abgelehnt:* ${approval.titel}`);
      return;
    }

    // Done (task)
    if (action === 'dn') {
      const all = db.select().from(aufgabenTable).where(eq(aufgabenTable.unternehmenId, unternehmenId)).all();
      const task = (all as any[]).find(t => t.id.startsWith(payload));
      if (!task) { await answerCbq(token, callbackQueryId, '❌ Task nicht gefunden'); return; }
      db.update(aufgabenTable).set({ status: 'done', aktualisiertAm: new Date().toISOString() })
        .where(eq(aufgabenTable.id, task.id)).run();
      await answerCbq(token, callbackQueryId, '✅ Erledigt!');
      await editMsg(token, chatId, messageId, `✅ *Erledigt:* ${task.titel}`);
      return;
    }

    // Wake agent
    if (action === 'wk') {
      const agent = db.select().from(experten)
        .where(and(eq(experten.unternehmenId, unternehmenId))).all()
        .find((a: any) => a.id.startsWith(payload));
      if (!agent) { await answerCbq(token, callbackQueryId, '❌ Agent nicht gefunden'); return; }
      scheduler.triggerZyklus((agent as any).id, unternehmenId, 'telegram').catch(console.error);
      await answerCbq(token, callbackQueryId, `⚡ ${(agent as any).name} aufgeweckt!`);
      await editMsg(token, chatId, messageId, `⚡ *${(agent as any).name}* wurde aufgeweckt und bearbeitet seine Inbox.`);
      return;
    }

    await answerCbq(token, callbackQueryId);
  },

  // ── Inbound message router ─────────────────────────────────────────────────

  async handleInboundMessage(unternehmenId: string, message: any, token: string) {
    if (!message?.text) return;
    const chatId = String(message.chat.id);
    const text   = message.text;

    // Fast-path commands
    const isCmd = await this.handleCommand(unternehmenId, chatId, token, text);
    if (isCmd) return;

    // Auto-pair chat ID
    const existing = db.select().from(einstellungen)
      .where(and(eq(einstellungen.schluessel, 'telegram_chat_id'), eq(einstellungen.unternehmenId, unternehmenId)))
      .get();

    if (!existing) {
      try {
        db.insert(einstellungen).values({
          unternehmenId, schluessel: 'telegram_chat_id',
          wert: chatId, aktualisiertAm: new Date().toISOString(),
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

      const agents = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();

      // @AgentName routing
      let targetAgent: any = null;
      let messageText = text;
      const atMatch = text.match(/^@(\S+)\s*([\s\S]*)/);
      if (atMatch) {
        const name = atMatch[1].toLowerCase();
        targetAgent = (agents as any[]).find((a: any) => {
          const normalized = a.name.toLowerCase().replace(/\s+/g, '');
          const words = a.name.toLowerCase().split(/\s+/);
          return (
            normalized === name ||                    // exact: @DevAgent
            normalized.startsWith(name) ||            // prefix no-space: @Dev → DevAgent
            words.some((w: string) => w === name) || // exact word: @Dev → "Dev Agent"
            words.some((w: string) => w.startsWith(name)) || // word prefix: @De → "Dev Agent"
            a.rolle.toLowerCase().replace(/\s+/g, '').startsWith(name) // role: @ceo
          );
        });
        if (targetAgent) messageText = atMatch[2].trim() || text;
      }

      const ceo = (agents as any[]).find((a: any) =>
        a.isOrchestrator === true || a.isOrchestrator === 1 ||
        a.verbindungsTyp === 'ceo' ||
        /ceo|manager|geschäftsführer/i.test(a.rolle)
      ) || agents[0];

      const respondingAgent = targetAgent || ceo;

      if (respondingAgent) {
        db.insert(chatNachrichten).values({
          id: uuid(), unternehmenId, expertId: respondingAgent.id,
          absenderTyp: 'board', nachricht: `[Telegram] ${text}`,
          gelesen: true, erstelltAm: new Date().toISOString(),
        }).run();
      }

      // Keep typing indicator alive every 4s (Telegram clears it after 5s)
      const typingInterval = setInterval(() => {
        tgPost(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      }, 4000);

      let reply: string;
      try {
        reply = await this.chatWithLLM(unternehmenId, chatId, messageText, targetAgent);
      } finally {
        clearInterval(typingInterval);
      }

      if (respondingAgent) {
        const replyMsg = {
          id: uuid(), unternehmenId, expertId: respondingAgent.id,
          absenderTyp: 'agent' as const, absenderName: respondingAgent.name || 'Agent',
          nachricht: reply, gelesen: false, erstelltAm: new Date().toISOString(),
        };
        db.insert(chatNachrichten).values(replyMsg).run();
        appEvents.emit('broadcast', { type: 'chat_message', data: replyMsg });
      }

      await sendMsg(token, chatId, reply);
    } catch (err) {
      console.error('[Telegram] Inbound chat error:', err);
      await sendMsg(token, chatId, '⚠️ Fehler bei der Verarbeitung. Versuch es nochmal.');
    }
  },

  // ── LLM chat ──────────────────────────────────────────────────────────────

  async chatWithLLM(unternehmenId: string, chatId: string, userMessage: string, targetAgent: any = null): Promise<string> {
    const company = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();
    const agents  = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
    const allTasks = db.select().from(aufgabenTable)
      .where(eq(aufgabenTable.unternehmenId, unternehmenId))
      .orderBy(desc(aufgabenTable.erstelltAm)).limit(20).all()
      .filter((t: any) => t.status !== 'done' && t.status !== 'cancelled');
    const pendingApprovals = db.select().from(genehmigungenTable)
      .where(and(eq(genehmigungenTable.unternehmenId, unternehmenId), eq(genehmigungenTable.status, 'pending'))).all();

    const agentList = (agents as any[]).map(a => `  • ${a.name} [${a.id.slice(0,8)}] (${a.rolle}, ${a.status})`).join('\n') || '  —';
    const taskList  = allTasks.slice(0, 8).map((t: any) => {
      const assignee = (agents as any[]).find((a: any) => a.id === t.zugewiesenAn)?.name || '—';
      return `  • [${t.id.slice(0,6)}] "${t.titel}" → ${assignee} (${t.status})`;
    }).join('\n') || '  —';

    // Determine the actual responding agent (targetAgent or CEO/Orchestrator)
    const respondingAgent: any = targetAgent
      || (agents as any[]).find((a: any) =>
          a.isOrchestrator === true || a.isOrchestrator === 1 ||
          /ceo|manager|geschäftsführer/i.test(a.rolle)
        )
      || null;

    if (!respondingAgent) {
      const l = getUiLanguage(unternehmenId);
      return l === 'en'
        ? '⚠️ No CEO / Orchestrator configured. Please mark an agent as "Company Orchestrator" and connect it to an LLM.'
        : '⚠️ Kein CEO / Orchestrator konfiguriert. Bitte einen Agenten als "Company Orchestrator" einstellen und mit einem LLM verbinden.';
    }

    const myTasks = targetAgent ? allTasks.filter((t: any) => t.zugewiesenAn === targetAgent.id) : [];

    const uiLang = getUiLanguage(unternehmenId);
    const isEn = uiLang === 'en';

    let systemPrompt: string;
    if (targetAgent) {
      systemPrompt = `You are ${targetAgent.name}, an AI agent at "${(company as any)?.name || 'OpenCognit'}".
Role: ${targetAgent.rolle || 'Specialist'}. Status: ${targetAgent.status || 'active'}.
${targetAgent.beschreibung ? (isEn ? `About you: ${targetAgent.beschreibung}` : `Über dich: ${targetAgent.beschreibung}`) : ''}
${langLine(uiLang)} Communicate directly and authentically in first person.

${isEn ? `MY TASKS (${myTasks.length}):` : `MEINE TASKS (${myTasks.length}):`}
${myTasks.map((t: any) => `  • [${t.id.slice(0,6)}] "${t.titel}" (${t.status})`).join('\n') || (isEn ? '  None' : '  Keine')}

${isEn ? 'TEAM:' : 'TEAM:'}
${agentList}

${isEn ? 'ACTIONS (optional):' : 'AKTIONEN (optional):'}
[ACTION]{"type": "create_task", "titel": "...", "agentId": "8-char-optional"}[/ACTION]
[ACTION]{"type": "message_agent", "agentId": "8-char", "message": "..."}[/ACTION]`;
    } else {
      const ceoName = respondingAgent?.name || 'CEO';
      const ceoRolle = respondingAgent?.rolle || 'Geschäftsführer';
      const configCtx = buildConfigContext(unternehmenId);
      const lang = getUiLanguage(unternehmenId);

      // Determine autonomy mode for prompt context
      let ceoCfg: any = {};
      try { ceoCfg = JSON.parse(respondingAgent?.verbindungsConfig || '{}'); } catch {}
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

${isEn ? `TEAM (${agents.length} agents):` : `TEAM (${agents.length} Agenten):`}
${agentList}

${isEn ? `OPEN TASKS (${allTasks.length}):` : `OFFENE TASKS (${allTasks.length}):`}
${taskList}

${isEn ? `PENDING APPROVALS: ${pendingApprovals.length}` : `GENEHMIGUNGEN AUSSTEHEND: ${pendingApprovals.length}`}
${(pendingApprovals as any[]).slice(0,3).map((a: any) => `  • [${a.id.slice(0,6)}] ${a.titel}`).join('\n')}

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

${isEn ? `IMPORTANT:
- Answer greetings and small talk without executing actions.
- Only execute actions when the user explicitly requests them.
- If a required API key is missing, inform the user clearly.
- Actions must NEVER appear in visible text — only as hidden blocks.
- Your visible response is always plain text, never JSON.` : `WICHTIG:
- Beantworte Grüße und Smalltalk freundlich ohne Aktionen auszuführen.
- Aktionen NUR wenn der User explizit darum bittet.
- Wenn ein API-Key fehlt aber benötigt wird, informiere den User klar darüber.
- Aktionen dürfen NIEMALS im sichtbaren Text erscheinen — nur als versteckter Block.
- Deine sichtbare Antwort ist immer reiner Text, kein JSON.`}

${isEn ? 'ACTIONS (only when explicitly requested, at the end of response):' : 'AKTIONEN (nur wenn explizit gewünscht, am Ende der Antwort):'}
[ACTION]{"type": "create_task", "titel": "...", "beschreibung": "...", "agentId": "8-char-optional", "prioritaet": "high"}[/ACTION]
[ACTION]{"type": "assign_task", "taskId": "6-char", "agentId": "8-char"}[/ACTION]
[ACTION]{"type": "approve", "id": "6-char"}[/ACTION]
[ACTION]{"type": "reject", "id": "6-char"}[/ACTION]
[ACTION]{"type": "create_agent", "name": "Name", "rolle": "Role", "faehigkeiten": "Skills", "verbindungsTyp": "claude-code"}[/ACTION]
[ACTION]{"type": "configure_agent", "agentId": "8-char", "verbindungsTyp": "openrouter", "model": "anthropic/claude-opus-4"}[/ACTION]
[ACTION]{"type": "save_setting", "key": "openrouter_api_key", "value": "sk-or-..."}[/ACTION]
[ACTION]{"type": "set_company_workdir", "path": "/path/to/project"}[/ACTION]`;
    }

    const historyKey = respondingAgent ? `${chatId}:${respondingAgent.id}` : chatId;
    const history = conversationHistory.get(historyKey) || [];
    conversationLastAccess.set(historyKey, Date.now()); // update LRU on read
    history.push({ role: 'user', content: userMessage });
    if (history.length > 20) history.splice(0, history.length - 20);

    const allSettings = db.select().from(einstellungen).all();
    const getSetting = (key: string) =>
      (allSettings as any[]).find(s => s.schluessel === key && s.unternehmenId === unternehmenId) ||
      (allSettings as any[]).find(s => s.schluessel === key && (!s.unternehmenId || s.unternehmenId === ''));

    // Route through the responding agent's configured LLM connection
    const llmResponse = await this.callAgentLLM(
      respondingAgent, systemPrompt, history, userMessage, getSetting
    );

    if (!llmResponse) return '⚠️ Kein LLM konfiguriert. Bitte API-Key oder Claude Code CLI in den Einstellungen hinterlegen.';

    const finalResponse = await this.executeActions(llmResponse, unternehmenId, agents, allTasks, pendingApprovals, respondingAgent);
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
    const verbindungsTyp: string = agent?.verbindungsTyp || '';
    const verbindungsConfig: any = (() => {
      try { return agent?.verbindungsConfig ? JSON.parse(agent.verbindungsConfig) : {}; } catch { return {}; }
    })();

    // ── CLI adapters (no API key needed) ─────────────────────────────────────
    if (verbindungsTyp === 'claude-code') {
      const historyText = history.slice(0, -1)
        .map(m => `[${m.role === 'user' ? 'USER' : 'ASSISTANT'}]: ${m.content}`).join('\n');
      const cliPrompt = `${systemPrompt}\n\n${historyText ? `[VERLAUF]\n${historyText}\n\n` : ''}[USER]\n${userMessage}`;
      try { return await runClaudeDirectChat(cliPrompt, agent.id); } catch { return null; }
    }

    // ── API-key adapters ──────────────────────────────────────────────────────
    const messages = [{ role: 'system' as const, content: systemPrompt }, ...history];

    if (verbindungsTyp === 'openrouter') {
      const entry = getSetting('openrouter_api_key');
      if (!entry?.wert) return null;
      const key = decryptSetting('openrouter_api_key', entry.wert);
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
      if (!entry?.wert) return null;
      const key = decryptSetting('anthropic_api_key', entry.wert);
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
      if (!entry?.wert) return null;
      const key = decryptSetting('openai_api_key', entry.wert);
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
      const baseUrl = entry?.wert || 'http://localhost:11434';
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
      if (!urlEntry?.wert) return null;
      const baseUrl = urlEntry.wert.replace(/\/$/, '');
      const key = keyEntry?.wert ? decryptSetting('custom_api_key', keyEntry.wert) : '';
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

    if (orEntry?.wert) {
      try {
        const apiKey = decryptSetting('openrouter_api_key', orEntry.wert);
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'X-Title': 'OpenCognit' },
          body: JSON.stringify({ model: 'openrouter/auto', messages: [{ role: 'system', content: systemPrompt }, ...history], max_tokens: 600, temperature: 0.7 }),
        });
        if (res.ok) return ((await res.json() as any).choices?.[0]?.message?.content?.trim()) || null;
      } catch {}
    }

    if (anEntry?.wert) {
      try {
        const apiKey = decryptSetting('anthropic_api_key', anEntry.wert);
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: systemPrompt, messages: history }),
        });
        if (res.ok) return ((await res.json() as any).content?.[0]?.text?.trim()) || null;
      } catch {}
    }

    if (oaEntry?.wert) {
      try {
        const apiKey = decryptSetting('openai_api_key', oaEntry.wert);
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

  async executeActions(llmText: string, unternehmenId: string, agents: any[], tasks: any[], approvals: any[], ceoAgent?: any): Promise<string> {
    const matches = [...llmText.matchAll(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/g)];
    // Always sanitize — even if no valid actions found (catches malformed output)
    let responseText = this.sanitizeResponse(llmText.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, ''));
    const results: string[] = [];

    // ── Load CEO permissions ─────────────────────────────────────────────────
    let perms: any = null;
    let autonomyLevel = 'autonomous';
    if (ceoAgent) {
      try {
        const cfg = JSON.parse(ceoAgent.verbindungsConfig || '{}');
        autonomyLevel = cfg.autonomyLevel || 'autonomous';
      } catch {}
      try {
        perms = db.select().from(agentPermissions).where(eq(agentPermissions.expertId, ceoAgent.id)).get();
      } catch {}
    }

    const isCopilot = autonomyLevel === 'copilot';
    // Default: allow if no permission row exists (no row = defaults apply from schema)
    const canCreateTask      = perms ? perms.darfAufgabenErstellen !== false : true;
    const canAssignTask      = perms ? perms.darfAufgabenZuweisen !== false : true;
    const canDecideApproval  = perms ? perms.darfGenehmigungEntscheiden !== false : true;
    const canRecruitAgent    = perms ? perms.darfExpertenAnwerben !== false : true;

    // Helper: create a genehmigungen entry and emit notification
    const requestApproval = (typ: 'hire_expert' | 'approve_strategy' | 'budget_change' | 'agent_action', titel: string, beschreibung: string, payload: any): string => {
      const approvalId = uuid();
      db.insert(genehmigungenTable).values({
        id: approvalId, unternehmenId,
        typ, titel, beschreibung,
        angefordertVon: ceoAgent?.id || null,
        status: 'pending',
        payload: JSON.stringify(payload),
        erstelltAm: new Date().toISOString(),
        aktualisiertAm: new Date().toISOString(),
      }).run();
      appEvents.emit('broadcast', { type: 'approval_needed', unternehmenId, taskTitel: titel });
      return approvalId;
    };

    for (const match of matches) {
      try {
        const action = JSON.parse(match[1]);

        if (action.type === 'create_task') {
          if (isCopilot || !canCreateTask) {
            requestApproval('agent_action', `Task erstellen: "${action.titel}"`, action.beschreibung || '', action);
            results.push(`⏳ Genehmigung angefordert: Task *"${action.titel}"* wartet auf deine Freigabe.`);
          } else {
            const agent = action.agentId ? (agents as any[]).find((a: any) => a.id.startsWith(action.agentId)) : null;
            db.insert(aufgabenTable).values({
              id: uuid(), unternehmenId, titel: action.titel,
              beschreibung: action.beschreibung || '', status: agent ? 'todo' : 'backlog',
              prioritaet: (['critical','high','medium','low'].includes(action.prioritaet) ? action.prioritaet : 'medium'),
              zugewiesenAn: agent?.id || null,
              erstelltAm: new Date().toISOString(), aktualisiertAm: new Date().toISOString(),
            }).run();
            results.push(`✅ Task erstellt: *"${action.titel}"*${agent ? ` → ${agent.name}` : ''}`);
          }

        } else if (action.type === 'message_agent') {
          // Messaging never needs approval — it's just communication
          const agent = (agents as any[]).find((a: any) => a.id.startsWith(action.agentId));
          if (agent) {
            db.insert(chatNachrichten).values({
              id: uuid(), unternehmenId, expertId: agent.id,
              absenderTyp: 'board', nachricht: `[Telegram]: ${action.message}`,
              gelesen: false, erstelltAm: new Date().toISOString(),
            }).run();
            scheduler.triggerZyklus(agent.id, unternehmenId, 'telegram').catch(console.error);
            results.push(`💬 Nachricht an *${agent.name}* gesendet`);
          }

        } else if (action.type === 'assign_task') {
          if (isCopilot || !canAssignTask) {
            const task  = (tasks as any[]).find((t: any) => t.id.startsWith(action.taskId));
            const agent = (agents as any[]).find((a: any) => a.id.startsWith(action.agentId));
            requestApproval('agent_action',
              `Task zuweisen: "${task?.titel || action.taskId}" → ${agent?.name || action.agentId}`,
              '', action);
            results.push(`⏳ Genehmigung angefordert: Zuweisung wartet auf deine Freigabe.`);
          } else {
            const task  = (tasks as any[]).find((t: any) => t.id.startsWith(action.taskId));
            const agent = (agents as any[]).find((a: any) => a.id.startsWith(action.agentId));
            if (task && agent) {
              db.update(aufgabenTable).set({ zugewiesenAn: agent.id, status: 'todo', aktualisiertAm: new Date().toISOString() })
                .where(eq(aufgabenTable.id, task.id)).run();
              results.push(`📋 *"${task.titel}"* → ${agent.name}`);
            }
          }

        } else if (action.type === 'approve' || action.type === 'reject') {
          if (!canDecideApproval) {
            results.push(`⛔ ${ceoAgent?.name || 'CEO'} hat keine Berechtigung, Genehmigungen zu entscheiden.`);
          } else {
            const approval = (approvals as any[]).find((a: any) => a.id.startsWith(action.id));
            if (approval) {
              const s = action.type === 'approve' ? 'approved' : 'rejected';
              db.update(genehmigungenTable).set({ status: s, aktualisiertAm: new Date().toISOString() })
                .where(eq(genehmigungenTable.id, approval.id)).run();
              results.push(`${action.type === 'approve' ? '✅ Genehmigt' : '❌ Abgelehnt'}: *${approval.titel}*`);
            }
          }

        } else if (action.type === 'create_agent') {
          if (isCopilot || !canRecruitAgent) {
            requestApproval('hire_expert',
              `Agent anwerben: "${action.name}" (${action.rolle || '—'})`,
              `Typ: ${action.verbindungsTyp || 'claude-code'} · Fähigkeiten: ${action.faehigkeiten || '—'}`,
              action);
            results.push(`⏳ Genehmigung angefordert: Agent *"${action.name}"* wartet auf deine Freigabe.`);
          } else {
            const msg = executeConfigAction(action, unternehmenId);
            if (msg) results.push(msg);
          }

        } else if (action.type === 'configure_agent' || action.type === 'save_setting' || action.type === 'set_company_workdir') {
          if (isCopilot) {
            const label = action.type === 'configure_agent'
              ? `Agent konfigurieren (${action.agentId})`
              : action.type === 'save_setting'
              ? `Setting speichern: ${action.key}`
              : `Arbeitsverzeichnis: ${action.path}`;
            requestApproval('agent_action', label, '', action);
            results.push(`⏳ Genehmigung angefordert: _${label}_ wartet auf deine Freigabe.`);
          } else {
            const msg = executeConfigAction(action, unternehmenId);
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
        const allSettings = db.select().from(einstellungen)
          .where(eq(einstellungen.schluessel, 'telegram_bot_token')).all();

        for (const s of allSettings as any[]) {
          if (!isPolling) break;
          if (!s.wert || s.wert.startsWith('enc:error')) continue;

          const token = decryptSetting('telegram_bot_token', s.wert);
          let uId = s.unternehmenId;
          if (!uId) {
            const first = db.select({ id: unternehmen.id }).from(unternehmen).orderBy(asc(unternehmen.erstelltAm)).limit(1).get();
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

          const offset = offsets.get(uId) || 0;
          try {
            const resp = await fetch(
              `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5`,
              { signal: pollController.signal }
            );
            if (!resp.ok) continue;

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

  stopPolling() {
    isPolling = false;
    if (pollController) { pollController.abort(); pollController = null; }
    if (pollTimeout)    { clearTimeout(pollTimeout); pollTimeout = null; }
    console.log('📡 Telegram Gateway gestoppt.');
  },

  // ── Push notifications ─────────────────────────────────────────────────────

  async notify(unternehmenId: string, title: string, details?: string, type: string = 'info', keyboard?: InlineKeyboard) {
    const icon = type === 'error' ? '🔴' : type === 'warning' ? '🟠' : type === 'success' ? '✅' : '🔵';
    const text = `*${icon} ${title}*${details ? `\n\n${details}` : ''}`.trim();
    await this.sendTelegram(unternehmenId, text, keyboard);
  },
};

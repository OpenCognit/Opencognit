// Background Review Service — Learning Loop-Vorbild
// Async Selbst-Review nach jeder Agent-Antwort:
// 1. Skill Review: Soll ein wiederverwendbarer Skill erstellt werden?
// 2. Memory Review: Soll User-Kontext in Memory gespeichert werden?
// 3. Iterative Context-Kompression: Zusammenfassungen aktualisieren statt verwerfen
// 4. FTS5 Session Search: Volltextsuche über alle vergangenen Nachrichten
//
// Blockiert NICHT die Agent-Antwort — läuft async im Hintergrund.

import { db } from '../db/client.js';
import { chatMessages, agents, palaceSummaries, palaceDrawers, palaceWings } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { nachZyklusVerarbeitung } from './learning-loop.js';

// ─── Review Prompts ─────────────────────────────

const MEMORY_REVIEW_PROMPT = `Überprüfe die Konversation oben und entscheide ob etwas im Langzeitgedächtnis gespeichert werden sollte.

Fokus:
1. Hat der Nutzer Dinge über sich preisgegeben — Persona, Wünsche, Präferenzen, persönliche Details?
2. Hat der Nutzer Erwartungen geäußert wie der Agent arbeiten soll, welchen Arbeitsstil er bevorzugt?

Wenn etwas wichtig ist, speichere es mit einem memory_add_drawer Aufruf im Room "user_context".
Wenn nichts wichtig ist, antworte mit: "Nichts zu speichern."`;

const SKILL_REVIEW_PROMPT = `Überprüfe die Konversation oben und entscheide ob ein wiederverwendbarer Skill erstellt oder aktualisiert werden sollte.

Fokus: Wurde ein nicht-trivialer Ansatz verwendet der Trial-and-Error erforderte, oder wurde der Kurs geändert aufgrund von Erfahrungswerten, oder hat der Nutzer eine andere Methode oder ein anderes Ergebnis erwartet?

Wenn ein relevanter Skill bereits existiert, aktualisiere ihn mit dem Gelernten.
Ansonsten erstelle einen neuen Skill wenn der Ansatz wiederverwendbar ist.
Wenn nichts wichtig ist, antworte mit: "Nichts zu speichern."

Formatiere neue Skills als:
[SKILL:Name]
Markdown-Inhalt mit dem gelernten Pattern...
[/SKILL:Name]`;

const COMBINED_REVIEW_PROMPT = `Überprüfe die Konversation und entscheide zwei Dinge:

**Gedächtnis**: Hat der Nutzer Dinge über sich preisgegeben — Persona, Wünsche, Präferenzen? Hat er Erwartungen geäußert wie du arbeiten sollst? Wenn ja, speichere es im Room "user_context".

**Skills**: Wurde ein nicht-trivialer Ansatz verwendet der Trial-and-Error erforderte, oder ein Kurs geändert aufgrund von Erfahrung? Wenn ein Skill existiert, aktualisiere ihn. Ansonsten erstelle einen neuen. Format: [SKILL:Name]...[/SKILL:Name]

Nur handeln wenn wirklich etwas Wertvolles vorliegt.
Wenn nichts auffällt, antworte mit: "Nichts zu speichern."`;

// ─── Structured Summary Template ─────────

const INITIAL_SUMMARY_PROMPT = `Erstelle eine strukturierte Übergabe-Zusammenfassung für einen späteren Assistenten der die Konversation fortsetzen wird.

ZU ZUSAMMENFASSENDE TURNS:
{content}

Verwende exakt diese Struktur:

## Ziel
[Was der Nutzer erreichen möchte]

## Einschränkungen & Präferenzen
[Nutzer-Präferenzen, Coding-Stil, Einschränkungen, wichtige Entscheidungen]

## Fortschritt
### Erledigt
[Abgeschlossene Arbeit — mit Dateipfaden, ausgeführten Befehlen, Ergebnissen]
### In Arbeit
[Aktuell laufende Arbeit]
### Blockiert
[Blocker oder aufgetretene Probleme]

## Schlüsselentscheidungen
[Wichtige technische Entscheidungen und warum sie getroffen wurden]

## Relevante Dateien
[Gelesene, geänderte oder erstellte Dateien — mit kurzer Notiz]

## Nächste Schritte
[Was als nächstes passieren muss]

## Kritischer Kontext
[Spezifische Werte, Fehlermeldungen, Konfigurationsdetails die ohne Speicherung verloren gehen]

Sei spezifisch — Dateipfade, Befehle, Fehlermeldungen statt vager Beschreibungen.`;

const ITERATIVE_SUMMARY_PROMPT = `Du aktualisierst eine Context-Komprimierungs-Zusammenfassung. Eine vorherige Komprimierung hat die folgende Zusammenfassung erstellt. Neue Konversations-Turns sind seitdem aufgetreten.

VORHERIGE ZUSAMMENFASSUNG:
{previous}

NEUE TURNS:
{content}

Aktualisiere die Zusammenfassung mit dieser Struktur. ERHALTE alle existierenden Informationen die noch relevant sind. FÜGE neuen Fortschritt HINZU. Verschiebe Items von "In Arbeit" nach "Erledigt" wenn abgeschlossen. Entferne nur klar veraltete Informationen.

## Ziel
[Was der Nutzer erreichen möchte — erhalten, aktualisieren wenn sich das Ziel entwickelt hat]

## Einschränkungen & Präferenzen
[Über Komprimierungen hinweg akkumulieren]

## Fortschritt
### Erledigt
[Abgeschlossene Arbeit]
### In Arbeit
[Aktuell laufend]
### Blockiert
[Blocker]

## Schlüsselentscheidungen
[Technische Entscheidungen und warum]

## Relevante Dateien
[Über Komprimierungen hinweg akkumulieren]

## Nächste Schritte
[Was als nächstes passieren muss]

## Kritischer Kontext
[Spezifische Werte die erhalten werden müssen]

Sei spezifisch — Dateipfade, Befehle, Fehlermeldungen statt vager Beschreibungen.`;

// ─── Konfiguration ──────────────────────────────────────────────────────────

const REVIEW_INTERVAL = 10; // Alle 10 Zyklen einen Review triggern
const COMPRESSION_THRESHOLD_CHARS = 20000; // Ab 20k Zeichen komprimieren

// ─── Background Review (async, non-blocking) ────────────────────────────────

export interface ReviewTrigger {
  agentId: string;
  companyId: string;
  agentOutput: string;
  zyklusNummer: number;
  reviewMemory: boolean;
  reviewSkills: boolean;
}

/**
 * Spawnt einen async Background-Review nach Learning Loop-Vorbild.
 * Blockiert NICHT die Hauptantwort.
 */
export function spawnBackgroundReview(trigger: ReviewTrigger): void {
  // Fire-and-forget — async, non-blocking
  setImmediate(() => {
    runReview(trigger).catch(err => {
      console.warn(`⚠️ Background Review fehlgeschlagen: ${err.message}`);
    });
  });
}

async function runReview(trigger: ReviewTrigger): Promise<void> {
  const { agentId, companyId, agentOutput, reviewMemory, reviewSkills } = trigger;

  const expert = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!expert) return;

  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_');

  // Wähle den richtigen Review-Prompt
  let prompt: string;
  if (reviewMemory && reviewSkills) {
    prompt = COMBINED_REVIEW_PROMPT;
  } else if (reviewMemory) {
    prompt = MEMORY_REVIEW_PROMPT;
  } else {
    prompt = SKILL_REVIEW_PROMPT;
  }

  // Lade letzte 15 Nachrichten als Kontext
  const recentMessages = db.select().from(chatMessages)
    .where(eq(chatMessages.agentId, agentId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(15)
    .all()
    .reverse();

  const conversationContext = recentMessages
    .map(m => `${m.senderType === 'agent' ? 'AGENT' : 'BOARD/SYSTEM'}: ${m.message}`)
    .join('\n\n');

  // --- Memory Review: User-Kontext extrahieren und speichern ---
  if (reviewMemory) {
    // Einfache Heuristik: Suche nach persönlichen Aussagen im Output
    const userContextPatterns = [
      /ich (bin|arbeite|bevorzuge|möchte|will|brauche|nutze)/gi,
      /mein (team|projekt|ziel|stack|workflow)/gi,
      /wir (nutzen|verwenden|arbeiten|haben)/gi,
      /bitte (immer|nie|nicht|achte)/gi,
    ];

    const matches: string[] = [];
    for (const msg of recentMessages) {
      if (msg.senderType === 'board') {
        for (const pattern of userContextPatterns) {
          const m = msg.message.match(pattern);
          if (m) matches.push(msg.message.slice(0, 200));
          pattern.lastIndex = 0; // Reset regex
        }
      }
    }

    if (matches.length > 0) {
      const wing = db.select().from(palaceWings)
        .where(and(eq(palaceWings.agentId, agentId), eq(palaceWings.companyId, companyId)))
        .get();
      if (wing) {
        db.insert(palaceDrawers).values({
          id: uuid(),
          wingId: wing.id,
          room: 'user_context',
          content: `### Auto-Review (Background)\n\nNutzer-Kontext erkannt:\n${matches.map(m => `- ${m}`).join('\n')}`,
          createdAt: new Date().toISOString(),
        }).run();
        console.log(`💾 Background Review: ${matches.length} User-Kontext-Einträge für ${expert.name} gespeichert`);
      }
    }
  }

  // --- Skill Review: wiederverwendbare Patterns extrahieren ---
  if (reviewSkills) {
    // Learning Loop-Style: Nutze den nachZyklusVerarbeitung Hook
    const taskTitel = recentMessages.find(m => m.senderType === 'board')?.message?.slice(0, 50) || 'Background Review';
    nachZyklusVerarbeitung(agentId, companyId, taskTitel, agentOutput, true);
  }

  console.log(`🔍 Background Review für ${expert.name} abgeschlossen (Memory: ${reviewMemory}, Skills: ${reviewSkills})`);
}

// ─── Iterative Context-Kompression ──────────────────────────────────────────

/**
 * Komprimiert den Kontext eines Agenten iterativ.
 * Erstellt beim ersten Mal eine neue Zusammenfassung.
 * Bei Folge-Aufrufen aktualisiert die vorherige Zusammenfassung.
 *
 * Gibt den Summary-Text zurück der in den System-Prompt injiziert werden kann.
 */
export function komprimiereKontext(
  agentId: string,
  companyId: string,
  neueTurns: string,
): string | null {
  const now = new Date().toISOString();

  // Vorherige Zusammenfassung laden
  const existing = db.select().from(palaceSummaries)
    .where(eq(palaceSummaries.agentId, agentId))
    .get();

  let summaryText: string;

  if (existing) {
    // Iteratives Update: Vorherige Summary + neue Turns → aktualisierte Summary
    summaryText = ITERATIVE_SUMMARY_PROMPT
      .replace('{previous}', existing.content)
      .replace('{content}', neueTurns);

    // Update statt Insert
    db.update(palaceSummaries).set({
      content: summaryText.slice(0, 10000), // Max 10k Zeichen
      version: existing.version + 1,
      komprimierteTurns: existing.komprimierteTurns + neueTurns.split('\n\n').length,
      updatedAt: now,
    }).where(eq(palaceSummaries.id, existing.id)).run();

    console.log(`📋 Context-Kompression: Summary v${existing.version + 1} für ${agentId} (iterativ aktualisiert)`);
  } else {
    // Erste Zusammenfassung
    summaryText = INITIAL_SUMMARY_PROMPT.replace('{content}', neueTurns);

    db.insert(palaceSummaries).values({
      id: uuid(),
      agentId,
      companyId,
      content: summaryText.slice(0, 10000),
      version: 1,
      komprimierteTurns: neueTurns.split('\n\n').length,
      createdAt: now,
      updatedAt: now,
    }).run();

    console.log(`📋 Context-Kompression: Erste Summary für ${agentId} erstellt`);
  }

  return `[KONTEXT-ZUSAMMENFASSUNG] Frühere Turns wurden komprimiert um Kontext zu sparen. Die Zusammenfassung unten beschreibt bereits erledigte Arbeit:\n\n${summaryText.slice(0, 5000)}`;
}

/**
 * Lädt die aktuelle Zusammenfassung eines Agenten (falls vorhanden).
 * Wird beim Zyklusstart in den System-Prompt injiziert.
 */
export function ladeSummary(agentId: string): string | null {
  const summary = db.select().from(palaceSummaries)
    .where(eq(palaceSummaries.agentId, agentId))
    .get();

  if (!summary) return null;

  return `[KONTEXT-ZUSAMMENFASSUNG v${summary.version} — ${summary.komprimierteTurns} Turns komprimiert]
${summary.content}`;
}

// ─── FTS5 Session-Suche ─────────────────────────────────────────────────────

/**
 * Durchsucht alle vergangenen Chat-Nachrichten und Drawer-Inhalte via FTS5.
 * Gibt die relevantesten Treffer als formatierten Text zurück.
 */
export function sessionSearch(query: string, agentId?: string, limit: number = 10): string {
  const results: Array<{ source: string; text: string; date: string }> = [];

  // FTS5 Suche über Chat-Nachrichten
  try {
    const ftsQuery = query.split(/\s+/).map(w => `"${w}"`).join(' OR ');

    // Direkte SQL-Abfrage für FTS5 (Drizzle unterstützt keine Virtual Tables nativ)
    const chatResults = (db as any).all(
      `SELECT cn.message, cn.createdAt, cn.senderType
       FROM fts_nachrichten fts
       JOIN chatMessages cn ON cn.rowid = fts.rowid
       ${agentId ? 'WHERE cn.expert_id = ?' : ''}
       ORDER BY fts.rank
       LIMIT ?`,
      agentId ? [agentId, limit] : [limit]
    ) as Array<{ message: string; createdAt: string; senderType: string }>;

    // Fallback: Wenn FTS5 nicht verfügbar, nutze LIKE
    if (!chatResults || chatResults.length === 0) {
      const likeResults = db.select().from(chatMessages)
        .where(agentId ? eq(chatMessages.agentId, agentId) : undefined as any)
        .all()
        .filter(m => m.message.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);

      for (const m of likeResults) {
        results.push({ source: `Chat (${m.senderType})`, text: m.message.slice(0, 300), date: m.createdAt });
      }
    } else {
      for (const r of chatResults) {
        results.push({ source: `Chat (${r.senderType})`, text: r.message.slice(0, 300), date: r.createdAt });
      }
    }
  } catch {
    // FTS5 nicht verfügbar — Fallback auf einfache Suche
    const likeResults = db.select().from(chatMessages)
      .all()
      .filter(m => {
        if (agentId && m.agentId !== agentId) return false;
        return m.message.toLowerCase().includes(query.toLowerCase());
      })
      .slice(0, limit);

    for (const m of likeResults) {
      results.push({ source: `Chat (${m.senderType})`, text: m.message.slice(0, 300), date: m.createdAt });
    }
  }

  // FTS5 Suche über Palace Drawers
  try {
    const drawerResults = db.select().from(palaceDrawers)
      .all()
      .filter(d => d.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5);

    for (const d of drawerResults) {
      results.push({ source: `Drawer (${d.room})`, text: d.content.slice(0, 300), date: d.createdAt });
    }
  } catch { /* silent */ }

  if (results.length === 0) {
    return `Keine Treffer für "${query}" in vergangenen Sessions.`;
  }

  // Formatiert für System-Prompt Injection
  const formatted = results
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(r => `[${r.source} | ${r.date.slice(0, 10)}]\n${r.text}`)
    .join('\n\n---\n\n');

  return `## Session-Suche: "${query}" (${results.length} Treffer)\n\n${formatted}`;
}

// ─── Prüfe ob Review getriggert werden soll ─────────────────────────────────

/**
 * Bestimmt ob ein Background-Review nötig ist basierend auf dem Zyklusnummer.
 */
export function sollteReviewen(zyklusNummer: number): { memory: boolean; skills: boolean } {
  return {
    memory: zyklusNummer % REVIEW_INTERVAL === 0,
    skills: zyklusNummer % REVIEW_INTERVAL === 0,
  };
}

/**
 * Prüft ob der Kontext komprimiert werden sollte.
 */
export function sollteKomprimieren(kontextLaenge: number): boolean {
  return kontextLaenge > COMPRESSION_THRESHOLD_CHARS;
}

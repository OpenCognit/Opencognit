// Background Review Service — Learning Loop-Vorbild
// Async Selbst-Review nach jeder Agent-Antwort:
// 1. Skill Review: Soll ein wiederverwendbarer Skill erstellt werden?
// 2. Memory Review: Soll User-Kontext in Memory gespeichert werden?
// 3. Iterative Context-Kompression: Zusammenfassungen aktualisieren statt verwerfen
// 4. FTS5 Session Search: Volltextsuche über alle vergangenen Nachrichten
//
// Blockiert NICHT die Agent-Antwort — läuft async im Hintergrund.

import { db } from '../db/client.js';
import { chatNachrichten, experten, palaceSummaries, palaceDrawers, palaceWings } from '../db/schema.js';
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
  expertId: string;
  unternehmenId: string;
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
  const { expertId, unternehmenId, agentOutput, reviewMemory, reviewSkills } = trigger;

  const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
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
  const recentMessages = db.select().from(chatNachrichten)
    .where(eq(chatNachrichten.expertId, expertId))
    .orderBy(desc(chatNachrichten.erstelltAm))
    .limit(15)
    .all()
    .reverse();

  const conversationContext = recentMessages
    .map(m => `${m.absenderTyp === 'agent' ? 'AGENT' : 'BOARD/SYSTEM'}: ${m.nachricht}`)
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
      if (msg.absenderTyp === 'board') {
        for (const pattern of userContextPatterns) {
          const m = msg.nachricht.match(pattern);
          if (m) matches.push(msg.nachricht.slice(0, 200));
          pattern.lastIndex = 0; // Reset regex
        }
      }
    }

    if (matches.length > 0) {
      const wing = db.select().from(palaceWings)
        .where(and(eq(palaceWings.expertId, expertId), eq(palaceWings.unternehmenId, unternehmenId)))
        .get();
      if (wing) {
        db.insert(palaceDrawers).values({
          id: uuid(),
          wingId: wing.id,
          room: 'user_context',
          inhalt: `### Auto-Review (Background)\n\nNutzer-Kontext erkannt:\n${matches.map(m => `- ${m}`).join('\n')}`,
          erstelltAm: new Date().toISOString(),
        }).run();
        console.log(`💾 Background Review: ${matches.length} User-Kontext-Einträge für ${expert.name} gespeichert`);
      }
    }
  }

  // --- Skill Review: wiederverwendbare Patterns extrahieren ---
  if (reviewSkills) {
    // Learning Loop-Style: Nutze den nachZyklusVerarbeitung Hook
    const taskTitel = recentMessages.find(m => m.absenderTyp === 'board')?.nachricht?.slice(0, 50) || 'Background Review';
    nachZyklusVerarbeitung(expertId, unternehmenId, taskTitel, agentOutput, true);
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
  expertId: string,
  unternehmenId: string,
  neueTurns: string,
): string | null {
  const now = new Date().toISOString();

  // Vorherige Zusammenfassung laden
  const existing = db.select().from(palaceSummaries)
    .where(eq(palaceSummaries.expertId, expertId))
    .get();

  let summaryText: string;

  if (existing) {
    // Iteratives Update: Vorherige Summary + neue Turns → aktualisierte Summary
    summaryText = ITERATIVE_SUMMARY_PROMPT
      .replace('{previous}', existing.inhalt)
      .replace('{content}', neueTurns);

    // Update statt Insert
    db.update(palaceSummaries).set({
      inhalt: summaryText.slice(0, 10000), // Max 10k Zeichen
      version: existing.version + 1,
      komprimierteTurns: existing.komprimierteTurns + neueTurns.split('\n\n').length,
      aktualisiertAm: now,
    }).where(eq(palaceSummaries.id, existing.id)).run();

    console.log(`📋 Context-Kompression: Summary v${existing.version + 1} für ${expertId} (iterativ aktualisiert)`);
  } else {
    // Erste Zusammenfassung
    summaryText = INITIAL_SUMMARY_PROMPT.replace('{content}', neueTurns);

    db.insert(palaceSummaries).values({
      id: uuid(),
      expertId,
      unternehmenId,
      inhalt: summaryText.slice(0, 10000),
      version: 1,
      komprimierteTurns: neueTurns.split('\n\n').length,
      erstelltAm: now,
      aktualisiertAm: now,
    }).run();

    console.log(`📋 Context-Kompression: Erste Summary für ${expertId} erstellt`);
  }

  return `[KONTEXT-ZUSAMMENFASSUNG] Frühere Turns wurden komprimiert um Kontext zu sparen. Die Zusammenfassung unten beschreibt bereits erledigte Arbeit:\n\n${summaryText.slice(0, 5000)}`;
}

/**
 * Lädt die aktuelle Zusammenfassung eines Agenten (falls vorhanden).
 * Wird beim Zyklusstart in den System-Prompt injiziert.
 */
export function ladeSummary(expertId: string): string | null {
  const summary = db.select().from(palaceSummaries)
    .where(eq(palaceSummaries.expertId, expertId))
    .get();

  if (!summary) return null;

  return `[KONTEXT-ZUSAMMENFASSUNG v${summary.version} — ${summary.komprimierteTurns} Turns komprimiert]
${summary.inhalt}`;
}

// ─── FTS5 Session-Suche ─────────────────────────────────────────────────────

/**
 * Durchsucht alle vergangenen Chat-Nachrichten und Drawer-Inhalte via FTS5.
 * Gibt die relevantesten Treffer als formatierten Text zurück.
 */
export function sessionSearch(query: string, expertId?: string, limit: number = 10): string {
  const results: Array<{ quelle: string; text: string; datum: string }> = [];

  // FTS5 Suche über Chat-Nachrichten
  try {
    const ftsQuery = query.split(/\s+/).map(w => `"${w}"`).join(' OR ');

    // Direkte SQL-Abfrage für FTS5 (Drizzle unterstützt keine Virtual Tables nativ)
    const chatResults = (db as any).all(
      `SELECT cn.nachricht, cn.erstellt_am, cn.absender_typ
       FROM fts_nachrichten fts
       JOIN chatNachrichten cn ON cn.rowid = fts.rowid
       ${expertId ? 'WHERE cn.expert_id = ?' : ''}
       ORDER BY fts.rank
       LIMIT ?`,
      expertId ? [expertId, limit] : [limit]
    ) as Array<{ nachricht: string; erstellt_am: string; absender_typ: string }>;

    // Fallback: Wenn FTS5 nicht verfügbar, nutze LIKE
    if (!chatResults || chatResults.length === 0) {
      const likeResults = db.select().from(chatNachrichten)
        .where(expertId ? eq(chatNachrichten.expertId, expertId) : undefined as any)
        .all()
        .filter(m => m.nachricht.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);

      for (const m of likeResults) {
        results.push({ quelle: `Chat (${m.absenderTyp})`, text: m.nachricht.slice(0, 300), datum: m.erstelltAm });
      }
    } else {
      for (const r of chatResults) {
        results.push({ quelle: `Chat (${r.absender_typ})`, text: r.nachricht.slice(0, 300), datum: r.erstellt_am });
      }
    }
  } catch {
    // FTS5 nicht verfügbar — Fallback auf einfache Suche
    const likeResults = db.select().from(chatNachrichten)
      .all()
      .filter(m => {
        if (expertId && m.expertId !== expertId) return false;
        return m.nachricht.toLowerCase().includes(query.toLowerCase());
      })
      .slice(0, limit);

    for (const m of likeResults) {
      results.push({ quelle: `Chat (${m.absenderTyp})`, text: m.nachricht.slice(0, 300), datum: m.erstelltAm });
    }
  }

  // FTS5 Suche über Palace Drawers
  try {
    const drawerResults = db.select().from(palaceDrawers)
      .all()
      .filter(d => d.inhalt.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5);

    for (const d of drawerResults) {
      results.push({ quelle: `Drawer (${d.room})`, text: d.inhalt.slice(0, 300), datum: d.erstelltAm });
    }
  } catch { /* silent */ }

  if (results.length === 0) {
    return `Keine Treffer für "${query}" in vergangenen Sessions.`;
  }

  // Formatiert für System-Prompt Injection
  const formatted = results
    .sort((a, b) => b.datum.localeCompare(a.datum))
    .map(r => `[${r.quelle} | ${r.datum.slice(0, 10)}]\n${r.text}`)
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

import type { AdapterRunOptions } from './types.js';

const TRIPLE_TICK = '```';

/**
 * Shared system prompt builder for all LLM adapters.
 */
export function buildAgentSystemPrompt(options: AdapterRunOptions): string {
  const aufgabenText = options.aufgaben.length > 0
    ? options.aufgaben.map((a, i) => `${i + 1}. ${a}`).join('\n')
    : 'Keine aktiven Aufgaben.';

  const nachrichten = options.chatNachrichten && options.chatNachrichten.length > 0
    ? `\nNACHRICHTEN:\n${options.chatNachrichten.join('\n')}`
    : '';

  let customBase = '';
  try {
    if (options.verbindungsConfig) {
      const cfg = JSON.parse(options.verbindungsConfig);
      if (cfg.systemPrompt) customBase = `\n${cfg.systemPrompt}\n`;
    }
  } catch {}

  const teamMitglieder = options.teamMitglieder && options.teamMitglieder.length > 0
    ? options.teamMitglieder.map((m: any) => `  - ${m.name} (${m.rolle}) → ID: ${m.id}`).join('\n')
    : options.teamKontext;

  const goalsSection = options.goals && options.goals.length > 0
    ? `\nSTRATEGISCHE ZIELE:\n${options.goals.map(g => {
        const bar = '█'.repeat(Math.round(g.fortschritt / 10)) + '░'.repeat(10 - Math.round(g.fortschritt / 10));
        const tasks = g.openTasks + g.doneTasks > 0 ? ` (${g.doneTasks}/${g.openTasks + g.doneTasks} Tasks)` : '';
        return `• ${g.titel} [${bar}] ${g.fortschritt}%${tasks}${g.beschreibung ? `\n  → ${g.beschreibung}` : ''}`;
      }).join('\n')}\n`
    : '';

  return `Du bist ${options.expertName}, ${options.rolle} bei ${options.unternehmenName}.${customBase}

FÄHIGKEITEN: ${options.faehigkeiten}

TEAM:
${teamMitglieder}
${goalsSection}
AKTIVE AUFGABEN:
${aufgabenText}
${nachrichten}

Antworte immer direkt und auf Deutsch. Für normale Antworten schreibe einfach Klartext.

═══════════════════════════════════════════════════════
TOOL-NUTZUNG (WICHTIG)
═══════════════════════════════════════════════════════

Du hast Zugriff auf folgende Tools:

1. BASH — Dateien erstellen, Code ausführen, Pakete installieren, etc.
   Schreibe einen ${TRIPLE_TICK}bash Block mit dem Befehl.
   Beispiel:
   ${TRIPLE_TICK}bash
   mkdir -p src && touch src/index.js
   ${TRIPLE_TICK}
   Das System führt diesen Befehl aus und schickt dir das Ergebnis zurück.
   Dann kannst du weitermachen oder weitere Befehle ausführen.

2. AUFGABE ABSCHLIESSEN — Wenn du fertig bist, schreibe:
   AUFGABE ABGESCHLOSSEN: [kurze Zusammenfassung was du getan hast]

WICHTIGE REGELN:
- Schreibe immer NUR EINEN ${TRIPLE_TICK}bash Block pro Antwort
- Warte auf das Ergebnis bevor du weitermachst
- Nutze relative Pfade (du befindest dich bereits im workspace)
- Wenn ein Befehl fehlschlägt, analysiere den Fehler und versuche es anders

FÜR MANAGERIALE AKTIONEN (JSON):
Aufgabe erstellen:
${TRIPLE_TICK}json
{"action": "create_task", "params": {"titel": "...", "beschreibung": "...", "zugewiesenAn": "<agent-id>"}}
${TRIPLE_TICK}

Nachricht an Teammitglied:
${TRIPLE_TICK}json
{"action": "chat", "params": {"nachricht": "...", "empfaenger": "<agent-id>"}}
${TRIPLE_TICK}

3. WISSEN SPEICHERN (Memory) — Wichtige Erkenntnisse direkt im Text:
   [REMEMBER:kg] Subjekt | Prädikat | Objekt          ← Wissensgraph-Triplet
   [REMEMBER:erkenntnisse] Wichtige Erkenntnis hier   ← Drawer-Eintrag
   Beispiele:
   [REMEMBER:kg] OpenCognit | verwendet | SQLite
   [REMEMBER:erkenntnisse] Das API-Rate-Limit beträgt 100 req/min
`;
}

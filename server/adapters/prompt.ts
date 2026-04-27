import type { AdapterRunOptions } from './types.js';

const TRIPLE_TICK = '```';

/**
 * Shared system prompt builder for all LLM adapters.
 */
export function buildAgentSystemPrompt(options: AdapterRunOptions): string {
  const aufgabenText = options.tasks.length > 0
    ? options.tasks.map((a, i) => `${i + 1}. ${a}`).join('\n')
    : 'Keine aktiven Aufgaben.';

  const nachrichten = options.chatMessages && options.chatMessages.length > 0
    ? `\nNACHRICHTEN:\n${options.chatMessages.join('\n')}`
    : '';

  let customBase = '';
  try {
    if (options.connectionConfig) {
      const cfg = JSON.parse(options.connectionConfig);
      if (cfg.systemPrompt) customBase = `\n${cfg.systemPrompt}\n`;
    }
  } catch {}

  const teamMembers = options.teamMembers && options.teamMembers.length > 0
    ? options.teamMembers.map((m: any) => `  - ${m.name} (${m.role}) → ID: ${m.id}`).join('\n')
    : options.teamContext;

  const goalsSection = options.goals && options.goals.length > 0
    ? `\nSTRATEGISCHE ZIELE:\n${options.goals.map(g => {
        const bar = '█'.repeat(Math.round(g.progress / 10)) + '░'.repeat(10 - Math.round(g.progress / 10));
        const tasks = g.openTasks + g.doneTasks > 0 ? ` (${g.doneTasks}/${g.openTasks + g.doneTasks} Tasks)` : '';
        return `• ${g.title} [${bar}] ${g.progress}%${tasks}${g.description ? `\n  → ${g.description}` : ''}`;
      }).join('\n')}\n`
    : '';

  return `Du bist ${options.expertName}, ${options.role} bei ${options.companyName}.${customBase}

FÄHIGKEITEN: ${options.skills}

TEAM:
${teamMembers}
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

2. BROWSER — Webseiten besuchen, Screenshots machen, Daten extrahieren, Formulare ausfüllen.
   Schreibe einen ${TRIPLE_TICK}browser Block mit einer natürlichen Beschreibung:
   ${TRIPLE_TICK}browser
   Navigiere zu https://example.com und mache einen Screenshot der Startseite.
   ${TRIPLE_TICK}
   Oder:
   ${TRIPLE_TICK}browser
   Besuche https://example.com/login, fülle das Formular mit user=test pass=1234 aus und klicke auf Login.
   ${TRIPLE_TICK}
   Oder:
   ${TRIPLE_TICK}browser
   Extrahiere alle Produktpreise von https://shop.example.com/products
   ${TRIPLE_TICK}

3. EMAIL — E-Mails senden oder empfangen.
   Schreibe einen ${TRIPLE_TICK}email Block:
   ${TRIPLE_TICK}email
   Sende eine E-Mail an max@example.com mit dem Betreff "Projekt-Update".
   Hallo Max, hier ist der aktuelle Stand...
   ${TRIPLE_TICK}
   Oder:
   ${TRIPLE_TICK}email
   Lese die letzten 5 E-Mails aus dem Posteingang.
   ${TRIPLE_TICK}

4. AUFGABE ABSCHLIESSEN — Wenn du fertig bist, schreibe:
   AUFGABE ABGESCHLOSSEN: [kurze Zusammenfassung was du getan hast]

WICHTIGE REGELN:
- Schreibe immer NUR EINEN Tool-Block (${TRIPLE_TICK}bash, ${TRIPLE_TICK}browser, ${TRIPLE_TICK}email) pro Antwort
- Warte auf das Ergebnis bevor du weitermachst
- Nutze bei BASH relative Pfade (du befindest dich bereits im workspace)
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

// Trace-Event-Text Translator
//
// Backend-Trace-Events sind durchgehend auf Deutsch. Damit sie in der englischen
// UI nicht komisch aussehen, mappen wir hier die bekannten Patterns auf EN.
//
// Matching-Strategie: Regex-Liste. Erste passende Regel gewinnt. Variable Teile
// (Task-Titel, Zahlen, Namen) bleiben unverändert erhalten.

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const RULES_DE_TO_EN: Rule[] = [
  // ── Task lifecycle ──────────────────────────────────────────────────────
  [/^Task gestartet: (.+)$/,              m => `Task started: ${m[1]}`],
  [/^Task als erledigt markiert$/,        () => `Task marked done`],
  [/^Task zugewiesen an (.+)$/,           m => `Task assigned to ${m[1]}`],
  [/^Task wartet auf Genehmigung: (.+)$/, m => `Task awaiting approval: ${m[1]}`],
  [/^🛑 Task blockiert: (.+)$/,           m => `🛑 Task blocked: ${m[1]}`],
  [/^Aufgabe erstellt$/,                  () => `Task created`],
  [/^Aufgabe delegiert$/,                 () => `Task delegated`],
  [/^Aufgaben laden$/,                    () => `Loading tasks`],
  [/^Duplikat-Task verhindert: (.+)$/,    m => `Duplicate task prevented: ${m[1]}`],
  [/^Fehler bei Task: (.+)$/,             m => `Task error: ${m[1]}`],
  [/^Task (\S+) nicht gefunden$/,         m => `Task ${m[1]} not found`],
  [/^Ungültiger Task-Status$/,            () => `Invalid task status`],

  // ── Cycles ──────────────────────────────────────────────────────────────
  [/^Arbeitszyklus gestartet$/,           () => `Work cycle started`],
  [/^Planungszyklus gestartet$/,          () => `Planning cycle started`],
  [/^Letzter Zyklus dauerte zu lange\. Task-Prozess wird neu gestartet\.$/,
                                          () => `Last cycle took too long. Task process restarting.`],

  // ── Retries / Escalation ────────────────────────────────────────────────
  [/^Automatischer Retry (\d+)\/(\d+): (.+)$/,
                                          m => `Auto retry ${m[1]}/${m[2]}: ${m[3]}`],
  [/^Eskalation nach (\d+) Fehlern: (.+)$/,
                                          m => `Escalation after ${m[1]} failures: ${m[2]}`],
  [/^Rate limit — wird automatisch wiederholt: (.+)$/,
                                          m => `Rate limit — auto-retrying: ${m[1]}`],
  [/^Timeout — Retry in (\d+) Minuten: (.+)$/,
                                          m => `Timeout — retry in ${m[1]} minutes: ${m[2]}`],
  [/^Nächster Versuch in (\d+) Minuten$/, m => `Next attempt in ${m[1]} minutes`],

  // ── Critic ──────────────────────────────────────────────────────────────
  [/^Critic: Eskalation — (.+)$/,         m => `Critic: Escalation — ${m[1]}`],
  [/^Critic: Überarbeitung nötig — (.+)$/,m => `Critic: Revision needed — ${m[1]}`],

  // ── Goals / Unblocking ──────────────────────────────────────────────────
  [/^🔓 (\d+) Task\(s\) entblockt$/,       m => `🔓 ${m[1]} task(s) unblocked`],
  [/^Ziel-Fortschritt aktualisiert: (\d+)%$/,
                                          m => `Goal progress updated: ${m[1]}%`],
  [/^(\d+)\/(\d+) Tasks erledigt$/,       m => `${m[1]}/${m[2]} tasks done`],
  [/^Blockierung erkannt$/,               () => `Block detected`],

  // ── CEO / Actions ───────────────────────────────────────────────────────
  [/^CEO führt (\d+) Aktion\(en\) aus$/,  m => `CEO executing ${m[1]} action(s)`],
  [/^Agent eingestellt: (.+)$/,           m => `Agent hired: ${m[1]}`],
  [/^Einstellung "(.+)" bereits beantragt — übersprungen$/,
                                          m => `Hire "${m[1]}" already requested — skipped`],
  [/^Agent (\S+) nicht gefunden$/,        m => `Agent ${m[1]} not found`],

  // ── Meetings ────────────────────────────────────────────────────────────
  [/^Meeting gestartet$/,                 () => `Meeting started`],
  [/^Meeting abgeschlossen$/,             () => `Meeting completed`],
  [/^Meeting abgeschlossen \(Board-Round\)$/,
                                          () => `Meeting completed (board round)`],
  [/^Meeting Synthesis gespeichert$/,     () => `Meeting synthesis saved`],
  [/^Meeting-Antwort: (.+)$/,             m => `Meeting reply: ${m[1]}`],
  [/^"(.+)" — alle (\d+) Antworten eingegangen$/,
                                          m => `"${m[1]}" — all ${m[2]} replies received`],
  [/^"(.+)" — alle Antworten da$/,        m => `"${m[1]}" — all replies received`],
  [/^call_meeting fehlgeschlagen$/,       () => `call_meeting failed`],

  // ── Messages / P2P / Board ──────────────────────────────────────────────
  [/^P2P Nachricht an Kollege$/,          () => `P2P message to colleague`],
  [/^P2P Nachricht von (.+)$/,            m => `P2P message from ${m[1]}`],
  [/^Board-Nachricht$/,                   () => `Board message`],
  [/^Neue Nachrichten$/,                  () => `New messages`],
  [/^(\d+) Nachricht\(en\) vom Board$/,   m => `${m[1]} message(s) from board`],
  [/^(\d+) Nachricht\(en\)(.*)$/,         m => `${m[1]} message(s)${m[2]}`],
  [/^Antwort erhalten$/,                  () => `Reply received`],
  [/^Eingangswarteschlange \(Queue\)$/,   () => `Inbox queue`],

  // ── Routines ────────────────────────────────────────────────────────────
  [/^Routine erstellt$/,                  () => `Routine created`],
  [/^Routine gestartet: (.+)$/,           m => `Routine started: ${m[1]}`],

  // ── Memory / Skills ─────────────────────────────────────────────────────
  [/^(\d+) Zeichen → iterative Summary aktualisiert$/,
                                          m => `${m[1]} chars → iterative summary updated`],
  [/^(\d+) Zeichen Ergebnis$/,            m => `${m[1]} chars result`],
  [/^Memory: (.+)$/,                      m => `Memory: ${m[1]}`],
  [/^Schlüssel: (.+)$/,                   m => `Key: ${m[1]}`],
  [/^Secret gespeichert$/,                () => `Secret saved`],
  [/^Session Search: "(.+)"$/,            m => `Session search: "${m[1]}"`],
  [/^(\d+)\/(\d+) Skill\(s\) relevant: (.+)$/,
                                          m => `${m[1]}/${m[2]} skill(s) relevant: ${m[3]}`],

  // ── Adapter / LLM ───────────────────────────────────────────────────────
  [/^Adapter-Exception$/,                 () => `Adapter exception`],
  [/^Adapter nicht gefunden: (.+)$/,      m => `Adapter not found: ${m[1]}`],
  [/^LLM-Anfrage senden$/,                () => `Sending LLM request`],
  [/^Modell: (.+)$/,                      m => `Model: ${m[1]}`],
  [/^Quelle: (\S+) · Adapter: (\S+)$/,    m => `Source: ${m[1]} · Adapter: ${m[2]}`],
  [/^Budget bei (\d+)% — Limit wird ignoriert!$/,
                                          m => `Budget at ${m[1]}% — limit ignored!`],

  // ── Misc ────────────────────────────────────────────────────────────────
  [/^Fehler$/,                            () => `Error`],
  [/^MAXIMIZER MODE$/,                    () => `MAXIMIZER MODE`],
  [/^Workspace: (.+)$/,                   m => `Workspace: ${m[1]}`],
  [/^(\d+) aktive Aufgabe\(n\): (.+)$/,   m => `${m[1]} active task(s): ${m[2]}`],
  [/^Neue Aufgabe\/Nachricht empfangen\. Agent arbeitet dies sofort nach aktuellem Task ab\.$/,
                                          () => `New task/message received. Agent will work on it right after the current task.`],
  [/^(.+) hat Task abgeschlossen: (.+)$/, m => `${m[1]} completed task: ${m[2]}`],
];

/**
 * Übersetzt einen Trace-Event-Titel in die gewünschte Sprache.
 * Aktuell unterstützt: DE (original) → EN. Für 'de' wird der Input unverändert zurückgegeben.
 */
export function translateTrace(title: string, lang: string): string {
  if (!title) return title;
  if (lang === 'de') return title;
  for (const [re, fn] of RULES_DE_TO_EN) {
    const m = title.match(re);
    if (m) return fn(m);
  }
  return title; // keine passende Regel → Original (lieber Deutsch als falsch übersetzt)
}

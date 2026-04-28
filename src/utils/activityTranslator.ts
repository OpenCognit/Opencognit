/**
 * Translates hardcoded German activity-log strings into the target language.
 * The backend stores finished German sentences in the DB (legacy). This
 * pattern-matches the known strings so the UI is correct regardless of locale.
 */

interface Pattern {
  de: RegExp;
  en: string | ((matches: RegExpMatchArray) => string);
}

const PATTERNS: Pattern[] = [
  // Agent / Expert actions
  { de: /^hat „(.+?)" abgelehnt$/, en: m => `rejected "${m[1]}"` },
  { de: /^hat „(.+?)" genehmigt$/, en: m => `approved "${m[1]}"` },
  { de: /^hat „(.+?)" pausiert$/, en: m => `paused "${m[1]}"` },
  { de: /^hat „(.+?)" fortgesetzt$/, en: m => `resumed "${m[1]}"` },
  { de: /^hat „(.+?)" entlassen$/, en: m => `dismissed "${m[1]}"` },
  { de: /^hat „(.+?)" als Experten eingestellt$/, en: m => `hired "${m[1]}" as expert` },

  // Tasks
  { de: /^hat Aufgabe „(.+?)" erstellt$/, en: m => `created task "${m[1]}"` },
  { de: /^hat „(.+?)" ausgecheckt$/, en: m => `checked out "${m[1]}"` },
  { de: /^hat Ticket (.+?) auf (.+?) gesetzt\.$/, en: m => `set ticket ${m[1]} to ${m[2]}` },

  // Projects
  { de: /^hat Projekt „(.+?)" erstellt$/, en: m => `created project "${m[1]}"` },
  { de: /^hat Projekt „(.+?)" gelöscht$/, en: m => `deleted project "${m[1]}"` },

  // Routines
  { de: /^hat Routine „(.+?)" erstellt$/, en: m => `created routine "${m[1]}"` },
  { de: /^hat Routine „(.+?)" gelöscht$/, en: m => `deleted routine "${m[1]}"` },
  { de: /^hat Trigger für Routine „(.+?)" erstellt$/, en: m => `created trigger for routine "${m[1]}"` },

  // Company
  { de: /^hat Unternehmen „(.+?)" erstellt$/, en: m => `created company "${m[1]}"` },

  // Goals
  { de: /^Ziel erstellt: "(.+?)"$/, en: m => `Goal created: "${m[1]}"` },

  // Meetings
  { de: /^hat ein Meeting gestartet: "(.+?)"$/, en: m => `started a meeting: "${m[1]}"` },

  // Comments
  { de: /^hat einen Kommentar hinterlassen$/, en: 'left a comment' },

  // System / budget
  { de: /^(.+?) wurde pausiert \(Budget (.+?)%\)$/, en: m => `${m[1]} was paused (Budget ${m[2]}%)` },
  { de: /^(.+?) pausiert \(Budget (.+?)% ≥ (.+?)% Schwellwert\)$/, en: m => `${m[1]} paused (Budget ${m[2]}% ≥ ${m[3]}% threshold)` },

  // Delegation
  { de: /^📋 (.+?) hat "(.+?)" an (.+?) delegiert\.$/, en: m => `📋 ${m[1]} delegated "${m[2]}" to ${m[3]}` },

  // Generic fallback patterns (catch-all for "hat ..." sentences)
  { de: /^hat (.+)$/, en: m => `${m[1]}` },
];

export function translateActivity(action: string, lang: string): string {
  if (lang === 'de') return action;

  for (const p of PATTERNS) {
    const m = action.match(p.de);
    if (m) {
      if (typeof p.en === 'string') {
        // Simple replacement – groups are $1, $2 etc.
        return m.slice(1).reduce((s, val, i) => s.replace(`$${i + 1}`, val), p.en);
      }
      return p.en(m);
    }
  }

  // No pattern matched – return raw (may still be German)
  return action;
}

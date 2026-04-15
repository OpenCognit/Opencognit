/**
 * Memory Auto-Integration
 *
 * Transparent layer that runs before/after every agent cycle:
 * - loadRelevantMemory()  → inject relevant past memories into prompt context
 * - autoSaveInsights()    → extract and persist key learnings from agent output
 * - saveMeetingResult()   → archive completed meeting to all participant wings
 *
 * All functions are non-blocking and swallow errors silently — they must
 * never crash or delay the main agent cycle.
 */

import { db } from '../db/client.js';
import { palaceWings, palaceDrawers, palaceDiary, palaceKg, experten } from '../db/schema.js';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { loadSummary, needsConsolidation, consolidateWing } from './memory-consolidation.js';

const now = () => new Date().toISOString();
const today = () => now().split('T')[0];

// ── Wing helpers ─────────────────────────────────────────────────────────────

function getWing(expertId: string) {
  return db.select().from(palaceWings).where(eq(palaceWings.expertId, expertId)).get() ?? null;
}

function getOrCreateWingForExpert(expertId: string) {
  const existing = getWing(expertId);
  if (existing) return existing;

  const expert = db.select().from(experten).where(eq(experten.id, expertId)).get();
  if (!expert) return null;

  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const id = uuid();
  db.insert(palaceWings).values({
    id,
    unternehmenId: expert.unternehmenId,
    expertId: expert.id,
    name: wingName || `agent_${id.slice(0, 8)}`,
    erstelltAm: now(),
    aktualisiertAm: now(),
  }).run();

  return db.select().from(palaceWings).where(eq(palaceWings.id, id)).get() ?? null;
}

function saveDrawer(wingId: string, room: string, content: string) {
  db.insert(palaceDrawers).values({
    id: uuid(),
    wingId,
    room,
    inhalt: content,
    erstelltAm: now(),
  }).run();
  db.update(palaceWings).set({ aktualisiertAm: now() }).where(eq(palaceWings.id, wingId)).run();
}

function saveDiary(wingId: string, opts: { thought?: string; action?: string; knowledge?: string }) {
  db.insert(palaceDiary).values({
    id: uuid(),
    wingId,
    datum: today(),
    thought: opts.thought ?? null,
    action: opts.action ?? null,
    knowledge: opts.knowledge ?? null,
    erstelltAm: now(),
  }).run();
}

function saveKg(unternehmenId: string, subject: string, predicate: string, object: string) {
  // Invalidate previous fact with same subject+predicate
  const old = db.select().from(palaceKg)
    .where(and(eq(palaceKg.subject, subject), eq(palaceKg.predicate, predicate), isNull(palaceKg.validUntil)))
    .all();
  for (const f of old) {
    db.update(palaceKg).set({ validUntil: today() }).where(eq(palaceKg.id, f.id)).run();
  }
  db.insert(palaceKg).values({
    id: uuid(),
    unternehmenId,
    subject,
    predicate,
    object,
    validFrom: today(),
    validUntil: null,
    erstelltVon: null,
    erstelltAm: now(),
  }).run();
}

// ── BM25 Retrieval Engine ─────────────────────────────────────────────────────
// Replaces naive word-length filter. Corpus-aware scoring: IDF is computed
// across all available drawers, so rare terms (e.g. "OAuth") rank higher
// than common ones (e.g. "task") — same principle as Elasticsearch.
//
// Parameters: k1=1.5 (TF saturation), b=0.75 (length normalization)
// These are the Robertson & Zaragoza 2009 defaults, empirically optimal
// for short technical documents.

const STOPWORDS = new Set([
  // German
  'dass', 'wenn', 'dann', 'aber', 'oder', 'auch', 'noch', 'schon', 'nicht',
  'mehr', 'sehr', 'kann', 'wird', 'sind', 'haben', 'werden', 'wurde', 'einen',
  'einer', 'diese', 'diesen', 'diesem', 'welche', 'welcher', 'welches',
  'durch', 'damit', 'dabei', 'daran', 'daher', 'davon', 'dafür', 'darauf',
  'immer', 'nach', 'über', 'unter', 'beim', 'eine', 'einem', 'eines',
  'sein', 'ihre', 'ihrer', 'ihren', 'ihrem', 'sein', 'seiner', 'seinen',
  // English
  'that', 'with', 'this', 'from', 'have', 'will', 'been', 'they', 'their',
  'there', 'which', 'would', 'could', 'should', 'about', 'into', 'than',
  'then', 'when', 'also', 'some', 'what', 'your', 'more', 'were', 'just',
]);

/**
 * Tokenizes text for BM25: lowercase, strip punctuation, remove stopwords.
 * Keeps German umlauts (äöüß) intact for proper German-language matching.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\wäöüß\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Full BM25+ scoring of a single document against a query.
 *
 * @param queryTerms  - tokenized query (task title + description)
 * @param docTerms    - tokenized document (drawer content)
 * @param docFreqs    - Map<term, number_of_docs_containing_term> across full corpus
 * @param N           - total number of documents in corpus
 * @param avgDocLen   - average document length (in tokens) across corpus
 * @param k1          - TF saturation (1.2–2.0 is typical; 1.5 = default)
 * @param b           - length normalization (0 = none, 1 = full; 0.75 = default)
 */
function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  docFreqs: Map<string, number>,
  N: number,
  avgDocLen: number,
  k1 = 1.5,
  b = 0.75,
): number {
  if (docTerms.length === 0 || queryTerms.length === 0) return 0;

  // Build term-frequency map for this document
  const tf = new Map<string, number>();
  for (const t of docTerms) tf.set(t, (tf.get(t) ?? 0) + 1);

  const docLen = docTerms.length;
  let score = 0;

  for (const term of queryTerms) {
    const termTf = tf.get(term) ?? 0;
    if (termTf === 0) continue;

    // IDF: Robertson & Zaragoza variant (always positive, avoids log(0))
    const df = docFreqs.get(term) ?? 0;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

    // TF normalization with length penalty
    const normTf = (termTf * (k1 + 1)) / (termTf + k1 * (1 - b + b * (docLen / avgDocLen)));

    score += idf * normTf;
  }

  return score;
}

/**
 * Rank a list of documents against a query using BM25.
 * Handles corpus stats (IDF, avgDocLen) internally — callers just pass docs.
 */
function rankByBm25<T extends { text: string; item: T }>(
  query: string,
  documents: Array<{ text: string; item: any }>,
  topK = 2,
): Array<{ item: any; score: number }> {
  if (documents.length === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Tokenize all docs once
  const tokenized = documents.map(d => ({
    item: d.item,
    terms: tokenize(d.text),
  }));

  // Compute corpus stats
  const N = tokenized.length;
  const docFreqs = new Map<string, number>();
  let totalLen = 0;

  for (const { terms } of tokenized) {
    totalLen += terms.length;
    const seen = new Set<string>();
    for (const t of terms) {
      if (!seen.has(t)) {
        docFreqs.set(t, (docFreqs.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }

  const avgDocLen = totalLen / N;

  // Score all documents
  return tokenized
    .map(({ item, terms }) => ({
      item,
      score: bm25Score(queryTerms, terms, docFreqs, N, avgDocLen),
    }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Backward-compat: extract keywords from text (now uses BM25 tokenizer) */
function extractKeywords(text: string): string[] {
  return tokenize(text);
}

// ── Pre-cycle: load relevant memory ──────────────────────────────────────────

// Memory protocol hint injected into every agent's context
const MEMORY_PROTOCOL_HINT = `
📝 GEDÄCHTNIS-PROTOKOLL:
Du kannst explizit etwas in dein Langzeitgedächtnis einlagern:
  [REMEMBER:raum] inhalt
Beispiele:
  [REMEMBER:entscheidungen] Ich habe mich für React entschieden weil...
  [REMEMBER:kontakte] Max Mustermann ist Ansprechpartner für API-Zugang
  [REMEMBER:projekt] Ziel: OAuth2-Integration bis Freitag
  [REMEMBER:erkenntnisse] Das API-Rate-Limit beträgt 100 req/min
Erlaubte Räume: entscheidungen, kontakte, projekt, erkenntnisse, notizen, aufgaben, fehler`;

/**
 * Loads relevant Memory context for an agent before its cycle.
 * Prefers a consolidated summary when available, falls back to raw entries.
 * Returns a compact string to inject into the system prompt.
 */
export function loadRelevantMemory(expertId: string, taskKeywords: string[]): string {
  try {
    const wing = getWing(expertId);
    if (!wing) return MEMORY_PROTOCOL_HINT;

    const parts: string[] = [];

    // 1. Use consolidated summary if available (prefer over raw entries)
    const summary = loadSummary(expertId);
    if (summary) {
      // Score each summary line via BM25 terms — keeps only task-relevant sections.
      // Falls back to full summary head if no keywords or no matches.
      const lines = summary.split('\n').filter(l => l.trim());
      let summarySnippet: string;

      if (taskKeywords.length > 0) {
        const query = taskKeywords.join(' ');
        const queryTerms = tokenize(query);
        // Score lines individually (each line is its own "mini-document")
        const scored = lines
          .map(line => {
            const lineTerms = tokenize(line);
            // Simple overlap score (BM25 degrades for <3 word docs — use term overlap)
            const hits = queryTerms.filter(t => lineTerms.includes(t)).length;
            return { line, hits };
          })
          .filter(x => x.hits > 0)
          .sort((a, b) => b.hits - a.hits);

        summarySnippet = scored.length > 0
          ? scored.slice(0, 15).map(x => x.line).join('\n')
          : lines.slice(0, 15).join('\n');
      } else {
        summarySnippet = lines.slice(0, 20).join('\n');
      }

      if (summarySnippet.trim()) {
        parts.push(`Zusammenfassung meines Wissens:\n${summarySnippet.slice(0, 700)}`);
      }
    }

    // 2. Recent raw diary entries (always include freshest, even if summary exists)
    const recentDiary = db.select().from(palaceDiary)
      .where(eq(palaceDiary.wingId, wing.id))
      .orderBy(desc(palaceDiary.erstelltAm))
      .limit(summary ? 1 : 2)
      .all();

    if (recentDiary.length > 0) {
      const diaryLines = recentDiary.map(d => {
        const lines: string[] = [];
        if (d.knowledge) lines.push(`📌 ${d.knowledge.slice(0, 120)}`);
        if (d.action && !d.knowledge) lines.push(`⚡ ${d.action.slice(0, 100)}`);
        return lines.join(' ');
      }).filter(Boolean);
      if (diaryLines.length > 0) {
        parts.push(`Letzte Erkenntnisse:\n${diaryLines.join('\n')}`);
      }
    }

    // 3. BM25-ranked drawers (replaces naive keyword-inclusion scoring)
    // Runs even when a summary exists — BM25 can surface task-specific
    // drawer knowledge that the summary doesn't cover.
    {
      const allDrawers = db.select().from(palaceDrawers)
        .where(eq(palaceDrawers.wingId, wing.id))
        .orderBy(desc(palaceDrawers.erstelltAm))
        .limit(50)  // larger candidate pool for better IDF stats
        .all();

      if (allDrawers.length > 0 && taskKeywords.length > 0) {
        const query = taskKeywords.join(' ');
        const ranked = rankByBm25(
          query,
          allDrawers.map(d => ({ text: `${d.room} ${d.inhalt}`, item: d })),
          summary ? 1 : 2,  // 1 drawer when summary exists, 2 when not
        );

        if (ranked.length > 0) {
          const drawerLines = ranked.map(({ item: d, score }) =>
            `[${d.room}] ${d.inhalt.slice(0, 220)}`  // slightly more content
          );
          parts.push(`Relevantes Wissen:\n${drawerLines.join('\n')}`);
        }
      }
    }

    // 4. Active KG facts about this agent
    const expert = db.select({ name: experten.name }).from(experten).where(eq(experten.id, expertId)).get() as any;
    if (expert?.name) {
      const kgFacts = db.select().from(palaceKg)
        .where(and(eq(palaceKg.subject, expert.name), isNull(palaceKg.validUntil)))
        .limit(3)
        .all();
      if (kgFacts.length > 0) {
        const kgLines = kgFacts.map(f => `${f.predicate}: ${f.object}`);
        parts.push(`Über mich:\n${kgLines.join('\n')}`);
      }
    }

    const memSection = parts.length > 0
      ? `\n\n🧠 GEDÄCHTNIS (Memory):\n${parts.join('\n\n')}`
      : '';

    return memSection + MEMORY_PROTOCOL_HINT;
  } catch {
    return MEMORY_PROTOCOL_HINT;
  }
}

// ── Post-cycle: auto-extract and save insights ────────────────────────────────

const DECISION_PATTERNS = [
  /ich habe entschieden[,:]?\s*(.+)/i,
  /ich werde\s+(.{10,100})/i,
  /task .{0,40} (?:ist |wurde )?(?:abgeschlossen|fertig|erledigt)[.!]?\s*(.{0,100})/i,
  /lösung[:]?\s*(.{20,200})/i,
  /ergebnis[:]?\s*(.{20,200})/i,
  /problem (?:war|ist)[:]?\s*(.{20,200})/i,
  /important[ly]?[:]?\s*(.{20,200})/i,
  /key (?:finding|insight|learning)[:]?\s*(.{20,200})/i,
];

const KNOWLEDGE_PATTERNS = [
  /die (?:api|url|endpoint|adresse) (?:ist|lautet)[:]?\s*(.{10,150})/i,
  /(?:zugangsdaten|credentials|api.?key)[:]?\s*(.{5,100})/i,
  /das (?:problem|fehler|bug) (?:war|ist)[:]?\s*(.{20,200})/i,
  /(?:fix|lösung|workaround)[:]?\s*(.{20,200})/i,
  /gelernt[:]?\s*(.{20,200})/i,
  /learned[:]?\s*(.{20,200})/i,
  /note[:]?\s*(.{20,200})/i,
];

// Allowed rooms for [REMEMBER:room] protocol (safe list to avoid spam)
const ALLOWED_REMEMBER_ROOMS = new Set([
  'entscheidungen', 'kontakte', 'projekt', 'erkenntnisse', 'notizen',
  'aufgaben', 'fehler', 'task_ergebnisse', 'meeting_ergebnisse',
  'decisions', 'contacts', 'project', 'insights', 'notes', 'tasks', 'errors',
]);

/**
 * Parses [REMEMBER:kg] tags and writes triplets to palace_kg.
 * Format: [REMEMBER:kg] subject | predicate | object
 * Also supports JSON: [REMEMBER:kg] {"subject":"...","predicate":"...","object":"..."}
 */
function parseAndSaveKgTags(output: string, expertId: string, unternehmenId: string): number {
  const kgPattern = /\[REMEMBER:kg\]\s*([^\[]+)/gi;
  let count = 0;
  let match;
  while ((match = kgPattern.exec(output)) !== null) {
    const raw = match[1].trim();
    let subject = '', predicate = '', object = '';

    // Try JSON format first
    try {
      const parsed = JSON.parse(raw.replace(/^[^{]*({.*})[^}]*$/s, '$1'));
      subject = parsed.subject || '';
      predicate = parsed.predicate || '';
      object = parsed.object || '';
    } catch {
      // Try pipe-separated: subject | predicate | object
      const parts = raw.split('|').map((p: string) => p.trim());
      if (parts.length >= 3) {
        [subject, predicate, object] = parts;
      } else if (parts.length === 2) {
        subject = parts[0];
        predicate = 'relates_to';
        object = parts[1];
      }
    }

    if (!subject || !object) continue;
    predicate = predicate || 'knows';

    db.insert(palaceKg).values({
      id: uuid(),
      unternehmenId,
      subject: subject.slice(0, 200),
      predicate: predicate.slice(0, 100),
      object: object.slice(0, 500),
      validFrom: today(),
      erstelltVon: expertId,
      erstelltAm: now(),
    }).run();
    console.log(`🧠 KG [REMEMBER:kg]: "${subject}" → ${predicate} → "${object}"`);
    count++;
  }
  return count;
}

/**
 * Parses [REMEMBER:room] content tags from agent output.
 * Returns an array of { room, content } pairs.
 */
function parseRememberTags(output: string): Array<{ room: string; content: string }> {
  const results: Array<{ room: string; content: string }> = [];
  // Match [REMEMBER:room] content (until next tag or end of string)
  const tagPattern = /\[REMEMBER:([a-zA-Z_äöüÄÖÜ]+)\]\s*([^\[]+)/g;
  let match;
  while ((match = tagPattern.exec(output)) !== null) {
    const room = match[1].trim().toLowerCase();
    const content = match[2].trim();
    if (content.length < 5) continue;
    // Normalize room name to allowed list or allow if close enough
    const normalizedRoom = ALLOWED_REMEMBER_ROOMS.has(room) ? room : `notizen_${room}`;
    results.push({ room: normalizedRoom, content: content.slice(0, 500) });
  }
  return results;
}

/**
 * After a successful agent cycle: extract key insights and persist them.
 * Runs async, errors are silently swallowed.
 */
export async function autoSaveInsights(
  expertId: string,
  unternehmenId: string,
  output: string,
  currentTaskTitle?: string,
): Promise<void> {
  if (!output || output.length < 50) return;

  try {
    const wing = getOrCreateWingForExpert(expertId);
    if (!wing) return;

    const expert = db.select({ name: experten.name }).from(experten).where(eq(experten.id, expertId)).get() as any;
    const agentName = expert?.name || expertId;

    // 1a. Parse [REMEMBER:kg] tags → write directly to Knowledge Graph
    parseAndSaveKgTags(output, expertId, unternehmenId);

    // 1b. Parse explicit [REMEMBER:room] tags — highest priority
    const rememberTags = parseRememberTags(output);
    for (const { room, content } of rememberTags) {
      saveDrawer(wing.id, room, `${today()}: ${content}`);
      console.log(`🧠 Memory [REMEMBER]: ${agentName} → ${room}: "${content.slice(0, 60)}…"`);
    }

    // Strip [REMEMBER:...] blocks from output before regex extraction
    const cleanOutput = output.replace(/\[REMEMBER:[^\]]+\][^\[]*/g, '').trim();

    // 2. Extract decisions/actions via pattern matching
    const decisions: string[] = [];
    for (const pattern of DECISION_PATTERNS) {
      const m = cleanOutput.match(pattern);
      if (m?.[1] && m[1].length > 15) {
        decisions.push(m[1].trim().slice(0, 200));
      }
    }

    // 3. Extract knowledge snippets
    const knowledge: string[] = [];
    for (const pattern of KNOWLEDGE_PATTERNS) {
      const m = cleanOutput.match(pattern);
      if (m?.[1] && m[1].length > 10) {
        knowledge.push(m[1].trim().slice(0, 200));
      }
    }

    // 4. Save diary entry if meaningful content found
    if (rememberTags.length > 0 || decisions.length > 0 || knowledge.length > 0) {
      saveDiary(wing.id, {
        action: decisions.length > 0 ? decisions[0] : (rememberTags.length > 0 ? `Gespeichert: ${rememberTags.map(t => t.room).join(', ')}` : undefined),
        knowledge: knowledge.length > 0 ? knowledge[0] : (rememberTags.length > 0 ? rememberTags[0].content.slice(0, 200) : undefined),
        thought: currentTaskTitle ? `Arbeite an: ${currentTaskTitle}` : undefined,
      });
    }

    // 5. Save full output snippet to task_ergebnisse drawer
    if (currentTaskTitle && cleanOutput.length > 100) {
      const snippet = cleanOutput
        .replace(/```[\s\S]*?```/g, '[code]')
        .replace(/\{[\s\S]*?\}/g, '[json]')
        .trim()
        .slice(0, 400);

      if (snippet.length > 80) {
        saveDrawer(wing.id, 'task_ergebnisse', `## ${currentTaskTitle}\n${today()}\n\n${snippet}`);
      }
    }

    // 6. KG fact: agent is working on task
    if (currentTaskTitle) {
      saveKg(unternehmenId, agentName, 'arbeitet_an', currentTaskTitle);
    }

    // 7. Knowledge snippets as drawer entries
    for (const k of knowledge.slice(0, 2)) {
      saveDrawer(wing.id, 'erkenntnisse', `${today()}: ${k}`);
    }

    // 8. Trigger auto-consolidation if threshold reached (non-blocking)
    if (needsConsolidation(expertId)) {
      consolidateWing(expertId).catch(() => {});
    }

  } catch {
    // Silent — never crash the cycle
  }
}

// ── Meeting archiving ─────────────────────────────────────────────────────────

/**
 * Archives a completed meeting into Memory:
 * - CEO wing: meeting_ergebnisse room
 * - Each participant wing: meeting_antworten room
 * - KG: meeting metadata as triplets
 */
export async function saveMeetingResult(
  meetingId: string,
  frage: string,
  antworten: Record<string, string>,
  teilnehmerIds: string[],
  veranstalterExpertId: string,
  unternehmenId: string,
): Promise<void> {
  try {
    const dateStr = today();
    const shortId = meetingId.slice(0, 8);

    // Build full summary text
    const expertNames = new Map<string, string>();
    const allExperts = db.select({ id: experten.id, name: experten.name }).from(experten)
      .where(eq(experten.unternehmenId, unternehmenId)).all();
    for (const e of allExperts as any[]) expertNames.set(e.id, e.name);

    const summaryLines = teilnehmerIds.map(id => {
      const name = expertNames.get(id) || id;
      const antwort = antworten[id] || '(keine Antwort)';
      return `**${name}:** ${antwort}`;
    });

    const fullSummary = `# Meeting: ${frage}\nDatum: ${dateStr}\n\n${summaryLines.join('\n\n')}`;
    const veranstalterName = expertNames.get(veranstalterExpertId) || 'Veranstalter';

    // 1. Save to organizer (CEO) wing — meeting_ergebnisse
    const ceoWing = getOrCreateWingForExpert(veranstalterExpertId);
    if (ceoWing) {
      saveDrawer(ceoWing.id, 'meeting_ergebnisse', fullSummary);
      saveDiary(ceoWing.id, {
        thought: `Meeting geleitet: "${frage}"`,
        action: `${teilnehmerIds.length} Teilnehmer befragt`,
        knowledge: summaryLines[0] || undefined,
      });
    }

    // 2. Save to each participant wing — meeting_antworten
    for (const teilnehmerId of teilnehmerIds) {
      const wing = getOrCreateWingForExpert(teilnehmerId);
      if (!wing) continue;
      const eigenAntwort = antworten[teilnehmerId] || '(keine Antwort)';
      saveDrawer(wing.id, 'meeting_antworten',
        `# Meeting: ${frage}\nDatum: ${dateStr}\nMeine Antwort: ${eigenAntwort}\n\n${summaryLines.join('\n')}`
      );
      saveDiary(wing.id, {
        action: `Meeting-Teilnahme: "${frage}"`,
        knowledge: eigenAntwort.slice(0, 200),
      });
    }

    // 3. KG triplets
    saveKg(unternehmenId, `Meeting-${shortId}`, 'behandelte_frage', frage);
    saveKg(unternehmenId, `Meeting-${shortId}`, 'geleitet_von', veranstalterName);
    saveKg(unternehmenId, `Meeting-${shortId}`, 'datum', dateStr);
    saveKg(unternehmenId, `Meeting-${shortId}`, 'teilnehmer_anzahl', String(teilnehmerIds.length));

    console.log(`🧠 Memory: Meeting "${frage}" archiviert (${teilnehmerIds.length + 1} Wings)`);
  } catch (e: any) {
    console.warn(`⚠️ Memory Meeting-Save fehlgeschlagen: ${e.message}`);
  }
}

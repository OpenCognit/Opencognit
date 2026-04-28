// Nativer Memory Service — TypeScript/SQLite Implementierung
// Ersetzt den Python MCP-Server komplett. Kein Python, kein externer Prozess.
//
// Implementiert alle 8 Memory-Tools mit identischen Signaturen:
// - memory_status
// - memory_search
// - memory_add_drawer
// - memory_diary_write
// - memory_list_wings
// - memory_traverse
// - memory_kg_add
// - memory_kg_query

import { db } from '../db/client.js';
import { palaceWings, palaceDrawers, palaceDiary, palaceKg, agents } from '../db/schema.js';
import { eq, and, like, isNull, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const now = () => new Date().toISOString();

// ─── MCP-kompatibles Rückgabeformat ─────────────────────────────────────────
// Der alte MCP-Server gab { content: [{ type: 'text', text: '...' }] } zurück.
// Wir halten das Format identisch, damit kein Aufrufer geändert werden muss.

function mcpResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

// ─── Wing-Management (intern) ───────────────────────────────────────────────

function getOrCreateWing(wingName: string, expertId?: string): typeof palaceWings.$inferSelect | null {
  // Versuche Wing zu finden
  let wing = db.select().from(palaceWings)
    .where(eq(palaceWings.name, wingName))
    .get();

  if (wing) return wing;

  // Wing erstellen — braucht einen Expert-Kontext
  if (!expertId) {
    // Versuche Expert anhand des Wing-Namens zu finden
    const allExperts = db.select().from(agents).all();
    const match = allExperts.find(e =>
      e.name.toLowerCase().replace(/\s+/g, '_') === wingName
    );
    if (!match) return null;
    expertId = match.id;
  }

  const expert = db.select().from(agents).where(eq(agents.id, expertId)).get();
  if (!expert) return null;

  const id = uuid();
  db.insert(palaceWings).values({
    id,
    companyId: expert.companyId,
    agentId: expert.id,
    name: wingName,
    createdAt: now(),
    updatedAt: now(),
  }).run();

  return db.select().from(palaceWings).where(eq(palaceWings.id, id)).get() ?? null;
}

// ─── Tool-Implementierungen ─────────────────────────────────────────────────

function memoryStatus(_args: any) {
  const wings = db.select().from(palaceWings).all();
  const drawerCount = db.select().from(palaceDrawers).all().length;
  const diaryCount = db.select().from(palaceDiary).all().length;
  const kgCount = db.select().from(palaceKg).where(isNull(palaceKg.validUntil)).all().length;

  const text = `# Memory Status (Native SQLite)

## Speicherprotokoll: AAAK
- **A**bsicht (Thought): Was der Agent denkt
- **A**ktion (Action): Was er getan hat
- **A**uswirkung (Knowledge): Was er gelernt hat
- **K**ontext: Wird automatisch durch Wing-Zugehörigkeit geliefert

## Statistiken
- Wings: ${wings.length}
- Drawers: ${drawerCount}
- Tagebuch-Einträge: ${diaryCount}
- Aktive Fakten (KG): ${kgCount}

## Wings
${wings.map(w => `- ${w.name} (Expert: ${w.agentId})`).join('\n') || '(keine)'}`;

  return mcpResult(text);
}

function memorySearch(args: { query?: string; wing?: string }) {
  const query = (args.query || '').toLowerCase();
  const wingName = args.wing;

  // Drawers durchsuchen
  let drawers;
  if (wingName) {
    const wing = db.select().from(palaceWings).where(eq(palaceWings.name, wingName)).get();
    if (!wing) return mcpResult(`Wing "${wingName}" nicht gefunden.`);
    drawers = db.select().from(palaceDrawers).where(eq(palaceDrawers.wingId, wing.id)).all();
  } else {
    drawers = db.select().from(palaceDrawers).all();
  }

  // Keyword-Suche (case-insensitive)
  const treffer = query && query !== '*'
    ? drawers.filter(d => d.content.toLowerCase().includes(query) || d.room.toLowerCase().includes(query))
    : drawers;

  // Diary auch durchsuchen
  let diaryTreffer: typeof palaceDiary.$inferSelect[] = [];
  if (query && query !== '*') {
    const allDiary = wingName
      ? (() => {
          const w = db.select().from(palaceWings).where(eq(palaceWings.name, wingName)).get();
          return w ? db.select().from(palaceDiary).where(eq(palaceDiary.wingId, w.id)).all() : [];
        })()
      : db.select().from(palaceDiary).all();
    diaryTreffer = allDiary.filter(d =>
      (d.thought || '').toLowerCase().includes(query) ||
      (d.action || '').toLowerCase().includes(query) ||
      (d.knowledge || '').toLowerCase().includes(query)
    );
  }

  if (treffer.length === 0 && diaryTreffer.length === 0) {
    return mcpResult(query === '*' ? 'Keine Einträge vorhanden.' : `Keine Treffer für "${args.query}".`);
  }

  const parts: string[] = [];

  if (treffer.length > 0) {
    parts.push(`## Drawer-Treffer (${treffer.length})`);
    for (const d of treffer.slice(0, 10)) {
      parts.push(`### [${d.room}] ${d.createdAt.slice(0, 10)}\n${d.content.slice(0, 500)}`);
    }
  }

  if (diaryTreffer.length > 0) {
    parts.push(`\n## Tagebuch-Treffer (${diaryTreffer.length})`);
    for (const d of diaryTreffer.slice(0, 5)) {
      parts.push(`### ${d.datum}\n- Gedanke: ${d.thought || '—'}\n- Aktion: ${d.action || '—'}\n- Wissen: ${d.knowledge || '—'}`);
    }
  }

  return mcpResult(parts.join('\n\n'));
}

function memoryAddDrawer(args: { wing: string; room: string; content: string }) {
  const wing = getOrCreateWing(args.wing);
  if (!wing) return mcpResult(`Fehler: Wing "${args.wing}" konnte nicht erstellt werden (kein passender Agent gefunden).`);

  db.insert(palaceDrawers).values({
    id: uuid(),
    wingId: wing.id,
    room: args.room || 'general',
    content: args.content || '',
    createdAt: now(),
  }).run();

  // Wing aktualisieren
  db.update(palaceWings).set({ updatedAt: now() }).where(eq(palaceWings.id, wing.id)).run();

  return mcpResult(`Drawer in Wing "${args.wing}" / Room "${args.room}" gespeichert.`);
}

function memoryDiaryWrite(args: { date?: string; thought?: string; action?: string; knowledge?: string; wing?: string }) {
  // Wing ermitteln — wenn keiner angegeben, nehme den ersten verfügbaren
  let wingName = args.wing;
  if (!wingName) {
    const firstWing = db.select().from(palaceWings).limit(1).get();
    wingName = firstWing?.name || 'default';
  }

  const wing = getOrCreateWing(wingName as string);
  if (!wing) return mcpResult(`Fehler: Wing "${wingName}" nicht verfügbar.`);

  const datum = args.date || new Date().toISOString().split('T')[0];

  db.insert(palaceDiary).values({
    id: uuid(),
    wingId: wing.id,
    datum,
    thought: args.thought || null,
    action: args.action || null,
    knowledge: args.knowledge || null,
    createdAt: now(),
  }).run();

  db.update(palaceWings).set({ updatedAt: now() }).where(eq(palaceWings.id, wing.id)).run();

  return mcpResult(`Tagebuch-Eintrag für ${datum} in Wing "${wingName}" gespeichert.`);
}

function memoryListWings(_args: any) {
  const wings = db.select().from(palaceWings).all();

  if (wings.length === 0) return mcpResult('Keine Wings vorhanden.');

  const lines = wings.map(w => {
    const drawerCount = db.select().from(palaceDrawers).where(eq(palaceDrawers.wingId, w.id)).all().length;
    const diaryCount = db.select().from(palaceDiary).where(eq(palaceDiary.wingId, w.id)).all().length;
    return `- **${w.name}** (${drawerCount} Drawers, ${diaryCount} Diary-Einträge) — Aktualisiert: ${w.updatedAt.slice(0, 10)}`;
  });

  return mcpResult(`# Wings im Palace\n\n${lines.join('\n')}`);
}

function memoryTraverse(args: { wing: string; room?: string }) {
  const wing = db.select().from(palaceWings).where(eq(palaceWings.name, args.wing)).get();
  if (!wing) return mcpResult(`Wing "${args.wing}" nicht gefunden.`);

  if (args.room) {
    // Spezifischer Room
    const drawers = db.select().from(palaceDrawers)
      .where(and(eq(palaceDrawers.wingId, wing.id), eq(palaceDrawers.room, args.room)))
      .all();

    if (drawers.length === 0) return mcpResult(`Room "${args.room}" in Wing "${args.wing}" ist leer.`);

    const parts = drawers.map(d => `### ${d.createdAt.slice(0, 16)}\n${d.content}`);
    return mcpResult(`# ${args.wing} / ${args.room}\n\n${parts.join('\n\n---\n\n')}`);
  }

  // Alle Rooms auflisten
  const drawers = db.select().from(palaceDrawers).where(eq(palaceDrawers.wingId, wing.id)).all();
  const rooms = [...new Set(drawers.map(d => d.room))];
  const diaryCount = db.select().from(palaceDiary).where(eq(palaceDiary.wingId, wing.id)).all().length;

  const roomLines = rooms.map(r => {
    const count = drawers.filter(d => d.room === r).length;
    return `- **${r}** (${count} Einträge)`;
  });

  return mcpResult(`# Wing: ${args.wing}\n\n## Rooms\n${roomLines.join('\n') || '(keine)'}\n\n## Tagebuch\n${diaryCount} Einträge`);
}

function memoryKgAdd(args: { subject: string; predicate: string; object: string; valid_from?: string }) {
  // Alten Fakt invalidieren (gleicher Subject + Predicate)
  const existierend = db.select().from(palaceKg)
    .where(and(
      eq(palaceKg.subject, args.subject),
      eq(palaceKg.predicate, args.predicate),
      isNull(palaceKg.validUntil),
    ))
    .all();

  for (const fakt of existierend) {
    db.update(palaceKg).set({ validUntil: now() }).where(eq(palaceKg.id, fakt.id)).run();
  }

  // Unternehmen ermitteln (über den Subject, der oft ein Agent-Name ist)
  let unternehmenId = '';
  const allExperts = db.select().from(agents).all();
  const match = allExperts.find(e =>
    e.name.toLowerCase() === args.subject.toLowerCase() ||
    e.name.toLowerCase().replace(/\s+/g, '_') === args.subject.toLowerCase()
  );
  unternehmenId = match?.companyId || allExperts[0]?.companyId || '';

  db.insert(palaceKg).values({
    id: uuid(),
    companyId: unternehmenId,
    subject: args.subject,
    predicate: args.predicate,
    object: args.object,
    validFrom: args.valid_from || now().split('T')[0],
    validUntil: null,
    createdBy: null,
    createdAt: now(),
  }).run();

  const invalidiert = existierend.length > 0 ? ` (${existierend.length} alte(r) Fakt(en) invalidiert)` : '';
  return mcpResult(`KG-Tripel gespeichert: "${args.subject}" → "${args.predicate}" → "${args.object}"${invalidiert}`);
}

function memoryKgQuery(args: { subject?: string; predicate?: string }) {
  let fakten = db.select().from(palaceKg).where(isNull(palaceKg.validUntil)).all();

  if (args.subject) {
    fakten = fakten.filter(f => f.subject.toLowerCase().includes(args.subject!.toLowerCase()));
  }
  if (args.predicate) {
    fakten = fakten.filter(f => f.predicate.toLowerCase().includes(args.predicate!.toLowerCase()));
  }

  if (fakten.length === 0) {
    return mcpResult(`Keine aktiven Fakten gefunden${args.subject ? ` für "${args.subject}"` : ''}.`);
  }

  const lines = fakten.slice(0, 20).map(f =>
    `- **${f.subject}** → ${f.predicate} → **${f.object}** (seit ${f.validFrom || '?'})`
  );

  return mcpResult(`# Knowledge Graph Abfrage\n\n${lines.join('\n')}`);
}

// ─── Tool-Router (Drop-in Ersatz für mcpClient.callTool) ────────────────────

const TOOLS: Record<string, (args: any) => any> = {
  memory_status: memoryStatus,
  memory_search: memorySearch,
  memory_add_drawer: memoryAddDrawer,
  memory_diary_write: memoryDiaryWrite,
  memory_list_wings: memoryListWings,
  memory_traverse: memoryTraverse,
  memory_kg_add: memoryKgAdd,
  memory_kg_query: memoryKgQuery,
};

/**
 * Drop-in Ersatz für mcpClient.callTool().
 * Gleiche Signatur, gleiche Rückgabeformate — kein Python nötig.
 */
export function callTool(name: string, args: any = {}): any {
  const handler = TOOLS[name];
  if (!handler) {
    throw new Error(`Memory: Unbekanntes Tool "${name}"`);
  }
  return handler(args);
}

/**
 * Für Kompatibilität: ensureStarted() ist ein No-Op (kein Prozess zu starten).
 */
export async function ensureStarted(): Promise<void> {
  // Nativ — nichts zu starten
}

/**
 * Für Kompatibilität: shutdown() ist ein No-Op.
 */
export async function shutdown(): Promise<void> {
  // Nativ — nichts zu stoppen
}

/**
 * Memory Consolidation Service
 *
 * Compresses old diary entries + drawers into a compact summary stored in
 * palaceSummaries. Prevents unbounded memory growth while preserving the
 * agent's key learnings and decisions.
 *
 * Strategy:
 *   1. Collect last N diary entries + all drawer entries
 *   2. Build a structured summary (template-based, no extra LLM call needed)
 *   3. Store in palaceSummaries (versioned, incrementing)
 *   4. Prune old raw entries (keep last 5 diary + 3 per room)
 *   5. loadRelevantMemory prefers a fresh summary over raw entries
 */

import { db } from '../db/client.js';
import {
  palaceWings, palaceDrawers, palaceDiary, palaceKg, palaceSummaries, experten,
} from '../db/schema.js';
import { eq, and, isNull, desc, lt, asc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const now = () => new Date().toISOString();
const today = () => now().split('T')[0];

// How many raw entries trigger auto-consolidation
const AUTO_CONSOLIDATE_THRESHOLD = 20;

// How many raw entries to keep after pruning
const KEEP_DIARY = 5;
const KEEP_PER_ROOM = 3;

// ── Main consolidation function ───────────────────────────────────────────────

/**
 * Consolidates a single agent wing into palaceSummaries.
 * Returns true if a new summary was written.
 */
export async function consolidateWing(expertId: string): Promise<boolean> {
  try {
    const wing = db.select().from(palaceWings).where(eq(palaceWings.expertId, expertId)).get();
    if (!wing) return false;

    const expert = db.select({ name: experten.name, unternehmenId: experten.unternehmenId })
      .from(experten).where(eq(experten.id, expertId)).get() as any;
    if (!expert) return false;

    // --- Collect raw material ---

    const allDiary = db.select().from(palaceDiary)
      .where(eq(palaceDiary.wingId, wing.id))
      .orderBy(desc(palaceDiary.erstelltAm))
      .limit(50)
      .all();

    const allDrawers = db.select().from(palaceDrawers)
      .where(eq(palaceDrawers.wingId, wing.id))
      .orderBy(desc(palaceDrawers.erstelltAm))
      .limit(80)
      .all();

    const activeKg = db.select().from(palaceKg)
      .where(and(eq(palaceKg.subject, expert.name), isNull(palaceKg.validUntil)))
      .all();

    if (allDiary.length === 0 && allDrawers.length === 0) return false;

    // --- Build structured summary ---

    const summaryParts: string[] = [];
    summaryParts.push(`# Gedächtniszusammenfassung: ${expert.name}`);
    summaryParts.push(`Konsolidiert am: ${today()} | Umfasst ${allDiary.length} Diary-Einträge, ${allDrawers.length} Drawers`);

    // Knowledge graph section
    if (activeKg.length > 0) {
      summaryParts.push('\n## Aktuelle Fakten (Knowledge Graph)');
      for (const f of activeKg) {
        summaryParts.push(`- ${f.predicate}: ${f.object}`);
      }
    }

    // Diary distillation — extract unique knowledge/action lines
    const knowledgeSet = new Set<string>();
    const actionSet = new Set<string>();
    for (const d of allDiary) {
      if (d.knowledge && d.knowledge.trim().length > 10) {
        knowledgeSet.add(d.knowledge.trim().slice(0, 200));
      }
      if (d.action && d.action.trim().length > 10) {
        actionSet.add(d.action.trim().slice(0, 200));
      }
    }

    if (knowledgeSet.size > 0) {
      summaryParts.push('\n## Gesichertes Wissen');
      for (const k of [...knowledgeSet].slice(0, 10)) {
        summaryParts.push(`- ${k}`);
      }
    }

    if (actionSet.size > 0) {
      summaryParts.push('\n## Getätigte Aktionen (Auszug)');
      for (const a of [...actionSet].slice(0, 8)) {
        summaryParts.push(`- ${a}`);
      }
    }

    // Drawer distillation — one representative entry per room
    const rooms = new Map<string, typeof palaceDrawers.$inferSelect[]>();
    for (const d of allDrawers) {
      if (!rooms.has(d.room)) rooms.set(d.room, []);
      rooms.get(d.room)!.push(d);
    }

    if (rooms.size > 0) {
      summaryParts.push('\n## Wissensdrawer (je Raum)');
      for (const [room, entries] of rooms) {
        const best = entries[0]; // most recent
        const snippet = best.inhalt.replace(/\n+/g, ' ').trim().slice(0, 250);
        summaryParts.push(`### ${room} (${entries.length} Einträge)\n${snippet}${entries.length > 1 ? ` …(+${entries.length - 1} weitere)` : ''}`);
      }
    }

    const summaryText = summaryParts.join('\n');

    // --- Write / update palaceSummaries ---

    const existing = db.select().from(palaceSummaries)
      .where(eq(palaceSummaries.expertId, expertId))
      .get();

    if (existing) {
      db.update(palaceSummaries).set({
        inhalt: summaryText,
        version: (existing.version || 1) + 1,
        komprimierteTurns: allDiary.length,
        aktualisiertAm: now(),
      }).where(eq(palaceSummaries.expertId, expertId)).run();
    } else {
      db.insert(palaceSummaries).values({
        id: uuid(),
        expertId,
        unternehmenId: expert.unternehmenId,
        inhalt: summaryText,
        version: 1,
        komprimierteTurns: allDiary.length,
        erstelltAm: now(),
        aktualisiertAm: now(),
      }).run();
    }

    // --- Prune raw entries (keep freshest ones) ---

    if (allDiary.length > KEEP_DIARY) {
      const toDelete = allDiary.slice(KEEP_DIARY);
      for (const d of toDelete) {
        db.delete(palaceDiary).where(eq(palaceDiary.id, d.id)).run();
      }
    }

    for (const [, entries] of rooms) {
      if (entries.length > KEEP_PER_ROOM) {
        const toDelete = entries.slice(KEEP_PER_ROOM);
        for (const d of toDelete) {
          db.delete(palaceDrawers).where(eq(palaceDrawers.id, d.id)).run();
        }
      }
    }

    console.log(`🧠 Memory: Wing "${expert.name}" konsolidiert (v${(existing?.version ?? 0) + 1})`);
    return true;
  } catch (e: any) {
    console.warn(`⚠️ Memory Consolidation fehlgeschlagen für ${expertId}: ${e.message}`);
    return false;
  }
}

/**
 * Check if a wing needs consolidation (threshold reached).
 */
export function needsConsolidation(expertId: string): boolean {
  try {
    const wing = db.select().from(palaceWings).where(eq(palaceWings.expertId, expertId)).get();
    if (!wing) return false;
    const count = db.select().from(palaceDiary)
      .where(eq(palaceDiary.wingId, wing.id))
      .all().length;
    return count >= AUTO_CONSOLIDATE_THRESHOLD;
  } catch {
    return false;
  }
}

/**
 * Load the latest summary for an expert (for injection into loadRelevantMemory).
 * Returns null if no summary exists or it's stale.
 */
export function loadSummary(expertId: string): string | null {
  try {
    const s = db.select().from(palaceSummaries)
      .where(eq(palaceSummaries.expertId, expertId))
      .get();
    if (!s) return null;

    // Consider stale if older than 7 days
    const ageMs = Date.now() - new Date(s.aktualisiertAm).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return null;

    return s.inhalt;
  } catch {
    return null;
  }
}

/**
 * Run consolidation for ALL wings in a company that have crossed the threshold.
 * Called by the scheduler periodically.
 */
export async function consolidateAll(unternehmenId: string): Promise<void> {
  try {
    const allExperts = db.select({ id: experten.id }).from(experten)
      .where(eq(experten.unternehmenId, unternehmenId)).all() as any[];

    for (const e of allExperts) {
      if (needsConsolidation(e.id)) {
        await consolidateWing(e.id);
      }
    }
  } catch (e: any) {
    console.warn(`⚠️ Memory consolidateAll fehlgeschlagen: ${e.message}`);
  }
}

// Issue Dependencies — Blocking-Graph für Task-Orchestrierung
// Tasks können andere Tasks blockieren. Blockierte Tasks werden nicht ausgeführt.

import { db } from '../db/client.js';
import { issueRelations, tasks } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

/**
 * Erstellt eine Blocking-Beziehung: sourceId blockiert zielId.
 * zielId kann erst bearbeitet werden wenn sourceId 'done' ist.
 */
export function erstelleAbhaengigkeit(
  sourceId: string,
  zielId: string,
  erstelltVon?: string
): { success: boolean; error?: string } {
  // Prüfe ob beide Aufgaben existieren
  const quell = db.select().from(tasks).where(eq(tasks.id, sourceId)).get();
  const ziel = db.select().from(tasks).where(eq(tasks.id, zielId)).get();
  if (!quell) return { success: false, error: `Aufgabe ${sourceId} nicht gefunden` };
  if (!ziel) return { success: false, error: `Aufgabe ${zielId} nicht gefunden` };

  // Zirkuläre Abhängigkeit prüfen
  if (hatAbhaengigkeitAuf(zielId, sourceId)) {
    return { success: false, error: 'Zirkuläre Abhängigkeit erkannt' };
  }

  // Bereits vorhanden?
  const existierend = db.select().from(issueRelations)
    .where(and(eq(issueRelations.sourceId, sourceId), eq(issueRelations.targetId, zielId)))
    .get();
  if (existierend) return { success: true }; // Idempotent

  db.insert(issueRelations).values({
    id: uuid(),
    sourceId,
    targetId: zielId,
    type: 'blocks',
    createdBy: erstelltVon || null,
    createdAt: new Date().toISOString(),
  }).run();

  // Ziel-Aufgabe als 'blocked' markieren wenn der Blocker nicht done ist
  if (quell.status !== 'done') {
    db.update(tasks).set({ status: 'blocked', updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, zielId)).run();
  }

  return { success: true };
}

/**
 * Entfernt eine Blocking-Beziehung.
 */
export function entferneAbhaengigkeit(sourceId: string, zielId: string): void {
  db.delete(issueRelations)
    .where(and(eq(issueRelations.sourceId, sourceId), eq(issueRelations.targetId, zielId)))
    .run();

  // Prüfe ob das Ziel noch andere Blocker hat
  pruefeUndEntblocke(zielId);
}

/**
 * Gibt alle Blocker für eine Aufgabe zurück.
 */
export function getBlocker(aufgabeId: string): Array<{ id: string; titel: string; status: string }> {
  const relations = db.select().from(issueRelations)
    .where(eq(issueRelations.targetId, aufgabeId))
    .all();

  return relations.map(r => {
    const task = db.select().from(tasks).where(eq(tasks.id, r.sourceId)).get();
    return { id: r.sourceId, titel: task?.title || '?', status: task?.status || '?' };
  });
}

/**
 * Gibt alle Tasks zurück die von dieser Aufgabe blockiert werden.
 */
export function getBlockiert(aufgabeId: string): Array<{ id: string; titel: string; status: string }> {
  const relations = db.select().from(issueRelations)
    .where(eq(issueRelations.sourceId, aufgabeId))
    .all();

  return relations.map(r => {
    const task = db.select().from(tasks).where(eq(tasks.id, r.goalId)).get();
    return { id: r.goalId, titel: task?.title || '?', status: task?.status || '?' };
  });
}

/**
 * Prüft ob eine Aufgabe (transitiv) von einer anderen abhängt.
 * Wird für Zirkuläre-Abhängigkeits-Check genutzt.
 */
function hatAbhaengigkeitAuf(vonId: string, aufId: string, besucht = new Set<string>()): boolean {
  if (vonId === aufId) return true;
  if (besucht.has(vonId)) return false;
  besucht.add(vonId);

  const blocker = db.select().from(issueRelations)
    .where(eq(issueRelations.targetId, vonId))
    .all();

  for (const rel of blocker) {
    if (hatAbhaengigkeitAuf(rel.sourceId, aufId, besucht)) return true;
  }
  return false;
}

/**
 * Prüft ob eine blockierte Aufgabe entblockt werden kann (alle Blocker done).
 * Wird aufgerufen wenn ein Task auf 'done' gesetzt wird.
 */
export function pruefeUndEntblocke(aufgabeId: string): string[] {
  const entblockt: string[] = [];

  // Finde alle Tasks die von dieser Aufgabe blockiert werden
  const blockiert = db.select().from(issueRelations)
    .where(eq(issueRelations.sourceId, aufgabeId))
    .all();

  for (const rel of blockiert) {
    // Prüfe ob ALLE Blocker des Ziels done sind
    const alleBlocker = db.select().from(issueRelations)
      .where(eq(issueRelations.targetId, rel.goalId))
      .all();

    const alleErledigt = alleBlocker.every(b => {
      const task = db.select().from(tasks).where(eq(tasks.id, b.sourceId)).get();
      return task?.status === 'done';
    });

    if (alleErledigt) {
      const ziel = db.select().from(tasks).where(eq(tasks.id, rel.goalId)).get();
      if (ziel?.status === 'blocked') {
        db.update(tasks).set({ status: 'todo', updatedAt: new Date().toISOString() })
          .where(eq(tasks.id, rel.goalId)).run();
        entblockt.push(rel.goalId);
        console.log(`🔓 Task "${ziel.title}" entblockt (alle Dependencies erledigt)`);
      }
    }
  }

  return entblockt;
}

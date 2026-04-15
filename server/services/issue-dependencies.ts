// Issue Dependencies — Blocking-Graph für Task-Orchestrierung
// Tasks können andere Tasks blockieren. Blockierte Tasks werden nicht ausgeführt.

import { db } from '../db/client.js';
import { issueRelations, aufgaben } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

/**
 * Erstellt eine Blocking-Beziehung: quellId blockiert zielId.
 * zielId kann erst bearbeitet werden wenn quellId 'done' ist.
 */
export function erstelleAbhaengigkeit(
  quellId: string,
  zielId: string,
  erstelltVon?: string
): { success: boolean; error?: string } {
  // Prüfe ob beide Aufgaben existieren
  const quell = db.select().from(aufgaben).where(eq(aufgaben.id, quellId)).get();
  const ziel = db.select().from(aufgaben).where(eq(aufgaben.id, zielId)).get();
  if (!quell) return { success: false, error: `Aufgabe ${quellId} nicht gefunden` };
  if (!ziel) return { success: false, error: `Aufgabe ${zielId} nicht gefunden` };

  // Zirkuläre Abhängigkeit prüfen
  if (hatAbhaengigkeitAuf(zielId, quellId)) {
    return { success: false, error: 'Zirkuläre Abhängigkeit erkannt' };
  }

  // Bereits vorhanden?
  const existierend = db.select().from(issueRelations)
    .where(and(eq(issueRelations.quellId, quellId), eq(issueRelations.zielId, zielId)))
    .get();
  if (existierend) return { success: true }; // Idempotent

  db.insert(issueRelations).values({
    id: uuid(),
    quellId,
    zielId,
    typ: 'blocks',
    erstelltVon: erstelltVon || null,
    erstelltAm: new Date().toISOString(),
  }).run();

  // Ziel-Aufgabe als 'blocked' markieren wenn der Blocker nicht done ist
  if (quell.status !== 'done') {
    db.update(aufgaben).set({ status: 'blocked', aktualisiertAm: new Date().toISOString() })
      .where(eq(aufgaben.id, zielId)).run();
  }

  return { success: true };
}

/**
 * Entfernt eine Blocking-Beziehung.
 */
export function entferneAbhaengigkeit(quellId: string, zielId: string): void {
  db.delete(issueRelations)
    .where(and(eq(issueRelations.quellId, quellId), eq(issueRelations.zielId, zielId)))
    .run();

  // Prüfe ob das Ziel noch andere Blocker hat
  pruefeUndEntblocke(zielId);
}

/**
 * Gibt alle Blocker für eine Aufgabe zurück.
 */
export function getBlocker(aufgabeId: string): Array<{ id: string; titel: string; status: string }> {
  const relations = db.select().from(issueRelations)
    .where(eq(issueRelations.zielId, aufgabeId))
    .all();

  return relations.map(r => {
    const task = db.select().from(aufgaben).where(eq(aufgaben.id, r.quellId)).get();
    return { id: r.quellId, titel: task?.titel || '?', status: task?.status || '?' };
  });
}

/**
 * Gibt alle Tasks zurück die von dieser Aufgabe blockiert werden.
 */
export function getBlockiert(aufgabeId: string): Array<{ id: string; titel: string; status: string }> {
  const relations = db.select().from(issueRelations)
    .where(eq(issueRelations.quellId, aufgabeId))
    .all();

  return relations.map(r => {
    const task = db.select().from(aufgaben).where(eq(aufgaben.id, r.zielId)).get();
    return { id: r.zielId, titel: task?.titel || '?', status: task?.status || '?' };
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
    .where(eq(issueRelations.zielId, vonId))
    .all();

  for (const rel of blocker) {
    if (hatAbhaengigkeitAuf(rel.quellId, aufId, besucht)) return true;
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
    .where(eq(issueRelations.quellId, aufgabeId))
    .all();

  for (const rel of blockiert) {
    // Prüfe ob ALLE Blocker des Ziels done sind
    const alleBlocker = db.select().from(issueRelations)
      .where(eq(issueRelations.zielId, rel.zielId))
      .all();

    const alleErledigt = alleBlocker.every(b => {
      const task = db.select().from(aufgaben).where(eq(aufgaben.id, b.quellId)).get();
      return task?.status === 'done';
    });

    if (alleErledigt) {
      const ziel = db.select().from(aufgaben).where(eq(aufgaben.id, rel.zielId)).get();
      if (ziel?.status === 'blocked') {
        db.update(aufgaben).set({ status: 'todo', aktualisiertAm: new Date().toISOString() })
          .where(eq(aufgaben.id, rel.zielId)).run();
        entblockt.push(rel.zielId);
        console.log(`🔓 Task "${ziel.titel}" entblockt (alle Dependencies erledigt)`);
      }
    }
  }

  return entblockt;
}

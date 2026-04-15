// Learning Loop Service
// "Closed Learning Loop" — Generiert und verbessert Skills autonom aus Erfahrung
//
// Ablauf:
// 1. Nach erfolgreichem Task: analysiere Output auf wiederverwendbare Patterns
// 2. Erstelle oder aktualisiere Skills in der skillsLibrary
// 3. Konfidenz steigt bei Erfolg, sinkt bei Fehlern
// 4. Skills unter dem Deprecation-Threshold werden automatisch entfernt

import { db } from '../db/client.js';
import { skillsLibrary, expertenSkills, experten } from '../db/schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// ─── Konfiguration ──────────────────────────────────────────────────────────

const KONFIDENZ_ERFOLG_BONUS = 8;    // +8 bei erfolgreichem Einsatz
const KONFIDENZ_FEHLER_MALUS = 15;   // -15 bei Fehler
const KONFIDENZ_DEPRECATION = 10;    // Unter 10 → automatisch entfernt
const MIN_SKILL_LAENGE = 100;        // Mindestlänge für extrahierte Skills
const MAX_AUTO_SKILLS_PRO_AGENT = 20; // Maximal 20 auto-generierte Skills pro Agent

// ─── Skill-Extraktion ───────────────────────────────────────────────────────

interface ExtrahierterSkill {
  name: string;
  beschreibung: string;
  inhalt: string;
  tags: string[];
}

/**
 * Extrahiert wiederverwendbare Patterns aus einem Agent-Output.
 * Sucht nach expliziten Skill-Tags ODER erkennt strukturierte Lösungen.
 */
export function extrahiereSkills(agentOutput: string, taskTitel: string): ExtrahierterSkill[] {
  const skills: ExtrahierterSkill[] = [];

  // Methode 1: Explizite [SKILL:name]...[/SKILL:name] Tags
  const skillTagRegex = /\[SKILL:([^\]]+)\]([\s\S]*?)\[\/SKILL:\1\]/gi;
  let match;
  while ((match = skillTagRegex.exec(agentOutput)) !== null) {
    const name = match[1].trim();
    const inhalt = match[2].trim();
    if (inhalt.length >= MIN_SKILL_LAENGE) {
      skills.push({
        name,
        beschreibung: `Auto-generiert aus Task: ${taskTitel}`,
        inhalt,
        tags: extrahiereTags(inhalt, name),
      });
    }
  }

  // Methode 2: Strukturierte Code-Blöcke mit Erklärung (heuristisch)
  // Sucht nach Markdown-Headings gefolgt von Code-Blöcken
  if (skills.length === 0) {
    const codeBlockRegex = /###\s+(.+)\n([\s\S]*?```[\s\S]*?```[\s\S]*?)(?=###|\z)/g;
    while ((match = codeBlockRegex.exec(agentOutput)) !== null) {
      const name = match[1].trim();
      const inhalt = match[2].trim();
      if (inhalt.length >= MIN_SKILL_LAENGE && inhalt.includes('```')) {
        skills.push({
          name: `${name} (${taskTitel.slice(0, 30)})`,
          beschreibung: `Pattern extrahiert aus: ${taskTitel}`,
          inhalt,
          tags: extrahiereTags(inhalt, name),
        });
      }
    }
  }

  return skills;
}

/**
 * Extrahiert relevante Tags aus einem Skill-Inhalt.
 */
function extrahiereTags(inhalt: string, name: string): string[] {
  const tags: string[] = [];
  const text = `${name} ${inhalt}`.toLowerCase();

  // Technologie-Keywords
  const techKeywords = [
    'typescript', 'javascript', 'python', 'react', 'node', 'express',
    'sql', 'sqlite', 'api', 'rest', 'graphql', 'docker', 'git',
    'css', 'tailwind', 'html', 'testing', 'jest', 'vitest',
    'security', 'auth', 'deploy', 'ci', 'cd', 'websocket',
  ];
  for (const kw of techKeywords) {
    if (text.includes(kw)) tags.push(kw);
  }

  // Kategorie-Keywords
  if (text.match(/bug|fix|fehler|error|debug/)) tags.push('bugfix');
  if (text.match(/refactor|cleanup|aufräum/)) tags.push('refactoring');
  if (text.match(/feature|neu|implement/)) tags.push('feature');
  if (text.match(/test|spec|assert/)) tags.push('testing');
  if (text.match(/deploy|release|build/)) tags.push('devops');
  if (text.match(/design|ui|ux|style|layout/)) tags.push('design');

  return [...new Set(tags)].slice(0, 8);
}

// ─── Konfidenz-Management ───────────────────────────────────────────────────

/**
 * Aktualisiert die Konfidenz eines Skills nach Nutzung.
 */
export function aktualisiereKonfidenz(skillId: string, erfolgreich: boolean): void {
  const skill = db.select().from(skillsLibrary).where(eq(skillsLibrary.id, skillId)).get();
  if (!skill) return;

  const delta = erfolgreich ? KONFIDENZ_ERFOLG_BONUS : -KONFIDENZ_FEHLER_MALUS;
  const neueKonfidenz = Math.max(0, Math.min(100, skill.konfidenz + delta));
  const neueNutzungen = skill.nutzungen + 1;
  const neueErfolge = skill.erfolge + (erfolgreich ? 1 : 0);

  db.update(skillsLibrary).set({
    konfidenz: neueKonfidenz,
    nutzungen: neueNutzungen,
    erfolge: neueErfolge,
    aktualisiertAm: new Date().toISOString(),
  }).where(eq(skillsLibrary.id, skillId)).run();

  console.log(`🧬 Learning Loop: Skill "${skill.name}" Konfidenz ${skill.konfidenz} → ${neueKonfidenz} (${erfolgreich ? 'Erfolg' : 'Fehler'})`);
}

/**
 * Entfernt alle Skills die unter den Deprecation-Threshold gefallen sind.
 * Gibt die Anzahl entfernter Skills zurück.
 */
export function deprecateSchlechteSkills(unternehmenId: string): number {
  const zuEntfernen = db.select().from(skillsLibrary)
    .where(and(
      eq(skillsLibrary.unternehmenId, unternehmenId),
      eq(skillsLibrary.quelle, 'learning-loop'),
      lt(skillsLibrary.konfidenz, KONFIDENZ_DEPRECATION),
    ))
    .all();

  for (const skill of zuEntfernen) {
    // Zuerst Zuweisungen entfernen
    db.delete(expertenSkills).where(eq(expertenSkills.skillId, skill.id)).run();
    // Dann den Skill selbst
    db.delete(skillsLibrary).where(eq(skillsLibrary.id, skill.id)).run();
    console.log(`🗑️ Learning Loop: Skill "${skill.name}" deprecated (Konfidenz: ${skill.konfidenz})`);
  }

  return zuEntfernen.length;
}

// ─── Haupt-Hook (wird nach erfolgreichem Zyklus aufgerufen) ─────────────────

/**
 * Verarbeitet einen erfolgreich abgeschlossenen Agent-Zyklus.
 * Extrahiert Skills, aktualisiert Konfidenz, räumt auf.
 */
export function nachZyklusVerarbeitung(
  expertId: string,
  unternehmenId: string,
  taskTitel: string,
  agentOutput: string,
  erfolg: boolean,
): { neueSkills: number; aktualisiertSkills: number; deprecatedSkills: number } {
  const ergebnis = { neueSkills: 0, aktualisiertSkills: 0, deprecatedSkills: 0 };

  // 1. Konfidenz aller genutzten Skills aktualisieren
  const genutzteSkills = db.select({ skill: skillsLibrary }).from(expertenSkills)
    .innerJoin(skillsLibrary, eq(expertenSkills.skillId, skillsLibrary.id))
    .where(eq(expertenSkills.expertId, expertId))
    .all()
    .map((r: any) => r.skill);

  for (const skill of genutzteSkills) {
    // Prüfe ob der Skill-Inhalt relevant war (einfache Heuristik: wurde der Skill-Name im Output erwähnt?)
    const wurdeGenutzt = agentOutput.toLowerCase().includes(skill.name.toLowerCase()) ||
                          skill.tags && JSON.parse(skill.tags || '[]').some((t: string) => agentOutput.toLowerCase().includes(t));
    if (wurdeGenutzt) {
      aktualisiereKonfidenz(skill.id, erfolg);
      ergebnis.aktualisiertSkills++;
    }
  }

  // 2. Neue Skills extrahieren (nur bei Erfolg)
  if (erfolg) {
    const neueSkills = extrahiereSkills(agentOutput, taskTitel);

    // Prüfe Limit
    const bestehendeAutoSkills = db.select().from(skillsLibrary)
      .where(and(
        eq(skillsLibrary.unternehmenId, unternehmenId),
        eq(skillsLibrary.quelle, 'learning-loop'),
      ))
      .all();

    const verfuegbarePlätze = MAX_AUTO_SKILLS_PRO_AGENT - bestehendeAutoSkills.length;

    for (const skill of neueSkills.slice(0, Math.max(0, verfuegbarePlätze))) {
      // Duplikat-Check: Gibt es schon einen Skill mit ähnlichem Namen?
      const existiert = bestehendeAutoSkills.find(s =>
        s.name.toLowerCase() === skill.name.toLowerCase()
      );

      if (existiert) {
        // Update: Inhalt zusammenführen, Konfidenz leicht erhöhen
        const neuerInhalt = existiert.inhalt + '\n\n---\n\n' + skill.inhalt;
        db.update(skillsLibrary).set({
          inhalt: neuerInhalt.slice(0, 5000), // Max 5k Zeichen
          konfidenz: Math.min(100, existiert.konfidenz + 3),
          aktualisiertAm: new Date().toISOString(),
        }).where(eq(skillsLibrary.id, existiert.id)).run();
        ergebnis.aktualisiertSkills++;
      } else {
        // Neuen Skill erstellen
        const skillId = uuid();
        db.insert(skillsLibrary).values({
          id: skillId,
          unternehmenId,
          name: skill.name,
          beschreibung: skill.beschreibung,
          inhalt: skill.inhalt.slice(0, 5000),
          tags: JSON.stringify(skill.tags),
          erstelltVon: 'learning-loop',
          konfidenz: 50,
          nutzungen: 0,
          erfolge: 0,
          quelle: 'learning-loop',
          erstelltAm: new Date().toISOString(),
          aktualisiertAm: new Date().toISOString(),
        }).run();

        // Skill dem Agenten zuweisen
        db.insert(expertenSkills).values({
          id: uuid(),
          expertId,
          skillId,
          erstelltAm: new Date().toISOString(),
        }).run();

        ergebnis.neueSkills++;
        console.log(`🧬 Learning Loop: Neuer Skill "${skill.name}" generiert (Tags: ${skill.tags.join(', ')})`);
      }
    }
  }

  // 3. Schlechte Skills aufräumen
  ergebnis.deprecatedSkills = deprecateSchlechteSkills(unternehmenId);

  return ergebnis;
}

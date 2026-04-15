// Execution Workspaces — Isolierte Arbeitsumgebungen pro Task
// Jeder Task bekommt sein eigenes Verzeichnis. Optional Git-Branch-Isolation.

import { db } from '../db/client.js';
import { executionWorkspaces, aufgaben, unternehmen } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Erstellt einen neuen isolierten Workspace für eine Aufgabe.
 * Gibt den Workspace-Pfad zurück.
 */
export function erstelleWorkspace(
  unternehmenId: string,
  aufgabeId: string,
  expertId: string,
  basePfad?: string
): { id: string; pfad: string } {
  const now = new Date().toISOString();
  const wsId = uuid();

  // Basis-Pfad ermitteln (Company workDir oder Fallback)
  const company = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();
  const base = basePfad || company?.workDir || path.join(process.cwd(), 'workspaces');

  // Workspace-Verzeichnis erstellen
  const wsDir = path.join(base, '.opencognit-workspaces', aufgabeId.slice(0, 8));

  if (!fs.existsSync(wsDir)) {
    fs.mkdirSync(wsDir, { recursive: true });
  }

  // Git-Branch erstellen wenn das Basis-Verzeichnis ein Git-Repo ist
  let branchName: string | null = null;
  try {
    const gitDir = execSync('git rev-parse --git-dir', { cwd: base, encoding: 'utf8' }).trim();
    if (gitDir) {
      branchName = `opencognit/task-${aufgabeId.slice(0, 8)}`;
      try {
        execSync(`git checkout -b ${branchName}`, { cwd: base, encoding: 'utf8' });
      } catch {
        // Branch existiert schon — checkout
        try { execSync(`git checkout ${branchName}`, { cwd: base, encoding: 'utf8' }); } catch {}
      }
    }
  } catch {
    // Kein Git-Repo — kein Branch
  }

  db.insert(executionWorkspaces).values({
    id: wsId,
    unternehmenId,
    aufgabeId,
    expertId,
    pfad: wsDir,
    branchName,
    basePfad: base,
    status: 'offen',
    geoeffnetAm: now,
    erstelltAm: now,
  }).run();

  // Workspace-Pfad auch in der Aufgabe setzen
  db.update(aufgaben).set({ workspacePath: wsDir }).where(eq(aufgaben.id, aufgabeId)).run();

  console.log(`📁 Workspace erstellt: ${wsDir} (Branch: ${branchName || 'none'})`);
  return { id: wsId, pfad: wsDir };
}

/**
 * Schließt einen Workspace (Agent ist fertig).
 */
export function schliesseWorkspace(workspaceId: string): void {
  const now = new Date().toISOString();
  db.update(executionWorkspaces).set({
    status: 'geschlossen',
    geschlossenAm: now,
  }).where(eq(executionWorkspaces.id, workspaceId)).run();
}

/**
 * Räumt einen geschlossenen Workspace auf (Verzeichnis löschen).
 */
export function raeumeWorkspaceAuf(workspaceId: string): void {
  const ws = db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)).get();
  if (!ws || ws.status !== 'geschlossen') return;

  // Git-Branch löschen wenn vorhanden
  if (ws.branchName && ws.basePfad) {
    try {
      execSync(`git checkout main 2>/dev/null || git checkout master`, { cwd: ws.basePfad, encoding: 'utf8' });
      execSync(`git branch -d ${ws.branchName}`, { cwd: ws.basePfad, encoding: 'utf8' });
    } catch { /* Branch war schon weg */ }
  }

  const now = new Date().toISOString();
  db.update(executionWorkspaces).set({
    status: 'aufgeraeumt',
    aufgeraeumtAm: now,
  }).where(eq(executionWorkspaces.id, workspaceId)).run();
}

/**
 * Gibt den aktiven Workspace für eine Aufgabe zurück (wenn vorhanden).
 */
export function getAktiverWorkspace(aufgabeId: string) {
  return db.select().from(executionWorkspaces)
    .where(and(
      eq(executionWorkspaces.aufgabeId, aufgabeId),
      eq(executionWorkspaces.status, 'offen')
    ))
    .get() || db.select().from(executionWorkspaces)
    .where(and(
      eq(executionWorkspaces.aufgabeId, aufgabeId),
      eq(executionWorkspaces.status, 'aktiv')
    ))
    .get();
}

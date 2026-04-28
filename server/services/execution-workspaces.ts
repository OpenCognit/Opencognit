// Execution Workspaces — Isolierte Arbeitsumgebungen pro Task
//
// Jeder Task bekommt sein eigenes Verzeichnis. Wenn der Basis-Pfad ein Git-Repo
// ist, wird ein echter `git worktree` angelegt — damit können mehrere Agenten
// parallel am selben Repo arbeiten, ohne dass sich ihre Branches überschreiben.

import { db } from '../db/client.js';
import { executionWorkspaces, tasks, companies } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function isGitRepo(dir: string): boolean {
  try {
    const result = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return !!result;
  } catch {
    return false;
  }
}

function detectDefaultBranch(repoDir: string): string {
  try {
    const head = execSync('git symbolic-ref --short refs/remotes/origin/HEAD', { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (head) return head.replace(/^origin\//, '');
  } catch { /* fallthrough */ }
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, { cwd: repoDir, stdio: 'ignore' });
      return candidate;
    } catch { /* try next */ }
  }
  return 'main';
}

/**
 * Erstellt einen neuen isolierten Workspace für eine Aufgabe.
 * Nutzt `git worktree add`, wenn basePfad ein Git-Repo ist — sonst einfaches Verzeichnis.
 */
export function erstelleWorkspace(
  unternehmenId: string,
  aufgabeId: string,
  expertId: string,
  basePfad?: string
): { id: string; pfad: string; branchName: string | null; isolation: 'worktree' | 'directory' } {
  const now = new Date().toISOString();
  const wsId = uuid();

  const company = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
  const base = basePfad || company?.workDir || path.join(process.cwd(), 'workspaces');

  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });

  const shortId = aufgabeId.slice(0, 8);
  let wsDir: string;
  let branchName: string | null = null;
  let isolation: 'worktree' | 'directory' = 'directory';

  if (isGitRepo(base)) {
    // Worktree-Isolation: eigener Branch + eigenes Arbeitsverzeichnis neben dem Repo.
    const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: base, encoding: 'utf8' }).trim();
    const parentDir = path.dirname(repoRoot);
    const repoName = path.basename(repoRoot);
    const worktreesRoot = path.join(parentDir, `.${repoName}-worktrees`);
    if (!fs.existsSync(worktreesRoot)) fs.mkdirSync(worktreesRoot, { recursive: true });

    wsDir = path.join(worktreesRoot, `task-${shortId}`);
    branchName = `opencognit/task-${shortId}`;

    // Wenn ein altes Verzeichnis rumliegt (verwaister Worktree), prunen und neu anlegen.
    if (fs.existsSync(wsDir)) {
      try { execSync(`git worktree remove --force "${wsDir}"`, { cwd: repoRoot, stdio: 'ignore' }); } catch { /* ignore */ }
      try { fs.rmSync(wsDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    const defaultBranch = detectDefaultBranch(repoRoot);
    try {
      execSync(`git worktree add -b "${branchName}" "${wsDir}" "${defaultBranch}"`, { cwd: repoRoot, stdio: 'pipe' });
      isolation = 'worktree';
    } catch (err: any) {
      // Branch existiert schon → checkout ohne -b.
      try {
        execSync(`git worktree add "${wsDir}" "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' });
        isolation = 'worktree';
      } catch (err2: any) {
        console.warn(`⚠️ git worktree add fehlgeschlagen — falle auf plain directory zurück: ${err2?.message || err?.message}`);
        if (!fs.existsSync(wsDir)) fs.mkdirSync(wsDir, { recursive: true });
        branchName = null;
      }
    }
  } else {
    // Kein Git-Repo → einfaches isoliertes Verzeichnis.
    wsDir = path.join(base, '.opencognit-workspaces', shortId);
    if (!fs.existsSync(wsDir)) fs.mkdirSync(wsDir, { recursive: true });
  }

  db.insert(executionWorkspaces).values({
    id: wsId,
    companyId: unternehmenId,
    taskId: aufgabeId,
    agentId: expertId,
    pfad: wsDir,
    branchName,
    basePfad: base,
    status: 'offen',
    metadata: JSON.stringify({ isolation }),
    geoeffnetAm: now,
    createdAt: now,
  }).run();

  db.update(tasks).set({ workspacePath: wsDir }).where(eq(tasks.id, aufgabeId)).run();

  console.log(`📁 Workspace [${isolation}] erstellt: ${wsDir}${branchName ? ` (Branch: ${branchName})` : ''}`);
  return { id: wsId, pfad: wsDir, branchName, isolation };
}

/**
 * Findet oder erstellt den Workspace für eine Aufgabe (idempotent).
 * Wird vom Heartbeat vor der Adapter-Ausführung aufgerufen.
 */
export function ensureWorkspace(
  unternehmenId: string,
  aufgabeId: string,
  expertId: string,
  basePfad?: string
): { id: string; pfad: string; branchName: string | null } {
  const existing = getAktiverWorkspace(aufgabeId);
  if (existing) {
    return { id: existing.id, pfad: existing.pfad, branchName: existing.branchName };
  }
  const created = erstelleWorkspace(unternehmenId, aufgabeId, expertId, basePfad);
  return { id: created.id, pfad: created.pfad, branchName: created.branchName };
}

/**
 * Schließt einen Workspace (Agent ist fertig) — räumt aber noch nichts auf,
 * damit der User die Änderungen reviewen kann.
 */
export function schliesseWorkspace(workspaceId: string): void {
  const now = new Date().toISOString();
  db.update(executionWorkspaces).set({
    status: 'geschlossen',
    geschlossenAm: now,
  }).where(eq(executionWorkspaces.id, workspaceId)).run();
}

/**
 * Räumt einen geschlossenen Workspace auf (Verzeichnis + Branch entfernen).
 * Bei Worktrees wird `git worktree remove` genutzt, damit Git konsistent bleibt.
 */
export function raeumeWorkspaceAuf(workspaceId: string, force = false): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const ws = db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, workspaceId)).get();
  if (!ws) return { ok: false, warnings: ['workspace nicht gefunden'] };
  if (!force && ws.status !== 'geschlossen') {
    return { ok: false, warnings: ['Workspace ist noch aktiv. Erst schließen oder force=true verwenden.'] };
  }

  const meta = ws.metadaten ? safeParse(ws.metadaten) : {};
  const isWorktree = meta?.isolation === 'worktree' && ws.basePfad;

  if (isWorktree) {
    try {
      const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: ws.basePfad!, encoding: 'utf8' }).trim();
      execSync(`git worktree remove ${force ? '--force ' : ''}"${ws.pfad}"`, { cwd: repoRoot, stdio: 'pipe' });
    } catch (err: any) {
      warnings.push(`git worktree remove fehlgeschlagen: ${err?.message}`);
      // Fallback: Verzeichnis manuell löschen
      try { fs.rmSync(ws.pfad, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (ws.branchName && ws.basePfad) {
      try {
        execSync(`git branch -D "${ws.branchName}"`, { cwd: ws.basePfad, stdio: 'pipe' });
      } catch (err: any) {
        warnings.push(`Branch-Löschung fehlgeschlagen: ${err?.message}`);
      }
    }
  } else {
    try { fs.rmSync(ws.pfad, { recursive: true, force: true }); } catch (err: any) {
      warnings.push(`rm -rf fehlgeschlagen: ${err?.message}`);
    }
  }

  const now = new Date().toISOString();
  db.update(executionWorkspaces).set({
    status: 'aufgeraeumt',
    aufgeraeumtAm: now,
  }).where(eq(executionWorkspaces.id, workspaceId)).run();

  return { ok: true, warnings };
}

/**
 * Listet alle Workspaces eines Unternehmens (für UI).
 */
export function listeWorkspaces(unternehmenId: string) {
  return db.select().from(executionWorkspaces)
    .where(eq(executionWorkspaces.companyId, unternehmenId))
    .all();
}

/**
 * Gibt den aktiven Workspace für eine Aufgabe zurück (wenn vorhanden).
 */
export function getAktiverWorkspace(aufgabeId: string) {
  return db.select().from(executionWorkspaces)
    .where(and(
      eq(executionWorkspaces.taskId, aufgabeId),
      eq(executionWorkspaces.status, 'offen')
    ))
    .get() || db.select().from(executionWorkspaces)
    .where(and(
      eq(executionWorkspaces.taskId, aufgabeId),
      eq(executionWorkspaces.status, 'aktiv')
    ))
    .get();
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

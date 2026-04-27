/**
 * Execution Workspace Service
 *
 * Gibt jedem Task ein eigenes, isoliertes Arbeitsverzeichnis.
 * Agents schreiben Dateien dort hinein — kein gegenseitiges Überschreiben.
 *
 * Struktur:
 *   data/workspaces/{taskId}/          ← Task-Workspace
 *     .meta.json                       ← Metadata (expertId, runId, erstelltAm)
 *     <agent output files>             ← Was der Agent produziert
 */

import fs from 'fs';
import path from 'path';

const WORKSPACES_ROOT = path.join(process.cwd(), 'data', 'workspaces');

export interface WorkspaceInfo {
  taskId: string;
  path: string;
  exists: boolean;
  files: WorkspaceFile[];
  sizeBytes: number;
  erstelltAm: string | null;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  sizeBytes: number;
  mimeTyp: string;
  isDirectory: boolean;
  erstelltAm: string;
}

function ensureRoot() {
  if (!fs.existsSync(WORKSPACES_ROOT)) {
    fs.mkdirSync(WORKSPACES_ROOT, { recursive: true });
  }
}

/**
 * Creates (or returns existing) workspace for a task.
 * Returns the absolute path.
 */
export function createWorkspace(taskId: string, expertId: string, runId: string): string {
  ensureRoot();
  const wsPath = path.join(WORKSPACES_ROOT, taskId);

  if (!fs.existsSync(wsPath)) {
    fs.mkdirSync(wsPath, { recursive: true });

    // Write metadata
    fs.writeFileSync(
      path.join(wsPath, '.meta.json'),
      JSON.stringify({ taskId, expertId, runId, erstelltAm: new Date().toISOString() }, null, 2)
    );
  }

  return wsPath;
}

/**
 * Returns the path for a task workspace (may not exist yet).
 */
export function getWorkspacePath(taskId: string): string {
  return path.join(WORKSPACES_ROOT, taskId);
}

/**
 * Lists all files in a workspace (non-recursive, skips .meta.json).
 */
export function listWorkspaceFiles(taskId: string): WorkspaceFile[] {
  const wsPath = path.join(WORKSPACES_ROOT, taskId);
  if (!fs.existsSync(wsPath)) return [];

  const files: WorkspaceFile[] = [];

  function scanDir(dir: string, relative = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.meta.json') continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.statSync(fullPath);

      if (entry.isDirectory()) {
        files.push({
          name: relPath,
          path: fullPath,
          sizeBytes: 0,
          mimeTyp: 'directory',
          isDirectory: true,
          erstelltAm: stat.birthtime.toISOString(),
        });
        scanDir(fullPath, relPath); // recursive
      } else {
        files.push({
          name: relPath,
          path: fullPath,
          sizeBytes: stat.size,
          mimeTyp: guessMimeType(entry.name),
          isDirectory: false,
          erstelltAm: stat.birthtime.toISOString(),
        });
      }
    }
  }

  scanDir(wsPath);
  return files;
}

/**
 * Returns workspace metadata + file listing.
 */
export function getWorkspaceInfo(taskId: string): WorkspaceInfo {
  const wsPath = path.join(WORKSPACES_ROOT, taskId);
  const exists = fs.existsSync(wsPath);

  if (!exists) {
    return { taskId, path: wsPath, exists: false, files: [], sizeBytes: 0, erstelltAm: null };
  }

  const files = listWorkspaceFiles(taskId);
  const sizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  let erstelltAm: string | null = null;
  const metaFile = path.join(wsPath, '.meta.json');
  if (fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      erstelltAm = meta.createdAt || null;
    } catch { /* ignore */ }
  }

  return { taskId, path: wsPath, exists: true, files, sizeBytes, erstelltAm };
}

/**
 * Reads a file from the workspace. Returns null if not found.
 */
export function readWorkspaceFile(taskId: string, filename: string): string | null {
  const filePath = path.join(WORKSPACES_ROOT, taskId, filename);
  // Security: ensure path stays within workspace
  const resolved = path.resolve(filePath);
  const wsResolved = path.resolve(path.join(WORKSPACES_ROOT, taskId));
  if (!resolved.startsWith(wsResolved)) return null;

  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Removes a workspace directory entirely.
 * Only call when task is cancelled or explicitly cleaned up.
 */
export function deleteWorkspace(taskId: string): void {
  const wsPath = path.join(WORKSPACES_ROOT, taskId);
  if (fs.existsSync(wsPath)) {
    fs.rmSync(wsPath, { recursive: true, force: true });
  }
}

// ─── MIME type guesser ───────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.sh': 'text/x-shellscript',
  '.py': 'text/x-python',
  '.html': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

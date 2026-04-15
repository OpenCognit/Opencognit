/**
 * Workspace Guard — Prevents agents from running inside the OpenCognit project directory.
 *
 * Root cause of the original bug: adapters fell back to process.cwd() (= project root)
 * when no workspacePath was configured, so agents would write files directly into the
 * OpenCognit source tree.
 *
 * Rules:
 *  - Any path OUTSIDE the project root is allowed.
 *  - Inside the project root, only data/workspaces/** and data/sessions/** are allowed.
 *  - Everything else (src/, server/, node_modules/, etc.) is forbidden.
 */

import path from 'path';
import fs from 'fs';

/** Absolute path to the OpenCognit project root (where server starts from) */
export const PROJECT_ROOT = path.resolve(process.cwd());

/** Safe fallback workspace when no workspacePath is provided by the caller */
export const SAFE_DEFAULT_WORKDIR = path.join(PROJECT_ROOT, 'data', 'workspaces', 'agent-default');

/** Subdirectories inside the project root that agents ARE allowed to use */
const ALLOWED_INTERNAL = [
  path.join(PROJECT_ROOT, 'data', 'workspaces'),
  path.join(PROJECT_ROOT, 'data', 'sessions'),
];

/**
 * Returns true if the given directory is a safe place for an agent to run.
 * Logs a warning and returns false if the path would land in the project root.
 */
export function isSafeWorkdir(dir: string): boolean {
  const resolved = path.resolve(dir);

  // Outside the project root → always safe (user's own project directories, etc.)
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    return true;
  }

  // Inside project root → only allowed subdirs are safe
  const safe = ALLOWED_INTERNAL.some(allowed => resolved.startsWith(allowed));
  if (!safe) {
    console.warn(
      `[WorkspaceGuard] ⛔ Blocked: agent workspace '${resolved}' is inside the OpenCognit project root. ` +
      `Agents must work in data/workspaces/ or an external directory. Falling back to safe default.`
    );
  }
  return safe;
}

/**
 * Resolves the effective working directory for an agent task.
 * Priority: config.workspacePath → fallback → SAFE_DEFAULT_WORKDIR
 * Guarantees the result is always a safe path.
 */
export function resolveAgentWorkdir(
  workspacePath: string | undefined | null,
  fallback?: string,
): string {
  const candidates = [workspacePath, fallback].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (isSafeWorkdir(candidate)) {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    }
  }

  // All candidates were unsafe — use the guaranteed-safe default
  fs.mkdirSync(SAFE_DEFAULT_WORKDIR, { recursive: true });
  return SAFE_DEFAULT_WORKDIR;
}

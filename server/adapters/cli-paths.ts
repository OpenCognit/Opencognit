// Global CLI path overrides — set via Settings UI or env vars.
// Adapters read from this map so paths can be changed at runtime
// without restarting the server.

const CLI_PATHS: Record<string, string> = {};

export function setCliPath(tool: string, path: string): void {
  if (path && path.trim()) {
    CLI_PATHS[tool] = path.trim();
  } else {
    delete CLI_PATHS[tool];
  }
}

export function getCliPath(tool: string): string | undefined {
  return CLI_PATHS[tool];
}

export function getAllCliPaths(): Record<string, string> {
  return { ...CLI_PATHS };
}

/** Resolves the effective binary path for a CLI tool.
 *  Priority: 1) runtime override, 2) env var, 3) default command name
 */
export function resolveCliPath(tool: string, envVar?: string, defaultCmd = tool): string {
  return getCliPath(tool) || (envVar ? process.env[envVar] : undefined) || defaultCmd;
}

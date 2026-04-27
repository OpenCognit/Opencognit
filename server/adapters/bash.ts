// Bash Adapter - Führt Shell-Kommandos aus (mit Sandbox-Isolation)
//
// Sicherheitsstufen (automatisch erkannt):
//   1. Docker    — Container mit --network none, read-only rootfs
//   2. systemd   — systemd-run mit Memory/CPU-Limits
//   3. exec      — Härtete child_process.exec mit erweiterten Prüfungen
//
// Für Produktion: Docker installieren und USE_DOCKER_SANDBOX=1 setzen.

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { db } from '../db/client.js';
import { agentPermissions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveAgentWorkdir, SAFE_DEFAULT_WORKDIR } from './workspace-guard.js';
import { runInSandbox } from './sandbox.js';

export interface BashAdapterOptions {
  allowedCommands?: string[];
  blockedCommands?: string[];
  workingDir?: string;
  maxExecutionTimeMs?: number;
}

export class BashAdapter implements Adapter {
  public readonly name = 'bash';
  private options: BashAdapterOptions & { workingDir: string; maxExecutionTimeMs: number };

  constructor(options: BashAdapterOptions = {}) {
    this.options = {
      allowedCommands: options.allowedCommands || [],
      blockedCommands: options.blockedCommands || [],
      workingDir: options.workingDir || SAFE_DEFAULT_WORKDIR,
      maxExecutionTimeMs: options.maxExecutionTimeMs || 5 * 60 * 1000, // 5 Minuten
    };
  }

  canHandle(task: AdapterTask): boolean {
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    return text.includes('bash') ||
           text.includes('shell') ||
           text.includes('command') ||
           text.includes('befehl') ||
           text.startsWith('führe ') ||
           text.startsWith('run ');
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    const command = this.extractCommand(task);

    if (!command) {
      return {
        success: false,
        output: 'Kein gültiges Kommando gefunden',
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'No command found in task',
      };
    }

    // Resolve a safe working directory — never falls back to project root
    const cwd = resolveAgentWorkdir(config.workspacePath, this.options.workingDir);

    // Agent permission check — erlaubtePfade (fail-closed)
    if (config.agentId) {
      const perms = db.select().from(agentPermissions)
        .where(eq(agentPermissions.agentId, config.agentId)).get();
      if (perms?.erlaubtePfade) {
        const allowed: string[] = JSON.parse(perms.erlaubtePfade);
        if (allowed.length > 0 && !allowed.some(p => cwd.startsWith(p))) {
          return {
            success: false,
            output: `Zugriff verweigert: Workspace '${cwd}' ist nicht in den erlaubten Pfaden`,
            exitCode: 1, inputTokens: 0, outputTokens: 0, costCents: 0,
            durationMs: Date.now() - startTime,
            error: 'Path not in agentPermissions.erlaubtePfade',
          };
        }
      }
    }

    // Execute through sandbox layer
    const result = await runInSandbox({
      command,
      cwd,
      timeoutMs: this.options.maxExecutionTimeMs,
      env: {
        OPENCOGNIT_EXPERT_ID: config.agentId,
        OPENCOGNIT_UNTERNEHMEN_ID: config.companyId,
        OPENCOGNIT_RUN_ID: config.runId,
        OPENCOGNIT_WORKSPACE: cwd,
      },
      blockedCommands: this.options.blockedCommands,
      allowedCommands: (this.options.allowedCommands ?? []).length > 0 ? this.options.allowedCommands : undefined,
      maxOutputSize: 10 * 1024 * 1024, // 10MB
    });

    return {
      success: result.success,
      output: result.output,
      exitCode: result.exitCode,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      durationMs: result.durationMs,
      error: result.error,
    };
  }

  private extractCommand(task: AdapterTask): string | null {
    const text = task.description || task.title;

    // Suche nach Code-Blöcken mit backticks
    const backtickMatch = text.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
    if (backtickMatch) {
      return backtickMatch[1].trim();
    }

    // Suche nach einzelnen Kommandos
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        return trimmed;
      }
    }

    return text.trim() || null;
  }
}

export const createBashAdapter = (options?: BashAdapterOptions) => new BashAdapter(options);

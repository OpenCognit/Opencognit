// Bash Adapter - Führt Shell-Kommandos aus

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/client.js';
import { agentPermissions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveAgentWorkdir, SAFE_DEFAULT_WORKDIR } from './workspace-guard.js';

const execAsync = promisify(exec);

export interface BashAdapterOptions {
  allowedCommands?: string[];
  blockedCommands?: string[];
  workingDir?: string;
  maxExecutionTimeMs?: number;
}

export class BashAdapter implements Adapter {
  public readonly name = 'bash';
  private options: BashAdapterOptions;

  constructor(options: BashAdapterOptions = {}) {
    this.options = {
      allowedCommands: options.allowedCommands || [],
      blockedCommands: options.blockedCommands || ['rm -rf', 'mkfs', 'dd'],
      workingDir: options.workingDir || SAFE_DEFAULT_WORKDIR,
      maxExecutionTimeMs: options.maxExecutionTimeMs || 5 * 60 * 1000, // 5 Minuten
    };
  }

  canHandle(task: AdapterTask): boolean {
    // Bash Adapter ist zuständig wenn:
    // 1. Task "bash" oder "shell" im Titel/Beschreibung erwähnt
    // 2. Task mit "Führe aus" oder "Run command" beginnt
    const text = `${task.titel} ${task.beschreibung || ''}`.toLowerCase();
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

    // Security check (global blocklist)
    if (!this.isCommandAllowed(command)) {
      return {
        success: false,
        output: `Kommando blockiert: ${command}`,
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'Command blocked by security policy',
      };
    }

    try {
      // Resolve a safe working directory — never falls back to project root
      const cwd = resolveAgentWorkdir(config.workspacePath, this.options.workingDir);

      // Agent permission check — erlaubtePfade (fail-closed)
      if (config.expertId) {
        const perms = db.select().from(agentPermissions)
          .where(eq(agentPermissions.expertId, config.expertId)).get();
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

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: this.options.maxExecutionTimeMs,
        env: {
          ...process.env,
          OPENCOGNIT_EXPERT_ID: config.expertId,
          OPENCOGNIT_UNTERNEHMEN_ID: config.unternehmenId,
          OPENCOGNIT_RUN_ID: config.runId,
          OPENCOGNIT_WORKSPACE: cwd,
        },
      });

      return {
        success: true,
        output: stdout || stderr || 'Kommando erfolgreich ausgeführt',
        exitCode: 0,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stderr || error.stdout || error.message,
        exitCode: error.exitCode || 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private extractCommand(task: AdapterTask): string | null {
    // Versuche Kommando aus Titel oder Beschreibung zu extrahieren
    const text = task.beschreibung || task.titel;
    
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

  private isCommandAllowed(command: string): boolean {
    // Blocked commands check
    for (const blocked of this.options.blockedCommands || []) {
      if (command.includes(blocked)) {
        return false;
      }
    }

    // If allowedCommands is specified, only allow those
    if (this.options.allowedCommands && this.options.allowedCommands.length > 0) {
      return this.options.allowedCommands.some(
        allowed => command.startsWith(allowed)
      );
    }

    return true;
  }
}

export const createBashAdapter = (options?: BashAdapterOptions) => new BashAdapter(options);

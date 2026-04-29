// Kimi CLI Adapter — Moonshot AI Kimi Code CLI
// Binary: https://github.com/moonshotai/kimi-cli
// Install: pip install kimi-cli  (or: pipx install kimi-cli)
// Auth:    kimi login

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { resolveAgentWorkdir, SAFE_DEFAULT_WORKDIR } from './workspace-guard.js';
import { resolveCliPath, getEnrichedEnv } from './cli-paths.js';

const execAsync = promisify(exec);

/** Spawn kimi CLI with prompt via stdin (avoids E2BIG & tag parsing issues) */
function execKimiWithStdin(
  kimiPath: string,
  args: string[],
  prompt: string,
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(kimiPath, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, options.timeout);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > options.maxBuffer) {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('stdout maxBuffer exceeded'));
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > options.maxBuffer) {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('stderr maxBuffer exceeded'));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({ stdout, stderr });
      }
    });

    child.stdin?.write(prompt, 'utf-8', () => {
      child.stdin?.end();
    });
  });
}

export interface KimiCLIAdapterOptions {
  /** Pfad zur kimi Binary (default: 'kimi') */
  kimiPath?: string;
  /** Modell (default: aus ~/.kimi/config.toml) */
  model?: string;
  /** Max Execution Time in ms (default: 10 Min) */
  maxExecutionTimeMs?: number;
  /** Working directory */
  workingDir?: string;
}

export class KimiCLIAdapter implements Adapter {
  public readonly name = 'kimi-cli';
  private options: KimiCLIAdapterOptions;
  private sessionDir: string;

  constructor(options: KimiCLIAdapterOptions = {}) {
    this.options = {
      kimiPath: options.kimiPath,
      model: options.model || undefined,
      maxExecutionTimeMs: options.maxExecutionTimeMs || 10 * 60 * 1000,
      workingDir: options.workingDir || SAFE_DEFAULT_WORKDIR,
    };
    this.sessionDir = path.join(process.cwd(), 'data', 'sessions', 'kimi');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private resolveKimiPath(): string {
    return this.options.kimiPath || resolveCliPath('kimi', 'KIMI_PATH', 'kimi');
  }

  canHandle(task: AdapterTask): boolean {
    // Kimi ist ein allround CLI-Agent — kann fast alles
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    return text.includes('kimi') || text.includes('moonshot');
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();

    // Prüfe ob Kimi CLI verfügbar ist
    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        output: [
          '❌ Kimi CLI nicht gefunden.',
          '',
          'Installation:',
          '  pip install kimi-cli',
          '  # oder:',
          '  pipx install kimi-cli',
          '',
          'Dann anmelden:',
          '  kimi login',
          '',
          'Dokumentation: https://moonshotai.github.io/kimi-cli/',
        ].join('\n'),
        exitCode: 127,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'kimi CLI not found',
      };
    }

    const prompt = this.buildPrompt(task, context);
    const workDir = resolveAgentWorkdir(config.workspacePath, this.options.workingDir);

    try {
      // Kimi CLI non-interactive via stdin (avoids E2BIG & tag parsing issues)
      const escapedPrompt = escapeKimiTags(prompt);

      const args = ['--input-format', 'text', '--quiet', '--work-dir', workDir];
      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      const { stdout, stderr } = await execKimiWithStdin(
        this.resolveKimiPath(),
        args,
        escapedPrompt,
        {
          cwd: workDir,
          timeout: this.options.maxExecutionTimeMs ?? 120000,
          env: {
            ...getEnrichedEnv(),
            OPENCOGNIT_EXPERT_ID: config.agentId,
            OPENCOGNIT_RUN_ID: config.runId,
          },
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const output = stdout || stderr || 'Kimi CLI Ausführung abgeschlossen';
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(output.length / 4);

      // Kimi CLI Kosten: über Moonshot API (ca. $0.50-2.00/1M tokens)
      const costCents = Math.round((outputTokens / 1000) * 0.05);

      this.saveSession(config, prompt, output);

      return {
        success: true,
        output,
        exitCode: 0,
        inputTokens,
        outputTokens,
        costCents,
        durationMs: Date.now() - startTime,
      };

    } catch (error: any) {
      const errorMsg = error.stderr || error.stdout || error.message || 'Unbekannter Fehler';

      let friendlyError = errorMsg;
      if (errorMsg.includes('not authenticated') || errorMsg.includes('login') || errorMsg.includes('credentials')) {
        friendlyError = '🔐 Nicht angemeldet. Bitte führe aus: kimi login\n\n' + errorMsg;
      } else if (errorMsg.includes('quota') || errorMsg.includes('rate')) {
        friendlyError = '⏱️ API Quota überschritten. Warte kurz oder upgrade deinen Plan.\n\n' + errorMsg;
      }

      return {
        success: false,
        output: friendlyError,
        exitCode: error.code || 1,
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private buildPrompt(task: AdapterTask, context: AdapterContext): string {
    const parts: string[] = [];

    parts.push(`Du bist ${context.agentContext.name}, ${context.agentContext.role} bei "${context.companyContext.name}".`);
    if (context.companyContext.goal) {
      parts.push(`Unternehmensziel: ${context.companyContext.goal}`);
    }
    if (context.agentContext.skills) {
      parts.push(`Fähigkeiten: ${context.agentContext.skills}`);
    }
    if (context.projektContext) {
      parts.push('');
      parts.push(`Projekt: ${context.projektContext.name}`);
      if (context.projektContext.description) parts.push(context.projektContext.description);
    }
    parts.push('');

    parts.push(`## Aufgabe: ${task.title}`);
    if (task.description) {
      parts.push(task.description);
    }
    parts.push(`Priorität: ${task.priority}`);
    parts.push('');

    if (context.previousComments.length > 0) {
      parts.push('## Bisheriger Verlauf');
      for (const comment of context.previousComments.slice(-10)) {
        parts.push(`[${comment.senderType}]: ${comment.content}`);
      }
      parts.push('');
    }

    parts.push('Führe die Aufgabe aus. Antworte auf Deutsch, präzise und strukturiert.');

    return parts.join('\n');
  }

  private saveSession(config: AdapterConfig, prompt: string, output: string): void {
    try {
      const sessionFile = path.join(
        this.sessionDir,
        `${config.companyId}-${config.agentId}.json`
      );
      let sessions: any[] = [];
      if (fs.existsSync(sessionFile)) {
        sessions = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      }
      sessions.push({
        runId: config.runId,
        timestamp: new Date().toISOString(),
        promptLength: prompt.length,
        outputPreview: output.slice(0, 500),
      });
      sessions = sessions.slice(-20);
      fs.writeFileSync(sessionFile, JSON.stringify(sessions, null, 2));
    } catch (e) {
      console.warn('Kimi CLI: Session konnte nicht gespeichert werden:', e);
    }
  }

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      try {
        const child = spawn(this.resolveKimiPath(), ['--version'], { stdio: 'ignore', shell: false, env: getEnrichedEnv() });
        child.on('error', () => resolve(false));
        child.on('close', code => resolve(code === 0));
        setTimeout(() => { try { child.kill(); } catch {} resolve(false); }, 5000);
      } catch {
        resolve(false);
      }
    });
  }
}

/**
 * Kimi CLI interprets [TAG]...[/TAG] as its own tag system.
 * We replace square brackets with «» to prevent parsing errors.
 */
function escapeKimiTags(prompt: string): string {
  return prompt.replace(/\[/g, '«').replace(/\]/g, '»');
}

/**
 * Runs a direct chat prompt through the Kimi CLI.
 * Used by the /chat/direct endpoint and Telegram chatWithLLM for kimi-cli agents.
 */
export async function runKimiDirectChat(prompt: string, expertId: string): Promise<string> {
  const kimiPath = resolveCliPath('kimi', 'KIMI_PATH', 'kimi');
  // Escape Kimi tag chars only (stdin avoids shell escaping issues)
  const escapedPrompt = escapeKimiTags(prompt);

  try {
    const { stdout, stderr } = await execKimiWithStdin(
      kimiPath,
      ['--input-format', 'text', '--quiet'],
      escapedPrompt,
      {
        cwd: SAFE_DEFAULT_WORKDIR,
        timeout: 5 * 60 * 1000,
        env: {
          ...process.env,
          OPENCOGNIT_EXPERT_ID: expertId,
        },
        maxBuffer: 5 * 1024 * 1024,
      }
    );
    return stdout?.trim() || stderr?.trim() || '(keine Antwort)';
  } catch (error: any) {
    const msg = error.stderr || error.stdout || error.message || 'Unbekannter Fehler';
    if (msg.includes('not authenticated') || msg.includes('login')) {
      throw new Error('🔐 Nicht angemeldet. Bitte führe aus: kimi login');
    }
    throw new Error(msg);
  }
}

export const createKimiCLIAdapter = (options?: KimiCLIAdapterOptions) =>
  new KimiCLIAdapter(options);

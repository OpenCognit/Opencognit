// Codex CLI Adapter - Nutzt OpenAI Codex CLI mit ChatGPT-Subscription (kein API-Key nötig)
// Authentifizierung: OAuth via ChatGPT-Account (Plus/Pro)
// Binary: https://github.com/openai/codex

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { resolveAgentWorkdir, SAFE_DEFAULT_WORKDIR } from './workspace-guard.js';

const execAsync = promisify(exec);

export interface CodexCLIAdapterOptions {
  /** Pfad zur codex CLI Binary (default: 'codex') */
  codexPath?: string;
  /** Modell (default: 'o4-mini') */
  model?: string;
  /** Max Execution Time in ms (default: 10 Min) */
  maxExecutionTimeMs?: number;
  /** Working directory */
  workingDir?: string;
  /** Approval mode: 'suggest' | 'auto-edit' | 'full-auto' */
  approvalMode?: string;
}

export class CodexCLIAdapter implements Adapter {
  public readonly name = 'codex-cli';
  private options: CodexCLIAdapterOptions;
  private sessionDir: string;

  constructor(options: CodexCLIAdapterOptions = {}) {
    this.options = {
      codexPath: options.codexPath || process.env.CODEX_PATH || 'codex',
      model: options.model || 'o4-mini',
      maxExecutionTimeMs: options.maxExecutionTimeMs || 10 * 60 * 1000,
      workingDir: options.workingDir || SAFE_DEFAULT_WORKDIR,
      approvalMode: options.approvalMode || 'full-auto',
    };
    this.sessionDir = path.join(process.cwd(), 'data', 'sessions', 'codex');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  canHandle(task: AdapterTask): boolean {
    // Codex CLI kann Code-Tasks besonders gut
    const text = `${task.titel} ${task.beschreibung || ''}`.toLowerCase();
    return text.includes('code') ||
           text.includes('implement') ||
           text.includes('write') ||
           text.includes('create') ||
           text.includes('fix') ||
           text.includes('refactor') ||
           text.includes('test') ||
           text.includes('debug');
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();

    // Prüfe ob Codex CLI verfügbar ist
    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        output: [
          '❌ Codex CLI nicht gefunden.',
          '',
          'Installation:',
          '  npm install -g @openai/codex',
          '',
          'Danach einmalig anmelden (OAuth mit ChatGPT-Account):',
          '  codex login',
          '',
          'Keine API-Key oder separate Abrechnung nötig — läuft über deine ChatGPT Plus/Pro Subscription.',
        ].join('\n'),
        exitCode: 127,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'codex CLI not found',
      };
    }

    const prompt = this.buildPrompt(task, context);
    const workDir = resolveAgentWorkdir(config.workspacePath, this.options.workingDir);

    // Write prompt to temp file (avoids shell escaping issues)
    const promptFile = path.join(this.sessionDir, `prompt-${config.runId}.txt`);
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    try {
      // Codex CLI: codex --model MODEL --approval-mode MODE "PROMPT"
      // Prompt is passed as last positional argument (double-quoted, shell-escaped)
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
      const cmd = `${this.options.codexPath} --model "${this.options.model}" --approval-mode "${this.options.approvalMode}" "${escapedPrompt}"`;

      const { stdout, stderr } = await execAsync(
        cmd,
        {
          cwd: workDir,
          timeout: this.options.maxExecutionTimeMs,
          env: {
            ...process.env,
            OPENCOGNIT_EXPERT_ID: config.expertId,
            OPENCOGNIT_UNTERNEHMEN_ID: config.unternehmenId,
            OPENCOGNIT_RUN_ID: config.runId,
          },
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const output = stdout || stderr || 'Codex CLI Ausführung abgeschlossen';

      // Token-Schätzung (Codex CLI gibt keine Token-Stats zurück)
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(output.length / 4);

      // Subscription-User: Kosten sind $0 (abgedeckt durch Subscription)
      // Wir tracken trotzdem für Statistiken mit 0
      const costCents = 0;

      // Session speichern
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

      // Spezifische Fehlermeldungen
      let friendlyError = errorMsg;
      if (errorMsg.includes('not authenticated') || errorMsg.includes('login')) {
        friendlyError = '🔐 Nicht angemeldet. Bitte führe aus: codex login\n\n' + errorMsg;
      } else if (errorMsg.includes('rate limit') || errorMsg.includes('too many')) {
        friendlyError = '⏱️ Rate Limit erreicht. Subscription-Limits gelten auch für CLI-Nutzung.\n\n' + errorMsg;
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
    } finally {
      // Temp prompt file aufräumen
      if (fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }
    }
  }

  private buildPrompt(task: AdapterTask, context: AdapterContext): string {
    const parts: string[] = [];

    parts.push(`Du bist ${context.agentContext.name}, ${context.agentContext.rolle} bei "${context.companyContext.name}".`);
    if (context.companyContext.ziel) {
      parts.push(`Unternehmensziel: ${context.companyContext.ziel}`);
    }
    if (context.agentContext.faehigkeiten) {
      parts.push(`Deine Fähigkeiten: ${context.agentContext.faehigkeiten}`);
    }
    if (context.projektContext) {
      parts.push('');
      parts.push(`Projekt: ${context.projektContext.name}`);
      if (context.projektContext.beschreibung) parts.push(context.projektContext.beschreibung);
    }
    parts.push('');

    parts.push(`## Aufgabe: ${task.titel}`);
    if (task.beschreibung) {
      parts.push(task.beschreibung);
    }
    parts.push(`Priorität: ${task.prioritaet}`);
    parts.push('');

    if (context.previousComments.length > 0) {
      parts.push('## Bisheriger Verlauf');
      for (const comment of context.previousComments.slice(-10)) {
        parts.push(`[${comment.autorTyp}]: ${comment.inhalt}`);
      }
      parts.push('');
    }

    parts.push('Führe die Aufgabe aus. Antworte auf Deutsch, sei präzise und strukturiert.');

    return parts.join('\n');
  }

  private saveSession(config: AdapterConfig, prompt: string, output: string): void {
    try {
      const sessionFile = path.join(
        this.sessionDir,
        `${config.unternehmenId}-${config.expertId}.json`
      );

      let sessions: any[] = [];
      if (fs.existsSync(sessionFile)) {
        sessions = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      }

      sessions.push({
        runId: config.runId,
        timestamp: new Date().toISOString(),
        promptLength: prompt.length,
        outputLength: output.length,
        outputPreview: output.slice(0, 500),
      });

      // Max 20 Sessions speichern
      sessions = sessions.slice(-20);
      fs.writeFileSync(sessionFile, JSON.stringify(sessions, null, 2));
    } catch (e) {
      console.warn('Codex CLI: Session konnte nicht gespeichert werden:', e);
    }
  }

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      try {
        const child = spawn(this.options.codexPath!, ['--version'], { stdio: 'ignore', shell: false });
        child.on('error', () => resolve(false));
        child.on('close', code => resolve(code === 0));
        setTimeout(() => { try { child.kill(); } catch {} resolve(false); }, 5000);
      } catch {
        resolve(false);
      }
    });
  }
}

export const createCodexCLIAdapter = (options?: CodexCLIAdapterOptions) =>
  new CodexCLIAdapter(options);

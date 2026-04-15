// Gemini CLI Adapter - Nutzt Google Gemini CLI mit Google Account (kein API-Key nötig)
// Authentifizierung: OAuth via Google Account (Gemini Advanced / Google One AI Premium)
// Binary: https://github.com/google-gemini/gemini-cli

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { resolveAgentWorkdir, SAFE_DEFAULT_WORKDIR } from './workspace-guard.js';

const execAsync = promisify(exec);

export interface GeminiCLIAdapterOptions {
  /** Pfad zur gemini CLI Binary (default: 'gemini') */
  geminiPath?: string;
  /** Modell (default: 'gemini-2.5-pro') */
  model?: string;
  /** Max Execution Time in ms (default: 10 Min) */
  maxExecutionTimeMs?: number;
  /** Working directory */
  workingDir?: string;
}

export class GeminiCLIAdapter implements Adapter {
  public readonly name = 'gemini-cli';
  private options: GeminiCLIAdapterOptions;
  private sessionDir: string;

  constructor(options: GeminiCLIAdapterOptions = {}) {
    this.options = {
      geminiPath: options.geminiPath || process.env.GEMINI_PATH || 'gemini',
      model: options.model || 'gemini-2.5-pro',
      maxExecutionTimeMs: options.maxExecutionTimeMs || 10 * 60 * 1000,
      workingDir: options.workingDir || SAFE_DEFAULT_WORKDIR,
    };
    this.sessionDir = path.join(process.cwd(), 'data', 'sessions', 'gemini');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  canHandle(task: AdapterTask): boolean {
    // Gemini ist gut bei Recherche, Analyse, Multimodalem
    const text = `${task.titel} ${task.beschreibung || ''}`.toLowerCase();
    return text.includes('gemini') ||
           text.includes('recherche') ||
           text.includes('analyse') ||
           text.includes('research') ||
           text.includes('zusammenfassung') ||
           text.includes('report') ||
           text.includes('bericht');
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();

    // Prüfe ob Gemini CLI verfügbar ist
    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        output: [
          '❌ Gemini CLI nicht gefunden.',
          '',
          'Installation:',
          '  npm install -g @google/gemini-cli',
          '  # oder:',
          '  npx @google/gemini-cli',
          '',
          'Dann anmelden:',
          '  gemini auth login',
          '',
          'Keine API-Key nötig — läuft über deinen Google Account.',
          'Für Gemini Advanced: Google One AI Premium Subscription ($19.99/mo) nutzen.',
        ].join('\n'),
        exitCode: 127,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'gemini CLI not found',
      };
    }

    const prompt = this.buildPrompt(task, context);
    const workDir = resolveAgentWorkdir(config.workspacePath, this.options.workingDir);

    try {
      // Gemini CLI: `gemini -m MODEL -p "PROMPT"`
      // -m / --model sets the model, -p / --prompt passes the prompt non-interactively
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');

      const { stdout, stderr } = await execAsync(
        `${this.options.geminiPath} -m "${this.options.model}" -p "${escapedPrompt}"`,
        {
          cwd: workDir,
          timeout: this.options.maxExecutionTimeMs,
          env: {
            ...process.env,
            OPENCOGNIT_EXPERT_ID: config.expertId,
            OPENCOGNIT_RUN_ID: config.runId,
          },
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const output = stdout || stderr || 'Gemini CLI Ausführung abgeschlossen';
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(output.length / 4);

      // Subscription: $0 Kosten (via Google Account Quota)
      const costCents = 0;

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
        friendlyError = '🔐 Nicht angemeldet. Bitte führe aus: gemini auth login\n\n' + errorMsg;
      } else if (errorMsg.includes('quota') || errorMsg.includes('rate')) {
        friendlyError = '⏱️ Google API Quota überschritten. Warte kurz oder upgrade zu Gemini Advanced.\n\n' + errorMsg;
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

    parts.push(`Du bist ${context.agentContext.name}, ${context.agentContext.rolle} bei "${context.companyContext.name}".`);
    if (context.companyContext.ziel) {
      parts.push(`Unternehmensziel: ${context.companyContext.ziel}`);
    }
    if (context.agentContext.faehigkeiten) {
      parts.push(`Fähigkeiten: ${context.agentContext.faehigkeiten}`);
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

    parts.push('Führe die Aufgabe aus. Antworte auf Deutsch, präzise und strukturiert.');

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
        outputPreview: output.slice(0, 500),
      });
      sessions = sessions.slice(-20);
      fs.writeFileSync(sessionFile, JSON.stringify(sessions, null, 2));
    } catch (e) {
      console.warn('Gemini CLI: Session konnte nicht gespeichert werden:', e);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync(`${this.options.geminiPath} --version`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const createGeminiCLIAdapter = (options?: GeminiCLIAdapterOptions) =>
  new GeminiCLIAdapter(options);

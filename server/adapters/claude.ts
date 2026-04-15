import { buildAgentSystemPrompt } from './prompt.js';
import { spawn } from 'child_process';
import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';

// Claude Code CLI Adapter
// Startet den claude CLI-Befehl als Kindprozess

export class ClaudeAdapter implements ExpertAdapter {
  name = 'claude';
  beschreibung = 'Claude Code CLI (Anthropic)';

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['claude']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 120000;

    const systemPrompt = buildAgentSystemPrompt(options);
    const userPrompt = options.prompt;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const args = [
        '--print',
        '--system-prompt', systemPrompt,
        userPrompt,
      ];

      const proc = spawn('claude', args, {
        timeout,
        env: {
          ...process.env,
          OPENCOGNIT_API_KEY: options.apiKey,
          OPENCOGNIT_API_URL: options.apiBaseUrl,
          OPENCOGNIT_EXPERT_ID: options.expertId,
          OPENCOGNIT_UNTERNEHMEN_ID: options.unternehmenId,
        },
      });

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        const dauer = Date.now() - startTime;
        if (code === 0) {
          resolve({
            success: true,
            ausgabe: stdout.trim(),
            dauer,
            tokenVerbrauch: this.estimateTokens(stdout),
          });
        } else {
          resolve({
            success: false,
            ausgabe: stdout.trim(),
            fehler: stderr.trim() || `Prozess beendet mit Code ${code}`,
            dauer,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({
          success: false,
          ausgabe: '',
          fehler: `Fehler beim Starten: ${err.message}`,
          dauer: Date.now() - startTime,
        });
      });
    });
  }

  private estimateTokens(text: string): { inputTokens: number; outputTokens: number; kostenCent: number } {
    // Rough estimation: ~4 chars per token
    const outputTokens = Math.ceil(text.length / 4);
    const inputTokens = Math.ceil(outputTokens * 0.5); // System prompt estimate
    // Claude pricing estimate: $3/MTok input, $15/MTok output
    const kostenCent = Math.ceil((inputTokens * 0.3 + outputTokens * 1.5) / 1000);
    return { inputTokens, outputTokens, kostenCent };
  }
}

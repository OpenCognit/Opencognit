import { buildAgentSystemPrompt } from './prompt.js';
import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { withRetry } from '../utils/http.js';
import { executeBashCommand, AGENT_TOOLS_OPENAI } from './tool-executor.js';

const MAX_ITERATIONS = 15;

/**
 * Generic adapter for any OpenAI-compatible API.
 * Works with Groq, Together.ai, Mistral, Poe.com, LM Studio, etc.
 *
 * verbindungsConfig (JSON per agent):
 *   { model: "llama3-70b-8192", baseUrl: "https://api.groq.com/openai/v1" }
 *
 * API key: set globally in Settings → "Custom API Key"
 * Base URL: can be overridden per agent in verbindungsConfig.baseUrl
 *           or set globally in Settings → "Custom API Base URL"
 */
export class CustomAdapter implements ExpertAdapter {
  name = 'custom';
  beschreibung = 'Custom API (OpenAI-kompatibel) — Groq, Mistral, Together.ai, LM Studio, …';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 120000;

    let model = 'gpt-4o-mini';
    let baseUrl = options.apiBaseUrl || 'https://api.openai.com/v1';

    try {
      if (options.verbindungsConfig) {
        const config = JSON.parse(options.verbindungsConfig);
        if (config.model) model = config.model;
        if (config.baseUrl) baseUrl = config.baseUrl;
      }
    } catch {
      // Ignore JSON parse errors
    }

    if (!options.apiKey) {
      return {
        success: false,
        ausgabe: '',
        fehler: 'Kein API Key hinterlegt. Bitte in den Einstellungen unter "Custom API Key" eintragen.',
        dauer: Date.now() - startTime,
      };
    }

    const systemPrompt = buildAgentSystemPrompt(options);
    const apiBase = baseUrl.replace(/\/$/, '');
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: options.prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalOutput = '';
    // Accumulated log of bash commands + their outputs for auditing
    const bashLog: Array<{ cmd: string; output: string }> = [];

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let data: any;
      try {
        data = await withRetry(
          async () => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            const res = await fetch(`${apiBase}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.apiKey}`,
              },
              body: JSON.stringify({
                model,
                messages,
                // Claude models via Poe don't support tools in OpenAI format —
                // they fall back to text-based bash block parsing (see below).
                ...(model.toLowerCase().includes('claude') ? {} : {
                  tools: AGENT_TOOLS_OPENAI,
                  tool_choice: 'auto',
                }),
              }),
              signal: controller.signal,
            });

            clearTimeout(id);

            if (!res.ok) {
              const errText = await res.text();
              const error = new Error(`Custom API Fehler (${res.status}): ${errText}`);
              (error as any).status = res.status;
              throw error;
            }

            return await res.json() as any;
          },
          {
            maxRetries: 3,
            initialDelayMs: 2000,
            shouldRetry: (err: any) => {
              if (err.status === 429) return true;
              if (err.status >= 500 && err.status <= 599) return true;
              if (err.message?.toLowerCase().includes('timeout')) return true;
              return false;
            },
            onRetry: (err, attempt, delay) => {
              console.warn(`[Custom API Retry] Versuch ${attempt}. Warte ${delay}ms... Fehler: ${err.message}`);
            },
          },
        );
      } catch (e: any) {
        return {
          success: false,
          ausgabe: finalOutput,
          fehler: `Verbindungsfehler zu Custom API (${apiBase}): ${e.message}`,
          dauer: Date.now() - startTime,
        };
      }

      totalInputTokens += data.usage?.prompt_tokens ?? 0;
      totalOutputTokens += data.usage?.completion_tokens ?? 0;

      const choice = data.choices?.[0];
      const message = choice?.message;

      if (!message) break;

      messages.push(message);

      if (message.content) {
        finalOutput = message.content;
      }

      // Handle tool calls
      const toolCalls: any[] = message.tool_calls ?? [];
      if (toolCalls.length === 0 || choice.finish_reason === 'stop') {
        // Fallback: check for bash blocks in text (models that don't support tool calls)
        if (message.content) {
          const { extractBashBlocks } = await import('./tool-executor.js');
          const blocks = extractBashBlocks(message.content);
          if (blocks.length > 0) {
            let toolResultText = 'Hier sind die Ergebnisse deiner Bash-Befehle:\n';
            for (const block of blocks) {
              console.log(`  🔧 [Custom API text] bash: ${block.slice(0, 100)}`);
              const result = await executeBashCommand(block, options.workspacePath);
              bashLog.push({ cmd: block, output: result.output });
              toolResultText += `\n\`\`\`\n$ ${block}\n${result.output}\n\`\`\``;
            }
            messages.push({ role: 'user', content: toolResultText + '\n\nMache weiter mit der Aufgabe.' });
            continue;
          }
        }
        break;
      }

      const toolResults: any[] = [];
      let taskDone = false;

      for (const toolCall of toolCalls) {
        const name = toolCall.function?.name;
        let input: any = {};
        try {
          input = JSON.parse(toolCall.function?.arguments || '{}');
        } catch {}

        if (name === 'task_complete') {
          finalOutput = input.summary || finalOutput;
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Task marked as complete.',
          });
          taskDone = true;
          break;
        }

        if (name === 'bash') {
          const cmd = input.command || '';
          console.log(`  🔧 [Custom API tool] bash: ${cmd.slice(0, 100)}`);
          const result = await executeBashCommand(cmd, options.workspacePath);
          bashLog.push({ cmd, output: result.output });
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.output,
          });
        }
      }

      messages.push(...toolResults);
      if (taskDone) break;
    }

    // Append bash execution log so kommentare show exactly what ran
    if (bashLog.length > 0) {
      const logSection = bashLog.map(({ cmd, output }) =>
        `$ ${cmd}\n${output.slice(0, 2000)}`,
      ).join('\n\n---\n\n');
      finalOutput = `${finalOutput}\n\n---\n**Ausgeführte Bash-Befehle:**\n\`\`\`\n${logSection}\n\`\`\``;
    }

    return {
      success: true,
      ausgabe: finalOutput,
      dauer: Date.now() - startTime,
      tokenVerbrauch: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, kostenCent: 0 },
    };
  }
}

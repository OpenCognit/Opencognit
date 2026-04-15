import { buildAgentSystemPrompt } from './prompt.js';
import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { withRetry } from '../utils/http.js';
import { executeBashCommand, AGENT_TOOLS_OPENAI } from './tool-executor.js';

const MAX_ITERATIONS = 15;

export class OpenAIAdapter implements ExpertAdapter {
  name = 'openai';
  beschreibung = 'OpenAI GPT (gpt-4o, gpt-4-turbo, gpt-3.5-turbo, etc.)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 120000;

    let model = 'gpt-4o-mini';
    let baseUrl = 'https://api.openai.com/v1';

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
        fehler: 'Kein API Key für diesen Provider hinterlegt.',
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
                tools: AGENT_TOOLS_OPENAI,
                tool_choice: 'auto',
              }),
              signal: controller.signal,
            });

            clearTimeout(id);

            if (!res.ok) {
              const errText = await res.text();
              const error = new Error(`OpenAI Fehler (${res.status}): ${errText}`);
              (error as any).status = res.status;
              throw error;
            }

            return await res.json() as any;
          },
          {
            maxRetries: 3,
            initialDelayMs: 2000,
            onRetry: (err, attempt, delay) => {
              console.warn(`[OpenAI Retry] Versuch ${attempt}. Warte ${delay}ms... Fehler: ${err.message}`);
            },
          },
        );
      } catch (e: any) {
        return {
          success: false,
          ausgabe: finalOutput,
          fehler: `Verbindungsfehler zu OpenAI: ${e.message}`,
          dauer: Date.now() - startTime,
        };
      }

      totalInputTokens += data.usage?.prompt_tokens ?? 0;
      totalOutputTokens += data.usage?.completion_tokens ?? 0;

      const choice = data.choices?.[0];
      const message = choice?.message;

      if (!message) break;

      messages.push(message);

      // Collect text output
      if (message.content) {
        finalOutput = message.content;
      }

      // No tool calls → done
      const toolCalls: any[] = message.tool_calls ?? [];
      if (toolCalls.length === 0 || choice.finish_reason === 'stop') {
        break;
      }

      // Execute each tool call
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
          console.log(`  🔧 [OpenAI tool] bash: ${cmd.slice(0, 100)}`);
          const result = await executeBashCommand(cmd, options.workspacePath);
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

    // gpt-4o-mini: ~$0.15/1M input, $0.60/1M output
    const kostenCent = Math.ceil((totalInputTokens * 0.00015 + totalOutputTokens * 0.0006) / 100);

    return {
      success: true,
      ausgabe: finalOutput,
      dauer: Date.now() - startTime,
      tokenVerbrauch: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, kostenCent },
    };
  }
}

import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { buildAgentSystemPrompt } from './prompt.js';
import { withRetry } from '../utils/http.js';

const MAX_ITERATIONS = 15;
const BASE_URL = 'https://api.poe.com/v1';

export class PoeAdapter implements ExpertAdapter {
  name = 'poe';
  description = 'Poe API (GPT-4o, Claude, Gemini, Llama via poe.com)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 120000;

    let model = 'GPT-4o';
    try {
      if (options.connectionConfig) {
        const config = JSON.parse(options.connectionConfig);
        if (config.model) model = config.model;
      }
      if (options.globalDefaultModel) model = options.globalDefaultModel;
    } catch {
      if (options.globalDefaultModel) model = options.globalDefaultModel;
    }

    if (!options.apiKey) {
      return {
        success: false,
        output: '',
        error: 'Kein Poe API Key in den Systemeinstellungen hinterlegt. Key unter poe.com/api_key erstellen.',
        duration: Date.now() - startTime,
      };
    }

    const systemPrompt = buildAgentSystemPrompt(options);
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: options.prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalOutput = '';
    let data: any;

    const MAX_OUTPUT_TOKENS = 4096;
    const MAX_MESSAGES_CHARS = 600_000;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const messagesSize = JSON.stringify(messages).length;
      if (messagesSize > MAX_MESSAGES_CHARS && messages.length > 4) {
        const head = messages.slice(0, 2);
        const tail = messages.slice(-4);
        messages.length = 0;
        messages.push(...head, ...tail);
        console.warn(`[Poe] Context zu groß (${messagesSize} chars) — alte Messages entfernt`);
      }

      try {
        data = await withRetry(
          async () => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            const res = await fetch(`${BASE_URL}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.apiKey}`,
              },
              body: JSON.stringify({
                model,
                messages,
                max_tokens: MAX_OUTPUT_TOKENS,
                temperature: 0.7,
              }),
              signal: controller.signal,
            });

            clearTimeout(id);

            if (!res.ok) {
              const errText = await res.text();
              const error = new Error(`Poe Fehler (${res.status}): ${errText}`);
              (error as any).status = res.status;
              throw error;
            }

            return await res.json() as any;
          },
          {
            maxRetries: 3,
            initialDelayMs: 3000,
            shouldRetry: (err: any) => {
              if (err.status === 401) return false;
              if (err.status === 429) return true;
              if (err.status >= 500 && err.status <= 599) return true;
              if (err.message?.toLowerCase().includes('timeout')) return true;
              return false;
            },
            onRetry: (err, attempt, delay) => {
              console.warn(`[Poe Retry] Versuch ${attempt}. Warte ${delay}ms... Fehler: ${err.message}`);
            },
          },
        );
      } catch (e: any) {
        const is401 = (e as any).status === 401 || e.message?.includes('401');
        const error = is401
          ? `Poe API Key ungültig. Bitte unter poe.com/api_key einen neuen Key erstellen. (${e.message})`
          : `Verbindungsfehler zu Poe: ${e.message}`;
        return {
          success: false,
          output: finalOutput,
          error,
          duration: Date.now() - startTime,
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

      break; // Poe aktuell ohne Tool-Calling in diesem Adapter
    }

    // Poe uses points-based pricing — exact cost not available via API
    // We estimate roughly based on token count (varies by model)
    const costCent = 0;

    return {
      success: true,
      output: finalOutput,
      duration: Date.now() - startTime,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costCent },
    };
  }
}

/**
 * Direct chat via Poe API (used by /chat/direct endpoint).
 */
export async function runPoeDirectChat(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  model = 'GPT-4o',
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Poe ${res.status}: ${errText}`);
  }

  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

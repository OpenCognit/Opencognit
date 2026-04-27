import { buildAgentSystemPrompt } from './prompt.js';
import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { withRetry } from '../utils/http.js';
import { executeBashCommand, extractBashBlocks } from './tool-executor.js';

const MAX_ITERATIONS = 10;

export class OllamaAdapter implements ExpertAdapter {
  name = 'ollama';
  description = 'Ollama Lokal (Llama 3, Mistral, etc.)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 180000; // 3min for local models

    let model = options.globalDefaultModel || 'mistral';
    try {
      if (options.connectionConfig) {
        const config = JSON.parse(options.connectionConfig);
        if (config.model) model = config.model;
      }
    } catch {
      // Ignore JSON parse errors
    }

    // For Ollama, apiKey holds the base URL
    const baseUrl = options.apiKey || 'http://localhost:11434';
    const endpoint = baseUrl.endsWith('/') ? `${baseUrl}api/chat` : `${baseUrl}/api/chat`;

    const systemPrompt = buildAgentSystemPrompt(options);

    // Ollama uses /api/chat with messages array — supports multi-turn natively
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

            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages,
                stream: false,
              }),
              signal: controller.signal,
            });

            clearTimeout(id);

            if (!res.ok) {
              const errText = await res.text();
              const error = new Error(`Ollama Fehler (${res.status}): ${errText}`);
              (error as any).status = res.status;
              throw error;
            }

            return await res.json() as any;
          },
          {
            maxRetries: 3,
            initialDelayMs: 2000,
            onRetry: (err, attempt, delay) => {
              console.warn(`[Ollama Retry] Versuch ${attempt}. Warte ${delay}ms... Fehler: ${err.message}`);
            },
          },
        );
      } catch (e: any) {
        return {
          success: false,
          output: finalOutput,
          error: `Verbindungsfehler zu Ollama (${baseUrl}): ${e.message}`,
          duration: Date.now() - startTime,
        };
      }

      totalInputTokens += data.prompt_eval_count ?? 0;
      totalOutputTokens += data.eval_count ?? 0;

      const responseText: string = data.message?.content || '';
      finalOutput = responseText;

      // Add assistant response to history
      messages.push({ role: 'assistant', content: responseText });

      // Extract and execute all bash blocks
      const blocks = extractBashBlocks(responseText);

      if (blocks.length === 0) {
        break; // No more actions → done
      }

      // Execute all blocks, collect results
      let resultsText = 'Hier sind die Ergebnisse deiner Bash-Befehle:\n';
      for (const block of blocks) {
        console.log(`  🔧 [Ollama] bash: ${block.slice(0, 100)}`);
        const result = await executeBashCommand(block, options.workspacePath);
        resultsText += `\n\`\`\`\n$ ${block}\n${result.output}\n\`\`\``;
      }

      // Feed results back as user message
      messages.push({
        role: 'user',
        content: resultsText + '\n\nMache weiter mit der Aufgabe oder teile mit, wenn du fertig bist.',
      });
    }

    return {
      success: true,
      output: finalOutput,
      duration: Date.now() - startTime,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costCent: 0 },
    };
  }
}

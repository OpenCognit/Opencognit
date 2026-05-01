import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { buildAgentSystemPrompt } from './prompt.js';
import { withRetry } from '../utils/http.js';
import { executeBashCommand, AGENT_TOOLS_OPENAI } from './tool-executor.js';

const MAX_ITERATIONS = 15;


export class OpenRouterAdapter implements ExpertAdapter {
  name = 'openrouter';
  description = 'OpenRouter API (Llama 3, Mistral, OpenAI, etc.)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 120000;

    let model = 'openrouter/auto';
    try {
      if (options.connectionConfig) {
        const config = JSON.parse(options.connectionConfig);
        if (config.model && config.model !== 'openrouter/auto') {
          model = config.model;
        } else {
          // No specific model configured → try global default
          if (options.globalDefaultModel) model = options.globalDefaultModel;
        }
      } else {
        // No verbindungsConfig at all → try global default
        if (options.globalDefaultModel) model = options.globalDefaultModel;
      }
    } catch {
      // Ignore JSON parse errors — try global default as fallback
      if (options.globalDefaultModel) model = options.globalDefaultModel;
    }

    if (!options.apiKey) {
      return {
        success: false,
        output: '',
        error: 'Kein OpenRouter API Key in den Systemeinstellungen hinterlegt.',
        duration: Date.now() - startTime,
      };
    }

    const modelParam = { model };

    const systemPrompt = buildAgentSystemPrompt(options);
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: options.prompt },
    ];

    // All paid models support function calling
    const supportsTools = true;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalOutput = '';
    let data: any;

    // Max output tokens per request — prevents burning credits on huge outputs.
    // 4096 is ample for agent task responses; most structured outputs are < 1000 tokens.
    const MAX_OUTPUT_TOKENS = 4096;

    // Max accumulated message chars before we trim old tool-call rounds.
    // ~600k chars ≈ ~150k tokens, safely under OpenRouter's 262k limit.
    const MAX_MESSAGES_CHARS = 600_000;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Trim conversation history if it's grown too large.
      // Keep system[0] + user[1] + last N tool-call/response pairs.
      const messagesSize = JSON.stringify(messages).length;
      if (messagesSize > MAX_MESSAGES_CHARS && messages.length > 4) {
        // Drop middle messages (tool iterations) but always keep system + initial user
        const head = messages.slice(0, 2);
        const tail = messages.slice(-4); // keep last 2 tool-call/result pairs
        messages.length = 0;
        messages.push(...head, ...tail);
        console.warn(`[OpenRouter] Context zu groß (${messagesSize} chars) — alte Iteration-Messages entfernt`);
      }

      try {
        data = await withRetry(
          async () => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);

            const body: any = {
              ...modelParam,
              messages,
              max_tokens: MAX_OUTPUT_TOKENS,
            };
            if (supportsTools) {
              body.tools = AGENT_TOOLS_OPENAI;
              body.tool_choice = 'auto';
            }

            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.apiKey}`,
                'HTTP-Referer': options.apiBaseUrl,
                'X-Title': 'OpenCognit OS',
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });

            clearTimeout(id);

            if (!res.ok) {
              const errText = await res.text();
              const error = new Error(`OpenRouter Fehler (${res.status}): ${errText}`);
              (error as any).status = res.status;
              throw error;
            }

            return await res.json() as any;
          },
          {
            maxRetries: 3,
            initialDelayMs: 3000,
            shouldRetry: (err: any) => {
              if (err.status === 402) return false; // insufficient credits — no point retrying
              if (err.status === 429) return true;  // rate limit — retry with backoff
              if (err.status >= 500 && err.status <= 599) return true;
              if (err.message?.toLowerCase().includes('timeout')) return true;
              return false;
            },
            onRetry: (err, attempt, delay) => {
              console.warn(`[OpenRouter Retry] Versuch ${attempt}. Warte ${delay}ms... Fehler: ${err.message}`);
            },
          },
        );
      } catch (e: any) {
        const is402 = (e as any).status === 402 || e.message?.includes('402');
        const error = is402
          ? `OpenRouter Credits aufgebraucht. Bitte unter openrouter.ai/settings/credits aufladen. (${e.message})`
          : `Verbindungsfehler zu OpenRouter: ${e.message}`;
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

      // Handle tool calls (native function calling)
      const toolCalls: any[] = message.tool_calls ?? [];

      if (toolCalls.length > 0 && choice.finish_reason !== 'stop') {
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
            console.log(`  🔧 [OpenRouter tool] bash: ${cmd.slice(0, 100)}`);
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
        continue;
      }

      // No tool calls — check for bash blocks in text (fallback for models without tool support)
      if (message.content) {
        const { extractBashBlocks } = await import('./tool-executor.js');
        const blocks = extractBashBlocks(message.content);

        if (blocks.length > 0) {
          let toolResultText = 'Hier sind die Ergebnisse deiner Bash-Befehle:\n';
          for (const block of blocks) {
            console.log(`  🔧 [OpenRouter text] bash: ${block.slice(0, 100)}`);
            const result = await executeBashCommand(block, options.workspacePath);
            toolResultText += `\n\`\`\`\n$ ${block}\n${result.output}\n\`\`\``;
          }
          messages.push({ role: 'user', content: toolResultText + '\n\nMache weiter mit der Aufgabe.' });
          continue;
        }
      }

      break; // No tools, no bash blocks → done
    }

    const costCent = data?.usage?.cost
      ? Math.round(data.usage.cost * 100)
      : 0;

    if (!finalOutput.trim()) {
      return {
        success: false,
        output: '',
        error: 'OpenRouter returned empty output (no content from model).',
        duration: Date.now() - startTime,
        tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costCent },
      };
    }

    return {
      success: true,
      output: finalOutput,
      duration: Date.now() - startTime,
      tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costCent },
    };
  }
}

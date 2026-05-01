import { buildAgentSystemPrompt } from './prompt.js';
import type { ExpertAdapter, AdapterRunOptions, AdapterRunResult } from './types.js';
import { withRetry } from '../utils/http.js';
import { executeBashCommand, AGENT_TOOLS_ANTHROPIC } from './tool-executor.js';

const MAX_ITERATIONS = 15;

export class AnthropicAdapter implements ExpertAdapter {
  name = 'anthropic';
  description = 'Anthropic Claude API (claude-3-5-sonnet, claude-3-haiku, etc.)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(options: AdapterRunOptions): Promise<AdapterRunResult> {
    const startTime = Date.now();
    const timeout = options.timeoutMs || 120000;

    let model = 'claude-haiku-4-5-20251001';
    try {
      if (options.connectionConfig) {
        const config = JSON.parse(options.connectionConfig);
        if (config.model) model = config.model;
      }
    } catch {
      // Ignore JSON parse errors
    }

    if (!options.apiKey) {
      return {
        success: false,
        output: '',
        error: 'Kein Anthropic API Key in den Systemeinstellungen hinterlegt.',
        duration: Date.now() - startTime,
      };
    }

    const systemPrompt = buildAgentSystemPrompt(options);
    const messages: any[] = [{ role: 'user', content: options.prompt }];

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

            const res = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': options.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model,
                max_tokens: 4096,
                system: systemPrompt,
                messages,
                tools: AGENT_TOOLS_ANTHROPIC,
              }),
              signal: controller.signal,
            });

            clearTimeout(id);

            if (!res.ok) {
              const errText = await res.text();
              const error = new Error(`Anthropic Fehler (${res.status}): ${errText}`);
              (error as any).status = res.status;
              throw error;
            }

            return await res.json() as any;
          },
          {
            maxRetries: 3,
            initialDelayMs: 2000,
            onRetry: (err, attempt, delay) => {
              console.warn(`[Anthropic Retry] Versuch ${attempt}. Warte ${delay}ms... Fehler: ${err.message}`);
            },
          },
        );
      } catch (e: any) {
        return {
          success: false,
          output: finalOutput,
          error: `Verbindungsfehler zu Anthropic: ${e.message}`,
          duration: Date.now() - startTime,
        };
      }

      totalInputTokens += data.usage?.input_tokens ?? 0;
      totalOutputTokens += data.usage?.output_tokens ?? 0;

      const content: any[] = data.content ?? [];
      messages.push({ role: 'assistant', content });

      // Collect latest text output
      const textBlocks = content.filter((b) => b.type === 'text');
      if (textBlocks.length > 0) {
        finalOutput = textBlocks.map((b) => b.text).join('\n');
      }

      // No tool calls → done
      const toolUseBlocks = content.filter((b) => b.type === 'tool_use');
      if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') {
        break;
      }

      // Execute each requested tool
      const toolResults: any[] = [];
      let taskDone = false;

      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'task_complete') {
          finalOutput = toolUse.input?.summary || finalOutput;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'Task marked as complete.',
          });
          taskDone = true;
          break;
        }

        if (toolUse.name === 'bash') {
          const cmd = toolUse.input?.command || '';
          console.log(`  🔧 [Anthropic tool] bash: ${cmd.slice(0, 100)}`);
          const result = await executeBashCommand(cmd, options.workspacePath);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.output,
            is_error: !result.success,
          });
        }
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }

      if (taskDone) break;
    }

    // Pricing varies by model; use conservative estimate (Sonnet 4.6 rates as default)
    // Haiku 4.5: ~$0.80/$4 per 1M, Sonnet 4.6: ~$3/$15 per 1M, Opus 4.6: ~$15/$75 per 1M
    const inputRate = model.includes('haiku') ? 0.0008 : model.includes('opus') ? 0.015 : 0.003;
    const outputRate = model.includes('haiku') ? 0.004 : model.includes('opus') ? 0.075 : 0.015;
    const costCent = Math.ceil((totalInputTokens * inputRate + totalOutputTokens * outputRate) / 100);

    if (!finalOutput.trim()) {
      return {
        success: false,
        output: '',
        error: 'Anthropic returned empty output (no content from model).',
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

import { ClaudeAdapter } from './claude.js';
import { BashAdapter } from './bash.js';
import { HttpAdapter } from './http.js';
import { OpenRouterAdapter } from './openrouter.js';
import { OllamaAdapter } from './ollama.js';
import { CEOAdapter } from './ceo.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { CustomAdapter } from './custom.js';
import { CodexCLIAdapter } from './codex-cli.js';
import { GeminiCLIAdapter } from './gemini-cli.js';
import { KimiCLIAdapter } from './kimi-cli.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { PoeAdapter } from './poe.js';
import { GoogleAdapter } from './google.js';
import { MoonshotAdapter } from './moonshot.js';
import type { ExpertAdapter } from './types.js';

export * from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapters: Record<string, any> = {
  claude: new ClaudeAdapter(),
  bash: new BashAdapter(),
  http: new HttpAdapter(),
  openrouter: new OpenRouterAdapter(),
  ollama: new OllamaAdapter(),
  ollama_cloud: new OllamaAdapter(), // Alias for Ollama Cloud
  ceo: new CEOAdapter(),
  openai: new OpenAIAdapter(),
  anthropic: new AnthropicAdapter(),
  custom: new CustomAdapter(),
  'codex-cli': new CodexCLIAdapter(),
  'gemini-cli': new GeminiCLIAdapter(),
  'kimi-cli': new KimiCLIAdapter(),
  'claude-code': new ClaudeCodeAdapter(),
  'poe': new PoeAdapter(),
  'google': new GoogleAdapter(),
  'moonshot': new MoonshotAdapter(),
};

export function getAdapter(type: string): ExpertAdapter | undefined {
  return adapters[type];
}

export function getAllAdapters(): ExpertAdapter[] {
  return Object.values(adapters);
}


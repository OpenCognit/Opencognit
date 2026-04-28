// Adapter Registry - Verwaltet alle Adapter und wählt den richtigen aus

import { Adapter, AdapterTask, AdapterConfig, AdapterExecutionResult, AdapterContext } from './types.js';
import { BashAdapter } from './bash.js';
import { HttpAdapter } from './http.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexCLIAdapter } from './codex-cli.js';
import { GeminiCLIAdapter } from './gemini-cli.js';
import { KimiCLIAdapter } from './kimi-cli.js';
import { OpenClawAdapter } from './openclaw.js';
import { EmailAdapter } from './email.js';
import { BrowserAdapter } from './browser.js';
import { createLLMWrapper } from './llm-wrapper.js';
import { loadAdapterPlugins, type LoadedAdapterPlugin } from './plugin-loader.js';

export class AdapterRegistry {
  private adapters: Map<string, Adapter> = new Map();
  private plugins: LoadedAdapterPlugin[] = [];
  private initialized = false;

  /**
   * Lädt externe Adapter-Plugins aus plugins/adapters/*.
   * Sollte einmal beim Server-Start aufgerufen werden.
   */
  async loadPlugins(): Promise<number> {
    this.plugins = await loadAdapterPlugins();
    for (const p of this.plugins) {
      // Core-Adapter haben Vorrang — Plugins überschreiben nicht versehentlich.
      if (this.adapters.has(p.manifest.name)) {
        console.warn(`[AdapterPlugin] ${p.manifest.name}: Name kollidiert mit Core-Adapter — übersprungen`);
        continue;
      }
      this.register(p.manifest.name, p.adapter);
    }
    return this.plugins.length;
  }

  /**
   * Liefert Metadaten über geladene Plugins (für API/UI).
   */
  getLoadedPlugins() {
    return this.plugins.map(p => ({
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
    }));
  }

  constructor() {
    // CLI / Subscription adapters (implement Adapter interface with execute())
    this.register('bash', new BashAdapter());
    this.register('http', new HttpAdapter());
    this.register('claude-code', new ClaudeCodeAdapter());
    this.register('codex-cli', new CodexCLIAdapter());
    this.register('gemini-cli', new GeminiCLIAdapter());
    this.register('kimi-cli', new KimiCLIAdapter());
    this.register('openclaw', new OpenClawAdapter());
    this.register('email', new EmailAdapter());
    this.register('browser', new BrowserAdapter());
    // API-key adapters (claude, openrouter, anthropic, openai, ollama, ceo)
    // are handled via createLLMWrapper() below — they use run() not execute()
  }

  /**
   * Registriert einen Adapter
   */
  register(name: string, adapter: Adapter): void {
    this.adapters.set(name, adapter);
    console.log(`Adapter registriert: ${name}`);
  }

  /**
   * Wählt den passenden Adapter für eine Aufgabe aus
   */
  selectAdapter(task: AdapterTask): Adapter | null {
    // First pass: Check all adapters if they can handle the task
    for (const [, adapter] of this.adapters) {
      if (adapter.canHandle(task)) {
        console.log(`Adapter ausgewählt: ${adapter.name} für Aufgabe: ${task.title}`);
        return adapter;
      }
    }

    // Fallback: Always use Claude Code as default
    const defaultAdapter = this.adapters.get('claude-code');
    if (defaultAdapter) {
      console.log(`Fallback Adapter: claude-code für Aufgabe: ${task.title}`);
      return defaultAdapter;
    }

    return null;
  }

  /**
   * Führt eine Aufgabe mit dem passenden Adapter aus
   */
  async executeTask(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    let adapter = this.selectAdapter(task);
    
    // Wenn verbindungsTyp gesetzt ist, versuche zuerst registrierte Adapter, dann LLM-Wrapper
    if (config.connectionType && config.connectionType !== 'bash' && config.connectionType !== 'http' && config.connectionType !== 'claude-code' && config.connectionType !== 'codex-cli' && config.connectionType !== 'gemini-cli' && config.connectionType !== 'kimi-cli') {
      // CLI-Subscription-Adapter haben Vorrang (direkt registriert)
      const directAdapter = this.adapters.get(config.connectionType);
      if (directAdapter) {
        adapter = directAdapter;
        console.log(`Using registered adapter: ${config.connectionType} für Aufgabe: ${task.title}`);
      } else {
        // Fallback: LLM-Wrapper für API-Key-basierte Adapter
        const llmAdapter = createLLMWrapper(config.connectionType);
        if (llmAdapter) {
          adapter = llmAdapter;
          console.log(`Using LLM wrapper adapter: ${config.connectionType} für Aufgabe: ${task.title}`);
        }
      }
    }
    
    if (!adapter) {
      return {
        success: false,
        output: 'Kein passender Adapter gefunden',
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: 0,
        error: 'No adapter found for task',
      };
    }

    // Initialize adapter if needed
    if (adapter.initialize && !this.initialized) {
      await adapter.initialize(config);
      this.initialized = true;
    }

    try {
      // Execute the task
      const result = await adapter.execute(task, context, config);
      return result;
    } finally {
      // Cleanup if adapter has cleanup method
      if (adapter.cleanup) {
        await adapter.cleanup(config).catch(console.error);
      }
    }
  }

  /**
   * Gibt alle registrierten Adapter zurück
   */
  getRegisteredAdapters(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Gibt einen spezifischen Adapter zurück
   */
  getAdapter(name: string): Adapter | undefined {
    return this.adapters.get(name);
  }
}

// Singleton instance
export const adapterRegistry = new AdapterRegistry();

// Convenience function
export async function executeWithAdapter(
  task: AdapterTask,
  context: AdapterContext,
  config: AdapterConfig
): Promise<AdapterExecutionResult> {
  return adapterRegistry.executeTask(task, context, config);
}

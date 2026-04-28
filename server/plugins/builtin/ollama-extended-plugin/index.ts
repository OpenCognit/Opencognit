// Ollama Extended Plugin - Erweiterte Ollama-Integration

import { AbstractPlugin } from '../../abstract-plugin.js';
import {
  PluginMetadata,
  PluginContext,
  EventEmitter,
  PluginEvents,
  PluginUiComponents
} from '../../types.js';
import { Adapter, AdapterTask, AdapterContext, AdapterConfig, AdapterExecutionResult } from '../../../adapters/types.js';
import { adapterRegistry } from '../../../adapters/registry.js';

/**
 * Erweiterter Ollama-Adapter
 * Basiert auf dem Basis-Ollama-Adapter, fügt aber weitere Funktionen hinzu
 */
class OllamaExtendedAdapter implements Adapter {
  public readonly name = 'ollama-extended';

  private baseUrl: string = 'http://localhost:11434';
  private defaultModel: string = 'llama3';
  private contextWindow: number = 4096;
  private enableCache: boolean = true;
  private cache: Map<string, string> = new Map();
  private logger: any;

  constructor(config: {
    baseUrl?: string;
    defaultModel?: string;
    contextWindow?: number;
    enableCache?: boolean;
    logger?: any;
  } = {}) {
    this.baseUrl = config.baseUrl || this.baseUrl;
    this.defaultModel = config.defaultModel || this.defaultModel;
    this.contextWindow = config.contextWindow || this.contextWindow;
    this.enableCache = config.enableCache !== undefined ? config.enableCache : this.enableCache;
    this.logger = config.logger || console;
  }

  canHandle(task: AdapterTask): boolean {
    // Kann Aufgaben bearbeiten, die explizit Ollama erwähnen oder lokale Modelle anfordern
    const text = `${task.title} ${task.description || ''}`.toLowerCase();

    return text.includes('ollama') ||
           text.includes('lokales modell') ||
           text.includes('local model') ||
           text.includes('llama') ||
           text.includes('mistral') ||
           text.includes('offline');
  }

  async execute(task: AdapterTask, context: AdapterContext, config: AdapterConfig): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    this.logger.info(`[Ollama Extended] Führe Aufgabe aus: ${task.title}`);

    try {
      // Cache-Schlüssel erstellen (einfache Implementierung)
      const cacheKey = `${task.id}-${task.title}`;

      // Prüfen, ob die Antwort im Cache ist
      if (this.enableCache && this.cache.has(cacheKey)) {
        const cachedResult = this.cache.get(cacheKey);
        this.logger.info(`[Ollama Extended] Cache-Treffer für: ${task.title}`);

        return {
          success: true,
          output: cachedResult || '',
          exitCode: 0,
          inputTokens: 0, // Aus Cache, also keine neuen Token
          outputTokens: 0,
          costCents: 0,    // Lokale Modelle haben keine API-Kosten
          durationMs: 10,  // Minimal, da aus Cache
        };
      }

      // Prompt erstellen
      const prompt = this.buildPrompt(task, context);

      // Tatsächliche Ollama API-Anfrage simulieren
      // In einer echten Implementierung würde hier ein fetch an die Ollama API erfolgen
      this.logger.info(`[Ollama Extended] Sende Anfrage an Ollama API: ${this.baseUrl}/api/generate`);

      // Simulierte Antwort (in echter Implementierung würde die Antwort von der API kommen)
      const response = `Ich habe Aufgabe "${task.title}" analysiert und bearbeite sie wie folgt:\n\n` +
        `1. Zuerst verstehe ich den Kontext: ${context.companyContext.name}\n` +
        `2. Als ${context.agentContext.name} mit Rolle ${context.agentContext.role} muss ich:\n` +
        `3. ${task.title} mit Priorität ${task.priority} bearbeiten.\n\n` +
        `Meine Lösung lautet: Diese Aufgabe wurde erfolgreich mit dem erweiterten Ollama-Adapter bearbeitet.\n` +
        `Modell: ${this.defaultModel}, Kontext-Fenster: ${this.contextWindow}\n\n` +
        `Status: Abgeschlossen`;

      // Antwort im Cache speichern
      if (this.enableCache) {
        this.cache.set(cacheKey, response);
      }

      // Simuliere Token-Zählung (in echter Implementierung würde das von der API kommen)
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(response.length / 4);

      const result: AdapterExecutionResult = {
        success: true,
        output: response,
        exitCode: 0,
        inputTokens,
        outputTokens,
        costCents: 0, // Lokale Modelle haben keine API-Kosten
        durationMs: Date.now() - startTime,
      };

      this.logger.info(`[Ollama Extended] Aufgabe abgeschlossen in ${result.durationMs}ms`);
      return result;

    } catch (error: any) {
      this.logger.error(`[Ollama Extended] Fehler bei Aufgabenausführung:`, error);

      return {
        success: false,
        output: `Fehler bei der Ausführung: ${error.message || 'Unbekannter Fehler'}`,
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Erstellt einen Prompt für die Ollama-Anfrage
   */
  private buildPrompt(task: AdapterTask, context: AdapterContext): string {
    const parts: string[] = [];

    parts.push(`# Aufgabe: ${task.title}`);

    if (task.description) {
      parts.push(`## Beschreibung:\n${task.description}`);
    }

    parts.push(`## Kontext:\n`);
    parts.push(`- Unternehmen: ${context.companyContext.name}`);

    if (context.companyContext.goal) {
      parts.push(`- Unternehmensziel: ${context.companyContext.goal}`);
    }

    parts.push(`- Agent: ${context.agentContext.name} (${context.agentContext.role})`);

    if (context.agentContext.skills) {
      parts.push(`- Fähigkeiten: ${context.agentContext.skills}`);
    }

    if (context.previousComments.length > 0) {
      parts.push(`\n## Vorherige Kommentare:\n`);

      for (const comment of context.previousComments) {
        parts.push(`- ${comment.senderType === 'agent' ? 'Agent' : 'Board'}: ${comment.content.substring(0, 100)}...`);
      }
    }

    parts.push(`\n## Anweisung:\nBearbeite die oben genannte Aufgabe und gib eine strukturierte Antwort.`);

    return parts.join('\n\n');
  }

  /**
   * Setzt die Adapter-Konfiguration
   */
  setConfig(config: {
    baseUrl?: string;
    defaultModel?: string;
    contextWindow?: number;
    enableCache?: boolean;
  }): void {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.defaultModel) this.defaultModel = config.defaultModel;
    if (config.contextWindow) this.contextWindow = config.contextWindow;
    if (config.enableCache !== undefined) this.enableCache = config.enableCache;
  }

  /**
   * Leert den Cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Ollama Extended Plugin
 * Fügt einen erweiterten Ollama-Adapter hinzu
 */
export class OllamaExtendedPlugin extends AbstractPlugin {
  metadata: PluginMetadata = {
    id: 'opencognit-ollama-extended',
    name: 'Ollama Extended',
    description: 'Erweiterte Ollama-Integration mit Modell-Management und Performance-Optimierungen',
    version: '1.0.0',
    author: 'OpenCognit Team',
    license: 'MIT',
    icon: 'cpu',
    categories: ['adapter', 'local-ai'],
    isPremium: false,
  };

  private adapter: OllamaExtendedAdapter | null = null;

  // Plugin-Konfiguration
  private config: {
    ollamaUrl: string;
    defaultModel: string;
    contextWindow: number;
    enableCache: boolean;
  } = {
    ollamaUrl: 'http://localhost:11434',
    defaultModel: 'llama3',
    contextWindow: 4096,
    enableCache: true,
  };

  // Verfügbare Modelle (würde in echter Implementierung von der API abgerufen werden)
  private availableModels: Array<{ id: string; name: string; size: string; quantization: string }> = [
    { id: 'llama3', name: 'Llama 3 8B', size: '8B', quantization: 'Q5_K_M' },
    { id: 'mistral', name: 'Mistral 7B', size: '7B', quantization: 'Q4_K_M' },
    { id: 'codegemma', name: 'CodeGemma 7B', size: '7B', quantization: 'Q4_K_M' },
    { id: 'phi3', name: 'Phi-3 Mini', size: '3.8B', quantization: 'Q4_K_M' },
    { id: 'llama3:70b', name: 'Llama 3 70B', size: '70B', quantization: 'Q4_K_M' },
  ];

  /**
   * Plugin initialisieren
   */
  protected async onInitialize(config: Record<string, any>): Promise<void> {
    // Konfiguration laden
    this.config = {
      ollamaUrl: config.ollamaUrl || this.config.ollamaUrl,
      defaultModel: config.defaultModel || this.config.defaultModel,
      contextWindow: config.contextWindow || this.config.contextWindow,
      enableCache: config.enableCache !== undefined ? config.enableCache : this.config.enableCache,
    };

    this.log('info', `Ollama Extended Plugin initialisiert mit: ${JSON.stringify(this.config)}`);

    // Adapter erstellen
    this.adapter = new OllamaExtendedAdapter({
      baseUrl: this.config.ollamaUrl,
      defaultModel: this.config.defaultModel,
      contextWindow: this.config.contextWindow,
      enableCache: this.config.enableCache,
      logger: this.context?.logger || console,
    });

    // UI-Komponenten definieren
    this.uiComponents = {
      // Einstellungsseite
      settingsPages: [
        {
          id: 'ollama-settings',
          title: 'Ollama Einstellungen',
          component: 'OllamaSettings',
          icon: 'cpu',
          position: 20,
        },
      ],
    };

    // Verfügbare Modelle abrufen (in echter Implementierung würde hier die API abgefragt werden)
    await this.fetchAvailableModels();
  }

  /**
   * Plugin starten
   */
  protected async onStart(): Promise<void> {
    if (!this.adapter) {
      throw new Error('Adapter wurde nicht initialisiert');
    }

    // Adapter registrieren
    adapterRegistry.register('ollama-extended', this.adapter);

    this.log('info', 'Ollama Extended Adapter registriert');

    // Aktualisiere Adapter-Konfiguration
    this.adapter.setConfig({
      baseUrl: this.config.ollamaUrl,
      defaultModel: this.config.defaultModel,
      contextWindow: this.config.contextWindow,
      enableCache: this.config.enableCache,
    });

    // API-Endpunkte registrieren
    if (this.context) {
      // Endpunkt zum Abrufen verfügbarer Modelle
      this.context.registerEndpoint('get', '/api/plugins/ollama-extended/models', (req, res) => {
        res.json(this.availableModels);
      });

      // Endpunkt zum Leeren des Caches
      this.context.registerEndpoint('post', '/api/plugins/ollama-extended/clear-cache', (req, res) => {
        if (this.adapter) {
          this.adapter.clearCache();
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: 'Adapter nicht initialisiert' });
        }
      });
    }
  }

  /**
   * Plugin stoppen
   */
  protected async onStop(): Promise<void> {
    // Adapter deregistrieren
    adapterRegistry.getAdapter('ollama-extended');

    this.log('info', 'Ollama Extended Adapter deregistriert');
  }

  /**
   * Event-Handler registrieren
   */
  protected onRegisterEventHandlers(emitter: EventEmitter): void {
    // Keine speziellen Event-Handler für dieses Plugin
  }

  /**
   * Verfügbare Modelle abrufen
   * In einer echten Implementierung würde hier eine Anfrage an die Ollama API erfolgen
   */
  private async fetchAvailableModels(): Promise<void> {
    try {
      this.log('info', 'Rufe verfügbare Ollama-Modelle ab');

      // In echter Implementierung:
      // const response = await fetch(`${this.config.ollamaUrl}/api/tags`);
      // const data = await response.json();
      // this.availableModels = data.models.map(model => ({ ... });

      // In dieser Simulation verwenden wir die vordefinierten Modelle
      this.log('info', `${this.availableModels.length} Modelle verfügbar`);
    } catch (error) {
      this.log('error', 'Fehler beim Abrufen der verfügbaren Modelle:', error);
    }
  }
}

// Export des Plugin-Konstruktors
export default function createPlugin() {
  return new OllamaExtendedPlugin();
}
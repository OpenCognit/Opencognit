// Abstract Plugin - Basis-Klasse für alle Plugins

import {
  Plugin,
  PluginMetadata,
  PluginContext,
  EventEmitter,
  PluginUiComponents
} from './types.js';

/**
 * Abstrakte Basis-Klasse für Plugins
 * Implementiert die grundlegenden Funktionen, die alle Plugins gemeinsam haben
 */
export abstract class AbstractPlugin implements Plugin {
  // Plugin-Metadaten (müssen von abgeleiteten Klassen überschrieben werden)
  abstract metadata: PluginMetadata;

  // Interner Context-Speicher
  protected context: PluginContext | null = null;

  // Speicher für UI-Komponenten
  protected uiComponents: PluginUiComponents = {};

  // Flag, ob das Plugin initialisiert wurde
  protected isInitialized = false;

  /**
   * Initialisiert das Plugin
   * Diese Methode wird vom Plugin-Manager beim Laden des Plugins aufgerufen
   */
  async initialize(context: PluginContext): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.context = context;

    try {
      // Lade Plugin-Konfiguration aus Context
      const config = context.config || {};

      // Führe Plugin-spezifische Initialisierungslogik aus
      await this.onInitialize(config);

      this.isInitialized = true;
      this.log('info', 'Plugin initialisiert');
    } catch (error) {
      this.log('error', 'Fehler bei der Initialisierung:', error);
      throw error;
    }
  }

  /**
   * Startet das Plugin
   * Diese Methode wird vom Plugin-Manager aufgerufen, wenn das Plugin aktiviert wird
   */
  async start?(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Plugin nicht initialisiert');
    }

    try {
      // Führe Plugin-spezifische Startlogik aus
      await this.onStart?.();
      this.log('info', 'Plugin gestartet');
    } catch (error) {
      this.log('error', 'Fehler beim Starten:', error);
      throw error;
    }
  }

  /**
   * Stoppt das Plugin
   * Diese Methode wird vom Plugin-Manager aufgerufen, wenn das Plugin deaktiviert wird
   */
  async stop?(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Führe Plugin-spezifische Stopplogik aus
      await this.onStop?.();
      this.log('info', 'Plugin gestoppt');
    } catch (error) {
      this.log('error', 'Fehler beim Stoppen:', error);
      throw error;
    }
  }

  /**
   * Deaktiviert das Plugin
   * Diese Methode wird vom Plugin-Manager aufgerufen, wenn das Plugin entfernt wird
   */
  async deactivate?(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Führe Plugin-spezifische Deaktivierungslogik aus
      await this.onDeactivate?.();
      this.log('info', 'Plugin deaktiviert');
      this.isInitialized = false;
    } catch (error) {
      this.log('error', 'Fehler bei der Deaktivierung:', error);
      throw error;
    }
  }

  /**
   * Registriert Event-Handler
   * Diese Methode wird vom Plugin-Manager aufgerufen, wenn das Plugin initialisiert wird
   */
  registerEventHandlers?(emitter: EventEmitter): void {
    if (!this.isInitialized) {
      throw new Error('Plugin nicht initialisiert');
    }

    try {
      // Führe Plugin-spezifische Event-Handler-Registrierung aus
      this.onRegisterEventHandlers?.(emitter);
    } catch (error) {
      this.log('error', 'Fehler bei der Event-Handler-Registrierung:', error);
      throw error;
    }
  }

  /**
   * Liefert die UI-Komponenten des Plugins
   * Diese Methode wird vom Plugin-Manager aufgerufen, wenn das Frontend UI-Komponenten anfordert
   */
  getUiComponents?(): PluginUiComponents {
    return this.uiComponents;
  }

  /**
   * Liefert das Konfigurationsschema für die UI
   */
  getConfigSchema?(): Record<string, any> {
    return {};
  }

  /**
   * Liefert Frontend-Assets (JS, CSS)
   */
  getAssets?(): Array<{ type: 'js' | 'css', path: string }> {
    return [];
  }

  // Abstrakte Methoden, die von abgeleiteten Klassen implementiert werden müssen

  /**
   * Plugin-spezifische Initialisierungslogik
   * Wird von initialize() aufgerufen
   */
  protected abstract onInitialize(config: Record<string, any>): Promise<void>;

  /**
   * Plugin-spezifische Startlogik
   * Wird von start() aufgerufen
   */
  protected onStart?(): Promise<void>;

  /**
   * Plugin-spezifische Stopplogik
   * Wird von stop() aufgerufen
   */
  protected onStop?(): Promise<void>;

  /**
   * Plugin-spezifische Deaktivierungslogik
   * Wird von deactivate() aufgerufen
   */
  protected onDeactivate?(): Promise<void>;

  /**
   * Plugin-spezifische Event-Handler-Registrierung
   * Wird von registerEventHandlers() aufgerufen
   */
  protected onRegisterEventHandlers?(emitter: EventEmitter): void;

  /**
   * Loggt eine Nachricht über den Plugin-Logger
   */
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: any[]): void {
    if (!this.context) {
      console[level](`[${this.metadata.id}] ${message}`, ...args);
      return;
    }

    this.context.logger[level](message, ...args);
  }
}
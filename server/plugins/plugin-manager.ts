// Plugin Manager - Lädt und verwaltet alle Plugins

import * as fs from 'fs';
import * as path from 'path';
import {
  Plugin,
  PluginManager,
  PluginMetadata,
  PluginContext,
  PluginInstallOptions,
  PluginSource,
  PluginStatus,
  PluginEvents
} from './types.js';
import { eventEmitter } from './event-emitter.js';
import { db } from '../db/client.js';
import * as adapterRegistry from '../adapters/registry.js';
import * as heartbeatService from '../services/heartbeat.js';
import * as wakeupService from '../services/wakeup.js';
import * as skillsService from '../services/skills.js';
import { pluginLoader } from './plugin-loader.js';

/**
 * Implementation des Plugin-Managers
 */
export class PluginManagerImpl implements PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private pluginStatuses: Map<string, PluginStatus> = new Map();
  private pluginDirectories: string[] = [];
  private initialized = false;

  /**
   * Erstellt eine neue Plugin-Manager-Instanz
   */
  constructor(
    pluginDirectories: string[] = [
      path.join(process.cwd(), 'data', 'plugins'),
      path.join(process.cwd(), 'server', 'plugins', 'builtin')
    ]
  ) {
    this.pluginDirectories = pluginDirectories;

    // Stelle sicher, dass Plugin-Verzeichnisse existieren
    for (const dir of this.pluginDirectories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Initialisiere den Plugin-Manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('🔌 Initialisiere Plugin-Manager...');

    try {
      // Lade integrierte Plugins
      await this.loadBuiltinPlugins();

      // Lade installierte Plugins
      await this.loadInstalledPlugins();

      this.initialized = true;
      console.log(`✅ Plugin-Manager initialisiert mit ${this.plugins.size} Plugins`);
    } catch (error) {
      console.error('❌ Fehler beim Initialisieren des Plugin-Managers:', error);
      throw error;
    }
  }

  /**
   * Plugin registrieren
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.metadata.id)) {
      throw new Error(`Plugin mit ID '${plugin.metadata.id}' ist bereits registriert`);
    }

    this.plugins.set(plugin.metadata.id, plugin);
    this.pluginStatuses.set(plugin.metadata.id, PluginStatus.INSTALLED);

    console.log(`📦 Plugin registriert: ${plugin.metadata.name} (${plugin.metadata.id}) v${plugin.metadata.version}`);
  }

  /**
   * Plugin von einer Quelle installieren und registrieren
   */
  async installPlugin(source: PluginSource, location: string, options?: { version?: string, force?: boolean }): Promise<string> {
    try {
      const pluginInstallOptions = {
        source,
        location,
        version: options?.version,
        force: options?.force || false
      };

      // Installiere Plugin (installPlugin lädt und registriert das Plugin bereits intern)
      const pluginId = await pluginLoader.installPlugin(pluginInstallOptions);
      return pluginId;
    } catch (error) {
      console.error(`❌ Fehler bei der Plugin-Installation:`, error);
      throw error;
    }
  }

  /**
   * Plugin laden und initialisieren
   */
  async loadPlugin(id: string): Promise<Plugin> {
    const plugin = this.getPlugin(id);

    if (!plugin) {
      throw new Error(`Plugin mit ID '${id}' nicht gefunden`);
    }

    try {
      // Erstelle Plugin-Kontext
      const context = this.createPluginContext(plugin.metadata.id);

      // Initialisiere Plugin
      await plugin.initialize(context);

      // Registriere Event-Handler
      if (plugin.registerEventHandlers) {
        plugin.registerEventHandlers(eventEmitter);
      }

      // Setze Status auf ENABLED
      this.pluginStatuses.set(id, PluginStatus.ENABLED);

      // Löse INITIALIZED-Event aus
      await eventEmitter.emit(PluginEvents.INITIALIZED, { pluginId: id });

      console.log(`✅ Plugin geladen: ${plugin.metadata.name} (${id})`);

      return plugin;
    } catch (error) {
      console.error(`❌ Fehler beim Laden des Plugins '${id}':`, error);
      this.pluginStatuses.set(id, PluginStatus.ERROR);
      throw error;
    }
  }

  /**
   * Plugin entladen
   */
  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.getPlugin(id);

    if (!plugin) {
      throw new Error(`Plugin mit ID '${id}' nicht gefunden`);
    }

    try {
      // Deaktiviere Plugin, falls es eine deactivate-Methode hat
      if (plugin.deactivate) {
        await plugin.deactivate();
      }

      // Entferne Plugin aus Registry
      this.plugins.delete(id);
      this.pluginStatuses.delete(id);

      console.log(`🔌 Plugin entladen: ${plugin.metadata.name} (${id})`);
    } catch (error) {
      console.error(`❌ Fehler beim Entladen des Plugins '${id}':`, error);
      throw error;
    }
  }

  /**
   * Plugin aktivieren
   */
  async enablePlugin(id: string): Promise<void> {
    const plugin = this.getPlugin(id);

    if (!plugin) {
      throw new Error(`Plugin mit ID '${id}' nicht gefunden`);
    }

    if (this.pluginStatuses.get(id) === PluginStatus.ENABLED) {
      console.log(`ℹ️ Plugin '${id}' ist bereits aktiviert`);
      return;
    }

    try {
      // Lade Plugin, falls noch nicht geschehen
      await this.loadPlugin(id);

      // Starte Plugin, falls es eine start-Methode hat
      if (plugin.start) {
        await plugin.start();

        // Löse STARTED-Event aus
        await eventEmitter.emit(PluginEvents.STARTED, { pluginId: id });
      }

      console.log(`✅ Plugin aktiviert: ${plugin.metadata.name} (${id})`);
    } catch (error) {
      console.error(`❌ Fehler beim Aktivieren des Plugins '${id}':`, error);
      this.pluginStatuses.set(id, PluginStatus.ERROR);
      throw error;
    }
  }

  /**
   * Plugin deaktivieren
   */
  async disablePlugin(id: string): Promise<void> {
    const plugin = this.getPlugin(id);

    if (!plugin) {
      throw new Error(`Plugin mit ID '${id}' nicht gefunden`);
    }

    if (this.pluginStatuses.get(id) !== PluginStatus.ENABLED) {
      console.log(`ℹ️ Plugin '${id}' ist nicht aktiviert`);
      return;
    }

    try {
      // Stoppe Plugin, falls es eine stop-Methode hat
      if (plugin.stop) {
        await plugin.stop();

        // Löse STOPPED-Event aus
        await eventEmitter.emit(PluginEvents.STOPPED, { pluginId: id });
      }

      // Setze Status auf DISABLED
      this.pluginStatuses.set(id, PluginStatus.DISABLED);

      console.log(`🔌 Plugin deaktiviert: ${plugin.metadata.name} (${id})`);
    } catch (error) {
      console.error(`❌ Fehler beim Deaktivieren des Plugins '${id}':`, error);
      throw error;
    }
  }

  /**
   * Alle verfügbaren Plugins auflisten
   */
  async listPlugins(): Promise<PluginMetadata[]> {
    return Array.from(this.plugins.values()).map(plugin => ({
      ...plugin.metadata,
      status: this.pluginStatuses.get(plugin.metadata.id) || PluginStatus.DISABLED
    }));
  }

  /**
   * Plugin anhand ID abrufen
   */
  getPlugin(id: string): Plugin | null {
    return this.plugins.get(id) || null;
  }

  /**
   * Plugin-Event auslösen
   */
  async emit(eventName: string, payload?: any): Promise<void> {
    await eventEmitter.emit(eventName, payload);
  }

  /**
   * Lade integrierte Plugins
   * Diese Plugins sind Teil der OpenCognit-Codebasis
   */
  private async loadBuiltinPlugins(): Promise<void> {
    const builtinDir = path.join(process.cwd(), 'server', 'plugins', 'builtin');

    if (!fs.existsSync(builtinDir)) {
      fs.mkdirSync(builtinDir, { recursive: true });
      return; // Keine integrierten Plugins
    }

    // In echter Implementierung würden hier Plugins dynamisch geladen
    // Für diesen Prototyp importieren wir sie manuell

    // Beispiel für ein integriertes Plugin:
    // const analyticsPlugin = new AnalyticsPlugin();
    // await this.registerPlugin(analyticsPlugin);
  }

  /**
   * Lade installierte Plugins aus dem data/plugins Verzeichnis
   */
  private async loadInstalledPlugins(): Promise<void> {
    const pluginsDir = path.join(process.cwd(), 'data', 'plugins');

    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      return; // Keine installierten Plugins
    }

    // In echter Implementierung würden hier Plugins dynamisch geladen
    // Für diesen Prototyp gehen wir davon aus, dass keine Plugins existieren
  }

  /**
   * Erstelle Plugin-Kontext
   * Dieser Kontext wird an Plugins übergeben und ermöglicht Zugriff auf OpenCognit
   */
  private createPluginContext(pluginId: string): PluginContext {
    return {
      db: {
        query: async (sql: string, params?: any[]) => {
          // Einfache Implementierung, in echt müsste Zugriff eingeschränkt werden
          return db.query(sql, params || []);
        }
      },
      events: eventEmitter,
      logger: {
        info: (message: string, ...args: any[]) => console.log(`[${pluginId}] INFO:`, message, ...args),
        warn: (message: string, ...args: any[]) => console.warn(`[${pluginId}] WARN:`, message, ...args),
        error: (message: string, ...args: any[]) => console.error(`[${pluginId}] ERROR:`, message, ...args),
        debug: (message: string, ...args: any[]) => console.debug(`[${pluginId}] DEBUG:`, message, ...args),
      },
      config: {}, // Plugin-Konfiguration (würde aus DB geladen)
      services: {
        adapters: adapterRegistry,
        heartbeat: heartbeatService,
        wakeup: wakeupService,
        skills: skillsService,
      },
      registerEndpoint: (
        method: 'get' | 'post' | 'put' | 'delete',
        path: string,
        handler: (req: any, res: any) => void
      ) => {
        // In echter Implementierung würde hier der Endpunkt registriert
        console.log(`[${pluginId}] Registriere Endpunkt: ${method.toUpperCase()} ${path}`);
      }
    };
  }
}

// Singleton-Instanz
export const pluginManager = new PluginManagerImpl();
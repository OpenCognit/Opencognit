// Plugin Loader - Lädt Plugins aus verschiedenen Quellen

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { promisify } from 'util';
import {
  PluginInstallOptions,
  PluginSource,
  PluginStatus,
  Plugin
} from './types.js';
import { pluginManager } from './plugin-manager.js';

// Promisify-Versionen von fs- und childProcess-Funktionen
const mkdir = promisify(fs.mkdir);
const exec = promisify(childProcess.exec);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Plugin-Loader
 * Verantwortlich für das Laden und Installieren von Plugins aus verschiedenen Quellen
 */
export class PluginLoader {
  private pluginsDir: string;
  private tempDir: string;

  /**
   * Erstellt eine neue Plugin-Loader-Instanz
   */
  constructor(
    pluginsDir: string = path.join(process.cwd(), 'data', 'plugins'),
    tempDir: string = path.join(process.cwd(), 'data', 'temp')
  ) {
    this.pluginsDir = pluginsDir;
    this.tempDir = tempDir;

    // Stelle sicher, dass Verzeichnisse existieren
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
    }

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  }

  /**
   * Plugin installieren
   */
  async installPlugin(options: PluginInstallOptions): Promise<string> {
    console.log(`🔌 Installiere Plugin aus ${options.source}: ${options.location}`);

    let pluginPath: string;

    try {
      // Je nach Quelle unterschiedliche Installation
      switch (options.source) {
        case PluginSource.LOCAL:
          pluginPath = await this.installFromLocal(options.location, options.force);
          break;

        case PluginSource.NPM:
          pluginPath = await this.installFromNpm(options.location, options.version, options.force);
          break;

        case PluginSource.URL:
          pluginPath = await this.installFromUrl(options.location, options.force);
          break;

        case PluginSource.REGISTRY:
          pluginPath = await this.installFromRegistry(options.location, options.version, options.force);
          break;

        default:
          throw new Error(`Unbekannte Plugin-Quelle: ${options.source}`);
      }

      // Plugin laden
      const plugin = await this.loadPluginFromPath(pluginPath);

      // Plugin registrieren
      await pluginManager.registerPlugin(plugin);

      console.log(`✅ Plugin installiert: ${plugin.metadata.name} (${plugin.metadata.id})`);
      return plugin.metadata.id;

    } catch (error) {
      console.error(`❌ Fehler bei der Plugin-Installation:`, error);
      throw error;
    }
  }

  /**
   * Sucht nach verfügbaren Plugins in den Plugin-Verzeichnissen
   */
  async discoverPlugins(): Promise<string[]> {
    console.log('🔍 Suche nach verfügbaren Plugins...');

    const pluginDirs = await this.findPluginDirectories(this.pluginsDir);
    console.log(`✅ ${pluginDirs.length} Plugins gefunden`);

    return pluginDirs;
  }

  /**
   * Lädt alle verfügbaren Plugins
   */
  async loadAllPlugins(): Promise<void> {
    const pluginDirs = await this.discoverPlugins();

    for (const dir of pluginDirs) {
      try {
        const plugin = await this.loadPluginFromPath(dir);
        await pluginManager.registerPlugin(plugin);
      } catch (error) {
        console.error(`❌ Fehler beim Laden des Plugins aus ${dir}:`, error);
      }
    }
  }

  // Private Methoden

  /**
   * Installiert ein Plugin aus einem lokalen Verzeichnis
   */
  private async installFromLocal(location: string, force?: boolean): Promise<string> {
    if (!fs.existsSync(location)) {
      throw new Error(`Lokales Verzeichnis existiert nicht: ${location}`);
    }

    // Lese package.json, um Plugin-ID zu ermitteln
    const packagePath = path.join(location, 'package.json');
    if (!fs.existsSync(packagePath)) {
      throw new Error(`Keine package.json in ${location} gefunden`);
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const pluginId = packageJson.name;

    // Zielverzeichnis
    const targetDir = path.join(this.pluginsDir, pluginId);

    // Prüfe, ob Plugin bereits installiert ist
    if (fs.existsSync(targetDir) && !force) {
      throw new Error(`Plugin ${pluginId} ist bereits installiert. Verwende 'force: true', um zu überschreiben.`);
    }

    // Kopiere Plugin-Verzeichnis
    if (fs.existsSync(targetDir)) {
      // Entferne bestehendes Verzeichnis
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    // Erstelle Zielverzeichnis
    await mkdir(targetDir, { recursive: true });

    // Kopiere Dateien
    await this.copyDirectory(location, targetDir);

    return targetDir;
  }

  /**
   * Installiert ein Plugin aus einem NPM-Paket
   * (Vereinfachte Implementierung für den Prototyp)
   */
  private async installFromNpm(packageName: string, version?: string, force?: boolean): Promise<string> {
    // In einer echten Implementierung würde hier npm/yarn verwendet, um das Paket zu installieren
    // Für den Prototyp werfen wir einen Fehler
    throw new Error('Installation aus NPM ist noch nicht implementiert');
  }

  /**
   * Installiert ein Plugin von einer URL
   * (Vereinfachte Implementierung für den Prototyp)
   */
  private async installFromUrl(url: string, force?: boolean): Promise<string> {
    // In einer echten Implementierung würde hier die URL heruntergeladen und entpackt werden
    // Für den Prototyp werfen wir einen Fehler
    throw new Error('Installation von URL ist noch nicht implementiert');
  }

  /**
   * Installiert ein Plugin aus einem zentralen Registry
   * (Vereinfachte Implementierung für den Prototyp)
   */
  private async installFromRegistry(pluginId: string, version?: string, force?: boolean): Promise<string> {
    // In einer echten Implementierung würde hier eine Anfrage an das Registry gesendet werden
    // Für den Prototyp werfen wir einen Fehler
    throw new Error('Installation aus Registry ist noch nicht implementiert');
  }

  /**
   * Lädt ein Plugin aus einem Verzeichnis
   * In einer echten Implementierung würde hier der Plugin-Code dynamisch geladen werden
   * Für den Prototyp simulieren wir die Implementierung
   */
  public async loadPluginFromPath(pluginPath: string): Promise<Plugin> {
    try {
      // Lese package.json
      const packagePath = path.join(pluginPath, 'package.json');
      if (!fs.existsSync(packagePath)) {
        throw new Error(`Keine package.json in ${pluginPath} gefunden`);
      }

      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      // Lese plugin.json, falls vorhanden
      let pluginJson: any = {};
      const pluginJsonPath = path.join(pluginPath, 'plugin.json');
      if (fs.existsSync(pluginJsonPath)) {
        pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
      }

      // Hier würde in einer echten Implementierung der Plugin-Code dynamisch geladen werden
      // Für den Prototyp erstellen wir ein Dummy-Plugin

      // Die Implementierung des DummyPlugins würde in einer echten Implementierung
      // durch das dynamisch geladene Plugin ersetzt werden
      class DummyPlugin implements Plugin {
        metadata = {
          id: packageJson.name || 'unknown',
          name: packageJson.displayName || packageJson.name || 'Unbekanntes Plugin',
          description: packageJson.description || '',
          version: packageJson.version || '0.0.0',
          author: packageJson.author || 'Unbekannt',
          license: packageJson.license || 'UNLICENSED',
          icon: pluginJson.icon || undefined,
          minOpenCognitVersion: packageJson.engines?.opencognit || undefined,
          dependencies: Object.keys(packageJson.dependencies || {}),
          categories: pluginJson.categories || [],
          isPremium: pluginJson.isPremium || false
        };

        async initialize(context: any): Promise<void> {
          console.log(`[${this.metadata.id}] Plugin initialisiert`);
        }
      }

      return new DummyPlugin();
    } catch (error) {
      console.error(`Fehler beim Laden des Plugins aus ${pluginPath}:`, error);
      throw error;
    }
  }

  /**
   * Sucht nach Plugin-Verzeichnissen im angegebenen Verzeichnis
   */
  private async findPluginDirectories(directory: string): Promise<string[]> {
    const result: string[] = [];

    if (!fs.existsSync(directory)) {
      return result;
    }

    const entries = await readdir(directory);

    for (const entry of entries) {
      const fullPath = path.join(directory, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Prüfe, ob es sich um ein Plugin-Verzeichnis handelt
        const packagePath = path.join(fullPath, 'package.json');
        if (fs.existsSync(packagePath)) {
          result.push(fullPath);
        } else {
          // Rekursive Suche
          const subdirResults = await this.findPluginDirectories(fullPath);
          result.push(...subdirResults);
        }
      }
    }

    return result;
  }

  /**
   * Kopiert ein Verzeichnis rekursiv
   */
  private async copyDirectory(source: string, target: string): Promise<void> {
    // Erstelle Zielverzeichnis
    await mkdir(target, { recursive: true });

    // Lese Quelldateien
    const entries = await readdir(source);

    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);

      const stats = await stat(sourcePath);

      if (stats.isDirectory()) {
        // Rekursive Kopie
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        // Kopiere Datei
        await fs.promises.copyFile(sourcePath, targetPath);
      }
    }
  }
}

// Singleton-Instanz
export const pluginLoader = new PluginLoader();
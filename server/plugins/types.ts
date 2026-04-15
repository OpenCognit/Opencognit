// Plugin System Types - Grundlegende Typen für das Plugin-Framework

/**
 * Metadaten für Plugins
 */
export interface PluginMetadata {
  // Eindeutige ID des Plugins (z.B. "opencognit-analytics")
  id: string;

  // Name des Plugins zur Anzeige in der UI
  name: string;

  // Kurzbeschreibung des Plugins
  description: string;

  // Version des Plugins (Semver)
  version: string;

  // Plugin-Autor (Name oder Organisation)
  author: string;

  // Lizenz (z.B. "MIT", "GPL", "Commercial")
  license: string;

  // Icon für die UI (optional)
  icon?: string;

  // Minimale OpenCognit-Version
  minOpenCognitVersion?: string;

  // Plugin-Abhängigkeiten
  dependencies?: string[];

  // Plugin-Kategorien (z.B. "analytics", "adapter", "ui")
  categories?: string[];

  // Premium-Flag (für monetarisierte Plugins)
  isPremium?: boolean;
}

/**
 * Plugin-Kontext - Wird an Plugins übergeben, um Zugriff auf OpenCognit zu ermöglichen
 */
export interface PluginContext {
  // API für Datenbankzugriff
  db: {
    query: (sql: string, params?: any[]) => Promise<any[]>;
    // Weitere DB-Methoden hier...
  };

  // Event-Emitter für Plugin-Kommunikation
  events: EventEmitter;

  // Logger-Instanz für das Plugin
  logger: {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
  };

  // Konfiguration des Plugins
  config: Record<string, any>;

  // OpenCognit-Services
  services: {
    adapters: any; // AdapterRegistry
    heartbeat: any; // HeartbeatService
    wakeup: any; // WakeupService
    skills: any; // SkillsService
    // Weitere Services hier...
  };

  // API für HTTP-Endpunkte registrieren
  registerEndpoint: (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    handler: (req: any, res: any) => void
  ) => void;
}

/**
 * EventEmitter-Interface für Plugin-Kommunikation
 */
export interface EventEmitter {
  // Event auslösen
  emit(eventName: string, payload?: any): Promise<void>;

  // Event-Handler registrieren
  on(eventName: string, handler: (payload?: any) => void | Promise<void>): void;

  // Event-Handler entfernen
  off(eventName: string, handler: (payload?: any) => void | Promise<void>): void;

  // Einmal-Event-Handler registrieren
  once(eventName: string, handler: (payload?: any) => void | Promise<void>): void;
}

/**
 * UI-Komponenten-Map für Frontend-Integration
 */
export interface PluginUiComponents {
  // Dashboard-Widgets
  dashboardWidgets?: Array<{
    id: string;
    title: string;
    component: string; // Frontend-React-Komponente
    defaultSize: { width: number; height: number };
    minSize?: { width: number; height: number };
    maxSize?: { width: number; height: number };
  }>;

  // Navigationseinträge
  navItems?: Array<{
    id: string;
    title: string;
    path: string;
    icon: string;
    component: string;
    position: number;
    parentId?: string;
  }>;

  // Task-Aktionen
  taskActions?: Array<{
    id: string;
    title: string;
    icon: string;
    handler: string;
  }>;

  // Einstellungsseiten
  settingsPages?: Array<{
    id: string;
    title: string;
    component: string;
    icon: string;
    position: number;
  }>;
}

/**
 * Plugin-Interface - Hauptschnittstelle für alle Plugins
 */
export interface Plugin {
  // Plugin-Metadaten
  metadata: PluginMetadata;

  // Lebenszyklus: Initialisierung (wird beim Plugin-Laden aufgerufen)
  initialize(context: PluginContext): Promise<void>;

  // Lebenszyklus: Start (wird beim Server-Start aufgerufen)
  start?(): Promise<void>;

  // Lebenszyklus: Stop (wird beim Server-Stop aufgerufen)
  stop?(): Promise<void>;

  // Lebenszyklus: Deaktivierung (wird vor dem Entladen aufgerufen)
  deactivate?(): Promise<void>;

  // Konfigurationsschema für die UI
  getConfigSchema?(): Record<string, any>;

  // Frontend-Komponenten
  getUiComponents?(): PluginUiComponents;

  // Frontend-Assets (JS, CSS)
  getAssets?(): Array<{ type: 'js' | 'css', path: string }>;

  // Event-Handler registrieren
  registerEventHandlers?(emitter: EventEmitter): void;
}

/**
 * Plugin-Manager-Interface - Verwaltet alle Plugins
 */
export interface PluginManager {
  // Plugin registrieren
  registerPlugin(plugin: Plugin): Promise<void>;

  // Plugin von einer Quelle installieren und registrieren
  installPlugin(source: PluginSource, location: string, options?: { version?: string, force?: boolean }): Promise<string>;

  // Plugin laden und initialisieren
  loadPlugin(id: string): Promise<Plugin>;

  // Plugin entladen
  unloadPlugin(id: string): Promise<void>;

  // Plugin aktivieren
  enablePlugin(id: string): Promise<void>;

  // Plugin deaktivieren
  disablePlugin(id: string): Promise<void>;

  // Alle verfügbaren Plugins auflisten
  listPlugins(): Promise<PluginMetadata[]>;

  // Plugin anhand ID abrufen
  getPlugin(id: string): Plugin | null;

  // Events zwischen Plugins weiterleiten
  emit(eventName: string, payload?: any): Promise<void>;
}

/**
 * Standard-Event-Namen für das Plugin-System
 */
export enum PluginEvents {
  // Lebenszyklus-Events
  INITIALIZED = 'plugin:initialized',
  STARTED = 'plugin:started',
  STOPPED = 'plugin:stopped',

  // OpenCognit-Events
  TASK_CREATED = 'opencognit:task:created',
  TASK_UPDATED = 'opencognit:task:updated',
  TASK_COMPLETED = 'opencognit:task:completed',
  EXPERT_CREATED = 'opencognit:expert:created',
  EXPERT_UPDATED = 'opencognit:expert:updated',
  HEARTBEAT_STARTED = 'opencognit:heartbeat:started',
  HEARTBEAT_COMPLETED = 'opencognit:heartbeat:completed',
}

/**
 * Plugin-Installation-Quelle
 */
export enum PluginSource {
  LOCAL = 'local',     // Lokales Verzeichnis
  NPM = 'npm',         // NPM-Paket
  URL = 'url',         // Download von URL
  REGISTRY = 'registry' // Zentrales Registry
}

/**
 * Plugin-Installation-Optionen
 */
export interface PluginInstallOptions {
  source: PluginSource;
  location: string;    // Pfad, URL oder Paketname
  version?: string;    // Version (für NPM)
  force?: boolean;     // Bestehende Installation überschreiben
}

/**
 * Plugin-Status
 */
export enum PluginStatus {
  INSTALLED = 'installed',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ERROR = 'error'
}
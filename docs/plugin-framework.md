# OpenCognit Plugin-Framework Dokumentation

## Übersicht

Das OpenCognit Plugin-Framework ermöglicht die Erweiterung von OpenCognit durch Plugins. Plugins können neue Funktionen hinzufügen, bestehende Funktionen erweitern und die Benutzeroberfläche anpassen.

Diese Dokumentation richtet sich an Entwickler, die Plugins für OpenCognit erstellen möchten.

## Inhaltsverzeichnis

1. [Einführung](#einführung)
2. [Plugin-Struktur](#plugin-struktur)
3. [Plugin-Lebenszyklus](#plugin-lebenszyklus)
4. [Plugin-API](#plugin-api)
5. [Event-System](#event-system)
6. [Frontend-Integration](#frontend-integration)
7. [Plugin erstellen](#plugin-erstellen)
8. [Plugin installieren](#plugin-installieren)
9. [Beispiele](#beispiele)
10. [Best Practices](#best-practices)

## Einführung

Das Plugin-Framework von OpenCognit basiert auf einem einfachen, aber leistungsfähigen Konzept: Plugins sind Module, die sich in das OpenCognit-System einklinken und dieses erweitern können. Jedes Plugin definiert seine Metadaten, Abhängigkeiten und Funktionen und kann mit anderen Plugins und dem OpenCognit-Kern interagieren.

Die Hauptfunktionen des Plugin-Frameworks sind:

- **Plugin-Lebenszyklus-Management**: Initialisierung, Start, Stopp und Deaktivierung von Plugins
- **Event-System**: Kommunikation zwischen Plugins und mit dem OpenCognit-Kern
- **Frontend-Integration**: Einbindung von Plugin-UI-Komponenten in die OpenCognit-Benutzeroberfläche
- **API-Erweiterung**: Hinzufügen neuer API-Endpunkte für Plugin-Funktionalitäten
- **Adapter-Erweiterung**: Hinzufügen neuer Adapter für verschiedene KI-Modelle und -Dienste

## Plugin-Struktur

Ein OpenCognit-Plugin besteht aus folgenden Komponenten:

### 1. Metadaten

Jedes Plugin definiert grundlegende Metadaten:

```typescript
interface PluginMetadata {
  id: string;            // Eindeutige Plugin-ID (z.B. "opencognit-analytics")
  name: string;          // Anzeigename des Plugins
  description: string;   // Kurzbeschreibung des Plugins
  version: string;       // Version des Plugins (Semver)
  author: string;        // Plugin-Autor
  license: string;       // Lizenz (z.B. "MIT")
  icon?: string;         // Icon für die UI (optional)
  minOpenCognitVersion?: string;  // Minimale OpenCognit-Version
  dependencies?: string[];  // Plugin-Abhängigkeiten
  categories?: string[];    // Plugin-Kategorien
  isPremium?: boolean;      // Premium-Flag
}
```

### 2. Plugin-Paketstruktur

Ein Plugin-Paket ist typischerweise wie folgt strukturiert:

```
plugin-name/
├── package.json         // NPM-Paket-Datei mit Abhängigkeiten
├── plugin.json          // Plugin-Metadaten und -Konfiguration
├── index.ts             // Haupteinstiegspunkt des Plugins
├── frontend/            // Frontend-Komponenten
│   └── components.tsx   // React-Komponenten für die UI
├── assets/              // Assets (Bilder, CSS, etc.)
└── README.md            // Plugin-Dokumentation
```

## Plugin-Lebenszyklus

Ein Plugin durchläuft folgende Lebenszyklus-Phasen:

1. **Installation**: Plugin wird im Plugin-Verzeichnis installiert
2. **Initialisierung**: Plugin wird beim Server-Start initialisiert
3. **Aktivierung**: Plugin wird aktiviert (start)
4. **Deaktivierung**: Plugin wird deaktiviert (stop)
5. **Deinstallation**: Plugin wird aus dem Plugin-Verzeichnis entfernt

Jede Phase wird über entsprechende Methoden des Plugin-Interfaces gesteuert.

## Plugin-API

### Plugin Interface

Das Hauptinterface für Plugins ist `Plugin`:

```typescript
interface Plugin {
  // Plugin-Metadaten
  metadata: PluginMetadata;

  // Lebenszyklus: Initialisierung
  initialize(context: PluginContext): Promise<void>;

  // Lebenszyklus: Start
  start?(): Promise<void>;

  // Lebenszyklus: Stop
  stop?(): Promise<void>;

  // Lebenszyklus: Deaktivierung
  deactivate?(): Promise<void>;

  // Konfigurationsschema für die UI
  getConfigSchema?(): Record<string, any>;

  // Frontend-Komponenten
  getUiComponents?(): PluginUiComponents;

  // Frontend-Assets
  getAssets?(): Array<{ type: 'js' | 'css', path: string }>;

  // Event-Handler registrieren
  registerEventHandlers?(emitter: EventEmitter): void;
}
```

### Plugin-Kontext

Beim Initialisieren erhält ein Plugin einen Kontext, der Zugriff auf OpenCognit-Services bietet:

```typescript
interface PluginContext {
  // DB-Zugriff
  db: {
    query: (sql: string, params?: any[]) => Promise<any[]>;
    // Weitere DB-Methoden...
  };

  // Event-Emitter
  events: EventEmitter;

  // Logger
  logger: {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
  };

  // Plugin-Konfiguration
  config: Record<string, any>;

  // OpenCognit-Services
  services: {
    adapters: any;    // AdapterRegistry
    heartbeat: any;   // HeartbeatService
    wakeup: any;      // WakeupService
    skills: any;      // SkillsService
    // Weitere Services...
  };

  // API-Endpunkte registrieren
  registerEndpoint: (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    handler: (req: any, res: any) => void
  ) => void;
}
```

### Abstract Plugin

Für eine einfachere Implementierung steht eine abstrakte Basis-Klasse zur Verfügung:

```typescript
abstract class AbstractPlugin implements Plugin {
  // Muss von abgeleiteten Klassen überschrieben werden
  abstract metadata: PluginMetadata;

  // Plugin-Kontext
  protected context: PluginContext | null = null;

  // UI-Komponenten
  protected uiComponents: PluginUiComponents = {};

  // Flag für Initialisierung
  protected isInitialized = false;

  // Implementiert die grundlegenden Methoden des Plugin-Interfaces
  async initialize(context: PluginContext): Promise<void> { ... }
  async start?(): Promise<void> { ... }
  async stop?(): Promise<void> { ... }
  async deactivate?(): Promise<void> { ... }
  registerEventHandlers?(emitter: EventEmitter): void { ... }

  // Abstrakte Methoden, die von abgeleiteten Klassen implementiert werden müssen
  protected abstract onInitialize(config: Record<string, any>): Promise<void>;
  protected onStart?(): Promise<void>;
  protected onStop?(): Promise<void>;
  protected onDeactivate?(): Promise<void>;
  protected onRegisterEventHandlers?(emitter: EventEmitter): void;

  // Hilfsmethode zum Loggen
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: any[]): void { ... }
}
```

## Event-System

Plugins können über ein Event-System miteinander kommunizieren:

```typescript
interface EventEmitter {
  // Event auslösen
  emit(eventName: string, payload?: any): Promise<void>;

  // Event-Handler registrieren
  on(eventName: string, handler: (payload?: any) => void | Promise<void>): void;

  // Event-Handler entfernen
  off(eventName: string, handler: (payload?: any) => void | Promise<void>): void;

  // Einmal-Event-Handler registrieren
  once(eventName: string, handler: (payload?: any) => void | Promise<void>): void;
}
```

### Standard-Events

Das Framework definiert einige Standard-Events:

```typescript
enum PluginEvents {
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
```

## Frontend-Integration

Plugins können Frontend-Komponenten zur OpenCognit-UI hinzufügen:

```typescript
interface PluginUiComponents {
  // Dashboard-Widgets
  dashboardWidgets?: Array<{
    id: string;
    title: string;
    component: string; // Name der React-Komponente
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
```

## Plugin erstellen

### 1. Verzeichnisstruktur anlegen

```bash
mkdir -p mein-plugin
cd mein-plugin
```

### 2. package.json erstellen

```json
{
  "name": "opencognit-mein-plugin",
  "displayName": "Mein Plugin",
  "version": "1.0.0",
  "description": "Mein OpenCognit Plugin",
  "author": "Mein Name",
  "license": "MIT",
  "main": "index.js"
}
```

### 3. plugin.json erstellen

```json
{
  "icon": "package",
  "categories": ["tools"],
  "isPremium": false,
  "settings": [
    {
      "id": "setting1",
      "type": "boolean",
      "label": "Einstellung 1",
      "description": "Beschreibung der Einstellung 1",
      "default": true
    }
  ]
}
```

### 4. Plugin-Klasse implementieren

```typescript
import { AbstractPlugin } from '../../abstract-plugin.js';
import {
  PluginMetadata,
  PluginContext,
  EventEmitter
} from '../../types.js';

export class MeinPlugin extends AbstractPlugin {
  metadata: PluginMetadata = {
    id: 'opencognit-mein-plugin',
    name: 'Mein Plugin',
    description: 'Mein OpenCognit Plugin',
    version: '1.0.0',
    author: 'Mein Name',
    license: 'MIT',
    icon: 'package',
    categories: ['tools'],
    isPremium: false,
  };

  protected async onInitialize(config: Record<string, any>): Promise<void> {
    this.log('info', 'Mein Plugin initialisiert');

    // UI-Komponenten definieren
    this.uiComponents = {
      dashboardWidgets: [
        {
          id: 'mein-widget',
          title: 'Mein Widget',
          component: 'MeinWidget',
          defaultSize: { width: 6, height: 4 },
        },
      ],
    };

    // Konfiguration laden
    const setting1 = config.setting1 !== undefined ? config.setting1 : true;
    this.log('info', `Konfiguration geladen: setting1=${setting1}`);
  }

  protected async onStart(): Promise<void> {
    this.log('info', 'Mein Plugin gestartet');
  }

  protected async onStop(): Promise<void> {
    this.log('info', 'Mein Plugin gestoppt');
  }

  protected onRegisterEventHandlers(emitter: EventEmitter): void {
    emitter.on('opencognit:task:created', this.handleTaskCreated.bind(this));
  }

  private async handleTaskCreated(payload: any): Promise<void> {
    this.log('info', 'Neuer Task erstellt:', payload.id);
  }
}

// Export des Plugin-Konstruktors
export default function createPlugin() {
  return new MeinPlugin();
}
```

### 5. Frontend-Komponenten erstellen

```tsx
// frontend/components.tsx

const MeinWidget = () => {
  return (
    <div className="mein-widget">
      <h3>Mein Widget</h3>
      <p>Inhalt meines Widgets</p>
    </div>
  );
};

export { MeinWidget };
```

## Plugin installieren

### Manuelle Installation

1. Kompiliere das Plugin (wenn nötig)
2. Kopiere das Plugin-Verzeichnis nach `/home/panto/CODING/OpenCognit/data/plugins/`
3. Starte den OpenCognit-Server neu

### Über die API

```bash
curl -X POST http://localhost:3201/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{
    "source": "local",
    "location": "/path/to/my-plugin",
    "force": true
  }'
```

### Über die UI

1. Gehe zu "Einstellungen" > "Plugins"
2. Klicke auf "Plugin installieren"
3. Wähle die Quelle und den Pfad aus
4. Klicke auf "Installieren"

## Beispiele

### Analytik-Plugin

Das Analytics-Plugin sammelt und visualisiert Nutzungsdaten:

- Tracking von Token-Nutzung und Kosten
- Dashboard-Widgets für Nutzungsdaten
- Detaillierte Analysenseite

Siehe `/home/panto/CODING/OpenCognit/server/plugins/builtin/analytics-plugin/` für die vollständige Implementierung.

### Ollama-Erweiterung

Das Ollama-Extended-Plugin erweitert den Ollama-Adapter um zusätzliche Funktionen:

- Modell-Management
- Caching für Anfragen
- Konfigurationsmöglichkeiten

Siehe `/home/panto/CODING/OpenCognit/server/plugins/builtin/ollama-extended-plugin/` für die vollständige Implementierung.

## Best Practices

1. **Isolation**: Halte dein Plugin so isoliert wie möglich, um Konflikte mit anderen Plugins zu vermeiden
2. **Fehlerbehandlung**: Implementiere robuste Fehlerbehandlung, damit Fehler in deinem Plugin nicht den gesamten Server beeinträchtigen
3. **Ressourcenmanagement**: Achte darauf, dass dein Plugin Ressourcen (DB-Verbindungen, Dateien, etc.) ordnungsgemäß öffnet und schließt
4. **Dokumentation**: Dokumentiere dein Plugin ausführlich, damit andere Entwickler es verstehen und nutzen können
5. **Versionierung**: Verwende semantische Versionierung für dein Plugin
6. **Tests**: Implementiere Tests für dein Plugin, um sicherzustellen, dass es korrekt funktioniert

## Häufig gestellte Fragen

**F: Kann ich mehrere Plugins gleichzeitig installieren?**
A: Ja, OpenCognit unterstützt die gleichzeitige Verwendung mehrerer Plugins.

**F: Werden Plugins automatisch aktualisiert?**
A: Nein, Plugin-Updates müssen manuell installiert werden.

**F: Kann ich ein Plugin für mehrere OpenCognit-Instanzen nutzen?**
A: Ja, du kannst ein Plugin-Paket erstellen und in mehreren OpenCognit-Instanzen installieren.

**F: Wie deinstalliere ich ein Plugin?**
A: Du kannst ein Plugin über die API oder die UI deinstallieren oder es manuell aus dem Plugin-Verzeichnis entfernen.
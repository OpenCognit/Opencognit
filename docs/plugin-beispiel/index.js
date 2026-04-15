// Beispiel-Plugin für OpenCognit

import { AbstractPlugin } from '../../server/plugins/abstract-plugin.js';
import {
  PluginMetadata,
  PluginContext,
  EventEmitter,
  PluginEvents,
  PluginUiComponents
} from '../../server/plugins/types.js';

/**
 * Beispiel-Plugin für OpenCognit
 * Demonstriert die grundlegenden Funktionen eines Plugins
 */
export class ExamplePlugin extends AbstractPlugin {
  // Plugin-Metadaten
  metadata = {
    id: 'opencognit-example-plugin',
    name: 'Beispiel Plugin',
    description: 'Ein Beispiel-Plugin für OpenCognit',
    version: '1.0.0',
    author: 'OpenCognit Team',
    license: 'MIT',
    icon: 'zap',
    categories: ['utilities', 'example'],
    isPremium: false,
  };

  // Plugin-Konfiguration
  private config = {
    enableNotifications: true,
    notificationSound: 'ping',
    refreshInterval: 60,
  };

  // Plugin-Status
  private stats = {
    eventsProcessed: 0,
    lastUpdate: '',
    notifications: [],
  };

  // Aktualisierungs-Timer
  private refreshTimer = null;

  /**
   * Plugin initialisieren
   */
  protected async onInitialize(config) {
    // Konfiguration laden
    this.config = {
      enableNotifications: config.enableNotifications ?? true,
      notificationSound: config.notificationSound || 'ping',
      refreshInterval: config.refreshInterval || 60,
    };

    this.log('info', `Plugin initialisiert mit Konfiguration: ${JSON.stringify(this.config)}`);

    // UI-Komponenten definieren
    this.uiComponents = {
      // Dashboard-Widget
      dashboardWidgets: [
        {
          id: 'example-stats',
          title: 'Plugin-Statistik',
          component: 'ExampleStats',
          defaultSize: { width: 3, height: 2 },
        }
      ],

      // Einstellungsseite
      settingsPages: [
        {
          id: 'example-settings',
          title: 'Beispiel-Einstellungen',
          component: 'ExampleSettings',
          icon: 'zap',
          position: 50,
        }
      ],

      // Task-Aktionen
      taskActions: [
        {
          id: 'example-action',
          title: 'Beispiel-Aktion',
          icon: 'zap',
          handler: 'handleExampleAction',
        }
      ],
    };

    // API-Endpunkte registrieren
    if (this.context) {
      this.context.registerEndpoint('get', '/api/plugins/example/stats', (req, res) => {
        res.json(this.stats);
      });

      this.context.registerEndpoint('post', '/api/plugins/example/reset-stats', (req, res) => {
        this.resetStats();
        res.json({ success: true, stats: this.stats });
      });
    }
  }

  /**
   * Plugin starten
   */
  protected async onStart() {
    this.log('info', 'Plugin gestartet');

    // Starte den Aktualisierungs-Timer
    this.startRefreshTimer();
  }

  /**
   * Plugin stoppen
   */
  protected async onStop() {
    this.log('info', 'Plugin gestoppt');

    // Stoppe den Aktualisierungs-Timer
    this.stopRefreshTimer();
  }

  /**
   * Event-Handler registrieren
   */
  protected onRegisterEventHandlers(emitter) {
    // Task-Events
    emitter.on(PluginEvents.TASK_CREATED, this.handleTaskCreated.bind(this));
    emitter.on(PluginEvents.TASK_UPDATED, this.handleTaskUpdated.bind(this));
    emitter.on(PluginEvents.TASK_COMPLETED, this.handleTaskCompleted.bind(this));

    // Heartbeat-Events
    emitter.on(PluginEvents.HEARTBEAT_COMPLETED, this.handleHeartbeatCompleted.bind(this));
  }

  /**
   * Starte den Aktualisierungs-Timer
   */
  private startRefreshTimer() {
    this.stopRefreshTimer();

    if (this.config.refreshInterval > 0) {
      this.refreshTimer = setInterval(() => {
        this.refreshStats();
      }, this.config.refreshInterval * 1000);

      this.log('info', `Aktualisierungs-Timer gestartet (${this.config.refreshInterval}s)`);
    }
  }

  /**
   * Stoppe den Aktualisierungs-Timer
   */
  private stopRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
      this.log('info', 'Aktualisierungs-Timer gestoppt');
    }
  }

  /**
   * Aktualisiere die Statistiken
   */
  private refreshStats() {
    this.stats.lastUpdate = new Date().toISOString();
    this.log('debug', 'Statistiken aktualisiert');

    // Hier könnten weitere Aktualisierungen erfolgen
  }

  /**
   * Setze die Statistiken zurück
   */
  private resetStats() {
    this.stats = {
      eventsProcessed: 0,
      lastUpdate: new Date().toISOString(),
      notifications: [],
    };
    this.log('info', 'Statistiken zurückgesetzt');
  }

  /**
   * Zeige eine Benachrichtigung an
   */
  private showNotification(message, type = 'info') {
    if (this.config.enableNotifications) {
      const notification = {
        id: Date.now().toString(),
        message,
        type,
        timestamp: new Date().toISOString(),
      };

      this.stats.notifications.push(notification);

      // Begrenze die Anzahl der Benachrichtigungen
      if (this.stats.notifications.length > 10) {
        this.stats.notifications.shift();
      }

      this.log('info', `Benachrichtigung: ${message}`);

      // Hier würde in einer echten Implementierung die Benachrichtigung angezeigt werden
    }
  }

  // Event-Handler

  private handleTaskCreated(payload) {
    this.stats.eventsProcessed++;
    this.showNotification(`Neue Aufgabe erstellt: ${payload.titel || payload.id}`);
  }

  private handleTaskUpdated(payload) {
    this.stats.eventsProcessed++;
    // Optional: Benachrichtigungen nur für bestimmte Updates anzeigen
  }

  private handleTaskCompleted(payload) {
    this.stats.eventsProcessed++;
    this.showNotification(`Aufgabe abgeschlossen: ${payload.titel || payload.id}`, 'success');
  }

  private handleHeartbeatCompleted(payload) {
    this.stats.eventsProcessed++;
    // Optional: Benachrichtigungen für Heartbeats anzeigen
  }
}

// Export des Plugin-Konstruktors
export default function createPlugin() {
  return new ExamplePlugin();
}
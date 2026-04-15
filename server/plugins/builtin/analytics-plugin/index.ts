// Analytics Plugin - Sammelt und visualisiert Nutzungsdaten

import { AbstractPlugin } from '../../abstract-plugin.js';
import {
  PluginMetadata,
  PluginContext,
  EventEmitter,
  PluginEvents,
  PluginUiComponents
} from '../../types.js';

/**
 * Analytics Plugin
 * Sammelt und visualisiert Nutzungsdaten von OpenCognit
 */
export class AnalyticsPlugin extends AbstractPlugin {
  // Implementiere die erforderlichen Metadaten
  metadata: PluginMetadata = {
    id: 'opencognit-analytics',
    name: 'Analytics Plugin',
    description: 'Sammelt und visualisiert Nutzungsdaten von OpenCognit',
    version: '1.0.0',
    author: 'OpenCognit Team',
    license: 'MIT',
    icon: 'bar-chart',
    categories: ['analytics', 'dashboard'],
    isPremium: false,
  };

  // Plugin-Konfiguration
  private config: {
    trackTokenUsage: boolean;
    retentionDays: number;
  } = {
    trackTokenUsage: true,
    retentionDays: 30,
  };

  // Sammlung von Nutzungsdaten
  private usageData: {
    taskCount: number;
    modelUsage: Record<string, { calls: number; tokens: number; cost: number }>;
    agentActivity: Record<string, { tasks: number; tokens: number }>;
  } = {
    taskCount: 0,
    modelUsage: {},
    agentActivity: {},
  };

  /**
   * Plugin initialisieren
   * Wird vom AbstractPlugin.initialize() aufgerufen
   */
  protected async onInitialize(config: Record<string, any>): Promise<void> {
    // Konfiguration laden
    this.config = {
      trackTokenUsage: config.trackTokenUsage !== undefined ? config.trackTokenUsage : true,
      retentionDays: config.retentionDays || 30,
    };

    this.log('info', `Plugin initialisiert mit Konfiguration: ${JSON.stringify(this.config)}`);

    // UI-Komponenten definieren
    this.uiComponents = {
      // Dashboard-Widget für Nutzungsdaten
      dashboardWidgets: [
        {
          id: 'analytics-overview',
          title: 'Nutzungsanalyse',
          component: 'AnalyticsOverviewWidget',
          defaultSize: { width: 6, height: 4 },
        },
        {
          id: 'model-usage',
          title: 'Modell-Nutzung',
          component: 'ModelUsageWidget',
          defaultSize: { width: 6, height: 4 },
        },
      ],

      // Eigene Navigationsseite für detaillierte Analysen
      navItems: [
        {
          id: 'analytics-page',
          title: 'Analytics',
          path: '/analytics',
          icon: 'bar-chart',
          component: 'AnalyticsPage',
          position: 100, // Position in der Navigation
        },
      ],

      // Einstellungsseite
      settingsPages: [
        {
          id: 'analytics-settings',
          title: 'Analytics Einstellungen',
          component: 'AnalyticsSettings',
          icon: 'settings',
          position: 30,
        },
      ],
    };

    // Tabelle für Analysedaten erstellen, falls noch nicht vorhanden
    await this.createAnalyticsTables();
  }

  /**
   * Plugin starten
   * Wird vom AbstractPlugin.start() aufgerufen
   */
  protected async onStart(): Promise<void> {
    this.log('info', 'Analytics Plugin gestartet');

    // Lade vorhandene Daten
    await this.loadExistingData();
  }

  /**
   * Plugin stoppen
   * Wird vom AbstractPlugin.stop() aufgerufen
   */
  protected async onStop(): Promise<void> {
    this.log('info', 'Analytics Plugin gestoppt');

    // Speichere aktuelle Daten
    await this.saveData();
  }

  /**
   * Event-Handler registrieren
   * Wird vom AbstractPlugin.registerEventHandlers() aufgerufen
   */
  protected onRegisterEventHandlers(emitter: EventEmitter): void {
    // Task-Events
    emitter.on(PluginEvents.TASK_CREATED, this.handleTaskCreated.bind(this));
    emitter.on(PluginEvents.TASK_COMPLETED, this.handleTaskCompleted.bind(this));

    // Heartbeat-Events für Token-Nutzung
    emitter.on(PluginEvents.HEARTBEAT_COMPLETED, this.handleHeartbeatCompleted.bind(this));
  }

  // Private Methoden

  /**
   * Erstellt die Tabellen für Analysedaten
   */
  private async createAnalyticsTables(): Promise<void> {
    if (!this.context) return;

    try {
      // Tabelle für allgemeine Nutzungsdaten
      await this.context.db.query(`
        CREATE TABLE IF NOT EXISTS analytics_usage (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          tasks_created INTEGER DEFAULT 0,
          tasks_completed INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          total_cost_cents INTEGER DEFAULT 0,
          data JSON
        )
      `);

      // Tabelle für Modell-Nutzung
      await this.context.db.query(`
        CREATE TABLE IF NOT EXISTS analytics_model_usage (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          model TEXT NOT NULL,
          calls INTEGER DEFAULT 0,
          input_tokens INTEGER DEFAULT 0,
          output_tokens INTEGER DEFAULT 0,
          cost_cents INTEGER DEFAULT 0
        )
      `);

      // Tabelle für Agent-Aktivität
      await this.context.db.query(`
        CREATE TABLE IF NOT EXISTS analytics_agent_activity (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          tasks_assigned INTEGER DEFAULT 0,
          tasks_completed INTEGER DEFAULT 0,
          tokens INTEGER DEFAULT 0,
          cost_cents INTEGER DEFAULT 0
        )
      `);

      this.log('info', 'Analytics-Tabellen erstellt oder bestätigt');
    } catch (error) {
      this.log('error', 'Fehler beim Erstellen der Analytics-Tabellen:', error);
    }
  }

  /**
   * Lädt vorhandene Daten aus der Datenbank
   */
  private async loadExistingData(): Promise<void> {
    if (!this.context) return;

    try {
      // Aktuelles Datum
      const today = new Date().toISOString().split('T')[0];

      // Lade Daten für heute
      const usageData = await this.context.db.query(
        `SELECT * FROM analytics_usage WHERE date = ?`,
        [today]
      );

      if (usageData.length > 0) {
        this.usageData.taskCount = usageData[0].tasks_created || 0;

        // Lade Modell-Nutzung
        const modelUsage = await this.context.db.query(
          `SELECT * FROM analytics_model_usage WHERE date = ?`,
          [today]
        );

        modelUsage.forEach((row: any) => {
          this.usageData.modelUsage[row.model] = {
            calls: row.calls,
            tokens: row.input_tokens + row.output_tokens,
            cost: row.cost_cents,
          };
        });

        // Lade Agent-Aktivität
        const agentActivity = await this.context.db.query(
          `SELECT * FROM analytics_agent_activity WHERE date = ?`,
          [today]
        );

        agentActivity.forEach((row: any) => {
          this.usageData.agentActivity[row.agent_id] = {
            tasks: row.tasks_assigned,
            tokens: row.tokens,
          };
        });

        this.log('info', 'Vorhandene Analysedaten geladen');
      }
    } catch (error) {
      this.log('error', 'Fehler beim Laden der Analysedaten:', error);
    }
  }

  /**
   * Speichert die aktuellen Daten in der Datenbank
   */
  private async saveData(): Promise<void> {
    if (!this.context) return;

    try {
      // Aktuelles Datum
      const today = new Date().toISOString().split('T')[0];
      const id = `usage-${today}`;

      // Speichere allgemeine Nutzungsdaten
      await this.context.db.query(
        `INSERT OR REPLACE INTO analytics_usage (id, date, tasks_created, data)
         VALUES (?, ?, ?, ?)`,
        [id, today, this.usageData.taskCount, JSON.stringify(this.usageData)]
      );

      // Speichere Modell-Nutzung
      for (const [model, data] of Object.entries(this.usageData.modelUsage)) {
        const modelId = `model-${model}-${today}`;
        await this.context.db.query(
          `INSERT OR REPLACE INTO analytics_model_usage
           (id, date, model, calls, input_tokens, output_tokens, cost_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [modelId, today, model, data.calls, 0, data.tokens, data.cost]
        );
      }

      // Speichere Agent-Aktivität
      for (const [agentId, data] of Object.entries(this.usageData.agentActivity)) {
        const activityId = `agent-${agentId}-${today}`;
        await this.context.db.query(
          `INSERT OR REPLACE INTO analytics_agent_activity
           (id, date, agent_id, tasks_assigned, tokens)
           VALUES (?, ?, ?, ?, ?)`,
          [activityId, today, agentId, data.tasks, data.tokens]
        );
      }

      this.log('info', 'Analysedaten gespeichert');
    } catch (error) {
      this.log('error', 'Fehler beim Speichern der Analysedaten:', error);
    }
  }

  /**
   * Bereinigt alte Analysedaten
   */
  private async cleanupOldData(): Promise<void> {
    if (!this.context) return;

    try {
      // Berechne Cutoff-Datum
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
      const cutoffString = cutoffDate.toISOString().split('T')[0];

      // Lösche alte Daten
      await this.context.db.query(
        `DELETE FROM analytics_usage WHERE date < ?`,
        [cutoffString]
      );

      await this.context.db.query(
        `DELETE FROM analytics_model_usage WHERE date < ?`,
        [cutoffString]
      );

      await this.context.db.query(
        `DELETE FROM analytics_agent_activity WHERE date < ?`,
        [cutoffString]
      );

      this.log('info', `Alte Analysedaten vor ${cutoffString} bereinigt`);
    } catch (error) {
      this.log('error', 'Fehler bei der Bereinigung alter Analysedaten:', error);
    }
  }

  // Event-Handler

  /**
   * Handler für Task-Erstellung
   */
  private async handleTaskCreated(payload: any): Promise<void> {
    this.usageData.taskCount++;

    // Aktualisiere Agent-Aktivität, wenn der Task einem Agenten zugewiesen wurde
    if (payload.agentId) {
      if (!this.usageData.agentActivity[payload.agentId]) {
        this.usageData.agentActivity[payload.agentId] = {
          tasks: 0,
          tokens: 0,
        };
      }
      this.usageData.agentActivity[payload.agentId].tasks++;
    }

    // Speichere Daten periodisch
    if (this.usageData.taskCount % 10 === 0) {
      await this.saveData();
    }
  }

  /**
   * Handler für Task-Abschluss
   */
  private async handleTaskCompleted(payload: any): Promise<void> {
    // Implementierung hier...
    await this.saveData();
  }

  /**
   * Handler für Heartbeat-Abschluss
   * Erfasst Token-Nutzung und Kosten
   */
  private async handleHeartbeatCompleted(payload: any): Promise<void> {
    if (!this.config.trackTokenUsage || !payload.usage) return;

    const { model, inputTokens, outputTokens, costCents } = payload.usage;

    if (!model) return;

    // Aktualisiere Modell-Nutzung
    if (!this.usageData.modelUsage[model]) {
      this.usageData.modelUsage[model] = {
        calls: 0,
        tokens: 0,
        cost: 0,
      };
    }

    this.usageData.modelUsage[model].calls++;
    this.usageData.modelUsage[model].tokens += (inputTokens || 0) + (outputTokens || 0);
    this.usageData.modelUsage[model].cost += costCents || 0;

    // Aktualisiere Agent-Aktivität
    if (payload.agentId) {
      if (!this.usageData.agentActivity[payload.agentId]) {
        this.usageData.agentActivity[payload.agentId] = {
          tasks: 0,
          tokens: 0,
        };
      }
      this.usageData.agentActivity[payload.agentId].tokens += (inputTokens || 0) + (outputTokens || 0);
    }
  }
}

// Export des Plugin-Konstruktors
export default function createPlugin() {
  return new AnalyticsPlugin();
}
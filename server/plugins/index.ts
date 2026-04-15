// Plugin-Framework - Zentraler Export aller Plugin-Module

export * from './types.js';
export * from './event-emitter.js';
export * from './plugin-manager.js';
export * from './plugin-loader.js';
export * from './abstract-plugin.js';

// Singleton-Exporte
import { eventEmitter } from './event-emitter.js';
import { pluginManager } from './plugin-manager.js';
import { pluginLoader } from './plugin-loader.js';

// Initialisierungsfunktion für das Plugin-System
export async function initializePluginSystem(): Promise<void> {
  try {
    console.log('🔌 Initialisiere Plugin-System...');

    // Initialisiere Plugin-Manager
    await pluginManager.initialize();

    // Lade vorhandene Plugins
    await pluginLoader.loadAllPlugins();

    console.log('✅ Plugin-System erfolgreich initialisiert');
  } catch (error) {
    console.error('❌ Fehler bei der Initialisierung des Plugin-Systems:', error);
    throw error;
  }
}

// Methode zum Stoppen aller Plugins (für Server-Shutdown)
export async function shutdownPluginSystem(): Promise<void> {
  try {
    console.log('🔌 Fahre Plugin-System herunter...');

    // Liste aller Plugins abrufen
    const plugins = await pluginManager.listPlugins();

    // Alle Plugins deaktivieren
    for (const plugin of plugins) {
      try {
        await pluginManager.disablePlugin(plugin.id);
      } catch (error) {
        console.error(`Fehler beim Deaktivieren des Plugins ${plugin.id}:`, error);
      }
    }

    console.log('✅ Plugin-System erfolgreich heruntergefahren');
  } catch (error) {
    console.error('❌ Fehler beim Herunterfahren des Plugin-Systems:', error);
  }
}

// Exporte der Singleton-Instanzen
export { eventEmitter, pluginManager, pluginLoader };
// MCP Client — Nativer Memory-Bridge (SQLite-basiert)
// Ersetzt den Python MCP-Server. Kein externer Prozess, keine Python-Abhängigkeit.
// Exportiert die gleiche Schnittstelle wie der alte Client: mcpClient.callTool(name, args)

import * as memory from './memory.js';

class MCPClient {
  /**
   * No-Op: Kein externer Prozess mehr nötig.
   */
  async ensureStarted(): Promise<void> {
    console.log('✅ Memory (nativ/SQLite) bereit.');
  }

  /**
   * Ruft ein Memory-Tool auf. Gleiche Signatur wie der alte Python-MCP-Client.
   */
  async callTool(name: string, args: any = {}): Promise<any> {
    try {
      return memory.callTool(name, args);
    } catch (err: any) {
      console.error(`❌ Memory Tool ${name} Fehler:`, err.message);
      throw err;
    }
  }

  /**
   * No-Op: Kein Prozess zum Beenden.
   */
  async shutdown(): Promise<void> {
    // Nativ — nichts zu stoppen
  }
}

export const mcpClient = new MCPClient();

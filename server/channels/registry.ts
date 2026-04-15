// Channel Registry — Verwaltet alle registrierten Messaging-Channels
// Neue Channels werden über register() hinzugefügt.
// Die Registry routet eingehende/ausgehende Nachrichten zum richtigen Channel.

import type { ChannelPlugin, InboundHandler, OutboundMessage, ChannelStatus } from './types.js';

class ChannelRegistry {
  private channels: Map<string, ChannelPlugin> = new Map();
  private inboundHandler: InboundHandler | null = null;

  /**
   * Registriert einen neuen Channel.
   */
  register(channel: ChannelPlugin): void {
    if (this.channels.has(channel.id)) {
      console.warn(`⚠️ Channel "${channel.id}" wird überschrieben`);
    }
    this.channels.set(channel.id, channel);
    console.log(`📡 Channel registriert: ${channel.id} (${channel.name})`);
  }

  /**
   * Setzt den globalen Handler für eingehende Nachrichten.
   * Wird typischerweise auf den CEO-Agent-Router gesetzt.
   */
  setInboundHandler(handler: InboundHandler): void {
    this.inboundHandler = handler;
  }

  /**
   * Wird von Channel-Plugins aufgerufen wenn eine Nachricht eingeht.
   */
  async handleInbound(unternehmenId: string, message: any): Promise<void> {
    if (this.inboundHandler) {
      await this.inboundHandler(unternehmenId, message);
    } else {
      console.warn(`⚠️ Keine Inbound-Handler gesetzt — Nachricht von ${message.channel} verworfen`);
    }
  }

  /**
   * Sendet eine Nachricht über den angegebenen Channel.
   */
  async send(message: OutboundMessage): Promise<{ success: boolean; error?: string }> {
    const channel = this.channels.get(message.channel);
    if (!channel) {
      return { success: false, error: `Channel "${message.channel}" nicht registriert` };
    }
    return channel.send(message);
  }

  /**
   * Gibt einen Channel nach ID zurück.
   */
  get(id: string): ChannelPlugin | undefined {
    return this.channels.get(id);
  }

  /**
   * Listet alle registrierten Channels.
   */
  list(): Array<{ id: string; name: string; icon: string; status: ChannelStatus }> {
    return Array.from(this.channels.values()).map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      status: c.status(),
    }));
  }

  /**
   * Registriert Webhook-Routes für alle Channels die Webhooks brauchen.
   */
  registerAllWebhooks(router: any): void {
    for (const channel of this.channels.values()) {
      if (channel.registerWebhooks) {
        channel.registerWebhooks(router);
        console.log(`  🔗 Webhooks registriert für ${channel.id}`);
      }
    }
  }

  /**
   * Shutdown aller Channels.
   */
  async shutdownAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      if (channel.shutdown) {
        await channel.shutdown().catch(e => console.warn(`Channel ${channel.id} shutdown error:`, e));
      }
    }
  }
}

export const channelRegistry = new ChannelRegistry();

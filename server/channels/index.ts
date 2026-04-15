// Channel System — Initialisiert alle Channel-Plugins
// Neue Channels: Datei in plugins/ erstellen, hier registrieren. Fertig.

import { channelRegistry } from './registry.js';
import { TelegramChannel } from './plugins/telegram.js';
import { WhatsAppChannel } from './plugins/whatsapp.js';
import { SlackChannel } from './plugins/slack.js';
import { DiscordChannel } from './plugins/discord.js';

/**
 * Initialisiert alle Channel-Plugins und registriert Webhooks.
 */
export async function initializeChannels(webhookRouter: any): Promise<void> {
  console.log('📡 Initialisiere Channel-System...');

  // Builtin Channels registrieren
  const channels = [
    new TelegramChannel(),
    new WhatsAppChannel(),
    new SlackChannel(),
    new DiscordChannel(),
  ];

  for (const channel of channels) {
    channelRegistry.register(channel);
    await channel.initialize({}).catch(e =>
      console.warn(`  ⚠️ Channel ${channel.id} Init-Fehler: ${e.message}`)
    );
  }

  // Webhooks für alle Channels registrieren
  channelRegistry.registerAllWebhooks(webhookRouter);

  console.log(`✅ ${channels.length} Channels bereit`);
}

export { channelRegistry } from './registry.js';
export type { ChannelPlugin, InboundMessage, OutboundMessage } from './types.js';

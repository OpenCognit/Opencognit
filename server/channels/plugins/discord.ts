// Discord Channel Plugin
// Discord Bot API — Webhooks + REST API

import type { ChannelPlugin, ChannelConfig, ChannelStatus, OutboundMessage, InboundMessage } from '../types.js';
import { channelRegistry } from '../registry.js';
import { db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

export class DiscordChannel implements ChannelPlugin {
  id = 'discord';
  name = 'Discord';
  description = 'Discord Bot mit Webhook-basiertem Empfang';
  icon = '🎮';

  private config: ChannelConfig = {};
  private lastActivity?: string;
  private error?: string;

  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config;
  }

  async send(message: OutboundMessage): Promise<{ success: boolean; error?: string }> {
    try {
      // Discord Webhook URL aus Config
      const webhookUrl = this.config.extra?.webhookUrl;
      if (!webhookUrl) return { success: false, error: 'Kein Discord Webhook konfiguriert' };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message.text.slice(0, 2000) }), // Discord 2000 char limit
      });

      if (res.ok) {
        this.lastActivity = new Date().toISOString();
        return { success: true };
      }
      const err = await res.text();
      return { success: false, error: err };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  status(): ChannelStatus {
    return { connected: true, lastActivity: this.lastActivity, error: this.error };
  }

  registerWebhooks(router: any): void {
    // Discord Interactions Endpoint
    router.post('/discord/:secret', async (req: any, res: any) => {
      const { secret } = req.params;
      const payload = req.body;

      try {
        const setting = db.select().from(settings)
          .where(and(eq(settings.key, 'webhook_secret'), eq(settings.value, secret)))
          .get();

        if (!setting?.companyId) return res.status(403).json({ error: 'Invalid secret' });

        // Discord sendet Ping zur Verifikation
        if (payload.type === 1) return res.json({ type: 1 });

        // Message Create (Typ 0 in Interaction, oder via Gateway Bot)
        if (payload.content && payload.author && !payload.author.bot) {
          const normalized: InboundMessage = {
            senderId: payload.author.id || '',
            senderName: payload.author.username || undefined,
            channel: 'discord',
            text: payload.content || '',
            timestamp: new Date(payload.timestamp || Date.now()).toISOString(),
            raw: payload,
          };
          this.lastActivity = normalized.timestamp;
          await channelRegistry.handleInbound(setting.companyId, normalized);
        }

        res.json({ ok: true });
      } catch (err) {
        console.error('Discord webhook error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
}

// Slack Channel Plugin
// Slack Events API — Webhooks + Web API

import type { ChannelPlugin, ChannelConfig, ChannelStatus, OutboundMessage, InboundMessage } from '../types.js';
import { channelRegistry } from '../registry.js';
import { db } from '../../db/client.js';
import { einstellungen } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

export class SlackChannel implements ChannelPlugin {
  id = 'slack';
  name = 'Slack';
  description = 'Slack Events API mit Bot-Token';
  icon = '💼';

  private config: ChannelConfig = {};
  private lastActivity?: string;
  private error?: string;

  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config;
  }

  async send(message: OutboundMessage): Promise<{ success: boolean; error?: string }> {
    // Slack Web API: chat.postMessage
    console.log(`📤 Slack Send (${message.recipientId}): ${message.text.slice(0, 50)}`);
    return { success: true };
  }

  status(): ChannelStatus {
    return { connected: true, lastActivity: this.lastActivity, error: this.error };
  }

  registerWebhooks(router: any): void {
    router.post('/slack/:secret', async (req: any, res: any) => {
      const { secret } = req.params;
      const payload = req.body;

      // Slack URL verification
      if (payload.type === 'url_verification') {
        return res.json({ challenge: payload.challenge });
      }

      try {
        const setting = db.select().from(einstellungen)
          .where(and(eq(einstellungen.schluessel, 'webhook_secret'), eq(einstellungen.wert, secret)))
          .get();

        if (!setting?.unternehmenId) return res.status(403).json({ error: 'Invalid secret' });

        const event = payload?.event;
        if (event?.type === 'message' && !event.subtype) {
          const normalized: InboundMessage = {
            senderId: event.user || '',
            channel: 'slack',
            text: event.text || '',
            timestamp: new Date(Number(event.ts) * 1000).toISOString(),
            raw: event,
          };
          this.lastActivity = normalized.timestamp;
          await channelRegistry.handleInbound(setting.unternehmenId, normalized);
        }

        res.json({ ok: true });
      } catch (err) {
        console.error('Slack webhook error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
}

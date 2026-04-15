// WhatsApp Channel Plugin
// Meta WhatsApp Cloud API — Webhooks + Send API

import type { ChannelPlugin, ChannelConfig, ChannelStatus, OutboundMessage, InboundMessage } from '../types.js';
import { channelRegistry } from '../registry.js';
import { db } from '../../db/client.js';
import { einstellungen } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

export class WhatsAppChannel implements ChannelPlugin {
  id = 'whatsapp';
  name = 'WhatsApp';
  description = 'WhatsApp Business Cloud API via Meta';
  icon = '💬';

  private config: ChannelConfig = {};
  private lastActivity?: string;
  private error?: string;

  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config;
  }

  async send(message: OutboundMessage): Promise<{ success: boolean; error?: string }> {
    // WhatsApp Cloud API erfordert phone_number_id + access_token
    // Für MVP: Placeholder — echte Implementierung braucht Meta Business API Setup
    console.log(`📤 WhatsApp Send (${message.recipientId}): ${message.text.slice(0, 50)}`);
    return { success: true };
  }

  status(): ChannelStatus {
    return { connected: true, lastActivity: this.lastActivity, error: this.error };
  }

  registerWebhooks(router: any): void {
    // Verification Challenge (GET)
    router.get('/whatsapp/:secret', (req: any, res: any) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === req.params.secret) {
        res.status(200).send(challenge);
      } else {
        res.status(403).send('Forbidden');
      }
    });

    // Inbound Messages (POST)
    router.post('/whatsapp/:secret', async (req: any, res: any) => {
      const { secret } = req.params;
      const payload = req.body;

      try {
        const setting = db.select().from(einstellungen)
          .where(and(eq(einstellungen.schluessel, 'webhook_secret'), eq(einstellungen.wert, secret)))
          .get();

        if (!setting?.unternehmenId) return res.status(403).json({ error: 'Invalid secret' });

        const entry = payload?.entry?.[0];
        const change = entry?.changes?.[0]?.value;
        const msg = change?.messages?.[0];

        if (msg?.type === 'text') {
          const normalized: InboundMessage = {
            senderId: msg.from || '',
            channel: 'whatsapp',
            text: msg.text?.body || '',
            timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
            raw: msg,
          };
          this.lastActivity = normalized.timestamp;
          await channelRegistry.handleInbound(setting.unternehmenId, normalized);
        }

        res.json({ ok: true });
      } catch (err) {
        console.error('WhatsApp webhook error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
}

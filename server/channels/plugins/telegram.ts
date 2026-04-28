// Telegram Channel Plugin
// Empfängt Nachrichten via Webhook, sendet über Bot API.

import type { ChannelPlugin, ChannelConfig, ChannelStatus, OutboundMessage, InboundMessage } from '../types.js';
import { channelRegistry } from '../registry.js';
import { db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

export class TelegramChannel implements ChannelPlugin {
  id = 'telegram';
  name = 'Telegram';
  description = 'Telegram Bot API — empfängt und sendet Nachrichten über Webhooks';
  icon = '✈️';

  private config: ChannelConfig = {};
  private lastActivity?: string;
  private error?: string;

  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config;
    console.log('  ✈️ Telegram Channel initialisiert');
  }

  async send(message: OutboundMessage): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Bot-Token und Chat-ID aus Einstellungen laden
      const unternehmenIds = db.select().from(settings)
        .where(eq(settings.key, 'telegram_bot_token'))
        .all();

      for (const setting of unternehmenIds) {
        if (!setting.value || !setting.companyId) continue;

        const chatIdSetting = db.select().from(settings)
          .where(and(
            eq(settings.key, 'telegram_chat_id'),
            eq(settings.companyId, setting.companyId)
          ))
          .get();

        if (!chatIdSetting?.value) continue;

        // Security: always use configured chat_id — never allow agents to redirect messages to arbitrary IDs
        const recipientId = chatIdSetting.value;
        const url = `https://api.telegram.org/bot${setting.value}/sendMessage`;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: recipientId,
            text: message.text,
            parse_mode: message.format === 'markdown' ? 'Markdown' : undefined,
          }),
        });

        if (res.ok) {
          this.lastActivity = new Date().toISOString();
          const data = await res.json() as any;
          return { success: true, messageId: String(data.result?.message_id) };
        } else {
          const err = await res.text();
          this.error = err;
          return { success: false, error: err };
        }
      }

      return { success: false, error: 'Kein Telegram Bot-Token konfiguriert' };
    } catch (err: any) {
      this.error = err.message;
      return { success: false, error: err.message };
    }
  }

  status(): ChannelStatus {
    return {
      connected: !this.error,
      lastActivity: this.lastActivity,
      error: this.error,
    };
  }

  registerWebhooks(router: any): void {
    router.post('/telegram/:secret', async (req: any, res: any) => {
      const { secret } = req.params;
      const payload = req.body;

      try {
        const setting = db.select().from(settings)
          .where(and(
            eq(settings.key, 'webhook_secret'),
            eq(settings.value, secret)
          ))
          .get();

        if (!setting?.companyId) {
          return res.status(403).json({ error: 'Invalid secret' });
        }

        const msg = payload.message;
        if (msg) {
          const incomingSenderId = String(msg.from?.id || msg.chat?.id || '');

          // Security: only accept messages from the configured chat_id (whitelist)
          const chatIdSetting = db.select().from(settings)
            .where(and(
              eq(settings.key, 'telegram_chat_id'),
              eq(settings.companyId, setting.companyId)
            ))
            .get();

          if (!chatIdSetting?.value || incomingSenderId !== chatIdSetting.value) {
            console.warn(`Telegram: eingehende Nachricht von unbekannter Chat-ID ${incomingSenderId} blockiert (erwartet: ${chatIdSetting?.value ?? 'nicht konfiguriert'})`);
            return res.json({ ok: true }); // acknowledge but discard
          }

          const normalized: InboundMessage = {
            senderId: incomingSenderId,
            senderName: msg.from?.first_name || undefined,
            channel: 'telegram',
            text: msg.text || '',
            timestamp: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
            raw: msg,
          };

          this.lastActivity = normalized.timestamp;
          await channelRegistry.handleInbound(setting.companyId, normalized);
        }

        res.json({ ok: true });
      } catch (err) {
        console.error('Telegram webhook error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
}

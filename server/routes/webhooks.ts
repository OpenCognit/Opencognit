import crypto from 'crypto';
import { Router } from 'express';
import { db } from '../db/client.js';
import { einstellungen, routineTrigger, routinen, routineAusfuehrung } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { messagingService } from '../services/messaging.js';
import { wakeupService } from '../services/wakeup.js';
import { v4 as uuid } from 'uuid';

const router = Router();

export interface OpenCognitMessage {
  senderId: string;
  channel: string;
  text: string;
  timestamp: string;
}

/**
 * Normalizes a Telegram webhook payload into the OpenCognit format.
 */
function normalizeTelegram(payload: any): OpenCognitMessage | null {
  if (!payload || !payload.message) return null;
  const msg = payload.message;
  
  return {
    senderId: String(msg.from?.id || msg.chat?.id),
    channel: 'telegram',
    text: msg.text || '',
    timestamp: new Date((msg.date || Date.now() / 1000) * 1000).toISOString()
  };
}

/**
 * Normalizes a WhatsApp Cloud API webhook payload into OpenCognit format.
 */
function normalizeWhatsApp(payload: any): OpenCognitMessage | null {
  // Meta WhatsApp Cloud API format
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  if (!msg || msg.type !== 'text') return null;

  return {
    senderId: msg.from || '',
    channel: 'whatsapp',
    text: msg.text?.body || '',
    timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
  };
}

/**
 * Normalizes a Slack Events API payload into OpenCognit format.
 */
function normalizeSlack(payload: any): OpenCognitMessage | null {
  const event = payload?.event;
  if (!event || event.type !== 'message' || event.subtype) return null;

  return {
    senderId: event.user || '',
    channel: 'slack',
    text: event.text || '',
    timestamp: new Date(Number(event.ts) * 1000).toISOString(),
  };
}

/**
 * POST /telegram/:secretToken
 * Endpoint for Telegram Bot Webhooks.
 */
router.post('/telegram/:secret', async (req, res) => {
  const { secret } = req.params;
  const payload = req.body;

  try {
    // Find the company associated with this secret
    const setting = db.select().from(einstellungen)
      .where(and(
        eq(einstellungen.schluessel, 'webhook_secret'),
        eq(einstellungen.wert, secret)
      ))
      .get();

    if (!setting || !setting.unternehmenId) {
      console.warn(`⚠️ Webhook received with invalid secret: ${secret}`);
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const unternehmenId = setting.unternehmenId;
    const normalized = normalizeTelegram(payload);

    if (normalized) {
      console.log(`📥 Inbound ${normalized.channel} message from ${normalized.senderId} for company ${unternehmenId}`);
      
      // We reuse the existing logic in messagingService which handles 
      // CEO routing, DB insertion and cycle triggering.
      // We pass the raw telegram message format as handleInboundMessage expects it.
      await messagingService.handleInboundMessage(unternehmenId, payload.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /whatsapp/:secretToken
 * Endpoint for WhatsApp Cloud API Webhooks.
 */
router.post('/whatsapp/:secret', async (req, res) => {
  const { secret } = req.params;
  const payload = req.body;

  try {
    const setting = db.select().from(einstellungen)
      .where(and(
        eq(einstellungen.schluessel, 'webhook_secret'),
        eq(einstellungen.wert, secret)
      ))
      .get();

    if (!setting || !setting.unternehmenId) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const unternehmenId = setting.unternehmenId;
    const normalized = normalizeWhatsApp(payload);

    if (normalized) {
      console.log(`📥 Inbound ${normalized.channel} message from ${normalized.senderId} for company ${unternehmenId}`);
      await messagingService.handleInboundMessage(unternehmenId, {
        from: { id: normalized.senderId },
        text: normalized.text,
        date: Math.floor(new Date(normalized.timestamp).getTime() / 1000),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WhatsApp verification (GET challenge)
router.get('/whatsapp/:secret', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === req.params.secret) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

/**
 * POST /slack/:secretToken
 * Endpoint for Slack Events API Webhooks.
 */
router.post('/slack/:secret', async (req, res) => {
  const { secret } = req.params;
  const payload = req.body;

  // Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  try {
    const setting = db.select().from(einstellungen)
      .where(and(
        eq(einstellungen.schluessel, 'webhook_secret'),
        eq(einstellungen.wert, secret)
      ))
      .get();

    if (!setting || !setting.unternehmenId) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const unternehmenId = setting.unternehmenId;
    const normalized = normalizeSlack(payload);

    if (normalized) {
      console.log(`📥 Inbound ${normalized.channel} message from ${normalized.senderId} for company ${unternehmenId}`);
      await messagingService.handleInboundMessage(unternehmenId, {
        from: { id: normalized.senderId },
        text: normalized.text,
        date: Math.floor(new Date(normalized.timestamp).getTime() / 1000),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Slack webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /routine/:publicId
 * External webhook to trigger a Routine. Expects:
 *   Header: x-signature: sha256=<hmac-sha256 of raw body with secretId>
 *   Body: any JSON payload (forwarded as trigger payload to the agent)
 *
 * Returns: { ok: true, executionId }
 */
router.post('/routine/:publicId', async (req, res) => {
  const { publicId } = req.params;

  // Find matching active webhook trigger
  const trigger = db.select().from(routineTrigger)
    .where(and(
      eq(routineTrigger.publicId, publicId),
      eq(routineTrigger.kind, 'webhook'),
      eq(routineTrigger.aktiv, true),
    ))
    .get() as any;

  if (!trigger) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  // Verify HMAC-SHA256 signature
  const signature = req.headers['x-signature'] as string | undefined;
  if (trigger.secretId && signature) {
    const rawBody = JSON.stringify(req.body);
    const expected = 'sha256=' + crypto.createHmac('sha256', trigger.secretId).update(rawBody).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } else if (trigger.secretId && !signature) {
    return res.status(403).json({ error: 'Missing x-signature header' });
  }

  // Load routine + assigned agent
  const routine = db.select().from(routinen).where(eq(routinen.id, trigger.routineId)).get() as any;
  if (!routine || !routine.zugewiesenAn) {
    return res.status(422).json({ error: 'Routine has no assigned agent' });
  }

  const now = new Date().toISOString();
  const executionId = uuid();

  // Record execution
  db.insert(routineAusfuehrung).values({
    id: executionId,
    unternehmenId: trigger.unternehmenId,
    routineId: routine.id,
    triggerId: trigger.id,
    quelle: 'webhook',
    status: 'received',
    payload: JSON.stringify(req.body),
    erstelltAm: now,
  } as any).run();

  // Update trigger last fired
  db.update(routineTrigger)
    .set({ zuletztGefeuertAm: now })
    .where(eq(routineTrigger.id, trigger.id))
    .run();

  // Wake agent
  await wakeupService.wakeup(routine.zugewiesenAn, trigger.unternehmenId, {
    source: 'automation',
    triggerDetail: 'webhook',
    reason: `Webhook-Trigger für Routine "${routine.titel}"`,
    payload: { executionId, routineId: routine.id, body: req.body },
  });

  console.log(`📡 Webhook: Routine "${routine.titel}" via publicId ${publicId} ausgelöst → Agent ${routine.zugewiesenAn}`);
  return res.json({ ok: true, executionId });
});

export default router;

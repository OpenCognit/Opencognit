// Order Ingestion Service — converts incoming orders into agent tasks
// Handles: Shopify, WooCommerce, Generic webhooks, Manual creation

import crypto from 'crypto';
import { db } from '../db/client.js';
import { customers, orders, orderItems, aufgaben, invoices, accountingEntries } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { wakeupService } from './wakeup.js';
import { messagingService } from './messaging.js';

export interface IncomingOrderItem {
  productId?: string;
  productName: string;
  productSku?: string;
  quantity: number;
  unitPrice: number; // in cents
  taxRate?: number; // percent, default 19
}

export interface IncomingOrder {
  externalOrderId?: string;
  quelle: 'shopify' | 'woocommerce' | 'manual' | 'webhook' | 'api';
  customer: {
    externalId?: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    zip?: string;
    country?: string;
    taxId?: string;
  };
  items: IncomingOrderItem[];
  paymentMethod?: string;
  paymentStatus?: 'pending' | 'paid' | 'partial' | 'failed';
  shippingCost?: number; // cents
  discount?: number; // cents
  currency?: string;
  shippingAddress?: {
    name?: string;
    address?: string;
    city?: string;
    zip?: string;
    country?: string;
  };
  rawPayload?: any;
}

/**
 * Ingest an incoming order. Creates customer, order, items, and auto-generates an agent task.
 */
export async function ingestOrder(
  unternehmenId: string,
  incoming: IncomingOrder
): Promise<{ orderId: string; taskId: string; message: string }> {
  const now = new Date().toISOString();

  // ── 1. Upsert Customer ──────────────────────────────────────────
  let customerId: string | null = null;
  if (incoming.customer.email) {
    const existing = db.select()
      .from(customers)
      .where(and(
        eq(customers.unternehmenId, unternehmenId),
        eq(customers.email, incoming.customer.email)
      ))
      .get();
    if (existing) {
      customerId = existing.id;
      // Update if externalId changed or name changed
      if (incoming.customer.externalId && existing.externalId !== incoming.customer.externalId) {
        db.update(customers)
          .set({ externalId: incoming.customer.externalId, aktualisiertAm: now })
          .where(eq(customers.id, customerId))
          .run();
      }
    }
  }

  if (!customerId) {
    customerId = crypto.randomUUID();
    db.insert(customers).values({
      id: customerId,
      unternehmenId,
      externalId: incoming.customer.externalId || null,
      name: incoming.customer.name,
      email: incoming.customer.email || null,
      telefon: incoming.customer.phone || null,
      adresse: incoming.customer.address || null,
      stadt: incoming.customer.city || null,
      plz: incoming.customer.zip || null,
      land: incoming.customer.country || 'DE',
      steuerId: incoming.customer.taxId || null,
      quelle: incoming.quelle,
      erstelltAm: now,
      aktualisiertAm: now,
    }).run();
  }

  // ── 2. Calculate totals ─────────────────────────────────────────
  let subtotal = 0;
  let totalTax = 0;
  for (const item of incoming.items) {
    const itemTotal = item.unitPrice * item.quantity;
    const taxRate = item.taxRate ?? 19;
    const itemTax = Math.round(itemTotal * (taxRate / 100));
    subtotal += itemTotal;
    totalTax += itemTax;
  }
  const shipping = incoming.shippingCost || 0;
  const discount = incoming.discount || 0;
  const grandTotal = subtotal + totalTax + shipping - discount;

  // ── 3. Create Order ─────────────────────────────────────────────
  const orderId = crypto.randomUUID();
  db.insert(orders).values({
    id: orderId,
    unternehmenId,
    customerId,
    externalOrderId: incoming.externalOrderId || null,
    quelle: incoming.quelle,
    status: 'pending',
    zahlungsStatus: incoming.paymentStatus || 'pending',
    zahlungsMethode: incoming.paymentMethod || null,
    zwischensummeCent: subtotal,
    steuerCent: totalTax,
    versandCent: shipping,
    rabattCent: discount,
    gesamtCent: grandTotal,
    waehrung: incoming.currency || 'EUR',
    versandName: incoming.shippingAddress?.name || incoming.customer.name,
    versandAdresse: incoming.shippingAddress?.address || incoming.customer.address,
    versandStadt: incoming.shippingAddress?.city || incoming.customer.city,
    versandPlz: incoming.shippingAddress?.zip || incoming.customer.zip,
    versandLand: incoming.shippingAddress?.country || incoming.customer.country || 'DE',
    rawPayloadJson: incoming.rawPayload ? JSON.stringify(incoming.rawPayload).slice(0, 50000) : null,
    erstelltAm: now,
    aktualisiertAm: now,
  }).run();

  // ── 4. Create Order Items ───────────────────────────────────────
  for (const item of incoming.items) {
    const itemTaxRate = item.taxRate ?? 19;
    const itemTotal = item.unitPrice * item.quantity;
    const itemTax = Math.round(itemTotal * (itemTaxRate / 100));
    db.insert(orderItems).values({
      id: crypto.randomUUID(),
      orderId,
      unternehmenId,
      productId: item.productId || null,
      productName: item.productName,
      productSku: item.productSku || null,
      menge: item.quantity,
      einzelpreisCent: item.unitPrice,
      gesamtpreisCent: itemTotal + itemTax,
      steuersatzProzent: itemTaxRate,
      erstelltAm: now,
    }).run();
  }

  // ── 5. Auto-create Task for Agent ───────────────────────────────
  const itemsSummary = incoming.items
    .map(i => `- ${i.quantity}x ${i.productName} (${(i.unitPrice / 100).toFixed(2)} €)`)
    .join('\n');

  const taskId = crypto.randomUUID();
  db.insert(aufgaben).values({
    id: taskId,
    unternehmenId,
    titel: `📦 Bestellung #${incoming.externalOrderId || orderId.slice(0, 8)} — ${incoming.customer.name}`,
    beschreibung: [
      `## Neue Bestellung eingegangen`,
      ``,
      `**Kunde:** ${incoming.customer.name}`,
      `**E-Mail:** ${incoming.customer.email || '—'}`,
      `**Adresse:** ${incoming.customer.address || '—'}, ${incoming.customer.zip || ''} ${incoming.customer.city || ''}`,
      `**Zahlung:** ${incoming.paymentMethod || '—'} (${incoming.paymentStatus || 'pending'})`,
      ``,
      `## Artikel`,
      itemsSummary,
      ``,
      `## Zu erledigen`,
      `- [ ] Bestellung prüfen und bestätigen`,
      `- [ ] Rechnung erstellen`,
      `- [ ] Buchhaltungseintrag vornehmen`,
      `- [ ] Versand vorbereiten (wenn physisch)`,
      `- [ ] Kunde benachrichtigen`,
    ].join('\n'),
    status: 'todo',
    prioritaet: 'high',
    zugewiesenAn: null, // Will be assigned via Contract-Net or CEO delegation
    erstelltVon: 'system',
    erstelltAm: now,
    aktualisiertAm: now,
  }).run();

  // Link task to order
  db.update(orders)
    .set({ taskId })
    .where(eq(orders.id, orderId))
    .run();

  // ── 6. Wake up CEO / relevant agents ────────────────────────────
  try {
    const { experten } = await import('../db/schema.js');
    const ceo = db.select()
      .from(experten)
      .where(and(
        eq(experten.unternehmenId, unternehmenId),
        eq(experten.isOrchestrator, true)
      ))
      .get();
    if (ceo) {
      await wakeupService.requestWakeup(ceo.id, unternehmenId, `new_order:${orderId}`);
    }
  } catch {
    // No CEO found, broadcast to all active agents
    try {
      const { experten } = await import('../db/schema.js');
      const activeAgents = db.select()
        .from(experten)
        .where(and(
          eq(experten.unternehmenId, unternehmenId),
          eq(experten.status, 'active')
        ))
        .all();
      for (const agent of activeAgents.slice(0, 3)) {
        await wakeupService.requestWakeup(agent.id, unternehmenId, `new_order:${orderId}`);
      }
    } catch { /* ignore */ }
  }

  // ── 7. Notify via messaging (Telegram if configured) ────────────
  try {
    await messagingService.sendNotification(unternehmenId, {
      channel: 'telegram',
      title: `📦 Neue Bestellung #${incoming.externalOrderId || orderId.slice(0, 8)}`,
      body: `${incoming.customer.name} — ${(grandTotal / 100).toFixed(2)} € (${incoming.items.length} Artikel)`,
    });
  } catch {
    // Telegram not configured, ignore
  }

  return { orderId, taskId, message: `Order ingested. Task created: ${taskId}` };
}

/**
 * Get orders with items for a company
 */
export function getOrders(unternehmenId: string, status?: string) {
  const query = db.select()
    .from(orders)
    .where(status
      ? and(eq(orders.unternehmenId, unternehmenId), eq(orders.status, status as any))
      : eq(orders.unternehmenId, unternehmenId)
    )
    .orderBy(desc(orders.erstelltAm))
    .all();

  return query.map(o => ({
    ...o,
    items: db.select()
      .from(orderItems)
      .where(eq(orderItems.orderId, o.id))
      .all(),
    customer: o.customerId
      ? db.select().from(customers).where(eq(customers.id, o.customerId)).get()
      : null,
  }));
}

/**
 * Get single order with full details
 */
export function getOrderById(orderId: string) {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;

  return {
    ...order,
    items: db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all(),
    customer: order.customerId
      ? db.select().from(customers).where(eq(customers.id, order.customerId)).get()
      : null,
  };
}

/**
 * Update order status
 */
export function updateOrderStatus(
  orderId: string,
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
) {
  db.update(orders)
    .set({ status, aktualisiertAm: new Date().toISOString() })
    .where(eq(orders.id, orderId))
    .run();
  return getOrderById(orderId);
}

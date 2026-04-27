// Invoice Generator — Creates PDF invoices from orders using PDFKit

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { db } from '../db/client.js';
import { orders, orderItems, customers, invoices, accountingEntries } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface InvoiceData {
  rechnungsNummer: string;
  rechnungsDatum: string;
  faelligkeitDatum?: string;
  // Seller
  firmaName: string;
  firmaAdresse: string;
  firmaStadt: string;
  firmaSteuerId: string;
  // Buyer
  kundeName: string;
  kundeAdresse: string;
  kundeStadt: string;
  kundePlz: string;
  kundeLand: string;
  kundeSteuerId?: string;
  // Items
  items: Array<{
    name: string;
    sku?: string;
    menge: number;
    einzelpreis: number; // in euros (not cents)
    gesamtpreis: number;
    steuersatz: number;
  }>;
  // Totals
  zwischensumme: number;
  steuer: number;
  versand: number;
  rabatt: number;
  gesamt: number;
  waehrung: string;
  // Notes
  notizen?: string;
}

function formatCurrency(cents: number, currency: string = 'EUR'): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;
  return `${(cents / 100).toFixed(2)} ${symbol}`;
}

function centsToEuro(cents: number): number {
  return cents / 100;
}

/**
 * Generate a PDF invoice from order data.
 * Returns the path to the generated PDF.
 */
export async function generateInvoicePdf(
  data: InvoiceData,
  outputDir: string
): Promise<string> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `RE-${data.rechnungsNummer}.pdf`;
  const outputPath = path.join(outputDir, filename);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // ── Header ──────────────────────────────────────────────────────
  doc.fontSize(20).font('Helvetica-Bold').text('RECHNUNG', 50, 50);
  doc.fontSize(10).font('Helvetica')
    .text(`Rechnungs-Nr: ${data.rechnungsNummer}`, 400, 50, { align: 'right' })
    .text(`Datum: ${new Date(data.rechnungsDatum).toLocaleDateString('de-DE')}`, 400, 65, { align: 'right' });

  if (data.faelligkeitDatum) {
    doc.text(`Fällig: ${new Date(data.faelligkeitDatum).toLocaleDateString('de-DE')}`, 400, 80, { align: 'right' });
  }

  // ── Seller ──────────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica-Bold').text(data.firmaName, 50, 130);
  doc.fontSize(9).font('Helvetica')
    .text(data.firmaAdresse, 50, 145)
    .text(data.firmaStadt, 50, 158)
    .text(`USt-IdNr: ${data.firmaSteuerId}`, 50, 171);

  // ── Buyer ───────────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica-Bold').text('Rechnungsempfänger:', 50, 210);
  doc.fontSize(10).font('Helvetica-Bold').text(data.kundeName, 50, 225);
  doc.fontSize(9).font('Helvetica')
    .text(data.kundeAdresse || '—', 50, 240)
    .text(`${data.kundePlz} ${data.kundeStadt}`, 50, 253)
    .text(data.kundeLand || 'Deutschland', 50, 266);
  if (data.kundeSteuerId) {
    doc.text(`USt-IdNr: ${data.kundeSteuerId}`, 50, 279);
  }

  // ── Table Header ────────────────────────────────────────────────
  const tableTop = 330;
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Pos.', 50, tableTop, { width: 30 })
    .text('Artikel', 80, tableTop, { width: 200 })
    .text('Menge', 290, tableTop, { width: 40, align: 'right' })
    .text('Einzelpreis', 340, tableTop, { width: 70, align: 'right' })
    .text('Gesamt', 420, tableTop, { width: 70, align: 'right' })
    .text('MwSt', 500, tableTop, { width: 50, align: 'right' });

  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

  // ── Table Rows ──────────────────────────────────────────────────
  let y = tableTop + 25;
  doc.fontSize(9).font('Helvetica');
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    doc.text(`${i + 1}`, 50, y, { width: 30 })
      .text(item.name, 80, y, { width: 200 })
      .text(`${item.menge}`, 290, y, { width: 40, align: 'right' })
      .text(`${item.einzelpreis.toFixed(2)} €`, 340, y, { width: 70, align: 'right' })
      .text(`${item.gesamtpreis.toFixed(2)} €`, 420, y, { width: 70, align: 'right' })
      .text(`${item.steuersatz}%`, 500, y, { width: 50, align: 'right' });
    y += 18;
    if (item.sku) {
      doc.fontSize(7).fillColor('#666666').text(`SKU: ${item.sku}`, 80, y - 5);
      doc.fillColor('#000000');
    }
    if (y > 680) {
      doc.addPage();
      y = 50;
    }
  }

  doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke();

  // ── Totals ──────────────────────────────────────────────────────
  y += 20;
  const totalsX = 350;
  doc.fontSize(9).font('Helvetica')
    .text('Zwischensumme:', totalsX, y, { width: 100, align: 'right' })
    .text(`${data.zwischensumme.toFixed(2)} €`, 460, y, { width: 80, align: 'right' });

  if (data.versand > 0) {
    y += 16;
    doc.text('Versand:', totalsX, y, { width: 100, align: 'right' })
      .text(`${data.versand.toFixed(2)} €`, 460, y, { width: 80, align: 'right' });
  }
  if (data.rabatt > 0) {
    y += 16;
    doc.text('Rabatt:', totalsX, y, { width: 100, align: 'right' })
      .text(`-${data.rabatt.toFixed(2)} €`, 460, y, { width: 80, align: 'right' });
  }
  y += 16;
  doc.text('MwSt:', totalsX, y, { width: 100, align: 'right' })
    .text(`${data.steuer.toFixed(2)} €`, 460, y, { width: 80, align: 'right' });

  y += 22;
  doc.fontSize(11).font('Helvetica-Bold')
    .text('Gesamtbetrag:', totalsX, y, { width: 100, align: 'right' })
    .text(`${data.gesamt.toFixed(2)} €`, 460, y, { width: 80, align: 'right' });

  // ── Footer ──────────────────────────────────────────────────────
  y += 50;
  if (data.notizen) {
    doc.fontSize(8).font('Helvetica').fillColor('#666666')
      .text('Hinweise:', 50, y)
      .text(data.notizen, 50, y + 12, { width: 500 });
    doc.fillColor('#000000');
    y += 40;
  }

  doc.fontSize(8).font('Helvetica').fillColor('#888888')
    .text('Diese Rechnung wurde maschinell erstellt und ist ohne Unterschrift gültig.', 50, 750, { align: 'center', width: 500 })
    .text('Gemäß § 14 UStG enthält diese Rechnung alle gesetzlich vorgeschriebenen Angaben.', 50, 765, { align: 'center', width: 500 });

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return outputPath;
}

/**
 * Create an invoice from an order and save to DB + PDF.
 */
export async function createInvoiceFromOrder(
  orderId: string,
  unternehmenId: string,
  companyDetails: { name: string; address: string; city: string; taxId: string },
  expertId?: string
): Promise<{ invoiceId: string; pdfPath: string; rechnungsNummer: string }> {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new Error('Order not found');

  const customer = order.customerId
    ? db.select().from(customers).where(eq(customers.id, order.customerId)).get()
    : null;

  const items = db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();

  const now = new Date();
  const rechnungsNummer = generateInvoiceNumber(unternehmenId);
  const rechnungsDatum = now.toISOString();
  const faelligkeitDatum = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // Build invoice data
  const invoiceData: InvoiceData = {
    rechnungsNummer,
    rechnungsDatum,
    faelligkeitDatum,
    firmaName: companyDetails.name,
    firmaAdresse: companyDetails.address,
    firmaStadt: companyDetails.city,
    firmaSteuerId: companyDetails.taxId,
    kundeName: customer?.name || order.versandName || 'Unbekannt',
    kundeAdresse: customer?.adresse || order.versandAdresse || '',
    kundeStadt: customer?.stadt || order.versandStadt || '',
    kundePlz: customer?.plz || order.versandPlz || '',
    kundeLand: customer?.land || order.versandLand || 'DE',
    kundeSteuerId: customer?.steuerId || undefined,
    items: items.map(it => ({
      name: it.productName,
      sku: it.productSku || undefined,
      menge: it.menge,
      einzelpreis: centsToEuro(it.einzelpreisCent),
      gesamtpreis: centsToEuro(it.gesamtpreisCent),
      steuersatz: it.steuersatzProzent,
    })),
    zwischensumme: centsToEuro(order.zwischensummeCent),
    steuer: centsToEuro(order.steuerCent),
    versand: centsToEuro(order.versandCent),
    rabatt: centsToEuro(order.rabattCent),
    gesamt: centsToEuro(order.gesamtCent),
    waehrung: order.waehrung,
    notizen: `Bestellung ${order.externalOrderId || order.id.slice(0, 8)}`,
  };

  // Generate PDF
  const outputDir = path.resolve('data', 'invoices', unternehmenId);
  const pdfPath = await generateInvoicePdf(invoiceData, outputDir);

  // Save to DB
  const invoiceId = crypto.randomUUID();
  db.insert(invoices).values({
    id: invoiceId,
    unternehmenId,
    orderId,
    customerId: order.customerId,
    rechnungsNummer,
    rechnungsDatum,
    faelligkeitDatum,
    status: 'draft',
    zwischensummeCent: order.zwischensummeCent,
    steuerCent: order.steuerCent,
    gesamtCent: order.gesamtCent,
    waehrung: order.waehrung,
    pdfPath,
    erstelltVonExpertId: expertId || null,
    erstelltAm: rechnungsDatum,
    aktualisiertAm: rechnungsDatum,
  }).run();

  // Link invoice to order
  db.update(orders)
    .set({ invoiceId, aktualisiertAm: rechnungsDatum })
    .where(eq(orders.id, orderId))
    .run();

  return { invoiceId, pdfPath, rechnungsNummer };
}

/**
 * Generate a unique invoice number per company.
 * Format: RE-{YYYY}-{companyShort}-{sequence}
 */
function generateInvoiceNumber(unternehmenId: string): string {
  const year = new Date().getFullYear();
  const companyShort = unternehmenId.slice(0, 4).toUpperCase();

  // Count existing invoices this year for this company
  const prefix = `RE-${year}-${companyShort}`;
  const existing = db.select().from(invoices)
    .where(eq(invoices.unternehmenId, unternehmenId))
    .all()
    .filter(i => i.rechnungsNummer.startsWith(prefix));

  const seq = (existing.length + 1).toString().padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Create accounting entries from an order (Einnahme + Steuer).
 */
export function createAccountingEntriesFromOrder(
  orderId: string,
  unternehmenId: string,
  expertId?: string
): string[] {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new Error('Order not found');

  const now = new Date().toISOString();
  const entryIds: string[] = [];

  // Einnahme (netto)
  const einnahmeId = crypto.randomUUID();
  db.insert(accountingEntries).values({
    id: einnahmeId,
    unternehmenId,
    orderId,
    typ: 'einnahme',
    kategorie: 'warenverkauf',
    betragCent: order.zwischensummeCent,
    waehrung: order.waehrung,
    steuersatzProzent: 19,
    steuerBetragCent: order.steuerCent,
    buchungsDatum: now,
    beschreibung: `Bestellung ${order.externalOrderId || order.id.slice(0, 8)} — Einnahme`,
    syncedTo: 'none',
    erstelltVonExpertId: expertId || null,
    erstelltAm: now,
  }).run();
  entryIds.push(einnahmeId);

  // Versand (if any)
  if (order.versandCent > 0) {
    const versandId = crypto.randomUUID();
    db.insert(accountingEntries).values({
      id: versandId,
      unternehmenId,
      orderId,
      typ: 'versand',
      kategorie: 'versandkosten',
      betragCent: order.versandCent,
      waehrung: order.waehrung,
      steuersatzProzent: 19,
      steuerBetragCent: Math.round(order.versandCent * 0.19),
      buchungsDatum: now,
      beschreibung: `Bestellung ${order.externalOrderId || order.id.slice(0, 8)} — Versand`,
      syncedTo: 'none',
      erstelltVonExpertId: expertId || null,
      erstelltAm: now,
    }).run();
    entryIds.push(versandId);
  }

  return entryIds;
}

/**
 * Export accounting entries to CSV (DATEV-compatible format).
 */
export function exportAccountingToCsv(
  unternehmenId: string,
  startDate?: string,
  endDate?: string
): string {
  const allEntries = db.select()
    .from(accountingEntries)
    .where(eq(accountingEntries.unternehmenId, unternehmenId))
    .all();

  const filtered = allEntries.filter(e => {
    if (startDate && e.buchungsDatum < startDate) return false;
    if (endDate && e.buchungsDatum > endDate) return false;
    return true;
  });

  // DATEV-compatible CSV header
  const lines = [
    'Umsatz (ohne Soll/Haben-Kz),Soll/Haben-Kennzeichen,Konto,Gegenkonto,Belegdatum,Belegfeld 1,Belegfeld 2,Buchungstext',
  ];

  for (const e of filtered) {
    const betrag = (e.betragCent / 100).toFixed(2);
    const sollHaben = e.typ === 'einnahme' ? 'H' : 'S';
    const konto = e.typ === 'einnahme' ? '8400' : '4900'; // 8400 = Erlöse, 4900 = Versand
    const gegenkonto = '1200'; // 1200 = Bank
    const datum = new Date(e.buchungsDatum).toLocaleDateString('de-DE');
    lines.push(`${betrag.replace('.', ',')},${sollHaben},${konto},${gegenkonto},${datum},${e.orderId?.slice(0, 8) || ''},,${e.beschreibung || ''}`);
  }

  return lines.join('\n');
}

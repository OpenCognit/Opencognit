// =============================================================================
// Rate Build-Up Service — PR-EST-2
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  estimateMaterialComponents,
  estimateLabourComponents,
  estimateEquipmentComponents,
  estimateSubcontractComponents,
  estimateRateSummaries,
  estimateBoqItems,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function recalcSummary(boqItemId: string) {
  const materials = db.select()
    .from(estimateMaterialComponents)
    .where(eq(estimateMaterialComponents.boqItemId, boqItemId)).all();
  const labour = db.select()
    .from(estimateLabourComponents)
    .where(eq(estimateLabourComponents.boqItemId, boqItemId)).all();
  const equipment = db.select()
    .from(estimateEquipmentComponents)
    .where(eq(estimateEquipmentComponents.boqItemId, boqItemId)).all();
  const sub = db.select()
    .from(estimateSubcontractComponents)
    .where(eq(estimateSubcontractComponents.boqItemId, boqItemId)).all();

  const matTotal = materials.reduce((s, m) => s + m.linePrice, 0);
  const labTotal = labour.reduce((s, l) => s + l.linePrice, 0);
  const equipTotal = equipment.reduce((s, e) => s + e.linePrice, 0);
  const subTotal = sub.reduce((s, sc) => s + sc.linePrice, 0);

  const subtotal = matTotal + labTotal + equipTotal + subTotal;
  const existing = db.select().from(estimateRateSummaries)
    .where(eq(estimateRateSummaries.boqItemId, boqItemId)).get();

  const overwrite = existing
    ? { overheadPct: existing.overheadPct, profitPct: existing.profitPct,
        riskAllowancePct: existing.riskAllowancePct, assumptionNotes: existing.assumptionNotes }
    : { overheadPct: 0, profitPct: 0, riskAllowancePct: 0, assumptionNotes: null };

  const ohAmt = subtotal * overwrite.overheadPct / 100;
  const profitAmt = (subtotal + ohAmt) * overwrite.profitPct / 100;
  const riskAmt = subtotal * overwrite.riskAllowancePct / 100;
  const finalRate = subtotal + ohAmt + profitAmt + riskAmt;

  const boqItem = db.select().from(estimateBoqItems)
    .where(eq(estimateBoqItems.id, boqItemId)).get();

  const finalAmount = boqItem ? finalRate * boqItem.quantity : finalRate;
  const isComplete = matTotal + labTotal + equipTotal + subTotal > 0;
  const now = new Date().toISOString();

  if (existing) {
    db.update(estimateRateSummaries).set({
      materialTotal: matTotal, labourTotal: labTotal, equipmentTotal: equipTotal,
      subcontractTotal: subTotal, subtotal,
      overheadAmount: ohAmt, profitAmount: profitAmt,
      riskAllowanceAmount: riskAmt, finalRate, finalAmount,
      buildUpStatus: isComplete ? 'complete' : 'incomplete', updatedAt: now,
    }).where(eq(estimateRateSummaries.id, existing.id)).run();
  } else {
    db.insert(estimateRateSummaries).values({
      id: uuid(), boqItemId, materialTotal: matTotal, labourTotal: labTotal,
      equipmentTotal: equipTotal, subcontractTotal: subTotal, subtotal,
      overheadPct: overwrite.overheadPct, overheadAmount: ohAmt,
      profitPct: overwrite.profitPct, profitAmount: profitAmt,
      riskAllowancePct: overwrite.riskAllowancePct, riskAllowanceAmount: riskAmt,
      finalRate, finalAmount, buildUpStatus: isComplete ? 'complete' : 'incomplete',
      assumptionNotes: overwrite.assumptionNotes,
    }).run();
  }

  // Update the boq item rate + amount
  if (boqItem && isComplete) {
    db.update(estimateBoqItems)
      .set({ rate: finalRate, amount: finalAmount, status: 'priced', updatedAt: now })
      .where(eq(estimateBoqItems.id, boqItemId)).run();
  }

  return db.select().from(estimateRateSummaries)
    .where(eq(estimateRateSummaries.boqItemId, boqItemId)).get();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const rateBuildUpService = {
  // Material
  addMaterial(params: { boqItemId: string; name: string; unit: string;
    qtyPerUnit?: number; unitPrice?: number; wastagePct?: number; vendorId?: string;
    quoteRef?: string; sortOrder?: number }) {
    const qty = params.qtyPerUnit || 1;
    const price = params.unitPrice || 0;
    const wastage = params.wastagePct || 0;
    const linePrice = qty * price * (1 + wastage / 100);

    const row = db.insert(estimateMaterialComponents).values({
      id: uuid(), boqItemId: params.boqItemId, materialName: params.name,
      unit: params.unit, qtyPerUnit: qty, unitPrice: price, linePrice,
      wastagePct: wastage, vendorId: params.vendorId || null,
      quoteRef: params.quoteRef || null, sortOrder: params.sortOrder || 0,
    }).returning().get();

    recalcSummary(params.boqItemId);
    return row;
  },

  // Labour
  addLabour(params: { boqItemId: string; tradeName: string;
    outputPerDay?: number; dayRate?: number; crewSize?: number;
    productivityBenchmarkId?: string; sortOrder?: number }) {
    const output = params.outputPerDay || 1;
    const rate = params.dayRate || 0;
    const crew = params.crewSize || 1;
    const labourDays = 1 / output;
    const linePrice = labourDays * rate * crew;

    const row = db.insert(estimateLabourComponents).values({
      id: uuid(), boqItemId: params.boqItemId, tradeName: params.tradeName,
      outputPerDay: output, labourDays, dayRate: rate, linePrice,
      crewSize: crew,
      productivityBenchmarkId: params.productivityBenchmarkId || null,
      sortOrder: params.sortOrder || 0,
    }).returning().get();

    recalcSummary(params.boqItemId);
    return row;
  },

  // Equipment
  addEquipment(params: { boqItemId: string; name: string;
    hourlyRate?: number; hoursPerDay?: number; equipmentDays?: number;
    sortOrder?: number }) {
    const hr = params.hourlyRate || 0;
    const hpd = params.hoursPerDay || 8;
    const days = params.equipmentDays || 1;
    const linePrice = hr * hpd * days;

    const row = db.insert(estimateEquipmentComponents).values({
      id: uuid(), boqItemId: params.boqItemId, equipmentName: params.name,
      hourlyRate: hr, hoursPerDay: hpd, equipmentDays: days, linePrice,
      sortOrder: params.sortOrder || 0,
    }).returning().get();

    recalcSummary(params.boqItemId);
    return row;
  },

  // Subcontract
  addSubcontract(params: { boqItemId: string; scope: string; unit: string;
    unitPrice?: number; subcontractorId?: string; quoteRef?: string;
    exclusions?: string; sortOrder?: number }) {
    const price = params.unitPrice || 0;
    const linePrice = price;

    const row = db.insert(estimateSubcontractComponents).values({
      id: uuid(), boqItemId: params.boqItemId, scope: params.scope,
      unit: params.unit, unitPrice: price, linePrice,
      subcontractorId: params.subcontractorId || null,
      quoteRef: params.quoteRef || null,
      exclusions: params.exclusions || null,
      sortOrder: params.sortOrder || 0,
    }).returning().get();

    recalcSummary(params.boqItemId);
    return row;
  },

  // OH&P settings
  setMarkups(boqItemId: string, params: { overheadPct?: number; profitPct?: number;
    riskAllowancePct?: number; assumptionNotes?: string }) {
    const sum = db.select().from(estimateRateSummaries)
      .where(eq(estimateRateSummaries.boqItemId, boqItemId)).get();
    if (!sum) return null;

    db.update(estimateRateSummaries).set({
      overheadPct: params.overheadPct ?? sum.overheadPct,
      profitPct: params.profitPct ?? sum.profitPct,
      riskAllowancePct: params.riskAllowancePct ?? sum.riskAllowancePct,
      assumptionNotes: params.assumptionNotes ?? sum.assumptionNotes,
    }).where(eq(estimateRateSummaries.id, sum.id)).run();

    return recalcSummary(boqItemId);
  },

  getRateSummary(boqItemId: string) {
    const summary = db.select().from(estimateRateSummaries)
      .where(eq(estimateRateSummaries.boqItemId, boqItemId)).get();
    if (!summary) return null;

    const materials = db.select().from(estimateMaterialComponents)
      .where(eq(estimateMaterialComponents.boqItemId, boqItemId)).all();
    const labour = db.select().from(estimateLabourComponents)
      .where(eq(estimateLabourComponents.boqItemId, boqItemId)).all();
    const equipment = db.select().from(estimateEquipmentComponents)
      .where(eq(estimateEquipmentComponents.boqItemId, boqItemId)).all();
    const sub = db.select().from(estimateSubcontractComponents)
      .where(eq(estimateSubcontractComponents.boqItemId, boqItemId)).all();

    return { summary, materials, labour, equipment, subcontract: sub };
  },

  recalc: recalcSummary,
};

// =============================================================================
// Quote Linkage Service — PR-EST-3
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { estimateQuoteLinks } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface LinkQuoteParams {
  estimateId: string;
  boqItemId?: string;
  quoteType: 'vendor' | 'subcontractor';
  vendorId?: string;
  subcontractorId?: string;
  quoteRef: string;
  quoteDate?: string;
  expiryDate?: string;
  amount?: number;
  coversVat?: boolean;
  coversTransport?: boolean;
  scopeMatch?: string;
  exclusions?: string;
  riskFlag?: string;
  linkedBy: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const quoteLinkageService = {
  linkQuote(params: LinkQuoteParams) {
    return db.insert(estimateQuoteLinks).values({
      id: uuid(),
      estimateId: params.estimateId,
      boqItemId: params.boqItemId || null,
      quoteType: params.quoteType,
      vendorId: params.vendorId || null,
      subcontractorId: params.subcontractorId || null,
      quoteRef: params.quoteRef,
      quoteDate: params.quoteDate || null,
      expiryDate: params.expiryDate || null,
      amount: params.amount ?? null,
      coversVat: params.coversVat ? 1 : 0,
      coversTransport: params.coversTransport ? 1 : 0,
      scopeMatch: params.scopeMatch || 'full',
      exclusions: params.exclusions || null,
      riskFlag: params.riskFlag || null,
      linkedBy: params.linkedBy,
    }).returning().get();
  },

  getEstimateQuotes(estimateId: string) {
    return db.select().from(estimateQuoteLinks)
      .where(eq(estimateQuoteLinks.estimateId, estimateId))
      .orderBy(desc(estimateQuoteLinks.createdAt))
      .all();
  },

  getItemQuotes(boqItemId: string) {
    return db.select().from(estimateQuoteLinks)
      .where(eq(estimateQuoteLinks.boqItemId, boqItemId))
      .all();
  },

  findExpiredQuotes(estimateId: string) {
    const now = new Date().toISOString();
    const all = this.getEstimateQuotes(estimateId);
    return all.filter(q => q.expiryDate && q.expiryDate < now);
  },

  markQuoteStatus(quoteId: string, status: string) {
    return db.update(estimateQuoteLinks)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(estimateQuoteLinks.id, quoteId))
      .returning()
      .get();
  },

  // Agent checks
  checkQuoteCoverage(estimateId: string) {
    const quotes = this.getEstimateQuotes(estimateId);
    const issues: string[] = [];

    const expired = quotes.filter(q => q.expiryDate && q.expiryDate < new Date().toISOString());
    if (expired.length) {
      issues.push(`${expired.length} quote(s) expired`);
    }
    const missingVat = quotes.filter(q => !q.coversVat);
    if (missingVat.length) {
      issues.push(`${missingVat.length} quote(s) exclude VAT`);
    }
    const missingTransport = quotes.filter(q => !q.coversTransport);
    if (missingTransport.length) {
      issues.push(`${missingTransport.length} quote(s) exclude transport`);
    }
    const partialScope = quotes.filter(q => q.scopeMatch !== 'full');
    if (partialScope.length) {
      issues.push(`${partialScope.length} quote(s) have partial scope match`);
    }
    const singleQuote = quotes.length === 1;
    if (singleQuote) {
      issues.push('single quote only — no competition');
    }

    return { total: quotes.length, issues };
  },
};

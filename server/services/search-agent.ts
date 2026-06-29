// =============================================================================
// Search Agent + Analytics Service — PR-SRCH-4+5
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { searchQueryIntents, searchAnalyticsEvents } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const searchAgentService = {
  // -------------------------------------------------------------------------
  // Query Intent Detection
  // -------------------------------------------------------------------------
  recordIntent(params: {
    companyId: string;
    userId?: string;
    queryText: string;
    detectedIntent: string;
    confidence: number;
    resolvedParams?: Record<string, any>;
    resultSummary?: string;
    evidenceCount?: number;
    recommendedAction?: string;
  }) {
    return db.insert(searchQueryIntents).values({
      id: uuid(),
      companyId: params.companyId,
      userId: params.userId || null,
      queryText: params.queryText,
      detectedIntent: params.detectedIntent,
      confidence: params.confidence,
      resolvedParams: params.resolvedParams ? JSON.stringify(params.resolvedParams) : null,
      resultSummary: params.resultSummary || null,
      evidenceCount: params.evidenceCount || 0,
      recommendedAction: params.recommendedAction || null,
    }).returning().get();
  },

  getRecentIntents(companyId: string, limit = 20) {
    return db.select().from(searchQueryIntents)
      .where(eq(searchQueryIntents.companyId, companyId))
      .orderBy(desc(searchQueryIntents.createdAt))
      .limit(limit)
      .all();
  },

  // -------------------------------------------------------------------------
  // Analytics Events
  // -------------------------------------------------------------------------
  recordEvent(params: {
    companyId: string;
    eventType: string;
    queryText?: string;
    affectedModule?: string;
    affectedRecordId?: string;
    detail?: Record<string, any>;
  }) {
    return db.insert(searchAnalyticsEvents).values({
      id: uuid(),
      companyId: params.companyId,
      eventType: params.eventType,
      queryText: params.queryText || null,
      affectedModule: params.affectedModule || null,
      affectedRecordId: params.affectedRecordId || null,
      detailJson: params.detail ? JSON.stringify(params.detail) : null,
    }).returning().get();
  },

  getPopularSearches(companyId: string, limit = 10) {
    return db.select().from(searchAnalyticsEvents)
      .where(eq(searchAnalyticsEvents.companyId, companyId))
      .orderBy(desc(searchAnalyticsEvents.createdAt))
      .limit(limit)
      .all();
  },
};

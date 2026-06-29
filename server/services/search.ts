// =============================================================================
// Search Service — PR-SRCH-1 Universal Search Index Foundation
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  searchIndexRecords,
  searchIndexTerms,
  searchIndexLinks,
  searchSavedQueries,
  searchRecentItems,
} from '../db/schema';
import { eq, and, like, desc, or, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface IndexRecordParams {
  companyId: string;
  projectId?: string;
  sourceModule: string;
  sourceRecordId: string;
  recordType: string;
  title: string;
  searchText: string;
  status?: string;
  ownerUserId?: string;
  visibilityScope?: string;
}

export interface SearchParams {
  companyId: string;
  query: string;
  projectId?: string;
  module?: string;
  recordType?: string;
  status?: string;
  limit?: number;
}

export interface SaveQueryParams {
  userId: string;
  companyId: string;
  name: string;
  queryText: string;
  filtersJson?: string;
}

export interface RecentItemParams {
  userId: string;
  companyId: string;
  sourceModule: string;
  sourceRecordId: string;
  recordType: string;
  title: string;
}

export interface LinkRecordParams {
  recordId: string;
  linkedRecordId: string;
  linkType: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\u0040-\uFFFF]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function termFrequency(terms: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of terms) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const searchService = {
  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------
  indexRecord(params: IndexRecordParams) {
    const recordId = uuid();

    // Upsert: remove existing index for same source record
    const existing = db.select().from(searchIndexRecords)
      .where(and(
        eq(searchIndexRecords.sourceModule, params.sourceModule),
        eq(searchIndexRecords.sourceRecordId, params.sourceRecordId),
      )).get();

    if (existing) {
      // Delete old terms
      db.delete(searchIndexTerms)
        .where(eq(searchIndexTerms.recordId, existing.id)).run();
      // Delete the old record
      db.delete(searchIndexRecords)
        .where(eq(searchIndexRecords.id, existing.id)).run();
    }

    // Insert record
    const record = db.insert(searchIndexRecords).values({
      id: recordId,
      companyId: params.companyId,
      projectId: params.projectId || null,
      sourceModule: params.sourceModule,
      sourceRecordId: params.sourceRecordId,
      recordType: params.recordType,
      title: params.title,
      searchText: params.searchText,
      status: params.status || null,
      ownerUserId: params.ownerUserId || null,
      visibilityScope: params.visibilityScope || 'tenant',
    }).returning().get();

    // Tokenize and index terms
    const terms = tokenize(params.title + ' ' + params.searchText);
    const freq = termFrequency(terms);
    for (const [term, count] of freq) {
      db.insert(searchIndexTerms).values({
        id: uuid(),
        recordId,
        term,
        frequency: count,
      }).run();
    }

    return record;
  },

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  search(params: SearchParams) {
    const query = params.query.toLowerCase().trim();
    const limit = params.limit || 25;

    // Tokenize query
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    // Find matching terms
    const matchingTermRecords = db.select({ recordId: searchIndexTerms.recordId })
      .from(searchIndexTerms)
      .where(
        or(...queryTerms.map(t => like(searchIndexTerms.term, `%${t}%`)))
      )
      .all();

    const recordIds = [...new Set(matchingTermRecords.map(r => r.recordId))];
    if (recordIds.length === 0) return [];

    // Fetch matching records with filters
    let q = db.select().from(searchIndexRecords)
      .where(
        and(
          eq(searchIndexRecords.companyId, params.companyId),
          sql`${searchIndexRecords.id} IN (${recordIds.map(() => '?').join(',')})`,
          ...recordIds,
        )
      );

    // Apply optional filters
    if (params.projectId) {
      q = q.where(eq(searchIndexRecords.projectId, params.projectId));
    }
    if (params.module) {
      q = q.where(eq(searchIndexRecords.sourceModule, params.module));
    }
    if (params.recordType) {
      q = q.where(eq(searchIndexRecords.recordType, params.recordType));
    }
    if (params.status) {
      q = q.where(eq(searchIndexRecords.status, params.status));
    }

    const results = q.limit(limit).all();

    // Attach linked records
    return results.map(r => {
      const links = db.select().from(searchIndexLinks)
        .where(eq(searchIndexLinks.recordId, r.id)).all();
      return { ...r, links };
    });
  },

  // -------------------------------------------------------------------------
  // Links between records
  // -------------------------------------------------------------------------
  linkRecords(params: LinkRecordParams) {
    // Update linked_record_count on both records
    db.update(searchIndexRecords)
      .set({ linkedRecordCount: sql`${searchIndexRecords.linkedRecordCount} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(searchIndexRecords.id, params.recordId)).run();

    db.update(searchIndexRecords)
      .set({ linkedRecordCount: sql`${searchIndexRecords.linkedRecordCount} + 1`, updatedAt: new Date().toISOString() })
      .where(eq(searchIndexRecords.id, params.linkedRecordId)).run();

    return db.insert(searchIndexLinks).values({
      id: uuid(),
      recordId: params.recordId,
      linkedRecordId: params.linkedRecordId,
      linkType: params.linkType,
      description: params.description || null,
    }).returning().get();
  },

  getLinkedRecords(recordId: string) {
    return db.select().from(searchIndexLinks)
      .where(eq(searchIndexLinks.recordId, recordId)).all();
  },

  // -------------------------------------------------------------------------
  // Saved Queries
  // -------------------------------------------------------------------------
  saveQuery(params: SaveQueryParams) {
    return db.insert(searchSavedQueries).values({
      id: uuid(),
      userId: params.userId,
      companyId: params.companyId,
      name: params.name,
      queryText: params.queryText,
      filtersJson: params.filtersJson || null,
    }).returning().get();
  },

  getSavedQueries(userId: string) {
    return db.select().from(searchSavedQueries)
      .where(eq(searchSavedQueries.userId, userId))
      .orderBy(desc(searchSavedQueries.createdAt))
      .all();
  },

  deleteSavedQuery(queryId: string) {
    return db.delete(searchSavedQueries)
      .where(eq(searchSavedQueries.id, queryId)).run();
  },

  // -------------------------------------------------------------------------
  // Recent Items
  // -------------------------------------------------------------------------
  recordRecentItem(params: RecentItemParams) {
    return db.insert(searchRecentItems).values({
      id: uuid(),
      userId: params.userId,
      companyId: params.companyId,
      sourceModule: params.sourceModule,
      sourceRecordId: params.sourceRecordId,
      recordType: params.recordType,
      title: params.title,
    }).returning().get();
  },

  getRecentItems(userId: string, companyId: string, limit = 20) {
    return db.select().from(searchRecentItems)
      .where(and(
        eq(searchRecentItems.userId, userId),
        eq(searchRecentItems.companyId, companyId),
      ))
      .orderBy(desc(searchRecentItems.accessedAt))
      .limit(limit)
      .all();
  },
};

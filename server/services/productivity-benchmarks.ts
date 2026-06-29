// =============================================================================
// Productivity + Historical Benchmark Service — PR-EST-4
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { estimateProductivityAssumptions, estimateHistoricalComparisons } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const productivityBenchmarkService = {
  addProductivityAssumption(params: {
    boqItemId: string;
    activityType: string;
    unit?: string;
    assumedOutputPerDay: number;
    crewSize?: number;
    crewComposition?: string;
    benchmarkSource?: string;
    benchmarkOutput?: number;
    conditionsFactor?: number;
    conditionsNotes?: string;
  }) {
    const variance = params.benchmarkOutput
      ? ((params.assumedOutputPerDay - params.benchmarkOutput) / params.benchmarkOutput) * 100
      : null;

    return db.insert(estimateProductivityAssumptions).values({
      id: uuid(),
      boqItemId: params.boqItemId,
      activityType: params.activityType,
      unit: params.unit || 'm²',
      assumedOutputPerDay: params.assumedOutputPerDay,
      crewSize: params.crewSize || 1,
      crewComposition: params.crewComposition || null,
      benchmarkSource: params.benchmarkSource || null,
      benchmarkOutput: params.benchmarkOutput || null,
      variancePct: variance,
      conditionsFactor: params.conditionsFactor || 1.0,
      conditionsNotes: params.conditionsNotes || null,
    }).returning().get();
  },

  getItemAssumptions(boqItemId: string) {
    return db.select().from(estimateProductivityAssumptions)
      .where(eq(estimateProductivityAssumptions.boqItemId, boqItemId))
      .all();
  },

  addHistoricalComparison(params: {
    estimateId: string;
    boqItemId?: string;
    activityType: string;
    currentRate: number;
    historicalAvgRate: number;
    historicalMinRate?: number;
    historicalMaxRate?: number;
    sampleCount?: number;
    dataSource?: string;
  }) {
    const variance = ((params.currentRate - params.historicalAvgRate) / params.historicalAvgRate) * 100;
    const riskLevel = Math.abs(variance) > 15 ? 'high' : Math.abs(variance) > 8 ? 'medium' : 'low';

    const rec = variance < -10
      ? `Rate ${Math.abs(variance).toFixed(1)}% below historical — verify productivity/logistics`
      : variance > 10
        ? `Rate ${variance.toFixed(1)}% above historical — risk of losing bid`
        : null;

    return db.insert(estimateHistoricalComparisons).values({
      id: uuid(),
      estimateId: params.estimateId,
      boqItemId: params.boqItemId || null,
      activityType: params.activityType,
      currentRate: params.currentRate,
      historicalAvgRate: params.historicalAvgRate,
      historicalMinRate: params.historicalMinRate || null,
      historicalMaxRate: params.historicalMaxRate || null,
      variancePct: variance,
      sampleCount: params.sampleCount || 1,
      dataSource: params.dataSource || null,
      riskLevel,
      recommendedAdjustment: rec,
    }).returning().get();
  },

  getEstimateComparisons(estimateId: string, riskFilter?: string) {
    let q = db.select().from(estimateHistoricalComparisons)
      .where(eq(estimateHistoricalComparisons.estimateId, estimateId));
    if (riskFilter) {
      q = q.where(eq(estimateHistoricalComparisons.riskLevel, riskFilter));
    }
    return q.orderBy(desc(estimateHistoricalComparisons.variancePct)).all();
  },
};

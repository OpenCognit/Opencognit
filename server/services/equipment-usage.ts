// =============================================================================
// Equipment Usage Service — PR-EQP-2
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { equipmentUsageLogs, equipmentAssets } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export const equipmentUsageService = {
  recordUsage(params: {
    companyId: string; equipmentId: string; date: string;
    hoursUsed: number; idleHours?: number; fuelUsed?: number;
    startMeter?: number; endMeter?: number;
    projectId?: string; workPackId?: string; activityId?: string;
    operatorId?: string; location?: string; notes?: string;
    createdBy: string;
  }) {
    // Update equipment meter
    if (params.endMeter) {
      db.update(equipmentAssets).set({
        meterReading: params.endMeter,
        status: 'in_use',
        updatedAt: new Date().toISOString(),
      }).where(eq(equipmentAssets.id, params.equipmentId)).run();
    }

    return db.insert(equipmentUsageLogs).values({
      id: uuid(), companyId: params.companyId,
      equipmentId: params.equipmentId, date: params.date,
      hoursUsed: params.hoursUsed, idleHours: params.idleHours || 0,
      fuelUsed: params.fuelUsed ?? null,
      startMeter: params.startMeter ?? null,
      endMeter: params.endMeter ?? null,
      projectId: params.projectId || null,
      workPackId: params.workPackId || null,
      activityId: params.activityId || null,
      operatorId: params.operatorId || null,
      location: params.location || null,
      notes: params.notes || null,
      createdBy: params.createdBy,
    }).returning().get();
  },

  getEquipmentLogs(equipmentId: string, limit = 30) {
    return db.select().from(equipmentUsageLogs)
      .where(eq(equipmentUsageLogs.equipmentId, equipmentId))
      .orderBy(desc(equipmentUsageLogs.date))
      .limit(limit).all();
  },

  getDailyLogs(companyId: string, date: string) {
    return db.select().from(equipmentUsageLogs)
      .where(eq(equipmentUsageLogs.date, date))
      .all();
  },

  getUtilization(equipmentId: string, days = 30) {
    const logs = this.getEquipmentLogs(equipmentId, days);
    const totalHrs = logs.reduce((s, l) => s + l.hoursUsed, 0);
    const totalIdle = logs.reduce((s, l) => s + l.idleHours, 0);
    const totalActive = totalHrs + totalIdle;
    const utilPct = totalActive > 0 ? (totalHrs / totalActive) * 100 : 0;

    const totalFuel = logs.reduce((s, l) => s + (l.fuelUsed || 0), 0);

    return {
      daysWithLogs: logs.length,
      totalHours: totalHrs,
      totalIdleHours: totalIdle,
      utilizationPct: Math.round(utilPct * 10) / 10,
      totalFuel: Math.round(totalFuel * 10) / 10,
      logs,
    };
  },

  findAbnormalFuel(companyId: string, thresholdPct = 30) {
    const assets = db.select().from(equipmentAssets)
      .where(eq(equipmentAssets.companyId, companyId)).all();
    const alerts: any[] = [];

    for (const a of assets) {
      const logs = this.getEquipmentLogs(a.id, 10);
      for (const l of logs) {
        if (!l.fuelUsed || !l.hoursUsed || l.hoursUsed < 1) continue;
        const perHr = l.fuelUsed / l.hoursUsed;
        const expected = 5; // baseline avg L/hr
        const variance = ((perHr - expected) / expected) * 100;
        if (variance > thresholdPct) {
          alerts.push({ equipmentId: a.id, assetCode: a.assetCode, date: l.date,
            fuelUsed: l.fuelUsed, hoursUsed: l.hoursUsed, fuelPerHr: perHr, variancePct: variance });
        }
      }
    }
    return alerts;
  },
};

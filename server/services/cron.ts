// Cron Scheduler Service - Schedules automatic agent wake-ups
// Implements a 5-field cron parser and fires due triggers every 30 seconds

import { db } from '../db/client.js';
import { routineTrigger, routinen, agentWakeupRequests, experten, routineAusfuehrung, unternehmen } from '../db/schema.js';
import { eq, and, lt, sql, isNull } from 'drizzle-orm';
import { wakeupService } from './wakeup.js';
import { heartbeatService } from './heartbeat.js';

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

export interface CronService {
  /**
   * Parse a cron expression
   */
  parseCron(expression: string): ParsedCron;

  /**
   * Calculate next run time for a cron expression
   */
  nextCronTick(expression: string, after?: Date): Date | null;

  /**
   * Start the cron scheduler
   */
  start(): void;

  /**
   * Stop the cron scheduler
   */
  stop(): void;

  /**
   * Process due triggers
   */
  processDueTriggers(now?: Date): Promise<number>;
}

class CronServiceImpl implements CronService {
  private intervalId: NodeJS.Timeout | null = null;
  private consolidationIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Parse a cron expression (5 fields: minute hour day-of-month month day-of-week)
   */
  parseCron(expression: string): ParsedCron {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
    }

    const [minute, hour, dom, month, dow] = fields;

    return {
      minutes: this.parseField(minute, 0, 59),
      hours: this.parseField(hour, 0, 23),
      daysOfMonth: this.parseField(dom, 1, 31),
      months: this.parseField(month, 1, 12),
      daysOfWeek: this.parseField(dow, 0, 6),
    };
  }

  /**
   * Parse a single cron field
   */
  private parseField(field: string, min: number, max: number): number[] {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }

    if (field.includes('/')) {
      const [base, step] = field.split('/');
      const stepVal = parseInt(step, 10);
      const start = base === '*' ? min : parseInt(base, 10);
      const result: number[] = [];
      for (let i = start; i <= max; i += stepVal) {
        result.push(i);
      }
      return result;
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map(s => parseInt(s, 10));
      const result: number[] = [];
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
      return result;
    }

    if (field.includes(',')) {
      return field.split(',').map(s => parseInt(s.trim(), 10));
    }

    return [parseInt(field, 10)];
  }

  /**
   * Calculate next run time for a cron expression
   */
  nextCronTick(expression: string, after: Date = new Date()): Date | null {
    try {
      const parsed = this.parseCron(expression);
      const current = new Date(after);

      // Start from next minute
      current.setSeconds(0, 0);
      current.setMinutes(current.getMinutes() + 1);

      // Search for next valid time (max 1 year ahead)
      const maxIterations = 365 * 24 * 60;

      for (let i = 0; i < maxIterations; i++) {
        const minute = current.getMinutes();
        const hour = current.getHours();
        const dayOfMonth = current.getDate();
        const month = current.getMonth() + 1;
        const dayOfWeek = current.getDay();

        if (
          parsed.months.includes(month) &&
          parsed.daysOfMonth.includes(dayOfMonth) &&
          parsed.daysOfWeek.includes(dayOfWeek) &&
          parsed.hours.includes(hour) &&
          parsed.minutes.includes(minute)
        ) {
          return current;
        }

        current.setMinutes(current.getMinutes() + 1);
      }

      return null;
    } catch (error) {
      console.error('Error calculating cron tick:', error);
      return null;
    }
  }

  /**
   * Start the cron scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('⏰ Cron scheduler already running');
      return;
    }

    this.isRunning = true;
    console.log('🕐 Starting cron scheduler (checking every 30 seconds)...');

    // Check every 30 seconds for due triggers
    this.intervalId = setInterval(async () => {
      try {
        await this.processDueTriggers();
      } catch (error) {
        console.error('❌ Error in cron scheduler:', error);
      }
    }, 30000);

    // Run Memory consolidation every hour for all companies
    this.consolidationIntervalId = setInterval(async () => {
      try {
        const { consolidateAll } = await import('./memory-consolidation.js');
        const companies = db.select({ id: unternehmen.id }).from(unternehmen).all();
        for (const c of companies) {
          await consolidateAll(c.id);
        }
      } catch (e: any) {
        console.warn('⚠️ Cron: Memory consolidation fehlgeschlagen:', e.message);
      }
    }, 60 * 60 * 1000); // every hour
  }

  /**
   * Stop the cron scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.consolidationIntervalId) {
      clearInterval(this.consolidationIntervalId);
      this.consolidationIntervalId = null;
    }
    this.isRunning = false;
    console.log('⏹️ Cron scheduler stopped');
  }

  /**
   * Process due triggers
   */
  async processDueTriggers(now: Date = new Date()): Promise<number> {
    const nowStr = now.toISOString();

    // Get all active triggers
    const triggers = await db.select({
      id: routineTrigger.id,
      routineId: routineTrigger.routineId,
      cronExpression: routineTrigger.cronExpression,
      naechsterAusfuehrungAm: routineTrigger.naechsterAusfuehrungAm,
      aktiv: routineTrigger.aktiv,
    })
    .from(routineTrigger)
    .where(eq(routineTrigger.aktiv, true));

    let firedCount = 0;

    for (const trigger of triggers) {
      if (!trigger.cronExpression) continue;

      const nextRun = trigger.naechsterAusfuehrungAm
        ? new Date(trigger.naechsterAusfuehrungAm)
        : this.nextCronTick(trigger.cronExpression, now);

      if (!nextRun) continue;

      // Check if it's time to fire
      if (nextRun <= now) {
        try {
          await this.fireTrigger(trigger.id, trigger.routineId, nowStr);
          firedCount++;
        } catch (error) {
          console.error(`❌ Error firing trigger ${trigger.id}:`, error);
        }
      }
    }

    if (firedCount > 0) {
      console.log(`⏰ Fired ${firedCount} cron trigger(s)`);
    }

    return firedCount;
  }

  /**
   * Fire a trigger and create wakeup request
   */
  private async fireTrigger(triggerId: string, routineId: string, nowStr: string): Promise<void> {
    // Get routine details
    const routines = await db.select({
      id: routinen.id,
      titel: routinen.titel,
      zugewiesenAn: routinen.zugewiesenAn,
      unternehmenId: routinen.unternehmenId,
      prioritaet: routinen.prioritaet,
    })
    .from(routinen)
    .where(eq(routinen.id, routineId))
    .limit(1);

    if (routines.length === 0) {
      console.warn(`⚠️ Routine ${routineId} not found`);
      return;
    }

    const routine = routines[0];

    if (!routine.zugewiesenAn) {
      console.warn(`⚠️ Routine ${routineId} has no assigned agent`);
      return;
    }

    // Check if agent exists and is active
    const agents = await db.select({
      id: experten.id,
      status: experten.status,
      zyklusAktiv: experten.zyklusAktiv,
    })
    .from(experten)
    .where(eq(experten.id, routine.zugewiesenAn))
    .limit(1);

    if (agents.length === 0 || agents[0].status === 'terminated' || !agents[0].zyklusAktiv) {
      console.warn(`⚠️ Agent ${routine.zugewiesenAn} is not available for routine ${routineId}`);
      return;
    }

    // Create routine execution record
    const executionId = crypto.randomUUID();
    await db.insert(routineAusfuehrung).values({
      id: executionId,
      unternehmenId: routine.unternehmenId,
      routineId,
      triggerId,
      quelle: 'schedule',
      status: 'enqueued',
      erstelltAm: nowStr,
    });

    // Queue wakeup for the assigned agent
    await wakeupService.wakeup(routine.zugewiesenAn, routine.unternehmenId, {
      source: 'timer',
      triggerDetail: 'cron',
      reason: `Geplante Aufgabe: ${routine.titel}`,
      payload: {
        routineId,
        executionId,
        triggerId,
      },
      contextSnapshot: {
        source: 'routine_schedule',
        routineId,
        executionId,
      },
    });

    // Update trigger next run time
    const trigger = await db.select({
      cronExpression: routineTrigger.cronExpression,
    })
    .from(routineTrigger)
    .where(eq(routineTrigger.id, triggerId))
    .limit(1);

    let nextRunAt: string | null = null;
    if (trigger.length > 0 && trigger[0].cronExpression) {
      const nextTick = this.nextCronTick(trigger[0].cronExpression, new Date());
      nextRunAt = nextTick?.toISOString() || null;
    }

    await db.update(routineTrigger)
      .set({
        naechsterAusfuehrungAm: nextRunAt,
        zuletztGefeuertAm: nowStr,
      })
      .where(eq(routineTrigger.id, triggerId));

    // Update routine last executed time
    await db.update(routinen)
      .set({
        zuletztAusgefuehrtAm: nowStr,
      })
      .where(eq(routinen.id, routineId));

    console.log(`⏰ Trigger ${triggerId} fired for routine ${routine.titel}`);
  }
}

// Singleton instance
export const cronService = new CronServiceImpl();

// Convenience exports
export const startCronScheduler = cronService.start.bind(cronService);
export const stopCronScheduler = cronService.stop.bind(cronService);
export const parseCronExpression = cronService.parseCron.bind(cronService);
export const calculateNextCronTick = cronService.nextCronTick.bind(cronService);

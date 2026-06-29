// =============================================================================
// Command Palette Service — PR-SRCH-3
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import { searchCommands, searchCommandUsage } from '../db/schema';
import { eq, and, like, desc, or } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const commandService = {
  search(query: string) {
    const q = query.toLowerCase().trim();
    return db.select().from(searchCommands)
      .where(and(
        eq(searchCommands.isActive, 1),
        or(
          like(searchCommands.label, `%${q}%`),
          like(searchCommands.commandKey, `%${q}%`),
          like(searchCommands.category, `%${q}%`),
        )
      ))
      .limit(10)
      .all();
  },

  getByCategory(category: string) {
    return db.select().from(searchCommands)
      .where(and(
        eq(searchCommands.category, category),
        eq(searchCommands.isActive, 1),
      ))
      .all();
  },

  listAll() {
    return db.select().from(searchCommands)
      .where(eq(searchCommands.isActive, 1))
      .orderBy(eq(searchCommands.category, 'navigate'))
      .all();
  },

  recordUsage(userId: string, companyId: string, commandId: string) {
    return db.insert(searchCommandUsage).values({
      id: uuid(),
      userId,
      companyId,
      commandId,
    }).returning().get();
  },

  getFrequentCommands(userId: string, limit = 5) {
    return db.select().from(searchCommandUsage)
      .where(eq(searchCommandUsage.userId, userId))
      .orderBy(desc(searchCommandUsage.executedAt))
      .limit(limit)
      .all();
  },
};

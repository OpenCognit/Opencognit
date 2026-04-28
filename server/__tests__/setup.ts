import { beforeEach } from 'vitest';
import { initializeDatabase, sqlite } from '../db/client.js';

/**
 * Test setup — runs before each test file (singleFork mode).
 *
 * With vitest.server.config.ts using `pool: 'forks'` + `singleFork: true`,
 * each test file gets its own fresh :memory: SQLite database. We just need
 * to ensure migrations are applied before tests run.
 */
beforeEach(async () => {
  // Apply migrations to the fresh in-memory database
  await initializeDatabase();
});

// Also expose a helper for tests that need a completely clean slate mid-file
export function resetTestDb() {
  if (!sqlite) return;
  // Get all user tables (excluding SQLite internals and _migrations)
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_migrations'
         AND name NOT LIKE '_%'`
    )
    .all() as { name: string }[];

  sqlite.exec('PRAGMA foreign_keys = OFF;');
  for (const { name } of tables) {
    try {
      sqlite.prepare(`DELETE FROM "${name}"`).run();
    } catch {
      // ignore views or other non-deletable objects
    }
  }
  sqlite.exec('PRAGMA foreign_keys = ON;');
}

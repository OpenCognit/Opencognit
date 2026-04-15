/**
 * CLI migration runner — run with: npm run db:migrate
 * Runs all pending migrations against the configured database.
 */
import { initializeDatabase } from './client.js';

console.log('🔄 OpenCognit Datenbank-Migration...\n');
console.log('Datenbank:', process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite (./data/opencognit.db)');
console.log('');

try {
  await initializeDatabase();
  console.log('\n✅ Migration abgeschlossen');
  process.exit(0);
} catch (err) {
  console.error('\n❌ Migration fehlgeschlagen:', err);
  process.exit(1);
}

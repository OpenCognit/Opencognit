
import { db } from '../db/client.js';
import { experten } from '../db/schema.js';

async function debug() {
  const all = await db.select().from(experten);
  console.log('--- EXPERTEN DB DUMP ---');
  all.forEach(e => {
    console.log(`ID: ${e.id} | Name: ${e.name} | ReportsTo: ${e.reportsTo}`);
  });
  console.log('------------------------');
}

debug().catch(console.error);

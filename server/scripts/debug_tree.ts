
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';

async function debug() {
  const all = await db.select().from(agents);
  console.log('--- EXPERTEN DB DUMP ---');
  all.forEach(e => {
    console.log(`ID: ${e.id} | Name: ${e.name} | ReportsTo: ${e.reportsTo}`);
  });
  console.log('------------------------');
}

debug().catch(console.error);

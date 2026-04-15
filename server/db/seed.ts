import { db, initializeDatabase } from './client.js';
import { benutzer } from './schema.js';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

const now = () => new Date().toISOString();

/**
 * Seed-Funktion für OpenCognit
 *
 * Diese Funktion wird beim Server-Start aufgerufen und erstellt nur den Admin-Benutzer.
 * KEINE Demo-Daten werden erstellt - das Onboarding übernimmt die Einrichtung des ersten
 * Unternehmens, der API-Keys und des ersten Experten.
 *
 * Flow für neue Installation:
 * 1. Server startet → DB wird initialisiert
 * 2. Admin-Benutzer wird erstellt (wenn nicht vorhanden)
 * 3. User registriert/sich anmeldet
 * 4. Onboarding-Wizard führt durch Einrichtung
 * 5. Dashboard mit leerem Unternehmen
 */
export async function seedDatabase() {
  initializeDatabase();

  // Check if admin user exists
  const adminEmail = 'admin@opencognit.com';
  const existingUser = db.select().from(benutzer).where(eq(benutzer.email, adminEmail)).get();

  if (existingUser) {
    console.log('ℹ️  Admin-Benutzer existiert bereits, überspringe Seed.');
    return;
  }

  console.log('🌱 Erstelle Admin-Benutzer für OpenCognit...');

  // Generate a random one-time password — never hardcode credentials
  const randomPassword = require('crypto').randomBytes(10).toString('base64url').slice(0, 14);

  // --- Benutzer (Login) ---
  const adminId = uuid();
  const passwordHash = await bcrypt.hash(randomPassword, 12);
  db.insert(benutzer).values({
    id: adminId,
    name: 'Admin User',
    email: 'admin@opencognit.com',
    passwortHash: passwordHash,
    rolle: 'admin',
    erstelltAm: now(),
    aktualisiertAm: now(),
  }).run();

  // Write credentials to a local file so the admin can find them
  const credFile = 'data/initial-credentials.txt';
  require('fs').writeFileSync(credFile,
    `OpenCognit Initial Admin Credentials\n\nEmail:    admin@opencognit.com\nPassword: ${randomPassword}\n\nDelete this file after your first login!\n`
  );

  console.log('✅ Admin-Benutzer erstellt!');
  console.log('   Email: admin@opencognit.com');
  console.log(`   Passwort: ${randomPassword}  ← bitte notieren!`);
  console.log(`   (Gespeichert in: ${credFile})`)
  console.log('');
  console.log('📋 Nächste Schritte:');
  console.log('   1. Öffne http://localhost:3200');
  console.log('   2. Melde dich mit den Admin-Daten an');
  console.log('   3. Das Onboarding führt dich durch die Einrichtung');
  console.log('');
}

// export function exists for manual seeding via CLI later

import { sqlite } from '../server/db/client.js';

console.log('🚀 Starte Migration: einstellungen Tabelle (Per-Unternehmen)...');

try {
  // 1. Sichere alte Daten
  const oldData = sqlite.prepare('SELECT * FROM einstellungen').all();
  console.log(`📦 ${oldData.length} bestehende Einstellungen gefunden.`);

  // 2. Erstelle neue Tabelle
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS einstellungen_new (
      schluessel TEXT NOT NULL,
      unternehmen_id TEXT NOT NULL DEFAULT '',
      wert TEXT NOT NULL,
      aktualisiert_am TEXT NOT NULL,
      PRIMARY KEY (schluessel, unternehmen_id)
    );
  `);

  // 3. Kopiere Daten (alte Daten werden global, unternehmen_id = '')
  const insert = sqlite.prepare('INSERT INTO einstellungen_new (schluessel, unternehmen_id, wert, aktualisiert_am) VALUES (?, ?, ?, ?)');
  const migrateTransaction = sqlite.transaction((data) => {
    for (const row of data) {
      insert.run(row.schluessel, '', row.wert, row.aktualisiert_am);
    }
  });
  migrateTransaction(oldData);

  // 4. Ersetze Tabellen
  sqlite.exec('DROP TABLE einstellungen;');
  sqlite.exec('ALTER TABLE einstellungen_new RENAME TO einstellungen;');

  console.log('✅ Migration erfolgreich abgeschlossen!');
} catch (e) {
  console.error('❌ Migration fehlgeschlagen:', e);
  process.exit(1);
}

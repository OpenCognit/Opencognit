-- Migration 0027: Business Automation (Orders, Customers, Invoices, Accounting)

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  external_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  telefon TEXT,
  adresse TEXT,
  stadt TEXT,
  plz TEXT,
  land TEXT DEFAULT 'DE',
  steuer_id TEXT,
  notizen TEXT,
  quelle TEXT DEFAULT 'manual',
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_unternehmen_idx ON customers(unternehmen_id);
CREATE INDEX IF NOT EXISTS customers_email_idx ON customers(email);
CREATE INDEX IF NOT EXISTS customers_external_idx ON customers(unternehmen_id, external_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  customer_id TEXT REFERENCES customers(id),
  external_order_id TEXT,
  quelle TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  zahlungs_status TEXT NOT NULL DEFAULT 'pending',
  zahlungs_methode TEXT,
  zwischensumme_cent INTEGER NOT NULL DEFAULT 0,
  steuer_cent INTEGER NOT NULL DEFAULT 0,
  versand_cent INTEGER NOT NULL DEFAULT 0,
  rabatt_cent INTEGER NOT NULL DEFAULT 0,
  gesamt_cent INTEGER NOT NULL DEFAULT 0,
  waehrung TEXT NOT NULL DEFAULT 'EUR',
  versand_name TEXT,
  versand_adresse TEXT,
  versand_stadt TEXT,
  versand_plz TEXT,
  versand_land TEXT DEFAULT 'DE',
  task_id TEXT REFERENCES aufgaben(id),
  invoice_id TEXT,
  raw_payload_json TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_unternehmen_status_idx ON orders(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_external_idx ON orders(unternehmen_id, external_order_id);
CREATE INDEX IF NOT EXISTS orders_quelle_idx ON orders(unternehmen_id, quelle);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  product_id TEXT,
  product_name TEXT NOT NULL,
  product_sku TEXT,
  menge INTEGER NOT NULL DEFAULT 1,
  einzelpreis_cent INTEGER NOT NULL DEFAULT 0,
  gesamtpreis_cent INTEGER NOT NULL DEFAULT 0,
  steuersatz_prozent INTEGER NOT NULL DEFAULT 19,
  internal_product_id TEXT,
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  order_id TEXT REFERENCES orders(id),
  customer_id TEXT REFERENCES customers(id),
  rechnungs_nummer TEXT NOT NULL UNIQUE,
  rechnungs_datum TEXT NOT NULL,
  faelligkeit_datum TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  zwischensumme_cent INTEGER NOT NULL DEFAULT 0,
  steuer_cent INTEGER NOT NULL DEFAULT 0,
  gesamt_cent INTEGER NOT NULL DEFAULT 0,
  waehrung TEXT NOT NULL DEFAULT 'EUR',
  pdf_path TEXT,
  gesendet_via TEXT,
  gesendet_am TEXT,
  erstellt_von_expert_id TEXT REFERENCES experten(id),
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_unternehmen_idx ON invoices(unternehmen_id);
CREATE INDEX IF NOT EXISTS invoices_order_idx ON invoices(order_id);
CREATE INDEX IF NOT EXISTS invoices_nummer_idx ON invoices(rechnungs_nummer);

CREATE TABLE IF NOT EXISTS accounting_entries (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  order_id TEXT REFERENCES orders(id),
  invoice_id TEXT REFERENCES invoices(id),
  typ TEXT NOT NULL,
  kategorie TEXT,
  betrag_cent INTEGER NOT NULL,
  waehrung TEXT NOT NULL DEFAULT 'EUR',
  steuersatz_prozent INTEGER NOT NULL DEFAULT 19,
  steuer_betrag_cent INTEGER NOT NULL DEFAULT 0,
  buchungs_datum TEXT NOT NULL,
  beschreibung TEXT,
  synced_to TEXT DEFAULT 'none',
  synced_at TEXT,
  erstellt_von_expert_id TEXT REFERENCES experten(id),
  erstellt_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS accounting_unternehmen_datum_idx ON accounting_entries(unternehmen_id, buchungs_datum);
CREATE INDEX IF NOT EXISTS accounting_typ_idx ON accounting_entries(unternehmen_id, typ);
CREATE INDEX IF NOT EXISTS accounting_synced_idx ON accounting_entries(unternehmen_id, synced_to);

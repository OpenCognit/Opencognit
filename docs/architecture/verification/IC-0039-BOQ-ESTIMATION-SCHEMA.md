# IC-0039: G-003 BOQ / Estimation Schema Foundation — Implementation Contract

**Contract ID:** `IC-0039-BOQ-ESTIMATION-SCHEMA`
**Status:** Draft — pending certification
**ADR:** `ADR-0039-BOQ-ESTIMATION-SCHEMA`
**Scope:** `CPO-SCOPE-G003-BOQ-ESTIMATION-SCHEMA-FOUNDATION-001`
**Baseline:** `0790da4`
**Date:** 2026-06-25

---

## Included Scope

This contract authorizes creation of **exactly one migration file** per dialect:

| Dialect | File | Tables | Indexes |
|---|---|---|---|
| SQLite | `server/db/migrations/sqlite/0039_boq_estimation.sql` | 8 | ~12 |
| Postgres | `server/db/migrations/postgres/0039_boq_estimation.sql` | 8 | ~12 |

### Table Inventory

```
boq_projects            — BOQ document headers
boq_sections            — Hierarchical BOQ classification (self-referential)
boq_items               — BOQ line items with waste factors
estimation_rates        — Unit rate library
estimation_rate_breakdowns — Rate composition (material/labour/plant/subcon)
measurement_sheets      — Take-off measurement records
price_data_sources      — Price data lake classification
price_data_entries      — Individual price records
```

### Index Inventory

```sql
-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_boq_sections_project ON boq_sections(boq_project_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_parent ON boq_sections(parent_section_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_section ON boq_items(boq_section_id);
CREATE INDEX IF NOT EXISTS idx_estimation_rates_company ON estimation_rates(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_rate_breakdowns_rate ON estimation_rate_breakdowns(estimation_rate_id);
CREATE INDEX IF NOT EXISTS idx_measurement_item ON measurement_sheets(boq_item_id);
CREATE INDEX IF NOT EXISTS idx_price_sources_company ON price_data_sources(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_price_entries_source ON price_data_entries(price_data_source_id);

-- Sort/ordering indexes
CREATE INDEX IF NOT EXISTS idx_boq_sections_sort ON boq_sections(boq_project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_boq_items_sort ON boq_items(boq_section_id, sort_order);

-- Temporal indexes
CREATE INDEX IF NOT EXISTS idx_estimation_rates_effective ON estimation_rates(unternehmen_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_price_sources_effective ON price_data_sources(unternehmen_id, effective_from);

-- Status index
CREATE INDEX IF NOT EXISTS idx_boq_projects_status ON boq_projects(unternehmen_id, status);
```

---

## Excluded Scope

The following are **explicitly not authorized** by this contract:

- Drizzle TypeScript schema definitions
- `allTables` registration
- Application routes or API endpoints
- UI components
- BOQ workflow logic
- Measurement formula evaluation engine
- Price data AI/agent behavior
- Financial approval workflows
- Migration execution (running the migration)
- TypeScript unit tests (authorized but in a separate follow-up)
- Seed data
- Changes to existing tables or migrations

---

## Expected Files

| File | Status |
|---|---|
| `server/db/migrations/sqlite/0039_boq_estimation.sql` | To be created |
| `server/db/migrations/postgres/0039_boq_estimation.sql` | To be created (mirror) |

---

## Expected Migration Structure

```sql
-- Migration 0039: G-003 BOQ / Estimation Schema Foundation
-- Domain: Construction costing — bill of quantities, estimation, rates, measurements, price data
-- Classification: Greenfield schema introduction (not consolidation)
-- ADR: ADR-0039-BOQ-ESTIMATION-SCHEMA
-- Baseline: 0790da4

-- 1. boq_projects
CREATE TABLE IF NOT EXISTS boq_projects ( ... );
CREATE INDEX IF NOT EXISTS idx_boq_projects_status ON boq_projects(unternehmen_id, status);

-- 2. boq_sections
CREATE TABLE IF NOT EXISTS boq_sections ( ... );
CREATE INDEX IF NOT EXISTS idx_boq_sections_project ON boq_sections(boq_project_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_parent ON boq_sections(parent_section_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_sort ON boq_sections(boq_project_id, sort_order);

-- 3. boq_items
CREATE TABLE IF NOT EXISTS boq_items ( ... );
CREATE INDEX IF NOT EXISTS idx_boq_items_section ON boq_items(boq_section_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_sort ON boq_items(boq_section_id, sort_order);

-- 4. estimation_rates
CREATE TABLE IF NOT EXISTS estimation_rates ( ... );
CREATE INDEX IF NOT EXISTS idx_estimation_rates_company ON estimation_rates(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_estimation_rates_effective ON estimation_rates(unternehmen_id, effective_from);

-- 5. estimation_rate_breakdowns
CREATE TABLE IF NOT EXISTS estimation_rate_breakdowns ( ... );
CREATE INDEX IF NOT EXISTS idx_rate_breakdowns_rate ON estimation_rate_breakdowns(estimation_rate_id);

-- 6. measurement_sheets
CREATE TABLE IF NOT EXISTS measurement_sheets ( ... );
CREATE INDEX IF NOT EXISTS idx_measurement_item ON measurement_sheets(boq_item_id);

-- 7. price_data_sources
CREATE TABLE IF NOT EXISTS price_data_sources ( ... );
CREATE INDEX IF NOT EXISTS idx_price_sources_company ON price_data_sources(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_price_sources_effective ON price_data_sources(unternehmen_id, effective_from);

-- 8. price_data_entries
CREATE TABLE IF NOT EXISTS price_data_entries ( ... );
CREATE INDEX IF NOT EXISTS idx_price_entries_source ON price_data_entries(price_data_source_id);
```

---

## Tests (authorized but deferred)

| Test | Method |
|---|---|
| SQL syntax validation | `sqlite3 :memory: < 0039_boq_estimation.sql` |
| Fresh DB bootstrap | Run migration against empty DB, verify 8 tables, ~12 indexes |
| Existing DB upgrade | Run from 0038 baseline with existing data, verify no conflicts |
| Foreign key integrity | `PRAGMA foreign_key_check` after migration |
| MigrationRunner ledger | Verify migration registered in `_migrations` table |
| KV mirror check | Confirm postgres migration has same table count as sqlite |
| Default value check | `waehrung` defaults to `'KES'`, `waste_factor_pct` defaults to `10.0` |

All tests are run manually or via test script — no Jest/Vitest test file is authorized by this contract.

---

## Verification Gates

Order of verification (sequenced, must pass in order):

| # | Gate | Method | Pass Condition |
|---|---|---|---|
| 1 | SQL syntax — sqlite | `sqlite3 :memory: < migration.sql` | Exit code 0 |
| 2 | SQL syntax — postgres | `psql < migration.sql` or manual review | No syntax errors |
| 3 | Fresh DB bootstrap | Apply to empty SQLite DB | 8 tables created, all indexes exist |
| 4 | Existing DB upgrade | Apply after 0038 migrations | No conflicts, `_migrations` records 0039 |
| 5 | MigrationRunner ledger | Check `SELECT * FROM _migrations WHERE name = '0039_boq_estimation.sql'` | Row exists |
| 6 | Governance | Review against ADR-0039 and scope packet | No deviations |
| 7 | KV mirror | Compare sqlite and postgres table counts | Equal (8 tables) |
| 8 | Capability audit | Verify all tables serve G-003 domain | No scope creep |
| 9 | Golden corpus | `INSERT INTO boq_projects (...) VALUES (...)` + `SELECT` roundtrip | Correct types, no truncation |

---

## Rollback Plan

### Pre-production / zero-data rollback

Applicable only in development, test, or freshly-bootstrapped databases with zero G-003 data:

```sql
-- Reverse order (FK dependencies first)
DROP TABLE IF EXISTS measurement_sheets;
DROP TABLE IF EXISTS price_data_entries;
DROP TABLE IF EXISTS price_data_sources;
DROP TABLE IF EXISTS estimation_rate_breakdowns;
DROP TABLE IF EXISTS boq_items;
DROP TABLE IF EXISTS boq_sections;
DROP TABLE IF EXISTS estimation_rates;
DROP TABLE IF EXISTS boq_projects;

-- Remove migration ledger entry
DELETE FROM _migrations WHERE name = '0039_boq_estimation.sql';
```

Re-application is safe because all `CREATE` statements use `IF NOT EXISTS`.

### Production rollback

**No destructive rollback is authorized for production databases that contain G-003 data.**

If G-003 tables must be removed from a production database after data has been written, the only approved path is:

1. Forward corrective migration (e.g., `0040_deprecate_boq_estimation.sql`) — adds no new tables, may remove or alter existing ones with explicit data migration steps.
2. Feature disablement at the application layer — G-003 queries are gated behind a feature flag; disabling the flag stops all G-003 read/write paths without touching the database.
3. A separate CPO-approved data-retention and rollback plan if physical table removal is required.

No `DROP TABLE` statements are authorized against production databases under this contract.

---

## Dependencies

- `unternehmen` table — exists since migration 0001 ✅
- `projekte` table — exists since migration 0020 ✅
- `experten` table — exists since migration 0001 (for `erstellt_von` FK) ✅
- Migration sequence: 0038 → 0039 ✅ (readdir sort order)

---

## Risks

| Risk | Mitigation |
|---|---|
| Naming convention drift | ADR-0039 locks the convention decision |
| FK to projekte if project deleted | Tables use standard FK without `ON DELETE CASCADE` — application handles cleanup |
| Performance with large measurement datasets | Indexes on all FK columns; `sort_order` indexes on section/item trees |
| Postgres dialect incompatibilities | Mirror migration verified separately; `TEXT` and `INTEGER` types are compatible |

---

## Certification Requirements

Before migration file creation:

- [ ] ADR-0039 approved by Program Office
- [ ] IC-0039 approved by Program Office
- [ ] Scope packet filed in canonical governance location

After certification, before implementation:

- [ ] Migration file created against certified ADR/IC
- [ ] All 9 verification gates pass
- [ ] No deviations from ADR/IC without re-certification

---

## References

- `ADR-0039-BOQ-ESTIMATION-SCHEMA` — Architecture Decision Record
- `CPO-SCOPE-G003-BOQ-ESTIMATION-SCHEMA-FOUNDATION-001` — Scope packet
- `server/db/client.ts` — MigrationRunner (lines 60-98 for discovery, lines 81-117 for SQLite runner)
- `server/db/schema.ts` — Existing Drizzle schema (FK verification references)

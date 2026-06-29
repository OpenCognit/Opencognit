# CPO-SCOPE-G003-BOQ-ESTIMATION-SCHEMA-FOUNDATION-001

**Decision ID:** `CPO-SCOPE-G003-BOQ-ESTIMATION-SCHEMA-FOUNDATION-001`
**Date:** 2026-06-25
**Current certified baseline:** `0790da4`
**Proposed migration:** `0039_boq_estimation.sql` (greenfield, reclassified from Phase 3C)
**Program classification:**
- migration consolidation: **No** — no existing schema to consolidate
- greenfield schema: **Yes** — new domain capability introduction
- capability/domain: **G-003** — BOQ / Estimation

---

## Business Need

CM360 currently has zero bill of quantities, estimation, rate library, or measurement data layer. Construction costing workflows (BOQ generation, rate analysis, take-off measurements, price data sourcing) cannot be persisted, queried, or audited. This blocks all downstream costing features including the costing agent tooling defined in AGENTS.md.

## Executive Impact

- **Before:** Costing agents and BOQ tools have no persistence layer. Every costing session starts from scratch with no historical rate data.
- **After:** BOQ projects, items, estimation rates, rate breakdowns, measurement sheets, and price data sources are all queryable and auditable entities scoped to companies. Agents can reference historical rates and generate structured BOQs.

## Architectural Impact

- **New migration:** `0039_boq_estimation.sql` (sqlite + postgres mirrors)
- **New Drizzle definitions:** 8 new table exports in `server/db/schema.ts`
- **No changes to existing tables:** Zero schema migration risk
- **Foreign keys:** References `unternehmen(id)` and `projekte(id)` only — no circular dependencies

## Engineering Impact

- 1 new migration file per dialect (sqlite + postgres)
- 8 new Drizzle table definitions + `allTables` registration
- Migration sequence: `0039` follows existing `0038_agent_messages`
- No application code changes required for initial migration — tables can be populated via seed or API later

---

## Domain Model

### 1. `boq_projects`
BOQ document header. One project can have multiple BOQ revisions.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| unternehmen_id | TEXT | NOT NULL, FK → unternehmen(id) |
| projekt_id | TEXT | FK → projekte(id) |
| name | TEXT | NOT NULL |
| revision | TEXT | NOT NULL DEFAULT 'A' |
| status | TEXT | NOT NULL DEFAULT 'draft' (draft/issued/approved/revised) |
| beschreibung | TEXT | |
| gesamt_betrag_cent | INTEGER | NOT NULL DEFAULT 0 |
| waehrung | TEXT | NOT NULL DEFAULT 'KES' |
| erstellt_von | TEXT | user/expert ID (non-binding) |
| genehmigt_von | TEXT | (non-binding, application-layer RBAC) |
| genehmigt_am | TEXT | |
| erstellt_am | TEXT | NOT NULL |
| aktualisiert_am | TEXT | NOT NULL |

### 2. `boq_sections`
Hierarchical BOQ classification (e.g., Sub-structure → Excavation → Trenches).

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| boq_project_id | TEXT | NOT NULL, FK → boq_projects(id) |
| parent_section_id | TEXT | FK → boq_sections(id) (self-referential) |
| code | TEXT | NOT NULL (e.g., "01", "01.01") |
| titel | TEXT | NOT NULL |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| erstellt_am | TEXT | NOT NULL |
| aktualisiert_am | TEXT | NOT NULL |

### 3. `boq_items`
Line items within a BOQ section.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| boq_section_id | TEXT | NOT NULL, FK → boq_sections(id) |
| item_code | TEXT | |
| beschreibung | TEXT | NOT NULL |
| einheit | TEXT | NOT NULL (m, m², m³, kg, t, No., ls, etc.) |
| menge | REAL | NOT NULL DEFAULT 0 |
| rate_cent | INTEGER | NOT NULL DEFAULT 0 |
| betrag_cent | INTEGER | NOT NULL DEFAULT 0 |
| waste_factor_pct | REAL | NOT NULL DEFAULT 10.0 |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| estimation_rate_id | TEXT | FK → estimation_rates(id) (optional rate link) |
| erstellt_am | TEXT | NOT NULL |
| aktualisiert_am | TEXT | NOT NULL |

### 4. `estimation_rates`
Unit rate library — reusable across BOQ items.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| unternehmen_id | TEXT | NOT NULL, FK → unternehmen(id) |
| beschreibung | TEXT | NOT NULL |
| einheit | TEXT | NOT NULL |
| material_cost_cent | INTEGER | NOT NULL DEFAULT 0 |
| labour_cost_cent | INTEGER | NOT NULL DEFAULT 0 |
| plant_cost_cent | INTEGER | NOT NULL DEFAULT 0 |
| subcon_cost_cent | INTEGER | NOT NULL DEFAULT 0 |
| overhead_pct | REAL | NOT NULL DEFAULT 15.0 |
| profit_pct | REAL | NOT NULL DEFAULT 10.0 |
| gesamt_rate_cent | INTEGER | NOT NULL DEFAULT 0 |
| waehrung | TEXT | NOT NULL DEFAULT 'KES' |
| quelle | TEXT | DEFAULT 'manual' (manual/supplier_quote/historical/market_survey) |
| effective_from | TEXT | NOT NULL |
| effective_to | TEXT | (NULL = still current) |
| erstellt_am | TEXT | NOT NULL |
| aktualisiert_am | TEXT | NOT NULL |

### 5. `estimation_rate_breakdowns`
Detailed resource composition for a unit rate.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| estimation_rate_id | TEXT | NOT NULL, FK → estimation_rates(id) |
| cost_type | TEXT | NOT NULL (material/labour/plant/subcon) |
| resource | TEXT | NOT NULL (e.g., "Cement 42.5R", "Skilled Labour") |
| resource_unit | TEXT | NOT NULL |
| unit_cost_cent | INTEGER | NOT NULL DEFAULT 0 |
| quantity_per_unit | REAL | NOT NULL DEFAULT 1.0 |
| total_cent | INTEGER | NOT NULL DEFAULT 0 |
| waste_pct | REAL | NOT NULL DEFAULT 5.0 |
| sort_order | INTEGER | NOT NULL DEFAULT 0 |
| erstellt_am | TEXT | NOT NULL |

### 6. `measurement_sheets`
Take-off measurement records linked to BOQ items.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| boq_item_id | TEXT | NOT NULL, FK → boq_items(id) |
| location_ref | TEXT | (e.g., "Grid A1-B2", "Floor 1 West Wing") |
| dimension_l | REAL | |
| dimension_w | REAL | |
| dimension_h | REAL | |
| quantity | REAL | NOT NULL DEFAULT 0 |
| formula | TEXT | (plain text, e.g., "L × W × H") |
| einheit | TEXT | NOT NULL |
| erfasst_von | TEXT | |
| erfasst_am | TEXT | NOT NULL |

### 7. `price_data_sources`
Price data lake classification — sources of unit price information.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| unternehmen_id | TEXT | NOT NULL, FK → unternehmen(id) |
| source_name | TEXT | NOT NULL |
| source_type | TEXT | NOT NULL (supplier_quote/market_survey/historical_tender/published_index) |
| region | TEXT | |
| waehrung | TEXT | NOT NULL DEFAULT 'KES' |
| effective_from | TEXT | NOT NULL |
| effective_to | TEXT | |
| beschreibung | TEXT | |
| erstellt_am | TEXT | NOT NULL |
| aktualisiert_am | TEXT | NOT NULL |

### 8. `price_data_entries`
Individual price records within a source.

| Column | Type | Constraint |
|---|---|---|
| id | TEXT | PK |
| price_data_source_id | TEXT | NOT NULL, FK → price_data_sources(id) |
| item_description | TEXT | NOT NULL |
| einheit | TEXT | NOT NULL |
| unit_price_cent | INTEGER | NOT NULL |
| supplier | TEXT | |
| date_observed | TEXT | NOT NULL |
| erstellt_am | TEXT | NOT NULL |

---

## Naming Convention — Resolved

**Decision:** Follow the existing English-domain precedent set by `customers`, `orders`, `order_items`, `invoices` (migration `0027_business_automation.sql`).

| Concern | Resolution | Evidence |
|---|---|---|
| Table names | English (boq_projects, estimation_rates, etc.) | Matches `customers`, `orders`, `invoices` |
| Company FK column | `unternehmen_id` (German, matching actual table name) | All 38 migrations use `unternehmen_id` |
| Project FK column | `projekt_id` (matches table `projekte`, not `projects`) | Table is named `projekte` in SQL |
| Timestamp columns | `erstellt_am`, `aktualisiert_am` (German) | Universal across all existing tables |
| Monetary columns | `*_cent` suffix (integer) | Matches `kosten_cent`, `gesamt_cent`, `betrag_cent` |
| Currency column | `waehrung TEXT NOT NULL DEFAULT 'KES'` | Matches `orders.waehrung`, `invoices.waehrung` |
| Description columns | `beschreibung` (German) | Matches `unternehmen.beschreibung`, `aufgaben.beschreibung` |
| Unit column | `einheit` (German) | Matches domain naming precedent |

---

## Tenant/Company Model — Resolved

**Verified:** `companies` table is `unternehmen` in SQL, with `id TEXT PRIMARY KEY`. All existing tables reference it via `unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id)`.

**Decision:** Use `unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id)` for all tenant-scoped BOQ tables.

Evidence from `server/db/schema.ts` line 114:
```typescript
export const companies = sqliteTable('unternehmen', {
  id: text('id').primaryKey(),
  ...
```

Evidence from 20+ existing FKs across the schema using this exact pattern.

---

## Project Reference Model — Resolved

**Verified:** `projects` table is `projekte` in SQL, with `id TEXT PRIMARY KEY`, `unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id)`.

**Decision:** Use `projekt_id TEXT REFERENCES projekte(id)` for project-scoped BOQ references.

Evidence from `server/db/schema.ts` line 484:
```typescript
export const projects = sqliteTable('projekte', {
  id: text('id').primaryKey(),
  companyId: text('unternehmen_id').notNull().references(() => companies.id),
  ...
```

---

## Currency/Money Model — Resolved

**Decision:** Follow the `0027_business_automation` pattern:
- All monetary amounts in integer cents (`*_cent`)
- Per-row currency field: `waehrung TEXT NOT NULL DEFAULT 'KES'`
- Sums are application-layer — not SQL computed columns

Evidence from `orders` and `invoices` tables which use `*_cent` + `waehrung` per row.

**KSH default:** Appropriate for Kenyan construction context (see USER.md: Africa/Nairobi timezone, Kenyan market rates in AGENTS.md).

---

## Approval/RBAC Model — Resolved

**Decision:** `genehmigt_von` and `genehmigt_am` are non-binding text fields in the SQL schema. Approval workflow is an application-layer concern. The schema records who approved and when, but does not enforce RBAC constraints at the database level — consistent with how `aufgaben.zugewiesen_an` and `genehmigungen.angefordert_von` work.

---

## Measurement Formula Model — Resolved

**Decision:** `measurement_sheets.formula` is `TEXT` — a plain text human-readable expression (e.g., "L × W × H", "π × r² × depth"). Deterministic evaluation is deferred to an application-layer measurement engine. The schema stores the formula for auditability; computed `quantity` is stored separately.

---

## Price Data Boundary — Resolved

**Decision:** `price_data_sources` and `price_data_entries` belong in G-003 (BOQ/Estimation) because they directly feed `estimation_rates`. A source can be linked to multiple rate items. If pricing data grows into an independent capability (commodity indices, supplier management, procurement integration), it can be extracted to a separate domain without breaking G-003 — the `estimation_rates` table has its own `quelle` field for loose coupling.

---

## Included Scope

- `boq_projects` — BOQ document headers
- `boq_sections` — Hierarchical BOQ classification
- `boq_items` — BOQ line items with waste factors
- `estimation_rates` — Reusable unit rate library
- `estimation_rate_breakdowns` — Rate composition (material/labour/plant/subcon)
- `measurement_sheets` — Take-off measurements
- `price_data_sources` — Price data lake classification
- `price_data_entries` — Individual price records
- All required indexes on FK columns and lookup patterns
- `CREATE TABLE IF NOT EXISTS` — safe for existing DB upgrade

---

## Excluded Scope

- Tender tables — separate domain (021_tender_intelligence)
- Financial invoice/payment tables — separate domain (business automation)
- AI/agent tables — core platform domain
- Render artifact tables — PR2B-4 still held
- GRN/PO/storekeeper tables — separate agentic workflow domain
- Application-layer business logic (approval workflow, measurement engine, rate calculation)
- Drizzle TypeScript definitions (follow-up task after migration approval)
- `allTables` registration (follow-up with Drizzle work)

---

## Expected ADR

`server/db/migrations/sqlite/0039_boq_estimation.sql` — one file containing all 8 `CREATE TABLE IF NOT EXISTS` statements with indexes.

**Line count estimate:** ~120 lines (similar density to `0027_business_automation.sql` at 106 lines for 5 tables).

---

## Expected IC

- Postgres mirror: `server/db/migrations/postgres/0039_boq_estimation.sql`
- Drizzle definitions: 8 exports added to `server/db/schema.ts`
- `allTables` map updated with 8 new entries

---

## Expected Tests

- `server/__tests__/migrations/0039_boq_estimation.test.ts`
  - Fresh DB bootstrap: run migration, verify all 8 tables exist
  - Existing DB upgrade: run from migration 0038, verify no conflicts
  - FK integrity: verify `unternehmen_id` and `projekt_id` constraints
  - Default values: verify `waehrung DEFAULT 'KES'`, `waste_factor_pct DEFAULT 10.0`

---

## Verification Plan

| Check | Method | Assertion |
|---|---|---|
| SQL syntax | `sqlite3 :memory: < 0039_boq_estimation.sql` | No parse errors |
| Fresh DB bootstrap | Run migration against empty DB | 8 tables created |
| Existing DB upgrade | Run from 0038 baseline | No conflicts with existing tables |
| MigrationRunner ledger | Check `schema_version` or migration tracking | 0039 registered |
| TypeScript | Compile after Drizzle addition | No type errors |
| Governance | Review against certified baseline `0790da4` | No breaking changes |
| KV mirror | Verify postgres migration matches sqlite | Same table set |
| Capability audit | Confirm all 8 tables serve G-003 domain | No scope creep |
| Golden corpus | Sample data insert + query roundtrip | Correct types |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Naming convention disagreement | Low | Convention resolved with evidence from `0027` precedent |
| Rate calculation logic in SQL | None | All calculation is application-layer; schema stores raw data only |
| FK to `projekte(id)` if project deleted | Low | `ON DELETE CASCADE` or `SET NULL` as appropriate — specify during implementation |
| Waste factor defaults differ by trade | Low | Schema default is 10% (matching AGENTS.md convention); per-item override via `boq_items.waste_factor_pct` |

---

## Dependencies

- `unternehmen` table (migration 0001) — exists
- `projekte` table (migration 0020) — exists
- No other migration dependencies

---

## Rollback Plan

If 0039 is problematic:
1. `DROP TABLE IF EXISTS` for all 8 tables (reverse order — FKs first)
2. Migration remains safe to re-apply (`IF NOT EXISTS`)
3. No data migration risk — greenfield tables with zero existing data

---

## Recommendation

**Approve** `0039_boq_estimation.sql` as a greenfield G-003 domain migration. All naming, FK, currency, and boundary concerns are resolved with evidence from the certified baseline. The migration is self-contained, has zero impact on existing tables, and unblocks CM360 costing agent workflows.

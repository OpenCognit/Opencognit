# ADR-0039: G-003 BOQ / Estimation Schema Foundation

**Decision ID:** `ADR-0039-BOQ-ESTIMATION-SCHEMA`
**Status:** Draft — pending certification
**Date:** 2026-06-25
**Baseline:** `0790da4`
**Scope file:** `CPO-SCOPE-G003-BOQ-ESTIMATION-SCHEMA-FOUNDATION-001`
**Canonical migration path:** `server/db/migrations/sqlite/0039_boq_estimation.sql`
**MigrationRunner discovery path:** `server/db/migrations/<dialect>/` — discovered by `readdirSync().sort()`
**Proposed migration:** `0039_boq_estimation.sql`
**Expected table count:** 8
**Expected index count:** ~12

---

## Context

CM360 currently has zero bill of quantities, estimation, rate library, or measurement data layer. The platform needs structured persistence for construction costing workflows before any BOQ tooling or costing agents can operate.

This is a greenfield schema introduction — not migration consolidation. No existing tables are being merged, extracted, or refactored.

## Decision

Introduce 8 new tables in migration `0039_boq_estimation.sql` to establish the G-003 BOQ/Estimation domain foundation.

### Schema Authority

**Decision:** G-003 is a greenfield domain. Authority is delegated by the Program Office under `CPO-CERT-G003-BOQ-ESTIMATION-SCHEMA-SCOPE-001`. The migration is a new capability introduction, not a consolidation of existing migrations.

### Naming Convention

**Decision:** Follow the English-domain precedent set by migration `0027_business_automation.sql` (`customers`, `orders`, `order_items`, `invoices`, `accounting_entries`).

| Concern | Convention | Evidence |
|---|---|---|
| Table names | English (`boq_projects`, `estimation_rates`) | Matches `customers`, `orders` pattern |
| FK columns referencing German tables | German SQL name (`unternehmen_id`, `projekt_id`) | Universal across 38 migrations |
| Timestamps | German (`erstellt_am`, `aktualisiert_am`) | Universal across all tables |
| Money columns | English + German hybrid (`*_cent`, `waehrung`) | Matches `orders.waehrung`, `gesamt_cent` |
| Domain columns | Mixed — English for BOQ terms (`item_code`, `rate_cent`), German for generic columns (`beschreibung`, `einheit`) | Matches how `orders` uses both `product_sku` (English) and `waehrung` (German) |

**Rationale:** Consistency with the existing migration ecosystem matters more than purity. The precedent exists and is stable. Introducing a pure-English or pure-German convention now would create a third naming standard.

### Tenant/Company FK Model

**Decision:** All tenant-scoped BOQ tables use `unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id)`.

**Verified:** `unternehmen` table exists, has `id TEXT PRIMARY KEY`, and is referenced by 20+ existing foreign keys with this exact pattern.

### Project FK Model

**Decision:** Project-scoped BOQ tables use `projekt_id TEXT REFERENCES projekte(id)`.

**Verified:** `projekte` table exists (migration 0020), has `id TEXT PRIMARY KEY`, and is already referenced by `aufgaben.projekt_id`.

### Money/Currency Model

**Decision:** 
- All monetary amounts stored as integer cents (`*_cent`)
- Currency stored per-row: `waehrung TEXT NOT NULL DEFAULT 'KES'`
- Sums computed in application layer, not SQL

**Verified:** `orders` and `invoices` tables use `*_cent` + `waehrung` per row. `KES` default is appropriate for Kenyan construction context.

### Approval Authority

**Decision:** `genehmigt_von` and `genehmigt_am` are non-binding text fields. Approval workflow enforcement lives in the application/RBAC layer.

**Verified:** Existing schema follows the same pattern — `aufgaben.zugewiesen_an`, `genehmigungen.angefordert_von` are text fields without RBAC constraints at the SQL level.

### Price Data Boundary

**Decision:** `price_data_sources` and `price_data_entries` belong within G-003 because they directly feed `estimation_rates`. Loose coupling via `estimation_rates.quelle` field allows future extraction to an independent pricing-data capability without breaking G-003.

### Measurement Formula Boundary

**Decision:** `measurement_sheets.formula` is `TEXT` — human-readable plain text. Deterministic evaluation is deferred to an application-layer measurement engine. The schema stores `quantity` (computed result) separately from `formula` (expression) for auditability.

### Rollback/Deprecation

**Decision:** Standard `DROP TABLE IF EXISTS` in reverse FK order. All 8 tables are net-new with zero existing data — no data migration risk. `IF NOT EXISTS` on creation ensures safe re-application.

---

## Consequences

### Positive
- BOQ/estimation/rate/measurement/price data can be persisted, queried, and audited
- Costing agents gain structured data access for historical rate lookups
- Schema is self-contained — zero impact on existing tables
- Follows established naming/FK conventions — no new patterns introduced

### Negative
- 8 tables is a non-trivial schema surface for a first pass
- `measurement_sheets.formula` is unstructured text — will need a migration if/when a formula engine is introduced
- `price_data_sources/entries` may need re-scoping if pricing data grows into an independent capability

### Neutral
- No Drizzle definitions in this ADR — TypeScript schema work is a follow-up task
- No routes, UI, or workflow logic are authorized by this ADR

---

## Alternatives Considered

### A. Pure English naming
Rejected — inconsistent with existing `unternehmen_id`, `erstellt_am` columns used across all 38 migrations.

### B. Pure German naming (e.g., `lv_projekte`, `lv_positionen`)
Rejected — BOQ/estimation is a construction domain that crosses language boundaries. English table names match the business automation precedent and are more accessible.

### C. Separate price-data domain (G-004)
Rejected for now — price data is too tightly coupled to estimation to justify a separate migration. Can be extracted later if pricing data becomes an independent capability.

### D. Store rates as JSON in a single table
Rejected — normalized tables enable querying, indexing, and aggregation that a JSON blob cannot support.

---

## Certification Gates

- [ ] Scope packet accepted by Program Office
- [ ] ADR reviewed and approved
- [ ] Implementation Contract reviewed and approved
- [ ] No implementation until certification complete

---

## References

- `CPO-SCOPE-G003-BOQ-ESTIMATION-SCHEMA-FOUNDATION-001` — Scope packet
- Migration `0027_business_automation.sql` — English-domain naming precedent
- `server/db/client.ts` — MigrationRunner discovery mechanism
- `server/db/schema.ts` — Existing Drizzle schema (for FK verification)

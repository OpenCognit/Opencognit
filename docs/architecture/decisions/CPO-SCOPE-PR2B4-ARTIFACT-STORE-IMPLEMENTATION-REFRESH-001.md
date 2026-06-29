# CPO-SCOPE-PR2B4-ARTIFACT-STORE-IMPLEMENTATION-REFRESH-001

**Decision ID:** `CPO-SCOPE-PR2B4-ARTIFACT-STORE-IMPLEMENTATION-REFRESH-001`
**Date:** 2026-06-26
**Baseline:** `27d5d27` (origin/main)
**Current upstream state:** Clean
**Pending dependency:** G-003 PR [#33](https://github.com/OpenCognit/Opencognit/pull/33) — certified, pending merge

---

## Existing PR2B-4 Governance

PR2B-4 was previously scoped as part of the Renderer/Document Intelligence program. Items PR2B-1 through PR2B-3 (Renderer Abstraction, Hardening, Manifest) are closed. PR2B-4 (Artifact Store Implementation) was held with this ruling:

> "PR2B-4 implementation should remain held until migration authority is more stable, especially because artifact storage will likely need tenant-scoped persistence and stronger schema guarantees."

**Governance artifacts from the earlier PR2B program are not in this repository.** The PR2B decisions predate the current repo structure and need to be reconstructed from the certified implementation baseline.

## Existing Skeletal Implementation

### `work_products` table (exists, in active use)

```sql
CREATE TABLE work_products (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id) ON DELETE CASCADE,
  aufgabe_id TEXT NOT NULL REFERENCES aufgaben(id) ON DELETE CASCADE,
  expert_id TEXT NOT NULL REFERENCES experten(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES arbeitszyklen(id),
  typ TEXT NOT NULL DEFAULT 'file',
  name TEXT NOT NULL,
  pfad TEXT,
  inhalt TEXT,
  groesse_bytes INTEGER,
  mime_typ TEXT,
  erstellt_am TEXT NOT NULL
);
```

### Current usage

| Usage | Location | Detail |
|---|---|---|
| RBAC | `server/middleware/auth.ts:199` | `workProduct` entity type with company-scoped auth |
| Task listing | `server/routes/tasks.ts:368-370` | GET work products filtered by task ID |
| Company listing | `server/index.ts:392-397` | GET all work products for a company, optional type filter |
| Company deletion | `server/routes/companies.ts:212,295` | Cascade delete work products with company |
| Agent deletion | `server/routes/agents.ts:371,383` | Nullify run_id, then delete agent's products |
| System reset | `server/routes/system.ts:281` | Delete all work products |
| Heartbeat deps | `server/services/heartbeat/dependencies.ts:30` | Insert work product entries for task context |

### What `work_products` does NOT provide

| Missing capability | Detail |
|---|---|
| Content-addressable storage | No checksum/hash — `pfad` is a plain text field with no integrity guarantee |
| File-system backing | `inhalt` stores content inline as TEXT — no disk/object store separation |
| Tenant-isolated paths | `pfad` is arbitrary text — no enforced directory scoping |
| Manifest relationship | No table linking artifacts to render manifests |
| Retention policy | No TTL, no archival, no cleanup logic |
| Orphan handling | Cascade delete from task/agent, but no standalone orphan detection |
| Replayability | No source reference to re-derive an artifact |
| Audit trail | No modification history — `aktualisiert_am` column is absent |
| Versioning | No revision tracking — a single row per artifact with no history |

---

## Why Artifact Store Is Needed

The agentic AI system (GRN Agent, RFI Agent, Site Instruction Agent, and future agents) produce documents, reports, spreadsheets, PDFs, and structured data. These artifacts:

1. **Must survive agent restarts** — inline `inhalt` TEXT is not suitable for >1MB files
2. **Must be auditable** — financial/construction documents need integrity verification
3. **Must be tenant-isolated** — Company A must never access Company B's artifacts via path traversal
4. **Must be replayable** — if a render manifest changes, artifacts must be re-derivable
5. **Must be cleanable** — deletion policies prevent disk exhaustion in long-running deployments

## What Changed Since the Hold

| Change | Impact on PR2B-4 |
|---|---|
| G-003 migration certified | Migration authority is now exercised and proven — the 0039 process established a repeatable pattern for greenfield schema introduction |
| ADR/IC governance pattern established | The scope→ADR→IC→implementation→verification→certification pipeline has been exercised end-to-end |
| Fork/PR workflow resolved | External contributor push path is now functional |
| MigrationRunner confirmed stable | `_migrations` ledger, `readdirSync().sort()`, `IF NOT EXISTS` idempotency all verified |

---

## Proposed Implementation Boundary

### Storage Model

**Decision:** Two-tier storage — metadata in database, content on filesystem.

```
Database:  artifact_metadata table (SQLite/PG)
Disk:      data/artifacts/<unternehmen_id>/<artifact_id>/<filename>
```

| Tier | Location | Stores |
|---|---|---|
| Metadata | Database | id, name, mime_type, size, checksum, manifest_ref, retention, timestamps |
| Content | `data/artifacts/` | Raw file bytes, organized by tenant → artifact |

**Rationale:** Inline TEXT storage (`inhalt`) was the MVP. Production-grade artifact storage requires content-addressable file-system backing for files of any size, with metadata in the database for querying.

### Metadata Model

Proposed new table: `artifact_store`

| Column | Type | Purpose |
|---|---|---|
| id | TEXT PK | UUID |
| unternehmen_id | TEXT NOT NULL FK | Tenant isolation |
| projekt_id | TEXT FK | Optional project scope |
| aufgabe_id | TEXT FK | Source task |
| expert_id | TEXT FK | Creator agent |
| run_id | TEXT FK | Work cycle that produced it |
| name | TEXT NOT NULL | Filename |
| mime_type | TEXT NOT NULL | Content type |
| size_bytes | INTEGER NOT NULL | File size |
| checksum_sha256 | TEXT NOT NULL | Content integrity |
| storage_path | TEXT NOT NULL | Relative path on disk |
| manifest_ref | TEXT | Link to render manifest (JSON schema ref) |
| manifest_version | TEXT | Manifest version at creation time |
| retention_policy | TEXT DEFAULT 'permanent' | permanent / ttl / task_lifetime |
| retention_ttl_days | INTEGER | TTL in days (if policy = ttl) |
| expires_at | TEXT | Computed expiry timestamp |
| status | TEXT DEFAULT 'active' | active / archived / expired / deleted |
| erstellt_am | TEXT NOT NULL | |
| aktualisiert_am | TEXT NOT NULL | |

### Tenant/Company/Project Ownership

- **Tenant:** `unternehmen_id → unternehmen(id)` — non-negotiable, matches all existing tables
- **Project:** `projekt_id → projekte(id)` — optional, allows project-scoped artifact browsing
- **Path isolation:** `data/artifacts/<unternehmen_id>/<artifact_id>/` — directory traversal prevented at the storage layer by UUID-based subdirectories (not user-supplied names)

### Artifact Identity

- **Primary key:** UUID (same pattern as all existing tables)
- **Content identity:** SHA-256 checksum stored in `checksum_sha256`
- **Path identity:** `storage_path` is deterministic: `{unternehmen_id}/{artifact_id}/{name}`

### Checksum

- SHA-256 computed at write time
- Stored in `checksum_sha256`
- Verified on read (optional, configurable)
- Enables deduplication detection (future capability)

### Manifest Relationship

- `manifest_ref` — opaque string referencing the PR2B-3 render manifest
- `manifest_version` — version at creation time, enabling replayability check
- If manifest version changes, artifact can be flagged for re-render (application-layer logic)

### Replayability

- Artifact stores: `aufgabe_id` (source task), `run_id` (work cycle), `manifest_ref` + `manifest_version` (render instructions)
- Application layer can compare current manifest version against stored `manifest_version` to determine staleness
- Re-render creates a new artifact row (does not overwrite — append-only model)

### Retention

| Policy | Behavior |
|---|---|
| `permanent` | Never auto-deleted (default) |
| `ttl` | Deleted after `retention_ttl_days` from `erstellt_am` |
| `task_lifetime` | Deleted when source task is deleted (cascade) |

A cleanup cron job (future, not in this scope) scans for `status='expired'` rows and removes files + rows.

### Deletion

1. Application marks `status = 'deleted'`
2. File remains on disk for grace period (configurable, default 30 days)
3. Cleanup job removes files and DB rows after grace period
4. Immediate purge available via admin API (not in initial scope)

### Orphan Handling

- Detectable via: `storage_path` exists on disk but no matching `artifact_store` row (or vice versa)
- Cleanup job reconciles orphans (future, not in this scope)
- Initial implementation guarantees consistency: write atomicity (file + DB row in transaction with rollback)

### Audit Trail

- `erstellt_am` / `aktualisiert_am` timestamps
- `expert_id` records creator
- `run_id` records execution context
- `checksum_sha256` provides integrity verification
- Status transitions logged at application layer (not a separate audit table in this scope)

### Security Controls

| Control | Implementation |
|---|---|
| Tenant isolation | `unternehmen_id` FK + path prefix `data/artifacts/<id>/` |
| Path traversal prevention | UUID-based subdirectories, no user input in paths |
| Auth/RBAC | Existing `workProduct` auth middleware pattern extended to `artifact` entity |
| Content integrity | SHA-256 checksum verify-on-read (optional) |
| Size limits | Application-layer cap (e.g., 100MB per artifact), enforced at upload |

---

## Included Scope

- New `artifact_store` table (migration `0040_artifact_store.sql`)
- New `artifact_checksums` table for dedup detection (optional, can be deferred)
- Drizzle TypeScript definitions (2 tables)
- File-system storage layer: write/read/delete to `data/artifacts/`
- API routes: GET artifact metadata, GET artifact content (download), POST create artifact, DELETE artifact (soft delete)
- Auth/RBAC on artifact routes (company-scoped, same pattern as `workProduct`)
- Checksum computation (SHA-256) at write time
- Tenant-isolated directory structure

---

## Excluded Scope

| Item | Reason |
|---|---|
| Migration of existing `work_products` rows to `artifact_store` | Separate data migration — `work_products` remains for backward compat |
| Removal of `work_products` table | Breaking change — requires deprecation window |
| Object store support (S3, GCS) | Abstracted for later — local filesystem first |
| Deduplication via checksum | Deferred — store checksums now, dedup later |
| Cleanup cron job | Deferred — retention policy stored, enforcement later |
| Orphan reconciliation | Deferred — guarantees at write time, cleanup job later |
| UI components | Separate UI implementation |
| Render manifest integration | PR2B-3 manifest reference stored; actual re-render logic is separate |
| Content indexing / full-text search | Future capability |
| Artifact versioning / diffing | Future capability |

---

## Database Impact

| Item | Detail |
|---|---|
| New migrations | `0040_artifact_store.sql` (sqlite + postgres) |
| New tables | `artifact_store` (primary) |
| New Drizzle exports | `artifactStore` |
| Altered tables | None |
| FK references | `unternehmen(id)`, `projekte(id)`, `aufgaben(id)`, `experten(id)`, `arbeitszyklen(id)` |
| Migration parity | SQLite + Postgres mirrors required |
| Rollback | `DROP TABLE IF EXISTS artifact_store` (pre-production only) |

## Storage Impact

| Item | Detail |
|---|---|
| Base path | `data/artifacts/` (relative to server cwd) |
| Structure | `{unternehmen_id}/{artifact_id}/{filename}` |
| Isolation | Per-tenant subdirectory, UUID-based artifact directories |
| Traversal prevention | No user-supplied path components — all directory names are UUIDs |
| Disk cleanup | Soft delete + grace period (file removal deferred to cleanup job) |

## API Impact

| Route | Method | Purpose |
|---|---|---|
| `/api/companies/:id/artifacts` | GET | List artifacts for company (optional `?projekt_id=`, `?aufgabe_id=`, `?status=`) |
| `/api/artifacts/:id` | GET | Get artifact metadata |
| `/api/artifacts/:id/content` | GET | Download artifact content (stream file) |
| `/api/artifacts` | POST | Create artifact (multipart upload) |
| `/api/artifacts/:id` | DELETE | Soft-delete artifact |

All routes are company-scoped via existing auth middleware pattern.

---

## Verification Plan

| Gate | Method | Assertion |
|---|---|---|
| SQL syntax | `sqlite3 :memory: < 0040_artifact_store.sql` | No parse errors |
| Fresh bootstrap | Apply to empty DB | `artifact_store` table created |
| Existing upgrade | Apply after 0039 migrations | No conflicts |
| Migration parity | Compare sqlite vs postgres | Same table structure |
| Tenant isolation | Attempt cross-tenant path access | Rejected by storage layer |
| Checksum integrity | Write artifact, read back, verify SHA-256 | Matches |
| Replayability check | Store manifest version, simulate version bump | Staleness detectable |
| Route containment | Verify artifact routes use auth middleware | Company-scoped access control |
| TypeScript | `npx tsc --noEmit` after Drizzle addition | No type errors |
| Golden corpus | Create→read→verify checksum→soft delete→verify status | Roundtrip correct |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| File-system permission issues in deployment | Medium | Document required `data/artifacts/` permissions; create directory on first write |
| Large files consume disk | Medium | Application-layer size limit (100MB); retention policies; future cleanup cron |
| Checksum computation overhead for large files | Low | SHA-256 is fast; streaming hash computation |
| `work_products` table continues diverging | Medium | Explicitly scope this as additive — `work_products` deprecation is a separate initiative |
| Manifest integration premature | Low | `manifest_ref` and `manifest_version` are optional nullable columns — no coupling risk |

---

## Dependencies

| Dependency | Status |
|---|---|
| Migration authority | ✅ Established via G-003 process |
| G-003 PR merge | ⏳ Pending (PR #33) — non-blocking for scope refresh |
| `unternehmen` table | ✅ Exists since 0001 |
| `projekte` table | ✅ Exists since 0020 |
| `experten` table | ✅ Exists since 0001 |
| `aufgaben` table | ✅ Exists since 0001 |
| `arbeitszyklen` table | ✅ Exists since 0001 |
| Auth middleware | ✅ `workProduct` pattern ready for extension |
| PR2B-3 manifest definition | ✅ Closed — `manifest_ref` column stores the reference |

---

## Recommendation

Authorize PR2B-4 artifact store implementation under a new ADR/IC cycle once:
1. G-003 PR #33 is merged
2. A new ADR (`ADR-0040-ARTIFACT-STORE`) and IC are certified
3. This scope refresh is accepted as the design foundation

The migration authority, governance pipeline, and fork/PR workflow are all proven. PR2B-4 can proceed with the same rigor applied to G-003.

# IC-0040: PR2B-4 Artifact Store — Implementation Contract

**Contract ID:** `IC-0040-ARTIFACT-STORE`
**Status:** Draft — pending certification
**ADR:** `ADR-0040-ARTIFACT-STORE`
**Scope:** `CPO-SCOPE-PR2B4-ARTIFACT-STORE-IMPLEMENTATION-REFRESH-001`
**Baseline:** `27d5d27` (origin/main)
**Date:** 2026-06-26
**G-003 dependency:** PR [#33](https://github.com/OpenCognit/Opencognit/pull/33) — certified, pending merge
**Expected migration number:** Conditional — next available after G-003 merge (likely `0040_artifact_store.sql`)

---

## Included Scope

This contract authorizes creation of:

| Artifact | Detail |
|---|---|
| Migration | `{next_available}_artifact_store.sql` (sqlite + postgres mirrors) |
| Table | `artifact_store` — 1 table |
| Storage service | `server/services/artifact-storage.ts` — local filesystem provider |
| API routes | 5 routes — create, list, metadata, content download, soft delete |
| Auth/RBAC | Company-scoped access control on all routes |
| Drizzle | 1 table export + `allTables` registration |

### `artifact_store` Table Schema

```sql
CREATE TABLE IF NOT EXISTS artifact_store (
  id TEXT PRIMARY KEY,
  unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id),
  projekt_id TEXT REFERENCES projekte(id),
  aufgabe_id TEXT REFERENCES aufgaben(id),
  expert_id TEXT REFERENCES experten(id),
  run_id TEXT REFERENCES arbeitszyklen(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  manifest_ref TEXT,
  manifest_version TEXT,
  source_ref TEXT,
  source_hash TEXT,
  retention_policy TEXT NOT NULL DEFAULT 'permanent',
  retention_ttl_days INTEGER,
  retain_until TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  erstellt_am TEXT NOT NULL,
  aktualisiert_am TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifact_store_company ON artifact_store(unternehmen_id);
CREATE INDEX IF NOT EXISTS idx_artifact_store_task ON artifact_store(aufgabe_id);
CREATE INDEX IF NOT EXISTS idx_artifact_store_status ON artifact_store(unternehmen_id, status);
CREATE INDEX IF NOT EXISTS idx_artifact_store_checksum ON artifact_store(checksum_sha256);
```

### Storage Service

**File:** `server/services/artifact-storage.ts`

**Provider interface:**
```typescript
interface ArtifactStorageProvider {
  write(artifactId: string, companyId: string, buffer: Buffer, filename: string): Promise<{ storagePath: string; checksum: string }>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
  verify(storagePath: string, expectedChecksum: string): Promise<boolean>;
}
```

**Initial implementation:** `LocalFilesystemProvider` using Node.js `fs/promises`.

**Storage root:** `process.env.ARTIFACT_STORAGE_ROOT` (default: `data/artifacts`).

**Directory structure:** `{root}/{unternehmen_id}/{artifact_id}/{filename}`

**Atomic write protocol:**
1. Create `{root}/{company_id}/` if not exists
2. Write buffer to `{root}/{company_id}/{artifact_id}.tmp`
3. Compute SHA-256 of temp file
4. Create `{root}/{company_id}/{artifact_id}/` directory
5. Rename temp to `{root}/{company_id}/{artifact_id}/{filename}`
6. Return `{ storagePath, checksum }`
7. On failure at any step: clean up temp file and partial directory

### API Routes

All routes are company-scoped via existing `authMiddleware`. No unauthenticated access.

| Method | Route | Handler | Auth |
|---|---|---|---|
| POST | `/api/artifacts` | Create artifact (multipart upload) | Company-scoped |
| GET | `/api/artifacts` | List artifacts (`?company_id=&task_id=&status=`) | Company-scoped |
| GET | `/api/artifacts/:id` | Get artifact metadata (JSON) | Company-scoped |
| GET | `/api/artifacts/:id/content` | Download artifact (stream file) | Company-scoped |
| DELETE | `/api/artifacts/:id` | Soft delete (sets `status='deleted'`, `deleted_at`) | Company-scoped |

### Auth/RBAC

Extends existing `workProduct` pattern in `server/middleware/auth.ts`:
- New entity type: `artifact`
- Resolves company ownership from `artifact_store.unternehmen_id`
- All 5 routes protected by `requireAuth` middleware
- Company-scoped: users can only access artifacts belonging to their company

### Security Controls

| Control | Implementation | Enforcement |
|---|---|---|
| Path traversal | UUID-based directory names | Structural — no user input in paths |
| Symlink | `fs.realpath` + root containment check | At every read/write |
| MIME type | Allowlist check at upload | Configurable list (default: common doc/image types) |
| Max size | `ARTIFACT_MAX_SIZE_BYTES` env var | Default 100MB, enforced at upload |
| Atomic write | Temp file + rename | Guarantees no partial files |
| Checksum | SHA-256 at write, optional verify on read | Stored in DB, recomputable |
| Tenant isolation | Company ID in path + DB FK + route auth | Three-layer enforcement |
| Failure cleanup | Temp file deletion on error | Guaranteed by atomic write protocol |

---

## Excluded Scope

```text
❌ Migration of existing work_products rows
❌ Removal/deprecation of work_products table
❌ Object store providers (S3, R2, MinIO, GCS)
❌ Cleanup cron job
❌ Hard delete worker
❌ TTL enforcement
❌ Archival job
❌ Orphan reconciliation
❌ Deduplication via checksum
❌ UI components
❌ Render manifest re-derivation
❌ Content indexing / full-text search
❌ Artifact versioning / diffing
❌ Public/unauthenticated routes
❌ Path-based download (no user-supplied paths)
```

---

## Expected Files

| File | Status |
|---|---|
| `server/db/migrations/sqlite/{next}_artifact_store.sql` | To be created |
| `server/db/migrations/postgres/{next}_artifact_store.sql` | To be created |
| `server/services/artifact-storage.ts` | To be created |
| `server/db/schema.ts` | Modified — 1 new Drizzle export |
| `server/routes/artifacts.ts` | To be created |
| `server/middleware/auth.ts` | Modified — add `artifact` entity type |
| `server/index.ts` | Modified — register artifact routes |

---

## Expected Tests

| Test | Method |
|---|---|
| SQL syntax | `sqlite3 :memory: < migration.sql` |
| Fresh bootstrap | Apply to empty DB, verify table + indexes |
| Existing upgrade | Apply after 0039, verify no conflicts |
| Migration parity | Compare sqlite vs postgres structure |
| Filesystem write | Write 1KB buffer, verify file on disk |
| Filesystem read | Read back file, verify buffer equality |
| Filesystem delete | Delete file, verify removed |
| Checksum integrity | Write, verify SHA-256, tamper, detect |
| Atomic write | Kill process mid-write, verify no partial file |
| Tenant isolation | Attempt cross-tenant path, verify rejected |
| Route auth | Unauthenticated request, verify 401 |
| Route company scope | Cross-company artifact access, verify 403 |
| Max size rejection | Upload > limit, verify rejected |
| Soft delete | DELETE, verify status='deleted', file still exists |
| Golden corpus | Full roundtrip: create→read→verify→delete |
| TypeScript | `npx tsc --noEmit` after all additions |

---

## Verification Gates

| # | Gate | Method | Pass Condition |
|---|---|---|---|
| 1 | SQL syntax — sqlite | `sqlite3 :memory: < migration.sql` | Exit 0 |
| 2 | SQL syntax — postgres | Manual review | No syntax errors |
| 3 | Fresh DB bootstrap | Apply + verify | 1 table, 4 indexes |
| 4 | Existing DB upgrade | Apply after 0038/0039 | No conflicts |
| 5 | Migration parity | Compare dialects | Same schema |
| 6 | Atomic write | Write 5MB buffer, verify | File intact, checksum matches |
| 7 | Checksum integrity | Tamper file, verify | Detection works |
| 8 | Tenant isolation | Write under company A, read as company B | Rejected |
| 9 | Route containment | All 5 routes require auth | 401 for unauthenticated |
| 10 | Cross-company access | Company A requests Company B artifact | 403 |
| 11 | Max size enforcement | Upload 101MB (with 100MB limit) | Rejected |
| 12 | Soft delete | DELETE → status='deleted', file persists | Verified |
| 13 | Path traversal attempt | Supply `../../etc/passwd` as filename | Rejected or normalized away |
| 14 | Golden corpus | Full roundtrip | All steps pass |
| 15 | TypeScript | `npx tsc --noEmit` | No errors |

---

## Rollback Plan

### Pre-production / zero-data rollback

```sql
DROP TABLE IF EXISTS artifact_store;
```
Plus manual removal of `data/artifacts/` directory.

### Production rollback

No destructive rollback authorized after production data exists. Options:
1. Forward corrective migration
2. Feature flag disabling artifact routes
3. Separate CPO-approved data-retention and rollback plan if physical removal required

---

## Dependencies

| Dependency | Status |
|---|---|
| G-003 PR #33 merge | ⏳ Pending — determines migration number |
| `unternehmen` table | ✅ Exists (0001) |
| `projekte` table | ✅ Exists (0020) |
| `aufgaben` table | ✅ Exists (0001) |
| `experten` table | ✅ Exists (0001) |
| `arbeitszyklen` table | ✅ Exists (0001) |
| Auth middleware | ✅ Exists (`server/middleware/auth.ts`) |
| MigrationRunner | ✅ Exists (`server/db/client.ts`) |

---

## Risks

| Risk | Mitigation |
|---|---|
| Migration number collision if upstream merges other PR first | Conditional naming — migration number confirmed at implementation time |
| Disk space exhaustion | Max size limit (100MB default); retention metadata enables future enforcement |
| Filesystem permission errors in deployment | `ARTIFACT_STORAGE_ROOT` env var; directory auto-created on first write; documented requirements |
| `work_products` confusion | Excluded from scope; explicit separation documented in ADR |
| Checksum overhead for large files | SHA-256 is fast; streaming hash avoids full-file-in-memory |

---

## Certification Requirements

Before implementation:

- [ ] ADR-0040 approved by Program Office
- [ ] IC-0040 approved by Program Office
- [ ] G-003 PR #33 merged upstream
- [ ] Migration number confirmed from actual upstream ordering
- [ ] ADR/IC files committed to `docs/architecture/` paths

After certification, before closure:

- [ ] All 15 verification gates pass
- [ ] No deviations from ADR/IC without re-certification

---

## References

- `ADR-0040-ARTIFACT-STORE` — Architecture Decision Record
- `CPO-SCOPE-PR2B4-ARTIFACT-STORE-IMPLEMENTATION-REFRESH-001` — Scope refresh
- `CPO-CERT-PR2B4-ARTIFACT-STORE-SCOPE-REFRESH-001` — Scope acceptance with amendments
- `server/db/schema.ts` line 468 — Existing `work_products` table
- `server/middleware/auth.ts` line 199 — Existing `workProduct` auth pattern
- `server/db/client.ts` — MigrationRunner mechanism

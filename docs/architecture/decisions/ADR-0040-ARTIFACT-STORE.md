# ADR-0040: PR2B-4 Artifact Store Implementation

**Decision ID:** `ADR-0040-ARTIFACT-STORE`
**Status:** Draft — pending certification
**Date:** 2026-06-26
**Baseline:** `27d5d27` (origin/main)
**Scope:** `CPO-SCOPE-PR2B4-ARTIFACT-STORE-IMPLEMENTATION-REFRESH-001`
**G-003 dependency:** PR [#33](https://github.com/OpenCognit/Opencognit/pull/33) — certified, pending merge
**Expected migration number:** Next available after G-003 merge (likely `0040_artifact_store.sql`, conditional on upstream ordering)

---

## Context

The agentic AI system produces documents, reports, spreadsheets, and structured data. The existing `work_products` table stores metadata with inline TEXT content — suitable for small text outputs but not for binary files, content-addressed storage, integrity verification, tenant-isolated filesystem paths, or replayable artifact lifecycle management.

PR2B-1 through PR2B-3 (Renderer Abstraction, Hardening, Manifest) are closed. PR2B-4 (Artifact Store Implementation) was held pending migration authority maturity. That prerequisite is now satisfied via the G-003 certification process.

## Decision

Introduce a new `artifact_store` metadata table backed by a local-filesystem storage provider, separated from the existing `work_products` table. This is an additive capability — `work_products` continues to serve its existing MVP role.

### 1. `artifact_store` vs `work_products`

**Decision:** New table. Do not extend `work_products`.

**Rationale:**
- `work_products` stores content inline as TEXT — unsuitable for binary files
- `work_products` has no checksum, retention, or manifest fields
- Extending it would break the existing MVP contract for heartbeat dependencies, task context, and chat attachments
- A separate table allows independent lifecycle management without backward-compatibility risk

### 2. Storage Provider Boundary

**Decision:** Local filesystem as the initial provider, with an abstracted provider interface for future object store support.

```text
Approved initial provider: local filesystem (Node.js fs)
Deferred providers: S3, R2, MinIO, GCS
Provider boundary: storage service class with write/read/delete/verify methods
Metadata model: identical regardless of provider
```

The storage service class exposes:
```typescript
interface ArtifactStorageProvider {
  write(artifactId: string, companyId: string, buffer: Buffer): Promise<string>; // returns storage_path
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
  verify(storagePath: string, expectedChecksum: string): Promise<boolean>;
}
```

### 3. Storage Root

**Decision:** Configurable via `ARTIFACT_STORAGE_ROOT` environment variable.

```text
Default (dev/local): data/artifacts
Production: deployment-managed path
Git: excluded from repository (.gitignore)
```

The directory is created on first write if it does not exist. Must reside outside any committed source tree.

### 4. Tenant/Company Isolation

**Decision:** Mandatory company ownership at every layer.

| Layer | Enforcement |
|---|---|
| Database | `unternehmen_id TEXT NOT NULL REFERENCES unternehmen(id)` — non-nullable |
| Storage path | `{ARTIFACT_STORAGE_ROOT}/{unternehmen_id}/{artifact_id}/{filename}` |
| API routes | Auth middleware checks company scope before any read/write/delete |
| Path input | No direct path from caller — all path components are server-computed from UUIDs |

Cross-tenant access is structurally impossible: the company ID is embedded in the filesystem path, and the route handler resolves it from the authenticated session, not from user input.

### 5. Artifact Identity

**Decision:** UUID primary key, content-addressed via SHA-256, path-addressed via deterministic storage path.

| Identity | Implementation |
|---|---|
| Row identity | UUID (`id TEXT PRIMARY KEY`) |
| Content identity | SHA-256 checksum (`checksum_sha256 TEXT NOT NULL`) |
| Path identity | `{unternehmen_id}/{artifact_id}/{filename}` (never user-supplied) |

### 6. Checksum / Integrity

**Decision:** SHA-256 computed at write time, stored in `checksum_sha256`, verifiable on read.

**Atomic write protocol:**
1. Write content to temp file: `{storage_root}/{company_id}/{artifact_id}.tmp`
2. Compute SHA-256 of temp file
3. Rename temp file to final path: `{storage_root}/{company_id}/{artifact_id}/{filename}`
4. Insert metadata row with `checksum_sha256`
5. If any step fails: delete temp file, roll back metadata insert

This guarantees no partial or corrupted files in the artifact store.

### 7. Manifest Relationship

**Decision:** Loose coupling via nullable reference fields. No hard foreign keys to manifest tables.

```text
manifest_ref      TEXT  — opaque string referencing PR2B-3 render manifest
manifest_version  TEXT  — version at creation time
source_ref        TEXT  — optional reference to source entity
source_hash       TEXT  — optional hash of source state
```

All are nullable. No FK constraint to any manifest table. The application layer uses these for staleness detection and replayability decisions.

### 8. Retention / Deletion

**Decision:** Metadata only. Enforcement is explicitly deferred.

**Allowed now:**
```text
retention_policy    TEXT DEFAULT 'permanent'  — permanent | ttl | task_lifetime
retain_until        TEXT                      — computed expiry (if ttl)
retention_ttl_days  INTEGER                   — TTL in days
status              TEXT DEFAULT 'active'     — active | archived | expired | deleted
deleted_at          TEXT                      — soft delete timestamp
```

**Held (not in this scope):**
```text
- Cleanup cron job
- Hard delete worker
- TTL enforcement
- Archival job
- Orphan reconciliation
```

### 9. Append-Only Behavior

**Decision:** Re-rendering an artifact creates a new row. Existing rows are never overwritten.

- Source task/agent/manifest version changes → creates new artifact
- Old artifact rows remain (status transitions to `archived` at application discretion)
- Audit trail is implicit in row history — no separate audit table needed

### 10. Route Exposure

**Decision:** Five routes, all company-scoped via existing auth middleware.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/artifacts` | Create/upload artifact (multipart, company-scoped) |
| GET | `/api/artifacts` | List/query artifacts (filter: `?company_id=`, `?task_id=`, `?status=`) |
| GET | `/api/artifacts/:id` | Get artifact metadata |
| GET | `/api/artifacts/:id/content` | Download/stream artifact content |
| DELETE | `/api/artifacts/:id` | Soft delete (sets `status='deleted'`, `deleted_at`) |

No unauthenticated, public, or path-based download routes.

### 11. Security Controls

| Control | Implementation |
|---|---|
| Path traversal prevention | UUID-based directory names — zero user input in paths |
| Symlink prevention | `fs.realpath` + root containment check before any read/write |
| MIME/content type | Application-level allowlist or declared `content_type` policy |
| Max file size | Configurable limit (default 100MB), enforced at upload |
| Atomic write | Temp file → checksum → rename → metadata insert |
| Checksum verification | SHA-256 verify on read (configurable) |
| Auth/RBAC | Company-scoped via existing middleware, extends `workProduct` pattern |
| Tenant isolation | Multi-layer: DB column + filesystem path + route auth |
| Failure cleanup | Temp file deletion on any write failure |

### 12. Rollback / Deprecation

**Pre-production rollback:**
```sql
DROP TABLE IF EXISTS artifact_store;
```
Plus manual cleanup of `data/artifacts/` directory.

**Production rollback:** Forward corrective migration only. No destructive table drops after production data exists. Feature flag can disable artifact routes without touching storage.

---

## Consequences

### Positive
- Binary files up to 100MB can be stored and retrieved with integrity verification
- Tenant isolation is structurally enforced at three layers
- Append-only model preserves audit trail
- Loose manifest coupling avoids tight dependency on PR2B-3 internals
- Provider abstraction enables future S3/MinIO without metadata schema changes

### Negative
- Adds a second artifact surface alongside `work_products` (addressed by explicit separation rationale)
- Filesystem provider requires deployment consideration (directory permissions, disk space)
- No immediate cleanup — retention metadata grows until cleanup cron is implemented

### Neutral
- Migration number is conditional on G-003 merge order
- `work_products` continues unchanged — deprecation is a separate future decision

---

## Alternatives Considered

### A. Extend `work_products` with filesystem backing
Rejected — would break existing inline-text contract; messy backward compatibility; `work_products` is wired into heartbeat/task context in ways that assume TEXT content.

### B. Object store only (S3 from day one)
Rejected — overcomplicates initial deployment; filesystem-first with provider abstraction gives the same future flexibility without the infrastructure dependency.

### C. Store files as BLOB in SQLite
Rejected — SQLite BLOB performance degrades with large files; filesystem is the correct storage tier for binary artifacts.

---

## Certification Gates

- [ ] Scope refresh accepted by Program Office ✅
- [ ] ADR reviewed and approved
- [ ] IC reviewed and approved
- [ ] G-003 PR #33 merged upstream (prerequisite)
- [ ] Migration number confirmed after G-003 merge
- [ ] No implementation until all gates pass

---

## References

- `CPO-SCOPE-PR2B4-ARTIFACT-STORE-IMPLEMENTATION-REFRESH-001` — Scope refresh
- `CPO-CERT-PR2B4-ARTIFACT-STORE-SCOPE-REFRESH-001` — Scope acceptance with amendments
- G-003 PR [#33](https://github.com/OpenCognit/Opencognit/pull/33) — Migration authority precedent
- `server/db/schema.ts` line 468 — Existing `work_products` table definition
- `server/middleware/auth.ts` line 199 — Existing `workProduct` auth pattern

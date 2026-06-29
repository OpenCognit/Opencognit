# IC-0041: PR-IAM-1 — Role and Permission Backbone — Implementation Contract

**Contract ID:** `IC-0041-IAM-ROLE-PERMISSION-BACKBONE`
**Status:** Draft — pending certification
**ADR:** `ADR-0041-IAM-ROLE-PERMISSION-BACKBONE`
**Scope:** `CPO-SCOPE-PRIAM1-IAM-BACKBONE-001`
**Baseline:** `05c147e`
**Date:** 2026-06-29

---

## Included Scope

| Artifact | Detail |
|---|---|
| Migration | `0041_iam_role_permission_backbone.sql` (sqlite + postgres) |
| Tables | 5 new, 0 altered |
| Seed data | ~55 permissions, ~12 roles, ~40 role_permission mappings |
| Middleware | `requirePermission(module, action)` in `server/middleware/auth.ts` |
| Drizzle | 5 table exports + `allTables` registration |
| Routes | No new routes — middleware enhancement only |

### Table Inventory

| Table | Columns | Indexes |
|---|---|---|
| `roles` | 7 | `idx_roles_company(unternehmen_id)` |
| `permissions` | 5 | `idx_permissions_module(module)`, `idx_permissions_module_action(module, action)` |
| `role_permissions` | 2 (composite PK) | — (covered by PK) |
| `project_users` | 8 | `idx_project_users_project(projekt_id)`, `idx_project_users_user(benutzer_id)`, `idx_project_users_role(role_id)` |
| `user_tenant_roles` | 7 | `idx_user_tenant_roles_user(benutzer_id)`, `idx_user_tenant_roles_company(unternehmen_id)`, unique composite on (benutzer_id, unternehmen_id, role_id) |

### Seed Data

**Permissions** — generated from module × action matrix:
```text
companies:      view, create, edit, delete
projects:       view, create, edit, archive
tasks:          view, create, edit, assign, close
agents:         view, create, edit, disable
documents:      view, create, edit, approve, delete
finance:        view, create, edit, submit, approve, reject, export
ipc:            view, create, edit, submit, approve, reject
procurement:    view, create, edit, submit, approve
workforce:      view, create, edit, assign
equipment:      view, create, edit, transfer
hse:            view, create, edit, escalate
admin:          view, create, edit, override, export, delete
audit:          view, export
```

**Roles** — 12 system roles with `ist_system = 1`, `unternehmen_id = NULL` (global):
```text
tenant_admin, director, finance_admin, project_manager,
site_engineer, qs, storekeeper, foreman, hse_officer,
procurement_officer, document_controller, viewer, auditor
```

### Middleware Contract

```typescript
// New function signature
function requirePermission(module: string, action: string): RequestHandler;

// Resolution chain:
// 1. Extract user from JWT/session
// 2. If user.rolle === 'admin' → GRANT (backward compat)
// 3. Resolve tenant from request context
// 4. Query user_tenant_roles → role_id
// 5. Query role_permissions → permission_id  
// 6. Query permissions → check module + action match
// 7. Match → next(); No match → 403

// Optional project-scoped check:
function requireProjectPermission(projectId: string, module: string, action: string): RequestHandler;
// Also checks project_users table
```

---

## Excluded Scope

```text
❌ Approval authority matrix (PR-IAM-2)
❌ Approval thresholds (PR-IAM-2)
❌ Multi-step approvals (PR-IAM-2)
❌ Audit events log (PR-AUD-1)
❌ Segregation of duties detection (PR-IAM-3)
❌ Agent permission policies (PR-IAM-4)
❌ User sessions / device sessions
❌ Security events
❌ Access reviews
❌ Enterprise SSO / OIDC / SAML
❌ Biometric identity
❌ Permission cache invalidation
❌ UI for role/permission management (schema only — UI separate)
❌ Changes to existing benutzer table
❌ Changes to existing agent_permissions table
❌ Changes to existing company_memberships table
```

---

## Expected Files

| File | Status |
|---|---|
| `server/db/migrations/sqlite/0041_iam_role_permission_backbone.sql` | To create |
| `server/db/migrations/postgres/0041_iam_role_permission_backbone.sql` | To create |
| `server/db/schema.ts` | Modified — 5 new Drizzle exports |
| `server/middleware/auth.ts` | Modified — add `requirePermission` + `requireProjectPermission` |

---

## Verification Gates

| # | Gate | Method | Pass Condition |
|---|---|---|---|
| 1 | SQLite syntax | `sqlite3 :memory: < migration.sql` | Exit 0 |
| 2 | Postgres syntax | Manual review | No errors |
| 3 | Fresh bootstrap | Apply to empty DB | 5 tables, ~10 indexes |
| 4 | Existing upgrade | Apply after 0040, verify no conflicts | No errors |
| 5 | Migration parity | Compare dialects | Same 5 tables |
| 6 | Seed data: permissions | `SELECT count(*) FROM permissions` | 47-55 rows |
| 7 | Seed data: roles | `SELECT count(*) FROM roles` | 12-13 rows |
| 8 | Seed data: role_permissions | `SELECT count(*) FROM role_permissions` | ~40 rows |
| 9 | FK integrity | `PRAGMA foreign_key_check` | 0 violations |
| 10 | admin backward compat | Request with admin role, no explicit permission | GRANTED |
| 11 | Permission denied | Request without required permission | 403 |
| 12 | Project-scoped access | Cross-project request | 403 |
| 13 | Existing routes unaffected | Hit any existing route without requirePermission | Works as before |
| 14 | Idempotency | Second migration run | No errors, no duplicates |
| 15 | TypeScript | `npx tsc --noEmit` | 0 new errors |
| 16 | Golden corpus | Create role→assign permission→assign user→check access | Roundtrip correct |

---

## Rollback Plan

### Pre-production / zero-data
```sql
DROP TABLE IF EXISTS user_tenant_roles;
DROP TABLE IF EXISTS project_users;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DELETE FROM _migrations WHERE name = '0041_iam_role_permission_backbone.sql';
```

### Production
Forward corrective migration only. Feature flag can disable `requirePermission` middleware globally. Existing routes are unaffected since they don't use the new middleware.

---

## Dependencies

| Dependency | Status |
|---|---|
| `benutzer` table | ✅ Exists (0001) |
| `unternehmen` table | ✅ Exists (0001) |
| `projekte` table | ✅ Exists (0020) |
| Auth middleware | ✅ Exists (`server/middleware/auth.ts`) |
| MigrationRunner | ✅ Exists (`server/db/client.ts`) |
| PR #33 merge | ⏳ Pending — migration number confirmed (0041) |

---

## Risks

| Risk | Mitigation |
|---|---|
| Permission middleware performance | Cache user→permissions per request (in-memory Map, cleared after response) |
| Seed data grows stale as new modules added | Seeds are `INSERT OR IGNORE` — safe to re-run; new modules add supplementally |
| `admin` role bypass creates audit gap | Explicitly logged: "admin bypass — no permission check" in middleware |
| Role name collisions if tenants create custom roles | System roles use `ist_system=1` and `unternehmen_id=NULL`; tenant roles scoped per company |

---

## Certification Requirements

- [ ] ADR-0041 approved
- [ ] IC-0041 approved
- [ ] Scope packet in canonical path
- [ ] ADR/IC in canonical paths
- [ ] No implementation until certification complete

---

## References

- `ADR-0041-IAM-ROLE-PERMISSION-BACKBONE` — Architecture Decision Record
- `CPO-SCOPE-PRIAM1-IAM-BACKBONE-001` — Scope packet
- `server/db/schema.ts` — Existing schema
- `server/middleware/auth.ts` — Existing auth middleware
- `server/db/client.ts` — MigrationRunner

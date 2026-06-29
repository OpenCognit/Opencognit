# CPO-SCOPE-PRIAM1-IDENTITY-ACCESS-CONTROL-ROOM-001

**Decision ID:** `CPO-SCOPE-PRIAM1-IAM-BACKBONE-001`
**Date:** 2026-06-29
**Baseline:** `05c147e` (local: ADR-0040 + PR2B-4 certified)
**CPO spec:** Identity, Access, Tenant & Audit Control Room — PR-IAM-1
**Classification:** Greenfield platform security foundation
**Previous certified deliveries:** G-003 (8 tables), PR2B-4 (1 table + storage service)

---

## 1. Current State — Near-Zero IAM

### What exists

| Table | Columns | Gap |
|---|---|---|
| `benutzer` (users) | id, name, email, passwort_hash, rolle (enum: admin/mitglied), oauth | 2 roles total — no granular RBAC |
| `unternehmen` (companies) | id, name, status | Tenant boundary — isolation via FK only |
| `company_memberships` | user_id, company_id, role | Links users → companies |
| `agent_permissions` | expert_id, boolean flags (darf_*) | Per-agent, not role-based, not user-scoped |

### Auth middleware

- JWT token validation via `server/middleware/auth.ts`
- Resource ownership check: resolves company_id from target entity
- Entity types supported: company, project, task, agent, workProduct, artifact, etc.
- No permission-level checks — binary access (you either own it or you don't)

### What's entirely missing

```
roles                  — 0 (only enum on user table)
permissions            — 0 granular permissions  
role_permissions       — 0 mappings
project_users          — 0 project-level access control
approval_authority_rules — 0
approval_thresholds    — 0
segregation_rules      — 0 conflict detection
audit_events           — 0 append-only audit log
user_sessions          — 0 session tracking
device_sessions        — 0
security_events        — 0
access_reviews         — 0
agent_permission_policies — 0 governed agent access
```

---

## 2. PR-IAM-1 Scope — Role and Permission Backbone

### Core tables (5)

| Table | Purpose |
|---|---|
| `roles` | Role registry — project_manager, site_engineer, qs, foreman, storekeeper, hse_officer, procurement_officer, document_controller, finance_admin, director, auditor, viewer |
| `permissions` | Permission registry — view, create, edit, submit, approve, reject, override, delete, export, assign, escalate, close |
| `role_permissions` | Many-to-many mapping — which roles have which permissions |
| `project_users` | User → project assignments with specific role |
| `user_tenant_roles` | User → tenant role mapping (extends company_memberships) |

### Extension to existing tables

| Table | Change |
|---|---|
| `benutzer` | No changes — role enum stays for backward compat |
| `company_memberships` | No changes — enhanced by `user_tenant_roles` |
| `agent_permissions` | No changes — agent governance is PR-IAM-4 |

### Table schemas

#### `roles`
```sql
id              TEXT PK
unternehmen_id  TEXT NOT NULL FK → unternehmen(id)
name            TEXT NOT NULL        -- 'project_manager', 'site_engineer', etc.
beschreibung    TEXT
ist_system      INTEGER DEFAULT 0    -- 1 = system role, cannot be deleted
erstellt_am     TEXT NOT NULL
aktualisiert_am TEXT NOT NULL
```

#### `permissions`
```sql
id              TEXT PK
module          TEXT NOT NULL        -- 'finance', 'ipc', 'documents', 'workforce', etc.
action          TEXT NOT NULL        -- 'view', 'create', 'edit', 'submit', 'approve', 'reject', 'override', 'delete', 'export', 'assign', 'escalate', 'close'
resource        TEXT                 -- optional: specific resource within module
beschreibung    TEXT
erstellt_am     TEXT NOT NULL
```

#### `role_permissions`
```sql
role_id        TEXT NOT NULL FK → roles(id)
permission_id  TEXT NOT NULL FK → permissions(id)
PRIMARY KEY (role_id, permission_id)
```

#### `project_users`
```sql
id              TEXT PK
projekt_id      TEXT NOT NULL FK → projekte(id)
benutzer_id     TEXT NOT NULL FK → benutzer(id)
role_id         TEXT NOT NULL FK → roles(id)
status          TEXT DEFAULT 'active'  -- active, suspended, removed
zugewiesen_von  TEXT
zugewiesen_am   TEXT NOT NULL
erstellt_am     TEXT NOT NULL
aktualisiert_am TEXT NOT NULL
```

#### `user_tenant_roles`
```sql
id              TEXT PK
benutzer_id     TEXT NOT NULL FK → benutzer(id)
unternehmen_id  TEXT NOT NULL FK → unternehmen(id)
role_id         TEXT NOT NULL FK → roles(id)
ist_primary     INTEGER DEFAULT 0    -- primary role within this tenant
erstellt_am     TEXT NOT NULL
aktualisiert_am TEXT NOT NULL
UNIQUE (benutzer_id, unternehmen_id, role_id)
```

---

## 3. Seeded Permissions

At migration time, seed the permission registry from known modules:

| Module | Actions |
|---|---|
| companies | view, create, edit, delete |
| projects | view, create, edit, archive |
| tasks | view, create, edit, assign, close |
| agents | view, create, edit, disable |
| documents | view, create, edit, approve, delete |
| finance | view, create, edit, submit, approve, reject, export |
| ipc | view, create, edit, submit, approve, reject |
| procurement | view, create, edit, submit, approve |
| workforce | view, create, edit, assign |
| equipment | view, create, edit, transfer |
| hse | view, create, edit, escalate |
| admin | view, create, edit, override, export, delete |
| audit | view, export |

---

## 4. Seeded Roles

| Role | Typical permissions |
|---|---|
| tenant_admin | all modules, all actions |
| director | view all, approve finance/ipc/procurement |
| finance_admin | finance: all; other modules: view |
| project_manager | projects: all; workforce: assign; equipment: transfer; documents: approve |
| site_engineer | tasks: all; workforce: assign; hse: create, edit |
| qs | ipc: all; finance: view, create |
| storekeeper | procurement: create, edit; workforce: view |
| foreman | workforce: assign; tasks: view, edit; equipment: view |
| hse_officer | hse: all; tasks: view |
| procurement_officer | procurement: all |
| document_controller | documents: all |
| viewer | all modules: view only |
| auditor | all modules: view, export |

---

## 5. Access Control Checks

Middleware enhancement — `requirePermission(module, action)`:

```typescript
// Current: binary ownership check
requireEntityAccess('task', 'id')

// New: permission-level check
requirePermission('finance', 'approve')
```

Route protection:
```typescript
router.post('/api/ipc/:id/approve',
  requireAuth,
  requirePermission('ipc', 'approve'),
  handler
);
```

---

## 6. Minimal UI — Access Control Room

Main screen sections:
- **Users** — list, assign role, revoke role, disable
- **Roles** — role registry with permission matrix
- **Project Access** — project_users management
- **Permission Conflicts** — users with conflicting grants (future PR-IAM-3)

---

## 7. Excluded from PR-IAM-1

```text
❌ Approval authority matrix (PR-IAM-2)
❌ Approval thresholds (PR-IAM-2)
❌ Multi-step approvals (PR-IAM-2)
❌ Audit events log (PR-AUD-1)
❌ Segregation of duties detection (PR-IAM-3)
❌ Agent permission policies (PR-IAM-4)
❌ User sessions / device sessions (PR-IAM-2)
❌ Security events (PR-AUD-1)
❌ Access reviews (future)
❌ Enterprise SSO / OIDC / SAML
❌ Biometric identity
❌ UI for audit viewer (PR-AUD-1)
```

---

## 8. Database Impact

| Item | Detail |
|---|---|
| New migrations | `0041_iam_role_permission_backbone.sql` (sqlite + postgres) |
| New tables | 5 (roles, permissions, role_permissions, project_users, user_tenant_roles) |
| New indexes | ~10 |
| New Drizzle exports | 5 |
| Altered tables | 0 — backward compatible |
| Seed data | ~55 permission rows, ~12 role rows |

---

## 9. Verification Gates

| Gate | Method |
|---|---|
| SQL syntax | `sqlite3 :memory:` |
| Fresh bootstrap | 5 tables, ~10 indexes |
| Existing upgrade | After 0040, no conflicts |
| Migration parity | SQLite = Postgres |
| Seed data integrity | Permission count matches module × action matrix |
| FK integrity | roles → unternehmen, project_users → projekte + benutzer + roles |
| Route protection | Unauthorized requests rejected with 403 |
| TypeScript | `npx tsc --noEmit` |
| Golden corpus | Create role → assign permission → assign user → verify access |

---

## 10. Recommendation

Authorize PR-IAM-1 scope packet. Proceed to ADR/IC under the established governance pipeline.

**Next migration:** `0041_iam_role_permission_backbone.sql`
**Dependencies:** None — self-contained. Builds on existing `benutzer`, `unternehmen`, `projekte` tables without modifying them.

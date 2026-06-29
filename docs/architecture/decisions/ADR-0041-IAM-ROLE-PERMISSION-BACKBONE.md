# ADR-0041: PR-IAM-1 — Role and Permission Backbone

**Decision ID:** `ADR-0041-IAM-ROLE-PERMISSION-BACKBONE`
**Status:** Draft — pending certification
**Date:** 2026-06-29
**Baseline:** `05c147e`
**Scope:** `CPO-SCOPE-PRIAM1-IAM-BACKBONE-001`
**CPO spec:** Identity, Access, Tenant & Audit Control Room
**Migration:** `0041_iam_role_permission_backbone.sql`

---

## Context

CHAMPE has 15+ control rooms (Finance, IPC, Claims, Vendor, Workforce, Equipment, Documents, Agents, etc.) with only two user roles — `admin` and `mitglied` — and no permission-level access control. Every user is either an admin (can do everything) or a member (can do very little). There are no project-level access controls, no granular permissions, no role registry, and no RBAC middleware.

This is the platform's biggest security blind spot. A construction OS handling finance, payments, claims, and agentic decisions without access control is architecturally unsound.

## Decision

Introduce a Role-Based Access Control (RBAC) backbone with 5 new tables, seeded permissions and roles, and a `requirePermission(module, action)` middleware extension. This is additive — zero existing tables are modified.

### 1. Schema Authority

**Decision:** Greenfield domain introduction. Self-contained migration `0041` with zero impact on existing tables.

**Rationale:** The `benutzer` table's 2-role enum is insufficient for multi-role, project-scoped access. Extending it would break backward compatibility. A separate RBAC layer allows migration without touching existing auth paths.

### 2. RBAC Model

**Decision:** Role-based, not attribute-based (ABAC). Roles are tenant-scoped. Users get roles per tenant and per project.

```
User → user_tenant_roles (tenant-level role)
User → project_users (project-level role)
Role → role_permissions → permissions
```

**Rationale:** ABAC is more flexible but premature for CHAMPE's current complexity. RBAC is well-understood, auditable, and maps directly to construction site roles (PM, QS, foreman, storekeeper, etc.). ABAC can be layered on later.

### 3. Role Registry

**Decision:** Roles are defined per tenant, with system roles seeded at migration time.

**Seeded system roles:** tenant_admin, director, finance_admin, project_manager, site_engineer, qs, storekeeper, foreman, hse_officer, procurement_officer, document_controller, viewer, auditor

**Rationale:** Construction roles are stable and well-defined. Seeding them avoids per-tenant setup friction. Tenants can create custom roles but system roles provide a baseline that every project understands.

### 4. Permission Model

**Decision:** Module + Action + optional Resource triplet. Permissions are global (not per-tenant).

```
permission = { module: 'finance', action: 'approve', resource: null }
permission = { module: 'documents', action: 'view', resource: 'contract' }
```

**Modules:** companies, projects, tasks, agents, documents, finance, ipc, procurement, workforce, equipment, hse, admin, audit

**Actions:** view, create, edit, submit, approve, reject, override, delete, export, assign, escalate, close

**Rationale:** Module+Action covers 95% of CHAMPE access control needs. Resource-level permissions (e.g., "view contract documents only") are deferred. The triplet model allows extension without schema changes.

### 5. Middleware Extension

**Decision:** New `requirePermission(module, action)` middleware alongside existing `requireEntityAccess`. No breaking changes to existing auth.

```typescript
// Existing (unchanged)
router.get('/api/artifacts/:id', requireAuth, requireEntityAccess('artifact', 'id'), handler);

// New (additive)
router.post('/api/ipc/:id/approve', requireAuth, requirePermission('ipc', 'approve'), handler);
```

**Implementation:** Middleware resolves user → tenant → roles → permissions. Caches result per request. Returns 403 if permission missing.

**Rationale:** Separates ownership (entity access) from capability (permission). A user may own a resource but lack approval permission. Or a user may have approval permission but only for their assigned project.

### 6. Backward Compatibility

**Decision:** Existing `admin`/`mitglied` enum on `benutzer` remains functional. All existing routes continue to work without modification.

- Users with `rolle='admin'` → implicitly granted all permissions for backward compat
- Users with `rolle='mitglied'` → use new RBAC system
- Routes without `requirePermission` → continue using existing binary ownership checks

**Rationale:** Zero-downtime migration. New routes adopt permission checks. Old routes are progressively migrated without breaking existing functionality.

### 7. Naming Convention

**Decision:** Follow established English-domain convention (G-003, PR2B-4 precedent):

| Concern | Convention |
|---|---|
| Table names | English (roles, permissions, role_permissions, project_users, user_tenant_roles) |
| FK columns | German for legacy tables (unternehmen_id, benutzer_id, projekt_id) |
| Timestamps | German (erstellt_am, aktualisiert_am) |
| Domain columns | English (module, action, resource, ist_system, ist_primary) |

### 8. Rollback

**Pre-production:** `DROP TABLE IF EXISTS` in reverse FK order. Seed data is re-creatable.

**Production:** Forward corrective migration only. Feature flag can disable permission middleware without touching data.

---

## Consequences

### Positive
- Every CHAMPE action can be permission-gated at module + action level
- Construction site roles map directly to RBAC roles
- Zero breaking changes — all existing routes continue working
- Permission checks are auditable — middleware logs denied requests
- Foundation for PR-IAM-2 (approval matrix), PR-AUD-1 (audit log), PR-IAM-3 (segregation)

### Negative
- 5 new tables add complexity to the schema surface
- Permission middleware adds latency per request (mitigated by caching)
- `admin` role bypass creates a two-tier system until full migration

### Neutral
- Agent permissions remain in existing `agent_permissions` table — PR-IAM-4 will reconcile
- Tenant isolation remains FK-based — enhanced isolation is a future capability

---

## Alternatives Considered

### A. ABAC (Attribute-Based Access Control)
Rejected — too complex for current needs. RBAC is simpler, well-understood, and maps cleanly to construction roles. ABAC can be layered on later.

### B. Extend `benutzer.rolle` enum with more values
Rejected — single-role enum can't express multi-role reality (user is PM on Project A, viewer on Project B). Requires schema migration for every new role. No permission granularity.

### C. CASL or similar JS authorization library
Considered but rejected for initial implementation — adds dependency. Custom middleware is ~50 lines and gives full control over the permission resolution pipeline.

---

## Certification Gates

- [ ] Scope packet approved ✅
- [ ] ADR reviewed and approved
- [ ] IC reviewed and approved
- [ ] No implementation until certification complete

---

## References

- `CPO-SCOPE-PRIAM1-IAM-BACKBONE-001` — Scope packet
- CPO spec: Identity, Access, Tenant & Audit Control Room
- `server/db/schema.ts` — Existing `benutzer`, `unternehmen`, `projekte` tables
- `server/middleware/auth.ts` — Existing `requireEntityAccess` pattern
- G-003 / PR2B-4 — Established governance pipeline precedent

# IC-0045 — Subscription Entitlement Backbone Verification

**IC:** `IC-0045` | **ADR:** ADR-0045 | **Migration:** `0045_subscription_entitlement_backbone.sql`

---

## Gates

1. SQLite: 6 tables, 5 plans, 31 module rows
2. Plan lookup by code
3. Tenant subscription lifecycle: trial → active → cancelled
4. Entitlement inheritance from plan modules
5. `all` module grants access to any key
6. Usage limit tracking (users, projects, storage, ai_requests)
7. Event audit trail for status changes
8. Migration parity (SQLite = Postgres)
9. Idempotency
10. TypeScript: 0 new errors

---

## Rollback
```sql
DROP TABLE IF EXISTS subscription_events;
DROP TABLE IF EXISTS tenant_usage_limits;
DROP TABLE IF EXISTS tenant_entitlements;
DROP TABLE IF EXISTS tenant_subscriptions;
DROP TABLE IF EXISTS subscription_plan_modules;
DROP TABLE IF EXISTS subscription_plans;
```

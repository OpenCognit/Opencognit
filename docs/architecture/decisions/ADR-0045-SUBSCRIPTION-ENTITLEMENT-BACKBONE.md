# ADR-0045 — Subscription Plan + Entitlement Backbone

**Decision ID:** `ADR-0045` | **Date:** 2026-06-29
**Branch:** `feat/pr-bill-1-subscription-entitlement-backbone`

---

## Decisions

### D-1: Module-based entitlements, not monolithic plans
Each plan defines a set of module_keys. Tenant entitlements inherit from plan, can be individually toggled.

### D-2: `all` module key for unlimited plans
Enterprise and Developer plans use module_key='all' — single entitlement row grants all modules. Simplifies checks.

### D-3: Usage limits as snapshots, not live queries
`tenant_usage_limits` stores periodic snapshots. Live computation deferred to PR-BILL-4.

### D-4: Subscription status machine: trial → active → cancelled | suspended → reactivated
Events table captures every transition with old/new values.

### D-5: No auto-suspension
Status changes are service calls, not cron jobs. Human approval required before suspension (per CPO spec).

### D-6: English tables, German FK columns — consistent with convention.

---

## Recommendation: Authorize. Proceed to IC-0045.

# ADR-0044 — Tenant Onboarding Plan

**Decision ID:** `ADR-0044`
**Date:** 2026-06-29
**Scope:** `CPO-SCOPE-PRCS1-TENANT-ONBOARDING-001`
**Branch:** `feat/pr-cs-1-tenant-onboarding-plan`

---

## Context

Construction companies adopting CHAMPE need structured onboarding: company profile, role setup, project creation, workflow activation, user training. Currently zero visibility into where a tenant is in this journey.

---

## Decisions

### D-1: Onboarding as a checklist plan, not a workflow engine

**Decision:** Tenant onboarding is a plan with categorized tasks. Task status is manually updated, not auto-detected.

**Rationale:** Auto-detection of setup completion requires scanning multiple tables — fragile and premature. Manual status + agent assistance (later PR) is sufficient.

### D-2: Task categories: setup, configuration, training, activation

**Decision:** Four standard categories cover the onboarding lifecycle.

```text
setup       — company profile, regions, currency, departments
configuration — roles, approval matrix, vendors, materials, cost codes, document templates
training    — role-specific training completed
activation  — workflow modules turned on, first project live
```

### D-3: Health score stored as snapshot, not computed live

**Decision:** `tenant_health_scores` is a snapshot table — scores are INSERTed periodically, not computed on read.

**Rationale:** Snapshots enable trend analysis over time. Live computation would require complex joins. Score calculation engine deferred to PR-CS-4.

### D-4: Usage snapshots are daily/weekly, not real-time

**Decision:** `tenant_usage_snapshots` captures periodic counts — active users, modules active, workflows completed.

**Rationale:** Real-time metrics require event sourcing. Snapshots are simpler to implement and sufficient for adoption tracking.

### D-5: Progress auto-derived from task completion

**Decision:** `plan.progress_pct` is set by the service when tasks are created/updated, not stored independently.

```typescript
progressPct = (completedTasks / totalTasks) * 100
```

### D-6: English tables, German FK columns — consistent with convention

---

## Recommendation

Authorize ADR-0044. Proceed to IC-0044.

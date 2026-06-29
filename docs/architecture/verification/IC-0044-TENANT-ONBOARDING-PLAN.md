# IC-0044 — Tenant Onboarding Plan Verification

**IC:** `IC-0044` | **ADR:** ADR-0044 | **Migration:** `0044_tenant_onboarding_plan.sql`

---

## Gates

### V-1: SQLite syntax
### V-2: 4 tables — tenant_onboarding_plans, tenant_onboarding_tasks, tenant_health_scores, tenant_usage_snapshots
### V-3: Task lifecycle — pending → in_progress → completed (blocked, skipped)
### V-4: Progress auto-calculation — 3/10 tasks completed → progress_pct = 30
### V-5: Health score write — insert snapshot with score + risk_flags
### V-6: Usage snapshot write — insert with active_users + modules_active
### V-7: Migration parity (SQLite = Postgres)
### V-8: Idempotency
### V-9: TypeScript: 0 new errors
### V-10: Zero existing table alterations

---

## Seed Data

Default onboarding tasks per new plan:
```text
setup:       company_profile, regions_currencies, departments
configuration: roles_assigned, approval_matrix, vendors_register, materials_catalogue, cost_codes, document_templates
training:    pm_training, qs_training, storekeeper_training, foreman_training
activation:  first_project, daily_work_active, ipc_workflow_active, executive_cockpit
```

---

## Rollback
```sql
DROP TABLE IF EXISTS tenant_usage_snapshots;
DROP TABLE IF EXISTS tenant_health_scores;
DROP TABLE IF EXISTS tenant_onboarding_tasks;
DROP TABLE IF EXISTS tenant_onboarding_plans;
```

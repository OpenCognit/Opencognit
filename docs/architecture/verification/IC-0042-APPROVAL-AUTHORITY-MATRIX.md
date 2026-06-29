# IC-0042 — IAM Approval Authority Matrix Verification

**Implementation Contract:** `IC-0042`
**Date:** 2026-06-29
**ADR:** ADR-0042
**Branch:** `feat/pr-iam-2-approval-authority-matrix`
**Migration:** `0042_approval_authority_matrix.sql`

---

## Verification Gates

### V-1: SQLite Syntax
```bash
sqlite3 :memory: < server/db/migrations/sqlite/0042_approval_authority_matrix.sql
.tables
# Expected: approval_thresholds, approval_workflows, approval_workflow_steps, approval_requests, approval_step_results
```

### V-2: Postgres Syntax
```bash
# Run against test PG instance
psql -f server/db/migrations/postgres/0042_approval_authority_matrix.sql
# No errors
```

### V-3: Table Structure
```sql
PRAGMA table_info(approval_thresholds);
-- Expected: id, unternehmen_id, role_id, module, action, max_amount, currency, beschreibung, erstellt_am, aktualisiert_am

PRAGMA table_info(approval_workflows);
-- Expected: id, unternehmen_id, name, module, beschreibung, ist_aktiv, erstellt_am, aktualisiert_am

PRAGMA table_info(approval_workflow_steps);
-- Expected: id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours, erstellt_am, aktualisiert_am

PRAGMA table_info(approval_requests);
-- Expected: id, unternehmen_id, workflow_id, source_module, source_record_id, source_record_type, amount, currency, current_step, status, requested_by, requested_am, abgeschlossen_am, erstellt_am, aktualisiert_am

PRAGMA table_info(approval_step_results);
-- Expected: id, request_id, step_order, role_id, reviewer_id, decision, kommentar, decided_am
```

### V-4: Threshold Routing — Within Limit
```typescript
// Given: payment_approval workflow, step 1 = PM (max 500,000)
// When: Request amount = 300,000
// Then: Starting step = 1 (PM is appropriate approver)
const startStep = approvalService.resolveStartStep(workflowId, 300000);
assert(startStep === 1);
```

### V-5: Threshold Routing — Auto-Escalate
```typescript
// Given: payment_approval workflow, step 1 = PM (max 500,000), step 2 = Director (max 5,000,000)
// When: Request amount = 2,000,000
// Then: Starting step = 2 (exceeds PM threshold)
const startStep = approvalService.resolveStartStep(workflowId, 2000000);
assert(startStep === 2);
```

### V-6: Threshold Routing — Catch-All
```typescript
// Given: payment_approval workflow, step 3 = tenant_admin (max NULL)
// When: Request amount = 10,000,000
// Then: Starting step = 3 (exceeds all previous thresholds)
const startStep = approvalService.resolveStartStep(workflowId, 10000000);
assert(startStep === 3);
```

### V-7: Self-Approval Blocked
```typescript
// Given: PM submits a payment for approval
// When: Same PM tries to review
// Then: Rejected with 'SELF_APPROVAL_DENIED'
const result = await approvalService.review({
  requestId,
  reviewerId: pmUserId,  // same as requested_by
  decision: 'approved',
});
assert(result.error === 'SELF_APPROVAL_DENIED');
```

### V-8: Multi-Step Completion → Approved
```typescript
// Given: 2-step workflow, both steps reviewed and approved
// When: Final step approved
// Then: Request status = 'approved', abgeschlossen_am set
const request = await approvalService.status(requestId);
assert(request.status === 'approved');
assert(request.abgeschlossen_am !== null);
```

### V-9: Any Step Rejection → Rejected
```typescript
// Given: 3-step workflow, step 2 reviewer rejects
// When: Review with decision='rejected'
// Then: Request status = 'rejected', no step 3 created
const request = await approvalService.status(requestId);
assert(request.status === 'rejected');
```

### V-10: Escalation Timeout
```typescript
// Given: Step 1 has auto_escalate_hours=24, no action taken
// When: 24h elapsed
// Then: Step 1 marked 'escalated', step 2 created
const request = await approvalService.status(requestId);
assert(request.current_step === 2);
const step1Result = getStepResult(requestId, 1);
assert(step1Result.decision === 'escalated');
```

### V-11: Cancellation
```typescript
// Given: In-progress approval request
// When: requested_by calls cancel()
// Then: Status = 'cancelled', no further steps possible
const request = await approvalService.cancel(requestId, pmUserId);
assert(request.status === 'cancelled');
```

### V-12: Revision Resubmission
```typescript
// Given: Rejected request
// When: requested_by resubmits with revision
// Then: New step 1 created, previous steps preserved
const request = await approvalService.resubmit(requestId, pmUserId);
assert(request.status === 'in_progress');
assert(request.steps.length >= 2); // previous + new
```

### V-13: Migration Parity
```bash
# Compare table names and column counts between SQLite and Postgres
diff <(grep "CREATE TABLE" server/db/migrations/sqlite/0042_approval_authority_matrix.sql | sort) \
     <(grep "CREATE TABLE" server/db/migrations/postgres/0042_approval_authority_matrix.sql | sort)
# No output = identical
```

### V-14: Idempotency
```bash
# Run migration twice — no errors on second run
sqlite3 :memory: < server/db/migrations/sqlite/0042_approval_authority_matrix.sql
sqlite3 :memory: < server/db/migrations/sqlite/0042_approval_authority_matrix.sql 2>&1
# No "already exists" errors
```

### V-15: TypeScript
```bash
npx tsc --noEmit
# 0 errors related to approval module
```

### V-16: Zero Existing Table Alterations
```bash
# Verify no ALTER TABLE statements in migration
grep -i "ALTER TABLE" server/db/migrations/sqlite/0042_approval_authority_matrix.sql
# No output
```

---

## Seed Data Specification

### Default Workflows
```sql
-- Payment Approval
INSERT INTO approval_workflows (id, unternehmen_id, name, module, erstellt_am, aktualisiert_am)
VALUES ('wf_payment_default', 'default', 'payment_approval', 'finance', datetime('now'), datetime('now'));

INSERT INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours, erstellt_am, aktualisiert_am)
VALUES
  ('ws_pay_1', 'wf_payment_default', 1, 'r_project_manager', 500000, 24, datetime('now'), datetime('now')),
  ('ws_pay_2', 'wf_payment_default', 2, 'r_director', 5000000, 48, datetime('now'), datetime('now')),
  ('ws_pay_3', 'wf_payment_default', 3, 'r_tenant_admin', NULL, 72, datetime('now'), datetime('now'));

-- IPC Certification
INSERT INTO approval_workflows (id, unternehmen_id, name, module, erstellt_am, aktualisiert_am)
VALUES ('wf_ipc_default', 'default', 'ipc_certification', 'ipc', datetime('now'), datetime('now'));

INSERT INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours, erstellt_am, aktualisiert_am)
VALUES
  ('ws_ipc_1', 'wf_ipc_default', 1, 'r_qs', 500000, 24, datetime('now'), datetime('now')),
  ('ws_ipc_2', 'wf_ipc_default', 2, 'r_project_manager', 2000000, 48, datetime('now'), datetime('now')),
  ('ws_ipc_3', 'wf_ipc_default', 3, 'r_director', 10000000, 72, datetime('now'), datetime('now')),
  ('ws_ipc_4', 'wf_ipc_default', 4, 'r_tenant_admin', NULL, 96, datetime('now'), datetime('now'));

-- Variation/Claim Approval
INSERT INTO approval_workflows (id, unternehmen_id, name, module, erstellt_am, aktualisiert_am)
VALUES ('wf_variation_default', 'default', 'variation_approval', 'variations', datetime('now'), datetime('now'));

INSERT INTO approval_workflow_steps (id, workflow_id, step_order, role_id, max_amount, auto_escalate_hours, erstellt_am, aktualisiert_am)
VALUES
  ('ws_var_1', 'wf_variation_default', 1, 'r_project_manager', 500000, 48, datetime('now'), datetime('now')),
  ('ws_var_2', 'wf_variation_default', 2, 'r_director', 5000000, 72, datetime('now'), datetime('now')),
  ('ws_var_3', 'wf_variation_default', 3, 'r_tenant_admin', NULL, 96, datetime('now'), datetime('now'));
```

---

## Middleware Contract

```typescript
// No new middleware required — approval is a service, not a gate
// Existing requirePermission ensures only authorized roles can review requests

// Example: IPC route
router.post('/api/ipc/:id/submit', 
  requireCompanyAccess,
  requirePermission('ipc', 'submit'),
  async (req, res) => {
    const request = await approvalService.submit({...});
    res.json(request);
  }
);

router.post('/api/approvals/:id/review',
  requireCompanyAccess,
  requirePermission(req.body.sourceModule, 'approve'), // or 'review'
  async (req, res) => {
    const result = await approvalService.review({...});
    res.json(result);
  }
);
```

---

## Pre-Prod Rollback Plan

```sql
DROP TABLE IF EXISTS approval_step_results;
DROP TABLE IF EXISTS approval_requests;
DROP TABLE IF EXISTS approval_workflow_steps;
DROP TABLE IF EXISTS approval_workflows;
DROP TABLE IF EXISTS approval_thresholds;
DELETE FROM migration_versions WHERE migration_id = '0042';
```

No data loss risk — greenfield tables only.

---

## Certification Criteria

All 16 gates must pass. Gate failures must include the failing SQL/TypeScript output.

# ADR-0042 — IAM Approval Authority Matrix

**Decision ID:** `ADR-0042`
**Date:** 2026-06-29
**Scope:** `CPO-SCOPE-PRIAM2-APPROVAL-MATRIX-001`
**Branch:** `feat/pr-iam-2-approval-authority-matrix`
**Depends on:** ADR-0041 (roles table must exist)
**Status:** Draft

---

## Context

PR-IAM-1 establishes the role/permission backbone but defers all approval logic. CHAMPE modules — IPC, finance, procurement, variations, claims — all require approval gating with monetary thresholds. Without an approval matrix, agent recommendations have no automated routing, and human approvals lack enforcement.

Decision point: How should approval authority be structured — as a fixed threshold matrix or as dynamic policy rules?

---

## Decisions

### D-1: Fixed threshold matrix, not dynamic policy engine

**Decision:** Approval limits are stored as role-level monetary thresholds per module, not as arbitrary policy rules.

**Rationale:**
- Construction approvals follow well-understood patterns (PM up to 500K, Director up to 5M, Admin unlimited)
- Dynamic policy engines add complexity without proportional value at this stage
- Fixed thresholds are auditable, testable, and predictable
- Policy engine (PR-IAM-4) can layer on top later

**Trade-off:** Less flexible than policy engine, but sufficient for current needs.

---

### D-2: Workflow-based escalation, not ad-hoc chains

**Decision:** Approval chains are defined as named workflows with ordered steps, not as ad-hoc chains created per request.

**Rationale:**
- Named workflows (payment_approval, ipc_certification, variation_claim) are reusable and business-meaningful
- Ad-hoc chains would require UI for chain construction — out of scope
- Ordered steps with per-step thresholds are simpler than dynamic routing
- Auto-escalation based on timeout is explicit in step definition

---

### D-3: Amount-based routing within workflow steps

**Decision:** For a given approval request with amount X, the starting step is determined by scanning workflow steps in order. If X exceeds a step's max_amount, the request auto-routes to the next step.

```text
Example: Payment Approval Workflow
  Step 1: project_manager | max 500,000
  Step 2: director         | max 5,000,000
  Step 3: tenant_admin     | max NULL

X = 300,000  → starts at Step 1 (PM)
X = 2,000,000 → auto-escalates to Step 2 (director)
X = 10,000,000 → auto-escalates to Step 3 (tenant_admin)
```

**Rationale:**
- Deterministic — same amount always routes to same starting step
- No guesswork about which role is appropriate
- NULL max_amount serves as catch-all for the most senior approver

---

### D-4: Status machine per request, not per step

**Decision:** The approval request has one status, not independent status per step.

```text
Valid states:
  in_progress → approved
  in_progress → rejected
  in_progress → cancelled
  rejected → in_progress (resubmitted with revision)
```

Each step records its own decision (`approved`, `rejected`, `requested_revision`, `escalated`) but the request status reflects the aggregate outcome.

**Rationale:**
- Simplifies querying: `WHERE status = 'in_progress'` finds all pending approvals
- Step-level decisions capture the full audit trail
- Any step rejection terminates the entire request

---

### D-5: No self-approval — enforced at service layer

**Decision:** Self-approval is blocked by rule, not by schema constraint. The approval service rejects any step where `reviewer_id = requested_by`.

**Rationale:**
- Schema-level CHECK can't reference another row easily
- Service-layer enforcement is testable and emits clear error messages
- Future delegation (PR-IAM-3) may require exceptions — easier to evolve code than DDL

---

### D-6: Escalation is explicit, not implicit

**Decision:** Auto-escalation creates an `escalated` step result before advancing. No silent step skipping.

**Rationale:**
- Clear audit trail — you can see that step 1 was escalated, not skipped
- Reviewer accountability — if PM ignored the request for 24h, the record shows it
- Helps identify bottlenecks in approval workflows

---

### D-7: Approval service as standalone module

**Decision:** The approval engine is a standalone `server/services/approval.ts` service, not embedded in individual module routes.

```typescript
interface ApprovalService {
  submit(params: SubmitRequest): ApprovalRequest;
  review(params: ReviewRequest): StepResult;
  status(requestId: string): ApprovalRequest;
  cancel(requestId: string, userId: string): void;
}
```

**Rationale:**
- IPC, finance, procurement, variations, claims all use the same approval pipeline
- Single source of truth for threshold logic, escalation, status machine
- Easier to test one service than N module integrations

---

### D-8: Migration safe for pre-IAM-1 databases

**Decision:** Migration `0042` references `roles(id)` but runs correctly regardless of whether PR-IAM-1 has been applied. If roles table doesn't exist, seed data is skipped — no foreign key violation.

**Rationale:**
- PR-IAM-1 is pending merge; can't assume it's present
- Migration namespacing: insert seed data only when FK targets exist
- In practice: PR-IAM-1 will be merged before PR-IAM-2, but migration is self-protective

**Implementation:** Use `INSERT OR IGNORE` (SQLite) / `INSERT ... ON CONFLICT DO NOTHING` (Postgres) — if roles table missing, FK at table creation time prevents the table itself from being created. Seed data only runs after table creation succeeds.

---

### D-9: English table names, German FK columns

**Decision:** Consistent with established convention (ADR-0039, ADR-0041).

```text
Tables:   approval_thresholds, approval_workflows, approval_workflow_steps,
          approval_requests, approval_step_results
FK cols:  unternehmen_id, erstellt_am, aktualisiert_am, beschreibung
PKs:      id TEXT (UUID)
```

---

## Consequences

| Pro | Con |
|---|---|
| Deterministic routing — same amount always same path | Fixed thresholds require DB migration to change limits |
| Single approval service for all modules | No dynamic delegation (held for PR-IAM-3) |
| Full audit trail per step | No parallel approval (held for future) |
| Clean 5-table schema | Depends on PR-IAM-1 roles table |
| Zero existing table alterations | — |

---

## Alternatives Considered

1. **ABAC policy engine:** Rejected — overengineered for KES 500K/5M threshold patterns. PR-IAM-4 can layer on later.
2. **Ad-hoc chains per request:** Rejected — requires UI for chain construction, adds complexity without value.
3. **Embedded approval in each module:** Rejected — duplicates threshold logic across IPC, finance, procurement.
4. **Parallel approval (two of N must approve):** Rejected — not needed at this stage. Sequential is sufficient.

---

## Recommendation

Authorize ADR-0042. Proceed to IC-0042 for verification strategy.

**Migration:** `0042_approval_authority_matrix.sql`
**PR target:** New PR from `feat/pr-iam-2-approval-authority-matrix` → `OpenCognit/opencognit:main`

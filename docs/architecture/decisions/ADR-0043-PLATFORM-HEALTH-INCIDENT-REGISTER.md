# ADR-0043 — Platform Health + Incident Register

**Decision ID:** `ADR-0043`
**Date:** 2026-06-29
**Scope:** `CPO-SCOPE-PROPS1-PLATFORM-HEALTH-001`
**Branch:** `feat/pr-ops-1-platform-health-incident-register`

---

## Context

CHAMPE has zero production observability. Errors are `console.error` in route handlers — invisible, unexplained, and unrecoverable. Agents, integrations, offline devices, payments, and approvals can all fail silently. PR-OPS-1 establishes the operational incident backbone.

---

## Decisions

### D-1: Health checks as periodic snapshots, not real-time stream

**Decision:** Health checks are INSERT-only records, not real-time streaming metrics.

**Rationale:**
- Periodic snapshots (heartbeat every 30-60s) are sufficient for detection
- Real-time streaming (WebSocket, SSE) adds infrastructure complexity without proportional value
- Snapshots are auditable, queryable, and trivially backfillable

---

### D-2: Incident state machine: open → investigating → mitigated → resolved → closed

**Decision:** Fixed state machine, not arbitrary status strings.

```
open → investigating → mitigated → resolved → closed
  ↓        ↓             ↓            ↓
  └──→ resolved (false alarm)
  └────────────────────────────→ closed (duplicate)
```

Any state can transition to `reopened` (except `closed` → requires new detection).

**Rationale:** Predictable lifecycle, queryable by status, prevents "zombie incidents" stuck in undefined states.

---

### D-3: P0-P4 severity, not custom labels

**Decision:** Standard 5-level severity: P0 (critical/data safety) to P4 (informational).

Per CPO spec:
```
P0 — production down / data safety / tenant leakage
P1 — major workflow blocked
P2 — degraded module / repeated failures
P3 — warning / performance
P4 — informational
```

---

### D-4: Error deduplication by module + route + error_type

**Decision:** Repeated identical errors increment `occurrence_count` on existing row instead of creating new rows.

**Rationale:**
- Prevents 10,000 identical 500 errors from creating 10,000 rows
- First seen / last seen timestamps capture the window
- `platform_error_logs` is an aggregate, not a raw log drain

---

### D-5: Release health as separate table, not embedded in incidents

**Decision:** `platform_release_health` is a standalone table tracking deployment health. Incidents can optionally reference a release.

**Rationale:**
- A release may be healthy (no incidents) or degraded (multiple incidents)
- Release health can be queried without joining incidents
- Enables post-release checks: "did error rate spike after deploy?"

---

### D-6: Agent alerts as recommendation-first, not incident-first

**Decision:** Agent-detected issues land in `platform_observability_alerts` as recommendations. Humans decide whether to create an incident.

**Rationale:**
- Aligned with agent governance (level 4: request_approval)
- Agent recommends, human decides
- Alert → incident linking via `link_incident_id`

---

### D-7: English table names, German FK/timestamp columns

**Decision:** Consistent with convention.

```
Tables:   platform_health_checks, platform_incidents, platform_incident_events,
          platform_error_logs, platform_release_health, platform_observability_alerts
FK cols:  unternehmen_id, erstellt_am, aktualisiert_am, beschreibung
PKs:      id TEXT (UUID)
```

---

### D-8: Migration safe — zero dependencies on other migrations

**Decision:** Migration 0043 has zero FK references to tables from PR-IAM-1, PR-IAM-2, G-003, or PR2B-4. Standalone greenfield.

**Rationale:** PR-OPS-1 must boot regardless of which other PRs have been merged. No merge-order dependency.

---

### D-9: Service functions, not middleware

**Decision:** Operations functions (healthCheck, createIncident, logError) are service functions, not Express middleware. They are called inline in routes, not injected via `app.use()`.

```typescript
// In route handler
import { opsService } from '../services/operations';

try {
  // ... route logic
} catch (err) {
  await opsService.logError({
    module: 'ipc',
    route: '/api/ipc/:id/submit',
    errorType: err.name,
    errorMessage: err.message,
    statusCode: 500,
  });
  throw err;
}
```

**Rationale:** Middleware catches all errors generically but loses module/route context. Inline calls preserve context.

---

## Consequences

| Pro | Con |
|---|---|
| 6 greenfield tables, zero dependencies | No UI dashboard (held for later) |
| Incident lifecycle is auditable | Not real-time streaming |
| Error deduplication prevents log spam | Requires periodic cleanup of stale error rows |
| Agent alerts respect human-in-the-loop governance | Not auto-mitigation |
| Release health enables regression detection | Requires manual release registration |

---

## Recommendation

Authorize ADR-0043. Proceed to IC-0043 for verification strategy.

**Migration:** `0043_platform_health_incident_register.sql`

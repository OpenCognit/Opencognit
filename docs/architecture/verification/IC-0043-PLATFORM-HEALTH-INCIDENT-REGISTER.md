# IC-0043 — Platform Health + Incident Register Verification

**Implementation Contract:** `IC-0043`
**Date:** 2026-06-29
**ADR:** ADR-0043
**Branch:** `feat/pr-ops-1-platform-health-incident-register`
**Migration:** `0043_platform_health_incident_register.sql`

---

## Verification Gates

### V-1: SQLite Syntax
```bash
sqlite3 :memory: < server/db/migrations/sqlite/0043_platform_health_incident_register.sql
.tables
# Expected: platform_health_checks, platform_incidents, platform_incident_events,
#           platform_error_logs, platform_release_health, platform_observability_alerts
```

### V-2: Postgres Syntax
```bash
psql -f server/db/migrations/postgres/0043_platform_health_incident_register.sql
# No errors
```

### V-3: Incident Lifecycle
```typescript
// Given: New incident created with severity=P2, status='open'
// When: Transition through lifecycle
// Then: Each transition records a platform_incident_event

const incident = await opsService.createIncident({
  title: 'GRN route returning 500',
  severity: 'P2',
  affectedModule: 'procurement',
  affectedProjectId: 'proj-1',
  detectedBy: 'health_check',
});

await opsService.updateIncident(incident.id, { status: 'investigating', owner: 'eng-team' });
// → event_type: 'investigating'

await opsService.updateIncident(incident.id, { status: 'mitigated' });
// → event_type: 'mitigated'

await opsService.updateIncident(incident.id, { status: 'resolved' });
// → event_type: 'resolved'
// → incident.resolved_am set
```

### V-4: Error Deduplication
```typescript
// Given: Error logged for route /api/ipc, errorType=ValidationError
// When: Same error logged again (same module, route, errorType)
// Then: occurrence_count incremented, first_seen unchanged, last_seen updated

await opsService.logError({ module: 'ipc', route: '/api/ipc', errorType: 'ValidationError', errorMessage: 'missing field' });
await opsService.logError({ module: 'ipc', route: '/api/ipc', errorType: 'ValidationError', errorMessage: 'missing field' });

const errors = db.select().from(platformErrorLogs).all();
assert(errors.length === 1);
assert(errors[0].occurrenceCount === 2);
assert(errors[0].firstSeenAm === errors[0].lastSeenAm); // same second
```

### V-5: Error Uniqueness (Different Error Types)
```typescript
// Given: Two different errors on same route
// When: Both logged
// Then: Two separate rows

await opsService.logError({ module: 'ipc', route: '/api/ipc', errorType: 'ValidationError', errorMessage: 'missing field' });
await opsService.logError({ module: 'ipc', route: '/api/ipc', errorType: 'DatabaseError', errorMessage: 'connection refused' });

const errors = db.select().from(platformErrorLogs).all();
assert(errors.length === 2);
```

### V-6: Release Health Tracking
```typescript
// Given: New release deployed
// When: Errors spike → regression detected
// Then: release status = 'degraded', rollback_recommended = 1

await opsService.registerRelease({
  version: 'v2.3.1',
  commitSha: 'abc123',
});

// Simulate 50 errors in 5 minutes
for (let i = 0; i < 50; i++) {
  await opsService.logError({ module: 'procurement', route: '/api/grn', errorType: 'DatabaseError', errorMessage: 'constraint violation', releaseId: 'rel-1' });
}

await opsService.detectRegression('rel-1');

const release = db.select().from(platformReleaseHealth).where(eq(platformReleaseHealth.id, 'rel-1')).get();
assert(release.errorSpikeDetected === 1);
assert(release.status === 'degraded');
```

### V-7: Agent Alert → Incident Link
```typescript
// Given: Agent detects issue, creates alert
// When: Human creates incident from alert
// Then: alert.linkIncidentId set

const alert = await opsService.createAlert({
  agentId: 'agent-claims',
  issue: 'Claims Agent failed to scan 4 projects',
  severity: 'P3',
  evidence: JSON.stringify({ projects: ['p1', 'p2', 'p3', 'p4'] }),
  suspectedCause: 'Missing contract clause mapping',
  recommendedAction: 'Notify Contracts Manager',
});

const incident = await opsService.createIncident({
  title: alert.issue,
  severity: alert.severity,
  linkAlertId: alert.id,
});

const updatedAlert = db.select().from(platformObservabilityAlerts).where(eq(platformObservabilityAlerts.id, alert.id)).get();
assert(updatedAlert.linkIncidentId === incident.id);
```

### V-8: Migration Parity
```bash
diff <(grep "CREATE TABLE" server/db/migrations/sqlite/0043_platform_health_incident_register.sql | sort) \
     <(grep "CREATE TABLE" server/db/migrations/postgres/0043_platform_health_incident_register.sql | sort)
# No output = identical tables
```

### V-9: Idempotency
```bash
sqlite3 :memory: < server/db/migrations/sqlite/0043_platform_health_incident_register.sql
sqlite3 :memory: < server/db/migrations/sqlite/0043_platform_health_incident_register.sql 2>&1
# No errors
```

### V-10: TypeScript
```bash
npx tsc --noEmit
# 0 errors from new code
```

### V-11: Zero Existing Table Alterations
```bash
grep -i "ALTER TABLE" server/db/migrations/sqlite/0043_platform_health_incident_register.sql
# No output
```

---

## Middleware Contract

```typescript
// No new middleware. Service functions called inline in routes.
// Example:

import { opsService } from '../services/operations';

router.post('/api/ipc/:id/submit',
  requireCompanyAccess,
  requirePermission('ipc', 'submit'),
  async (req, res) => {
    try {
      const result = await ipcService.submit(req.params.id, req.body);
      res.json(result);
    } catch (err: any) {
      await opsService.logError({
        module: 'ipc',
        route: '/api/ipc/:id/submit',
        errorType: err.constructor?.name || 'Error',
        errorMessage: err.message,
        stackTrace: err.stack,
        statusCode: 500,
        affectedTenantId: req.companyMembership?.companyId,
        affectedUserId: req.users?.userId,
      });
      res.status(500).json({ error: 'Internal server error', code: 'IPC_SUBMIT_FAILED' });
    }
  }
);
```

---

## Pre-Prod Rollback Plan

```sql
DROP TABLE IF EXISTS platform_observability_alerts;
DROP TABLE IF EXISTS platform_incident_events;
DROP TABLE IF EXISTS platform_incidents;
DROP TABLE IF EXISTS platform_error_logs;
DROP TABLE IF EXISTS platform_release_health;
DROP TABLE IF EXISTS platform_health_checks;
DELETE FROM migration_versions WHERE migration_id = '0043';
```

No data loss risk — greenfield tables only.

---

## Certification Criteria

All 11 gates must pass.

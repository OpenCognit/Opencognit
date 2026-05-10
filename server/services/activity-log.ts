// =============================================================================
// Activity-log helper — extracted from server/index.ts so route modules can
// log activity without depending on the index module.
//
// Broadcast: relies on the existing appEvents bus (index.ts already
// subscribes 'broadcast' → websocket fan-out), so this module has no direct
// websocket dependency.
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client.js';
import { activityLog } from '../db/schema.js';
import { appEvents } from '../events.js';

const now = () => new Date().toISOString();

export function logAktivitaet(
  unternehmenId: string,
  akteurTyp: 'agent' | 'board' | 'system',
  akteurId: string,
  akteurName: string,
  aktion: string,
  entitaetTyp: string,
  entitaetId: string,
  details?: any,
) {
  const activity = {
    id: uuid(),
    companyId: unternehmenId,
    actorType: akteurTyp,
    actorId: akteurId,
    actorName: akteurName,
    action: aktion,
    entityType: entitaetTyp,
    entityId: entitaetId,
    details: details ? JSON.stringify(details) : null,
    createdAt: now(),
  };
  db.insert(activityLog).values(activity).run();
  appEvents.emit('broadcast', { type: 'activity', data: activity });
}

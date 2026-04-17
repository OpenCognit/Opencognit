// Heartbeat — backward-compatible facade
// All logic lives in ./heartbeat/ sub-modules.

export type { HeartbeatInvocationSource, HeartbeatOptions, HeartbeatRun, HeartbeatService } from './heartbeat/types.js';
export {
  heartbeatService,
  executeHeartbeat,
  processPendingWakeups,
  getHeartbeatRun,
  updateHeartbeatStatus,
  recordHeartbeatUsage,
} from './heartbeat/service.js';

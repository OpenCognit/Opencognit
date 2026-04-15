import { EventEmitter } from 'events';

// Shared event bus — used to broadcast updates to SSE clients
// without creating circular imports between index.ts and services.
export const appEvents = new EventEmitter();
appEvents.setMaxListeners(50);

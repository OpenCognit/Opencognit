// Barrel export for the unified MemoryService. Consumers should import from
// here rather than reaching into ./service.ts directly.

export { memoryService, type MemoryService } from './service.js';
export type {
  RecallParams, RecallResult,
  RememberParams,
  ForgetTarget,
  ImproveParams, ImproveResult,
} from './types.js';

// Heartbeat Types — shared interfaces and enums

export type HeartbeatInvocationSource = 'on_demand' | 'timer' | 'assignment' | 'automation';

export interface HeartbeatOptions {
  invocationSource: HeartbeatInvocationSource;
  triggerDetail: string;
  contextSnapshot?: {
    issueId?: string;
    wakeReason?: string;
    wakeCommentId?: string;
    [key: string]: unknown;
  };
  payload?: {
    meetingId?: string;
    thema?: string;
    [key: string]: unknown;
  };
}

export interface HeartbeatRun {
  id: string;
  companyId: string;
  agentId: string;
  status: string;
  invocationSource: string;
  triggerDetail: string;
  contextSnapshot: any;
}

export interface HeartbeatService {
  /**
   * Create a new heartbeat run and execute it
   */
  executeHeartbeat(agentId: string, companyId: string, options: HeartbeatOptions): Promise<string>;

  /**
   * Process all pending wakeups for an agent
   */
  processPendingWakeups(agentId: string): Promise<number>;

  /**
   * Get heartbeat run by ID
   */
  getRun(runId: string): Promise<HeartbeatRun | null>;

  /**
   * Update run status
   */
  updateRunStatus(runId: string, status: string, extra?: Record<string, any>): Promise<void>;

  /**
   * Run Critic/Evaluator review for a completed task output
   */
  runCriticReview(taskId: string, taskTitel: string, taskBeschreibung: string, output: string, agentId: string, companyId: string): Promise<{ approved: boolean; feedback: string; escalate?: boolean }>;

  /**
   * Record usage/costs for a run
   */
  recordUsage(runId: string, usage: { inputTokens: number; outputTokens: number; costCents: number }): Promise<void>;
}

// =============================================================================
// Approval Service — PR-IAM-2 Approval Authority Matrix
// =============================================================================
// Handles approval request lifecycle:
//   1. Submit request → routes to correct workflow step based on amount
//   2. Review request → approve/reject/escalate individual steps
//   3. Status check → aggregate step outcomes into request status
//   4. Cancel → terminate in-progress request
//   5. Resubmit → re-open a rejected request with revision
//
// Business rules:
//   - Self-approval denied (reviewer_id ≠ requested_by)
//   - Any step rejection terminates entire request
//   - Escalation creates explicit step result before advancing
//   - Multi-step workflow: all steps must complete for full approval
// =============================================================================

import { v4 as uuid } from 'uuid';
import { db } from '../db/client';
import {
  approvalRequests,
  approvalStepResults,
  approvalWorkflows,
  approvalWorkflowSteps,
} from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ApprovalRequest = InferSelectModel<typeof approvalRequests>;
export type ApprovalStepResult = InferSelectModel<typeof approvalStepResults>;

export interface SubmitRequest {
  unternehmenId: string;
  workflowName: string;        // e.g., 'payment_approval'
  sourceModule: string;
  sourceRecordId: string;
  sourceRecordType: string;
  amount: number;
  currency?: string;
  requestedBy: string;         // user ID
}

export interface ReviewRequest {
  requestId: number;
  reviewerId: string;          // user ID
  decision: 'approved' | 'rejected' | 'requested_revision';
  comment?: string;
}

export interface StatusResult {
  request: ApprovalRequest;
  steps: ApprovalStepResult[];
  pendingStep: number | null;
  nextReviewerRole: string | null;
}

export interface ServiceError {
  error: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const approvalService = {
  // -------------------------------------------------------------------------
  // 1. Submit an approval request
  // -------------------------------------------------------------------------
  async submit(params: SubmitRequest): Promise<ApprovalRequest | ServiceError> {
    // Look up workflow by name+module
    const workflow = db
      .select()
      .from(approvalWorkflows)
      .where(
        and(
          eq(approvalWorkflows.name, params.workflowName),
          eq(approvalWorkflows.module, params.sourceModule),
          eq(approvalWorkflows.istAktiv, true),
        )
      )
      .get();

    if (!workflow) {
      return {
        error: `No active workflow "${params.workflowName}" for module "${params.sourceModule}".`,
        code: 'WORKFLOW_NOT_FOUND',
      };
    }

    // Resolve starting step based on amount
    const startStep = this.resolveStartStep(workflow.id, params.amount);

    // Insert request
    const request: typeof approvalRequests.$inferInsert = {
      unternehmenId: params.unternehmenId,
      workflowId: workflow.id,
      sourceModule: params.sourceModule,
      sourceRecordId: params.sourceRecordId,
      sourceRecordType: params.sourceRecordType,
      amount: params.amount,
      currency: params.currency || 'KES',
      currentStep: startStep.stepOrder,
      status: 'in_progress',
      requestedBy: params.requestedBy,
    };

    return db.insert(approvalRequests).values(request).returning().get();
  },

  // -------------------------------------------------------------------------
  // 2. Review (approve/reject) a step
  // -------------------------------------------------------------------------
  async review(params: ReviewRequest): Promise<ApprovalStepResult | ServiceError> {
    const request = db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, params.requestId))
      .get();

    if (!request) {
      return { error: 'Request not found.', code: 'REQUEST_NOT_FOUND' };
    }
    if (request.status !== 'in_progress') {
      return { error: `Request is ${request.status}.`, code: 'NOT_IN_PROGRESS' };
    }
    if (request.requestedBy === params.reviewerId) {
      return { error: 'Approver cannot be the requester.', code: 'SELF_APPROVAL_DENIED' };
    }

    // Find current step definition
    const stepDef = this.getStepDef(request.workflowId, request.currentStep);
    if (!stepDef) {
      return { error: 'Invalid workflow step.', code: 'INVALID_STEP' };
    }

    // Record step result
    const stepResult: typeof approvalStepResults.$inferInsert = {
      requestId: request.id,
      stepOrder: request.currentStep,
      roleId: stepDef.roleId,
      reviewerId: params.reviewerId,
      decision: params.decision,
      kommentar: params.comment || null,
    };

    const result = db.insert(approvalStepResults).values(stepResult).returning().get();

    // Update request status
    if (params.decision === 'rejected') {
      db.update(approvalRequests)
        .set({ status: 'rejected', aktualisiertAm: new Date().toISOString() })
        .where(eq(approvalRequests.id, params.requestId))
        .run();
    } else if (params.decision === 'approved') {
      this.advanceAfterApproval(request);
    } else {
      // requested_revision — stays at current step
    }

    return result;
  },

  // -------------------------------------------------------------------------
  // 3. Advance to next step after approval
  // -------------------------------------------------------------------------
  advanceAfterApproval(request: ApprovalRequest): void {
    const nextStep = this.getNextStep(request.workflowId, request.currentStep);

    if (nextStep) {
      // Advance to next step
      db.update(approvalRequests)
        .set({
          currentStep: nextStep.stepOrder,
          aktualisiertAm: new Date().toISOString(),
        })
        .where(eq(approvalRequests.id, request.id))
        .run();
    } else {
      // No more steps — fully approved
      db.update(approvalRequests)
        .set({
          status: 'approved',
          abgeschlossenAm: new Date().toISOString(),
          aktualisiertAm: new Date().toISOString(),
        })
        .where(eq(approvalRequests.id, request.id))
        .run();
    }
  },

  // -------------------------------------------------------------------------
  // 4. Get request status with step details
  // -------------------------------------------------------------------------
  status(requestId: number): StatusResult | ServiceError {
    const request = db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId))
      .get();

    if (!request) {
      return { error: 'Request not found.', code: 'REQUEST_NOT_FOUND' };
    }

    const steps = db
      .select()
      .from(approvalStepResults)
      .where(eq(approvalStepResults.requestId, requestId))
      .orderBy(asc(approvalStepResults.stepOrder))
      .all();

    const pendingDef = request.status === 'in_progress'
      ? this.getStepDef(request.workflowId, request.currentStep)
      : null;

    return {
      request,
      steps,
      pendingStep: pendingDef ? pendingDef.stepOrder : null,
      nextReviewerRole: pendingDef ? pendingDef.roleId : null,
    };
  },

  // -------------------------------------------------------------------------
  // 5. Cancel a request (only by requester)
  // -------------------------------------------------------------------------
  cancel(requestId: number, userId: string): ApprovalRequest | ServiceError {
    const request = db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId))
      .get();

    if (!request) {
      return { error: 'Request not found.', code: 'REQUEST_NOT_FOUND' };
    }
    if (request.status !== 'in_progress') {
      return { error: `Request is already ${request.status}.`, code: 'NOT_IN_PROGRESS' };
    }
    if (request.requestedBy !== userId) {
      return { error: 'Only the requester can cancel.', code: 'NOT_REQUESTER' };
    }

    return db
      .update(approvalRequests)
      .set({ status: 'cancelled', aktualisiertAm: new Date().toISOString() })
      .where(eq(approvalRequests.id, requestId))
      .returning()
      .get();
  },

  // -------------------------------------------------------------------------
  // 6. Resubmit a rejected request
  // -------------------------------------------------------------------------
  resubmit(requestId: number, userId: string): ApprovalRequest | ServiceError {
    const request = db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId))
      .get();

    if (!request) {
      return { error: 'Request not found.', code: 'REQUEST_NOT_FOUND' };
    }
    if (request.status !== 'rejected') {
      return { error: 'Only rejected requests can be resubmitted.', code: 'NOT_REJECTED' };
    }
    if (request.requestedBy !== userId) {
      return { error: 'Only the requester can resubmit.', code: 'NOT_REQUESTER' };
    }

    // Restart from step 1
    return db
      .update(approvalRequests)
      .set({
        status: 'in_progress',
        currentStep: 1,
        abgeschlossenAm: null,
        aktualisiertAm: new Date().toISOString(),
      })
      .where(eq(approvalRequests.id, requestId))
      .returning()
      .get();
  },

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  resolveStartStep(workflowId: number, amount: number): { stepOrder: number; roleId: string } {
    const steps = db
      .select()
      .from(approvalWorkflowSteps)
      .where(eq(approvalWorkflowSteps.workflowId, workflowId))
      .orderBy(asc(approvalWorkflowSteps.stepOrder))
      .all();

    for (const step of steps) {
      // Start at the first step where amount <= max_amount (or max is NULL = catch-all)
      if (step.maxAmount === null || amount <= step.maxAmount) {
        return { stepOrder: step.stepOrder, roleId: step.roleId };
      }
    }

    // Fallback: first step (shouldn't reach here if workflow has catch-all)
    return { stepOrder: steps[0].stepOrder, roleId: steps[0].roleId };
  },

  getStepDef(workflowId: number, stepOrder: number) {
    return db
      .select()
      .from(approvalWorkflowSteps)
      .where(
        and(
          eq(approvalWorkflowSteps.workflowId, workflowId),
          eq(approvalWorkflowSteps.stepOrder, stepOrder),
        )
      )
      .get();
  },

  getNextStep(workflowId: number, currentStepOrder: number) {
    return db
      .select()
      .from(approvalWorkflowSteps)
      .where(
        and(
          eq(approvalWorkflowSteps.workflowId, workflowId),
          eq(approvalWorkflowSteps.stepOrder, currentStepOrder + 1),
        )
      )
      .get();
  },
};

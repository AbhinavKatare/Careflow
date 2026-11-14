import { z } from "zod";

/**
 * Validated Case Status State Machine.
 * States:
 *   RECEIVED -> PROCESSING -> (NEEDS_REVIEW | DRAFT_READY | PROCESSING_FAILED)
 *   DRAFT_READY -> (APPROVED_SIMULATED | REJECTED | NEEDS_REVIEW)
 *   NEEDS_REVIEW -> (APPROVED_SIMULATED | REJECTED | DRAFT_READY)
 *   PROCESSING_FAILED -> (PROCESSING | NEEDS_REVIEW)
 *   APPROVED_SIMULATED: Terminal
 *   REJECTED: Terminal
 */
export const CaseStatusEnum = z.enum([
  "RECEIVED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "DRAFT_READY",
  "APPROVED_SIMULATED",
  "REJECTED",
  "PROCESSING_FAILED",
]);

export type CaseStatus = z.infer<typeof CaseStatusEnum>;

export class InvalidStateTransitionError extends Error {
  readonly currentStatus: CaseStatus;
  readonly targetStatus: CaseStatus;

  constructor(currentStatus: CaseStatus, targetStatus: CaseStatus) {
    super(`Illegal state transition from ${currentStatus} to ${targetStatus}`);
    this.name = "InvalidStateTransitionError";
    this.currentStatus = currentStatus;
    this.targetStatus = targetStatus;
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

export const ALLOWED_CASE_TRANSITIONS: Record<CaseStatus, ReadonlySet<CaseStatus>> = {
  RECEIVED: new Set(["PROCESSING"]),
  PROCESSING: new Set(["NEEDS_REVIEW", "DRAFT_READY", "PROCESSING_FAILED"]),
  DRAFT_READY: new Set(["NEEDS_REVIEW", "APPROVED_SIMULATED", "REJECTED"]),
  NEEDS_REVIEW: new Set(["DRAFT_READY", "APPROVED_SIMULATED", "REJECTED"]),
  APPROVED_SIMULATED: new Set(), // Terminal
  REJECTED: new Set(),           // Terminal
  PROCESSING_FAILED: new Set(["PROCESSING", "NEEDS_REVIEW"]),
};

/**
 * Validates that a transition between statuses is legal according to policy.
 * Throws InvalidStateTransitionError if the transition is prohibited.
 */
export function validateTransition(current: CaseStatus, target: CaseStatus): void {
  const allowed = ALLOWED_CASE_TRANSITIONS[current];
  if (!allowed || !allowed.has(target)) {
    throw new InvalidStateTransitionError(current, target);
  }
}

/**
 * Executes a state transition, returning the new status if legal.
 */
export function transitionCaseStatus(current: CaseStatus, target: CaseStatus): CaseStatus {
  validateTransition(current, target);
  return target;
}


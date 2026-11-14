/**
 * Staged Activation Ladder Types.
 * Stages: Draft -> Evaluated -> Shadowed -> Reviewed-by-all -> Active.
 * PERMANENT RULE: Pure deterministic TypeScript; zero external side effects.
 */

import type { WorkflowSpec } from "../../shared/domain/types";

export type ActivationStage =
  | "Draft"
  | "Evaluated"
  | "Shadowed"
  | "Reviewed-by-all"
  | "Active";

export const ACTIVATION_STAGES: ActivationStage[] = [
  "Draft",
  "Evaluated",
  "Shadowed",
  "Reviewed-by-all",
  "Active",
];

export interface GateCheckResult {
  gate: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ReviewerSignOff {
  reviewerId: string;
  role: string;
  signedAt: string;
  simulated: true;
  notes?: string;
}

export interface LadderState {
  proposalId: string;
  specVersion: string;
  currentStage: ActivationStage;
  evaluatedSpecHash: string | null;
  shadowedSpecHash: string | null;
  activeSpecHash: string | null;
  signOffs: ReviewerSignOff[];
  gatesHistory: Record<string, GateCheckResult[]>;
  lastResetReason?: string;
  updatedAt: string;
  createdAt: string;
}

export interface TransitionStageRequest {
  proposalId: string;
  targetStage: ActivationStage;
  spec: WorkflowSpec;
  actor?: string;
  notes?: string;
}

export interface StageTransitionResponse {
  success: boolean;
  previousStage: ActivationStage;
  newStage: ActivationStage;
  gates: GateCheckResult[];
  state: LadderState;
  errorMessage?: string;
}

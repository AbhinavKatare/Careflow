/**
 * Case Replay & Bulk Evaluation Types.
 * Enables deterministic replay of past cases and delta analysis against candidate specifications.
 * PERMANENT RULE: Pure deterministic TypeScript; zero external side effects.
 */

import type { ExtractedFact, WorkflowSpec } from "../../shared/domain/types";
import type { PolicyRoute } from "../../shared/policy/types";
import type { CheckInSubmission, PipelineSpan, PipelineTrace } from "../pipeline/types";

export interface ExecutionRunRecord {
  caseId: string;
  specHash: string;
  specVersion: string;
  promptVersion: string;
  modelId: string;
  modelTier: "small" | "strong";
  rawInput: CheckInSubmission;
  redactedInputs: {
    redactedText: string;
    tokenMap: Record<string, string>;
    patientId: string;
  };
  extractedFacts: ExtractedFact[];
  firedRules: Array<{ id: string; description: string; route: PolicyRoute; reason_code: string }>;
  route: PolicyRoute;
  reasonCode: string;
  draft: string | null;
  trace: PipelineTrace;
  createdAt: string;
}

export interface ReplayCaseOptions {
  targetSpec?: WorkflowSpec;
  targetPromptVersion?: string;
  targetModelTier?: "small" | "strong";
}

export interface CaseReplayRunSummary {
  specHash: string;
  specVersion: string;
  promptVersion: string;
  modelTier: string;
  extractedFacts: ExtractedFact[];
  firedRules: Array<{ id: string; description: string; route: PolicyRoute; reason_code: string }>;
  route: PolicyRoute;
  reasonCode: string;
  draft: string | null;
  trace: PipelineTrace;
}

export interface CaseReplayDiff {
  caseId: string;
  baseline: CaseReplayRunSummary;
  candidate: CaseReplayRunSummary;
  diff: {
    extractionChanged: boolean;
    addedFacts: ExtractedFact[];
    removedFacts: ExtractedFact[];
    rulesFiredChanged: boolean;
    addedFiredRules: string[];
    removedFiredRules: string[];
    routeChanged: boolean;
    severityChange: "UNCHANGED" | "ESCALATED" | "SEVERITY_LOWERED";
    isSeverityLowering: boolean;
    draftChanged: boolean;
    draftDiffText: string;
  };
  traceWaterfall: {
    baselineSpans: PipelineSpan[];
    candidateSpans: PipelineSpan[];
  };
}

export interface BulkReplayCaseChange {
  caseId: string;
  patientName: string;
  baselineRoute: PolicyRoute;
  candidateRoute: PolicyRoute;
  changeType: "ESCALATED" | "SEVERITY_LOWERED";
  isSeverityLowering: boolean;
  baselineReason: string;
  candidateReason: string;
  firedRulesDelta: { added: string[]; removed: string[] };
  warning?: string;
}

export interface BulkReplayReport {
  id: string;
  candidateSpecHash: string;
  candidateSpecVersion: string;
  totalCasesReplayed: number;
  unchangedCount: number;
  escalatedCount: number;
  severityLoweredCount: number;
  routeTransitionMatrix: Record<string, number>;
  routeChanges: BulkReplayCaseChange[];
  generatedAt: string;
}


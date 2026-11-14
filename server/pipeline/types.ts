/**
 * Type definitions for the Check-In Workflow Pipeline.
 * PERMANENT RULES:
 * - Plain typed functions, no agent framework.
 * - Any step failure ends in PROCESSING_FAILED with a visible reason.
 * - Tracing contains non-sensitive attributes only (NEVER record patient text).
 * - Zero outbound actions.
 */

import { z } from "zod";
import { CaseStatus } from "../../shared/domain/state-machine";
import { AuditEvent, ExtractedFact } from "../../shared/domain/types";
import { PolicyRoute } from "../../shared/policy/types";

// ==========================================
// 1. INPUT SUBMISSION SCHEMA
// ==========================================

export const CheckInSubmissionSchema = z.object({
  patientId: z.string().min(1, "patientId is required"),
  patientName: z.string().optional().default("Demo Patient 001"),
  programName: z.string().optional().default("Weekly check-in"),
  weekStatus: z.string().min(1, "weekStatus is required"),
  followUp: z.union([z.string(), z.boolean()]).optional().default("no"),
  note: z.string().optional().default(""),
  idempotencyKey: z.string().optional(),
  draftCandidate: z.string().optional(),
});

export type CheckInSubmission = z.infer<typeof CheckInSubmissionSchema>;

// ==========================================
// 2. STEP RESULTS
// ==========================================

export interface ValidationStepResult {
  valid: boolean;
  errorMessage?: string;
  cleanedNote?: string;
}

export interface RedactionStepResult {
  redactedText: string;
  tokenMap: Record<string, string>; // Reversible token map kept server-side only
  containsInstructionLikeText: boolean;
  detectedPatterns: string[];
  redactionCount: number;
}

export interface OffendingSpan {
  start: number;
  end: number;
  text: string;
}

export interface DraftCheckItem {
  checkId:
    | "NO_DIAGNOSIS_LANGUAGE"
    | "NO_TREATMENT_RECOMMENDATION"
    | "NO_ACTION_CLAIM"
    | "FACT_GROUNDING_TRACEABLE"
    | "NO_CROSS_PATIENT_DATA"
    | "NO_EMERGENCY_MONITORING_IMPLICATION";
  name: string;
  passed: boolean;
  offendingSpan?: OffendingSpan;
  detail?: string;
}

export interface DraftCheckStepResult {
  passed: boolean;
  blocked: boolean;
  targetRoute?: PolicyRoute;
  violationCode?: string;
  violationDetail?: string;
  offendingSpan?: OffendingSpan;
  checks?: DraftCheckItem[];
}

// ==========================================
// 3. LIGHTWEIGHT TRACING
// ==========================================

export type PipelineStepName =
  | "validate"
  | "sanitize_redact"
  | "extract"
  | "policy"
  | "draft"
  | "draft_check"
  | "persist"
  | "audit";

export interface PipelineSpan {
  spanId: string;
  name: PipelineStepName;
  startTimeMs: number;
  durationMs: number;
  status: "OK" | "ERROR";
  errorMessage?: string;
  // Non-sensitive operational attributes ONLY. NEVER record patient text!
  attributes: Record<string, string | number | boolean>;
}

export interface PipelineTrace {
  traceId: string;
  caseId: string;
  status: "SUCCESS" | "FAILED";
  startTimeMs: number;
  totalDurationMs: number;
  spans: PipelineSpan[];
  errorReason?: string;
}

// ==========================================
// 4. OVERALL PIPELINE RESULT
// ==========================================

export interface PipelineResult {
  caseId: string;
  status: CaseStatus;
  route: PolicyRoute;
  reasonCode: string;
  reason: string;
  draft: string | null;
  extractedFacts: ExtractedFact[];
  firedRules?: Array<{ id: string; description: string; route: PolicyRoute; reason_code: string }>;
  trace: PipelineTrace;
  redactedPreview?: string;
  tokenMap?: Record<string, string>;
  errorReason?: string;
  auditEvents: AuditEvent[];
  stepDurations: Record<string, number>;
}


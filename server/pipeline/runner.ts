/**
 * Check-In Workflow Pipeline Orchestrator.
 * Explicit typed pipeline: validate -> sanitize/redact -> extract -> policy -> draft -> draft_check -> persist -> audit.
 *
 * PERMANENT RULES:
 * - Plain typed functions, no agent framework.
 * - Any step failure yields PROCESSING_FAILED with a visible reason, never a success-looking state.
 * - LLM extraction is advisory input; policy strictly owns the route.
 * - The draft checker is deterministic and fails drafts with clinical or outbound action claims.
 * - Lightweight tracing with measured step durations and non-sensitive attributes only. Never log patient text.
 * - Zero outbound actions.
 */

import { CaseStatus } from "../../shared/domain/state-machine";
import { AuditEvent, ExtractedFact, WorkflowSpec } from "../../shared/domain/types";
import { defaultWorkflowSpec } from "../../shared/policy/default-spec";
import { PolicyRoute } from "../../shared/policy/types";
import { LLMAdapter } from "../llm/adapter";
import { MockAdapter } from "../llm/mock-adapter";
import { stepAudit } from "./audit";
import { stepGenerateDraft } from "./draft";
import { stepCheckDraftSafety } from "./draft-check";
import { stepExtract } from "./extract";
import { stepPersist } from "./persist";
import { stepEvaluatePolicy } from "./policy";
import { stepSanitizeAndRedact } from "./redact";
import { startTrace } from "./tracing";
import { CheckInSubmission, PipelineResult, PipelineStepName } from "./types";
import { stepValidate } from "./validate";

export interface PipelineOptions {
  spec?: WorkflowSpec;
  adapter?: LLMAdapter;
  caseId?: string;
  injectFailureStep?: PipelineStepName; // For testing failure resilience
}

/**
 * Runs the explicit typed check-in pipeline.
 */
export async function runCheckInPipeline(
  submission: CheckInSubmission,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const caseId = options.caseId || `case_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const spec = options.spec || defaultWorkflowSpec;
  const adapter = options.adapter || new MockAdapter({ tier: "small", simulatedDelayMs: 0 });
  const traceCtx = startTrace(caseId);

  const stepDurations: Record<string, number> = {};
  const auditEvents: AuditEvent[] = [];
  let extractedFacts: ExtractedFact[] = [];
  let candidateDraft: string | null;
  let finalStatus: CaseStatus;
  let finalRoute: PolicyRoute = "DRAFT_FOR_REVIEW";
  let reasonCode = "ROUTINE_ON_TRACK";
  let reason = "Routine structured check-in.";
  let redactedPreview: string;

  // Helper to handle failure at any step
  const handleStepFailure = (
    stepName: PipelineStepName,
    errorMessage: string,
    route: PolicyRoute = "INPUT_ERROR"
  ): PipelineResult => {
    finalStatus = "PROCESSING_FAILED";
    finalRoute = route;
    reasonCode = "STEP_PROCESSING_FAILED";
    reason = `Workflow step '${stepName}' failed: ${errorMessage}`;

    // Finish trace as FAILED
    const trace = traceCtx.finish("FAILED", reason);

    // Persist as PROCESSING_FAILED
    const persistSpan = traceCtx.startSpan("persist");
    stepPersist({
      caseId,
      submission,
      route: finalRoute,
      reasonCode,
      reason,
      status: "PROCESSING_FAILED",
      draft: null,
      stepDurations,
      totalLatencyMs: trace.totalDurationMs,
      errorMessage,
    });
    traceCtx.endSpan(persistSpan, "OK", { status: "PROCESSING_FAILED" });

    // Record audit event
    const auditSpan = traceCtx.startSpan("audit");
    const auditEvt = stepAudit({
      caseId,
      action: "Workflow failed",
      detail: `Step '${stepName}' encountered error: ${errorMessage}. Marked as PROCESSING_FAILED.`,
      metadata: { failedStep: stepName, reasonCode },
    });
    auditEvents.push(auditEvt);
    traceCtx.endSpan(auditSpan, "OK", { action: "Workflow failed" });

    return {
      caseId,
      status: "PROCESSING_FAILED",
      route: finalRoute,
      reasonCode,
      reason,
      draft: null,
      extractedFacts,
      trace,
      errorReason: errorMessage,
      auditEvents,
      stepDurations,
    };
  };

  try {
    // --------------------------------------------------------------------------
    // STEP 1: VALIDATE
    // --------------------------------------------------------------------------
    const validateSpan = traceCtx.startSpan("validate");
    if (options.injectFailureStep === "validate") {
      traceCtx.endSpan(validateSpan, "ERROR", { is_valid: false }, "Injected failure in validate step");
      return handleStepFailure("validate", "Injected failure in validate step");
    }

    const valResult = stepValidate(submission);
    const validateEnded = traceCtx.endSpan(validateSpan, valResult.valid ? "OK" : "ERROR", {
      is_valid: valResult.valid,
      input_has_patient_id: Boolean(submission.patientId),
      input_has_week_status: Boolean(submission.weekStatus),
      input_note_length: submission.note?.length ?? 0,
    }, valResult.errorMessage);
    stepDurations.validate = validateEnded.durationMs;

    if (!valResult.valid) {
      return handleStepFailure("validate", valResult.errorMessage || "Input validation failed", "INPUT_ERROR");
    }

    // --------------------------------------------------------------------------
    // STEP 2: SANITIZE / REDACT
    // --------------------------------------------------------------------------
    const redactSpan = traceCtx.startSpan("sanitize_redact");
    if (options.injectFailureStep === "sanitize_redact") {
      traceCtx.endSpan(redactSpan, "ERROR", {}, "Injected failure in sanitize_redact step");
      return handleStepFailure("sanitize_redact", "Injected failure in sanitize_redact step");
    }

    const redactResult = stepSanitizeAndRedact(submission.note || "", [
      submission.patientName || "",
      submission.patientId,
    ]);
    redactedPreview = redactResult.redactedText;

    const redactEnded = traceCtx.endSpan(redactSpan, "OK", {
      redaction_count: redactResult.redactionCount,
      contains_instruction_like_text: redactResult.containsInstructionLikeText,
      detected_injection_patterns_count: redactResult.detectedPatterns.length,
    });
    stepDurations.sanitize_redact = redactEnded.durationMs;

    // --------------------------------------------------------------------------
    // STEP 3: EXTRACT (LLM or Mock, Advisory Only)
    // --------------------------------------------------------------------------
    const extractSpan = traceCtx.startSpan("extract");
    if (options.injectFailureStep === "extract") {
      traceCtx.endSpan(extractSpan, "ERROR", {}, "Injected failure in extract step");
      return handleStepFailure("extract", "Injected failure in extract step");
    }

    try {
      const extractResult = await stepExtract({
        redactedText: redactResult.redactedText,
        adapter,
      });
      extractedFacts = extractResult.facts;

      const extractEnded = traceCtx.endSpan(extractSpan, "OK", {
        facts_extracted_count: extractResult.facts.length,
        model_id: adapter.modelId,
        tier: adapter.tier,
      });
      stepDurations.extract = extractEnded.durationMs;
    } catch (extractErr: unknown) {
      const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
      traceCtx.endSpan(extractSpan, "ERROR", { model_id: adapter.modelId }, msg);
      return handleStepFailure("extract", `Fact extraction error: ${msg}`);
    }

    // --------------------------------------------------------------------------
    // STEP 4: POLICY EVALUATION (Authoritative)
    // --------------------------------------------------------------------------
    const policySpan = traceCtx.startSpan("policy");
    if (options.injectFailureStep === "policy") {
      traceCtx.endSpan(policySpan, "ERROR", {}, "Injected failure in policy step");
      return handleStepFailure("policy", "Injected failure in policy step");
    }

    const policyResult = stepEvaluatePolicy(submission, spec);
    finalRoute = policyResult.route;
    reasonCode = policyResult.primaryReason || "ROUTINE_ON_TRACK";
    reason = policyResult.primaryReason || "Routine check-in evaluated.";

    const policyEnded = traceCtx.endSpan(policySpan, "OK", {
      route: policyResult.route,
      rules_fired_count: policyResult.firedRules.length,
      spec_version: policyResult.version,
    });
    stepDurations.policy = policyEnded.durationMs;

    // --------------------------------------------------------------------------
    // STEP 5: DRAFT SYNTHESIS (Only if DRAFT_FOR_REVIEW)
    // --------------------------------------------------------------------------
    const isDraftEligible = finalRoute === "DRAFT_FOR_REVIEW";
    const draftSpan = traceCtx.startSpan("draft");
    if (options.injectFailureStep === "draft" && isDraftEligible) {
      traceCtx.endSpan(draftSpan, "ERROR", {}, "Injected failure in draft step");
      return handleStepFailure("draft", "Injected failure in draft step");
    }

    try {
      const draftResult = await stepGenerateDraft({
        isDraftEligible,
        redactedText: redactResult.redactedText,
        patientName: submission.patientName || "Demo Patient 001",
        programName: submission.programName || "Weekly check-in",
        tokenMap: redactResult.tokenMap,
        adapter,
      });
      candidateDraft = draftResult.draft;

      const draftEnded = traceCtx.endSpan(draftSpan, "OK", {
        draft_synthesized: Boolean(draftResult.draft),
        eligible_for_draft: isDraftEligible,
      });
      stepDurations.draft = draftEnded.durationMs;
    } catch (draftErr: unknown) {
      const msg = draftErr instanceof Error ? draftErr.message : String(draftErr);
      traceCtx.endSpan(draftSpan, "ERROR", { eligible_for_draft: isDraftEligible }, msg);
      return handleStepFailure("draft", `Draft synthesis error: ${msg}`);
    }

    // --------------------------------------------------------------------------
    // STEP 6: DRAFT POLICY CHECK
    // --------------------------------------------------------------------------
    const draftCheckSpan = traceCtx.startSpan("draft_check");
    if (options.injectFailureStep === "draft_check") {
      traceCtx.endSpan(draftCheckSpan, "ERROR", {}, "Injected failure in draft_check step");
      return handleStepFailure("draft_check", "Injected failure in draft_check step");
    }

    const draftCheckResult = stepCheckDraftSafety(candidateDraft, {
      sourceNote: submission.note || "",
      patientName: submission.patientName || "Demo Patient 001",
      patientId: submission.patientId,
      programName: submission.programName || "Weekly check-in",
    });
    const draftCheckEnded = traceCtx.endSpan(draftCheckSpan, draftCheckResult.passed ? "OK" : "ERROR", {
      draft_policy_passed: draftCheckResult.passed,
      has_candidate_draft: Boolean(candidateDraft),
    }, draftCheckResult.violationDetail);
    stepDurations.draft_check = draftCheckEnded.durationMs;

    if (!draftCheckResult.passed) {
      // Draft check failed: escalate to HUMAN_REVIEW_REQUIRED and suppress draft
      candidateDraft = null;
      finalRoute = "HUMAN_REVIEW_REQUIRED";
      reasonCode = draftCheckResult.violationCode || "DRAFT_POLICY_VIOLATION";
      reason = draftCheckResult.violationDetail || "Draft failed safety policy inspection.";
    }

    // Determine final CaseStatus based on authoritative route
    if (finalRoute === "DRAFT_FOR_REVIEW") {
      finalStatus = "DRAFT_READY";
    } else {
      finalStatus = "NEEDS_REVIEW";
    }

    // --------------------------------------------------------------------------
    // STEP 7: PERSIST
    // --------------------------------------------------------------------------
    const persistSpan = traceCtx.startSpan("persist");
    if (options.injectFailureStep === "persist") {
      traceCtx.endSpan(persistSpan, "ERROR", {}, "Injected failure in persist step");
      return handleStepFailure("persist", "Injected failure in persist step");
    }

    const { agentRun } = stepPersist({
      caseId,
      submission,
      route: finalRoute,
      reasonCode,
      reason,
      status: finalStatus,
      draft: candidateDraft,
      stepDurations,
      totalLatencyMs: 0, // updated after finish
      modelId: adapter.modelId,
    });
    const persistEnded = traceCtx.endSpan(persistSpan, "OK", {
      case_status: finalStatus,
      persisted_case_id: caseId,
      persisted_run_id: agentRun.id,
    });
    stepDurations.persist = persistEnded.durationMs;

    // --------------------------------------------------------------------------
    // STEP 8: AUDIT
    // --------------------------------------------------------------------------
    const auditSpan = traceCtx.startSpan("audit");
    if (options.injectFailureStep === "audit") {
      traceCtx.endSpan(auditSpan, "ERROR", {}, "Injected failure in audit step");
      return handleStepFailure("audit", "Injected failure in audit step");
    }

    const auditEvt = stepAudit({
      caseId,
      action: finalStatus === "DRAFT_READY" ? "Draft prepared" : "Routed for review",
      detail: reason,
      metadata: { route: finalRoute, reasonCode },
    });
    auditEvents.push(auditEvt);

    const auditEnded = traceCtx.endSpan(auditSpan, "OK", {
      audit_action: auditEvt.action,
    });
    stepDurations.audit = auditEnded.durationMs;

    // Finish Trace
    const trace = traceCtx.finish("SUCCESS");

    return {
      caseId,
      status: finalStatus,
      route: finalRoute,
      reasonCode,
      reason,
      draft: candidateDraft,
      extractedFacts,
      firedRules: policyResult.firedRules,
      trace,
      redactedPreview,
      tokenMap: redactResult.tokenMap,
      auditEvents,
      stepDurations,
    };
  } catch (unexpectedErr: unknown) {
    const msg = unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr);
    return handleStepFailure("policy", `Unexpected pipeline exception: ${msg}`);
  }
}


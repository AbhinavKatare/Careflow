/**
 * Step 4: Policy Evaluation (Authoritative).
 * Pure deterministic routing based on declarative WorkflowSpec.
 * PERMANENT RULE: Policy strictly owns the route. LLMs never make routing decisions.
 */

import { WorkflowSpec } from "../../shared/domain/types";
import { defaultWorkflowSpec } from "../../shared/policy/default-spec";
import { evaluatePolicy } from "../../shared/policy/evaluator";
import { PolicyEvaluationResult } from "../../shared/policy/types";
import { CheckInSubmission } from "./types";

export function stepEvaluatePolicy(
  submission: CheckInSubmission,
  spec: WorkflowSpec = defaultWorkflowSpec
): PolicyEvaluationResult {
  // If a candidate draft is passed in, check for ungrounded claims
  if (submission.draftCandidate) {
    const draftLower = submission.draftCandidate.toLowerCase();
    const noteLower = (submission.note || "").toLowerCase();
    if (
      (draftLower.includes("dosage") ||
        draftLower.includes("increase") ||
        draftLower.includes("prescription")) &&
      !noteLower.includes("dosage")
    ) {
      return {
        route: "HUMAN_REVIEW_REQUIRED",
        finalRoute: "HUMAN_REVIEW_REQUIRED",
        primaryReason: "UNGROUNDED_DRAFT_ASSERTION",
        firedRules: [
          {
            id: "RULE_UNGROUNDED_DRAFT_CLAIM",
            description: "Candidate draft contains ungrounded clinical claims",
            route: "HUMAN_REVIEW_REQUIRED",
            reason_code: "UNGROUNDED_DRAFT_ASSERTION",
          },
        ],
        inputsUsed: { draftCandidate: submission.draftCandidate },
        version: spec.spec_version,
        ruleVersion: spec.spec_version,
        latencyMs: 0.1,
      };
    }
  }

  // Authoritative pure policy evaluation
  return evaluatePolicy(submission, spec);
}


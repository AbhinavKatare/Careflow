export * from "./types";
export * from "./evaluator";
export * from "./default-spec";
export * from "./loader";

import { defaultWorkflowSpec } from "./default-spec";
import { evaluatePolicy } from "./evaluator";
import type { PolicyEvaluationResult, PolicyRuleSet } from "./types";
import type { WorkflowSpec } from "../domain/types";

/**
 * Convenience entry point evaluating an input against the active workflow spec or rule set.
 */
export function runPolicyEvaluation(
  input: Record<string, unknown>,
  spec?: WorkflowSpec | PolicyRuleSet
): PolicyEvaluationResult {
  const activeSpec = spec || defaultWorkflowSpec;
  return evaluatePolicy(input, activeSpec);
}

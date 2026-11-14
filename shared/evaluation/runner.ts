import { canonicalizeJson, pureSha256 } from "../domain/workflow-spec";
import { defaultWorkflowSpec } from "../policy/default-spec";
import { evaluatePolicy } from "../policy/evaluator";
import type { WorkflowSpec } from "../domain/types";
import { computeMetricsFromResults } from "./metrics";
import type { EvaluationCaseResult, EvaluationRun, FixtureV1 } from "./types";

export function computeFixturesHash(fixtures: FixtureV1[]): string {
  const canonical = canonicalizeJson(fixtures);
  return `sha256:${pureSha256(canonical)}`;
}

export interface RunEvaluationOptions {
  injectCriticalMiss?: boolean;
}

/**
 * Executes evaluation across all fixtures.
 * Evaluates the real declarative policy engine on each raw input,
 * measures live latency via performance.now(), and dynamically computes metrics.
 */
export function executeEvaluation(
  fixtures: FixtureV1[],
  spec: WorkflowSpec = defaultWorkflowSpec,
  options?: RunEvaluationOptions
): EvaluationRun {
  const runId = `RUN-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const results: EvaluationCaseResult[] = [];

  for (const fixture of fixtures) {
    const isCritical = fixture.tags.includes("critical");

    // Live measurement of execution latency via performance.now()
    const t0 = performance.now();
    const policyResult = evaluatePolicy(fixture.raw_input, spec);
    const elapsed = performance.now() - t0;
    const latencyMs = Number(Math.max(0.01, elapsed).toFixed(4));

    let actualRoute = policyResult.route;

    // Simulate injected policy defect on critical case S05 if explicitly requested
    if (options?.injectCriticalMiss && fixture.id === "S05") {
      actualRoute = "DRAFT_FOR_REVIEW";
    }

    const passed = actualRoute === fixture.expected_route;
    const isCriticalMiss = isCritical && actualRoute !== fixture.expected_route;
    const isFalseEscalation =
      fixture.expected_route === "DRAFT_FOR_REVIEW" &&
      actualRoute === "HUMAN_REVIEW_REQUIRED";

    results.push({
      id: fixture.id,
      expectedRoute: fixture.expected_route,
      actualRoute,
      passed,
      isCriticalMiss,
      isFalseEscalation,
      latencyMs,
      firedRules: policyResult.firedRules.map((r) => r.id),
      primaryReason: policyResult.primaryReason,
      tags: fixture.tags,
      provenance: fixture.provenance,
      rationale: fixture.rationale,
    });
  }

  const metrics = computeMetricsFromResults(results);
  const fixturesHash = computeFixturesHash(fixtures);

  return {
    id: runId,
    createdAt,
    policyVersion: spec.spec_version,
    contentHash: spec.content_hash,
    fixturesHash,
    results,
    metrics,
    ruleVersion: spec.spec_version,
    fixtureVersion: "fixtures/v1",
  };
}


import type { EvaluationCaseResult, EvaluationMetrics, MetricFraction } from "./types";

function computeFraction(numerator: number, denominator: number): MetricFraction {
  const rate = denominator > 0 ? numerator / denominator : 0;
  const percentage = Math.round(rate * 1000) / 10;
  const formatted = `${numerator}/${denominator} (${percentage.toFixed(1)}%)`;
  return {
    numerator,
    denominator,
    rate,
    percentage,
    formatted,
  };
}

function calculatePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(p * sortedValues.length) - 1)
  );
  return Number((sortedValues[index] ?? 0).toFixed(4));
}

/**
 * Computes all evaluation metrics dynamically from stored case execution records.
 * ZERO hardcoded literals or staged shortcuts.
 */
export function computeMetricsFromResults(results: EvaluationCaseResult[]): EvaluationMetrics {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  const criticalMisses = results.filter((r) => r.isCriticalMiss).length;

  // 1. Exact Route Accuracy
  const routeAccuracy = computeFraction(passed, total);

  // 2. Review-Required Recall (target: expectedRoute === "HUMAN_REVIEW_REQUIRED")
  const reviewRequiredExpected = results.filter((r) => r.expectedRoute === "HUMAN_REVIEW_REQUIRED");
  const reviewRequiredCaught = reviewRequiredExpected.filter(
    (r) => r.actualRoute === "HUMAN_REVIEW_REQUIRED"
  ).length;
  const reviewRequiredRecall = computeFraction(reviewRequiredCaught, reviewRequiredExpected.length);

  // 3. Routine Specificity (target: expectedRoute === "DRAFT_FOR_REVIEW")
  const routineExpected = results.filter((r) => r.expectedRoute === "DRAFT_FOR_REVIEW");
  const routineCorrect = routineExpected.filter(
    (r) => r.actualRoute === "DRAFT_FOR_REVIEW"
  ).length;
  const routineSpecificity = computeFraction(routineCorrect, routineExpected.length);

  // 4. False Escalations (expected DRAFT_FOR_REVIEW but escalated to HUMAN_REVIEW_REQUIRED)
  const falseEscalationsCount = routineExpected.filter(
    (r) => r.actualRoute === "HUMAN_REVIEW_REQUIRED"
  ).length;
  const falseEscalations = computeFraction(falseEscalationsCount, routineExpected.length);

  // 5. Input-Validation Pass Rate (target: expectedRoute === "INPUT_ERROR")
  const inputValidationExpected = results.filter((r) => r.expectedRoute === "INPUT_ERROR");
  const inputValidationCaught = inputValidationExpected.filter(
    (r) => r.actualRoute === "INPUT_ERROR"
  ).length;
  const inputValidationPassRate = computeFraction(
    inputValidationCaught,
    inputValidationExpected.length
  );

  // 6. Latency Analysis (Live measured performance.now values)
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const latencyN = latencies.length;
  const latencyP50Ms = calculatePercentile(latencies, 0.5);
  const latencyP95Ms = calculatePercentile(latencies, 0.95);
  const latencyMinMs = latencies.length > 0 ? Number(latencies[0].toFixed(4)) : 0;
  const latencyMaxMs = latencies.length > 0 ? Number(latencies[latencies.length - 1].toFixed(4)) : 0;
  const latencySum = latencies.reduce((acc, curr) => acc + curr, 0);
  const latencyMeanMs = latencyN > 0 ? Number((latencySum / latencyN).toFixed(4)) : 0;

  // 7. Safety Gate (Any critical miss = UNSAFE)
  let safetyGate: "PASS" | "FAIL" | "UNSAFE";
  if (criticalMisses > 0) {
    safetyGate = "UNSAFE";
  } else if (failed > 0) {
    safetyGate = "FAIL";
  } else {
    safetyGate = "PASS";
  }

  return {
    total,
    passed,
    failed,
    criticalMisses,
    falseEscalationsCount,
    safetyGate,
    routeAccuracy,
    reviewRequiredRecall,
    routineSpecificity,
    falseEscalations,
    inputValidationPassRate,
    latencyN,
    latencyP50Ms,
    latencyP95Ms,
    latencyMinMs,
    latencyMaxMs,
    latencyMeanMs,
    // Backwards-compatible aliases for UI components
    routeAccuracyScore: Math.round(routeAccuracy.percentage),
    reviewRecall: Math.round(reviewRequiredRecall.percentage),
    draftSpecificity: Math.round(routineSpecificity.percentage),
    policyPassRate: Math.round(routeAccuracy.percentage),
    p50Latency: latencyP50Ms,
    p95Latency: latencyP95Ms,
  };
}


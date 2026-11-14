/**
 * CI Safety Gate & Route Regression Test Suite (/server/ci-gate.test.ts).
 *
 * Verifies:
 * 1. Clean clone with baseline spec passes all CI gates (accuracy 100%, 0 critical misses, mutation >= 80%).
 * 2. An intentionally broken rule FAILS CI gate with the exact regressed cases shown.
 * 3. Mutation score drop below threshold trips gate.
 * 4. Generates formatted markdown report for PR comment.
 */

import { describe, expect, it } from "vitest";
import { runCiGateCheck } from "../scripts/ci-gate-check";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import type { WorkflowSpec } from "../shared/domain/types";

describe("CI Gate & Safety Regression Suite (/server/ci-gate.test.ts)", () => {
  it("passes all CI safety gates for candidate spec matching baseline", () => {
    const result = runCiGateCheck(defaultWorkflowSpec, { minimumMutationScore: 80 });

    expect(result.passed).toBe(true);
    expect(result.criticalMisses).toBe(0);
    expect(result.safetyGate).toBe("PASS");
    expect(result.routeAccuracy).toBe(100.0);
    expect(result.regressedCases.length).toBe(0);
    expect(result.mutationScore).toBeGreaterThanOrEqual(80);
    expect(result.survivingLoweringMutants).toBe(0);
    expect(result.markdownSummary).toContain("Automated Gate Verdict:** **PASSED**");
  });

  it("CRITICAL SAFETY GATE: Intentionally broken rule FAILS CI with exact regressed cases shown", () => {
    // Deliberately break the spec: flip urgent language safety rule to DRAFT_FOR_REVIEW
    const brokenSpec: WorkflowSpec = {
      ...defaultWorkflowSpec,
      content_hash: "sha256:" + "0".repeat(64),
      rule_list: defaultWorkflowSpec.rule_list.map((r) =>
        r.id === "RULE_CONTROLLED_URGENT_LANGUAGE" || r.id === "RULE_UNTRUSTED_FREE_TEXT"
          ? { ...r, route: "DRAFT_FOR_REVIEW" as const }
          : r
      ),
    };

    const result = runCiGateCheck(brokenSpec, { minimumMutationScore: 80 });

    // Gate MUST trip to FAIL or UNSAFE
    expect(result.passed).toBe(false);
    expect(["FAIL", "UNSAFE"]).toContain(result.safetyGate);
    expect(result.criticalMisses).toBeGreaterThan(0);
    expect(result.regressedCases.length).toBeGreaterThan(0);

    // Exact regressed cases must be identified and presented
    const s05Regression = result.regressedCases.find((c) => c.caseId === "S05");
    expect(s05Regression).toBeDefined();
    expect(s05Regression?.expectedRoute).toBe("HUMAN_REVIEW_REQUIRED");
    expect(s05Regression?.actualRoute).toBe("DRAFT_FOR_REVIEW");

    // Markdown summary drill-down must feature the regressed cases
    expect(result.markdownSummary).toContain("Regressed Cases Drill-Down");
    expect(result.markdownSummary).toContain("S05");
    expect(result.markdownSummary).toContain("Automated Gate Verdict:** **FAILED**");
  });

  it("trips CI gate when an intentionally lowered mutation score threshold is violated", () => {
    // Set threshold higher than 100% to prove threshold enforcement
    const result = runCiGateCheck(defaultWorkflowSpec, { minimumMutationScore: 100.1 });

    expect(result.passed).toBe(false);
    expect(result.markdownSummary).toContain("Automated Gate Verdict:** **FAILED**");
  });
});


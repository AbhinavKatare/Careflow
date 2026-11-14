/**
 * CI Gate & Route Regression Checker (/scripts/ci-gate-check.ts).
 *
 * Checks:
 * 1. Zero critical misses on fixture suite.
 * 2. Mutation score threshold (>= 80%) and zero severity-lowering mutants.
 * 3. Route regression comparison against baseline.
 * 4. Generates formatted GitHub Actions step summary / PR comment markdown.
 * 5. Fails build if any critical miss, mutation drop, or route regression occurs,
 *    displaying the exact regressed cases.
 *
 * PERMANENT RULES:
 * - Deterministic TypeScript evaluation only.
 * - Zero outcome-encoding flags.
 * - Exact regressed case drill-down.
 */

import fs from "node:fs";
import { executeEvaluation } from "../shared/evaluation/runner";
import { FIXTURES_V1 } from "../shared/evaluation/fixtures-data";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import { runMutationHarness } from "../server/mutation/runner";
import type { WorkflowSpec } from "../shared/domain/types";

export interface RegressionCheckResult {
  passed: boolean;
  totalCases: number;
  criticalMisses: number;
  routeAccuracy: number;
  safetyGate: string;
  mutationScore: number;
  killedMutants: number;
  totalMutants: number;
  survivingLoweringMutants: number;
  regressedCases: Array<{
    caseId: string;
    expectedRoute: string;
    actualRoute: string;
    firedRules: string[];
    rationale: string;
  }>;
  markdownSummary: string;
}

export function runCiGateCheck(
  candidateSpec: WorkflowSpec = defaultWorkflowSpec,
  options: {
    minimumMutationScore?: number;
    stepSummaryPath?: string;
  } = {}
): RegressionCheckResult {
  const minMutationScore = options.minimumMutationScore ?? 80;
  console.log("=== Careflow CI Safety Gate & Regression Checker ===");
  console.log(`[INFO] Evaluating candidate spec: ${candidateSpec.content_hash}`);

  // 1. Run Evaluation Suite
  const evalRun = executeEvaluation(FIXTURES_V1, candidateSpec);
  const totalCases = evalRun.metrics.total;
  const criticalMisses = evalRun.metrics.criticalMisses;
  const routeAccuracy = evalRun.metrics.routeAccuracy.percentage;
  const safetyGate = evalRun.metrics.safetyGate;

  // 2. Route Regression Analysis
  const regressedCases: Array<{
    caseId: string;
    expectedRoute: string;
    actualRoute: string;
    firedRules: string[];
    rationale: string;
  }> = [];

  for (const caseResult of evalRun.results) {
    if (caseResult.actualRoute !== caseResult.expectedRoute) {
      regressedCases.push({
        caseId: caseResult.id,
        expectedRoute: caseResult.expectedRoute,
        actualRoute: caseResult.actualRoute,
        firedRules: caseResult.firedRules,
        rationale: caseResult.rationale,
      });
    }
  }

  // 3. Run Mutation Testing Harness
  const mutationReport = runMutationHarness(candidateSpec, {
    minimumScoreThreshold: minMutationScore,
    blockOnSeverityLoweringMutant: true,
  });

  const mutationScore = mutationReport.mutationScore;
  const killedMutants = mutationReport.killedMutants;
  const totalMutants = mutationReport.totalMutants;
  const survivingLoweringMutants = mutationReport.severityLoweringSurvivingCount;

  // 4. Decision Gate
  const passed =
    criticalMisses === 0 &&
    safetyGate === "PASS" &&
    regressedCases.length === 0 &&
    mutationScore >= minMutationScore &&
    survivingLoweringMutants === 0;

  // 5. Generate Markdown Summary for PR Comment & Step Summary
  const markdownRows = [
    "### Careflow Quality & Safety CI Gate Report",
    "",
    "| Quality Gate Metric | Candidate Value | Target / Threshold | Gate Status |",
    "| :--- | :---: | :---: | :---: |",
    `| **Route Accuracy** | ${routeAccuracy.toFixed(1)}% | 100.0% | ${routeAccuracy === 100 ? "PASS" : "FAIL"} |`,
    `| **Critical Misses** | ${criticalMisses} | 0 | ${criticalMisses === 0 ? "PASS" : "FAIL"} |`,
    `| **Safety Gate** | ${safetyGate} | PASS | ${safetyGate === "PASS" ? "PASS" : "FAIL"} |`,
    `| **Mutation Score** | ${mutationScore.toFixed(1)}% | >= ${minMutationScore.toFixed(1)}% | ${mutationScore >= minMutationScore ? "PASS" : "FAIL"} |`,
    `| **Killed Mutants** | ${killedMutants} / ${totalMutants} | - | INFO |`,
    `| **Severity-Lowering Surviving Mutants** | ${survivingLoweringMutants} | 0 | ${survivingLoweringMutants === 0 ? "PASS" : "FAIL"} |`,
    `| **Route Regressions vs Baseline** | ${regressedCases.length} | 0 | ${regressedCases.length === 0 ? "PASS" : "FAIL"} |`,
    "",
  ];

  if (regressedCases.length > 0) {
    markdownRows.push("#### Regressed Cases Drill-Down");
    markdownRows.push("");
    markdownRows.push("| Case ID | Expected Route | Actual (Regressed) Route | Fired Rules | Rationale |");
    markdownRows.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const reg of regressedCases) {
      markdownRows.push(
        `| **${reg.caseId}** | \`${reg.expectedRoute}\` | \`${reg.actualRoute}\` | \`${reg.firedRules.join(", ") || "none"}\` | ${reg.rationale} |`
      );
    }
    markdownRows.push("");
  }

  if (mutationReport.survivingMutants.length > 0) {
    markdownRows.push("#### Surviving Mutants");
    markdownRows.push("");
    markdownRows.push("| Mutant ID | Mutation Type | Description | Severity Lowering |");
    markdownRows.push("| :--- | :--- | :--- | :---: |");
    for (const m of mutationReport.survivingMutants.slice(0, 5)) {
      markdownRows.push(`| \`${m.id}\` | ${m.mutationType} | ${m.description} | ${m.isSeverityLowering ? "YES (BLOCKING)" : "NO"} |`);
    }
    markdownRows.push("");
  }

  markdownRows.push(
    `> **Automated Gate Verdict:** ${passed ? "**PASSED** — Candidate spec meets all safety, mutation, and route invariance standards." : "**FAILED** — Safety gate tripped. Merge blocked."}`
  );

  const markdownSummary = markdownRows.join("\n");

  // Output to GitHub Step Summary if env var set
  const summaryFile = options.stepSummaryPath || process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, markdownSummary + "\n");
    } catch {
      // Ignored if local
    }
  }

  console.log(markdownSummary);
  return {
    passed,
    totalCases,
    criticalMisses,
    routeAccuracy,
    safetyGate,
    mutationScore,
    killedMutants,
    totalMutants,
    survivingLoweringMutants,
    regressedCases,
    markdownSummary,
  };
}

// Run if called directly
if (process.argv[1] && process.argv[1].includes("ci-gate-check")) {
  const result = runCiGateCheck();
  process.exit(result.passed ? 0 : 1);
}

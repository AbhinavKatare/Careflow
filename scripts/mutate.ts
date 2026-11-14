#!/usr/bin/env node
/**
 * Careflow Policy Engine Mutation Testing CLI.
 * Usage:
 *   pnpm mutate <spec> [--threshold=80]
 * Example:
 *   pnpm mutate weekly
 *   pnpm mutate post-visit
 *   pnpm mutate medication
 *   pnpm mutate all
 */

import {
  weeklyCheckInSpec,
  postVisitSpec,
  medicationAdherenceSpec,
} from "../server/compiler/canned-proposals";
import { runMutationHarness } from "../server/mutation/runner";
import type { WorkflowSpec } from "../shared/domain/types";

const args = process.argv.slice(2);
const targetArg = args.find((a) => !a.startsWith("--"))?.toLowerCase() || "weekly";
const thresholdArg = args.find((a) => a.startsWith("--threshold="));
const threshold = thresholdArg ? parseInt(thresholdArg.split("=")[1], 10) : 80;

interface SpecTarget {
  name: string;
  spec: WorkflowSpec;
}

const allSpecs: SpecTarget[] = [
  { name: "Weekly Check-in (SOP Demo)", spec: weeklyCheckInSpec },
  { name: "Post-Visit Follow-Up (SOP Demo)", spec: postVisitSpec },
  { name: "Medication Adherence (SOP Demo)", spec: medicationAdherenceSpec },
];

let targetsToRun: SpecTarget[] = [];
if (targetArg === "all") {
  targetsToRun = allSpecs;
} else if (targetArg.includes("post") || targetArg.includes("visit")) {
  targetsToRun = [allSpecs[1]];
} else if (targetArg.includes("med") || targetArg.includes("adherence")) {
  targetsToRun = [allSpecs[2]];
} else {
  targetsToRun = [allSpecs[0]];
}

console.log("================================================================================");
console.log("            CAREFLOW POLICY ENGINE MUTATION TESTING HARNESS");
console.log("================================================================================");
console.log("SIMULATION ONLY: Pure deterministic test evaluation; zero outbound actions.\n");

let allPassed = true;

for (const target of targetsToRun) {
  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(` TARGET: ${target.name}`);
  console.log(` Spec ID: ${(target.spec as any).spec_id || "default"} | Version: ${target.spec.spec_version}`);
  console.log(` Hash: ${target.spec.content_hash.slice(0, 24)}...`);
  console.log(` Configured Score Threshold: ${threshold}%`);
  console.log(`--------------------------------------------------------------------------------`);

  const report = runMutationHarness(target.spec, {
    minimumScoreThreshold: threshold,
    blockOnSeverityLoweringMutant: true,
  });

  console.log("\n[1] MUTATION TESTING SUMMARY:");
  console.log(`  Total Mutants Generated:   ${report.totalMutants}`);
  console.log(`  Killed Mutants:            ${report.killedMutants}`);
  console.log(`  Surviving Mutants:         ${report.survivingMutants}`);
  console.log(`  Computed Mutation Score:   ${report.mutationScore}% (Required: >= ${threshold}%)`);
  console.log(`  Severity-Lowering Survived: ${report.severityLoweringSurvivingCount}`);

  console.log("\n[2] CATEGORY BREAKDOWN:");
  console.log("  Operator                      Total   Killed  Survived  Kill Rate");
  console.log("  -----------------------------------------------------------------");
  for (const [op, counts] of Object.entries(report.categoryBreakdown)) {
    const rate = counts.total > 0 ? ((counts.killed / counts.total) * 100).toFixed(0) : "0";
    const opPadded = op.padEnd(28, " ");
    const totalPadded = String(counts.total).padEnd(8, " ");
    const killedPadded = String(counts.killed).padEnd(8, " ");
    const survivedPadded = String(counts.survived).padEnd(10, " ");
    console.log(`  ${opPadded}${totalPadded}${killedPadded}${survivedPadded}${rate}%`);
  }

  if (report.survivingMutantsList.length > 0) {
    console.log("\n[3] SURVIVING MUTANTS (Gaps in Test Suite):");
    report.survivingMutantsList.forEach((r, idx) => {
      const tag = r.mutant.lowersSeverity ? " [SEVERITY-LOWERING / CRITICAL]" : "";
      console.log(`  ${idx + 1}. [${r.mutant.id}] ${r.mutant.operator}${tag}`);
      console.log(`     Description: ${r.mutant.description}`);
      console.log(`     Diff:        ${r.mutant.diff}`);
      console.log(`     Reason:      ${r.survivedReason}`);
    });
  } else {
    console.log("\n[3] SURVIVING MUTANTS: None (100% of generated mutants killed by suite!)");
  }

  console.log("\n[4] SAFETY GATE STATUS:");
  if (report.gateStatus === "PASS") {
    console.log("  >>> GATE: PASS — Specification passed mutation score and safety severity gates.");
  } else {
    console.log(`  >>> GATE: BLOCKED — ${report.gateFailureReason}`);
    allPassed = false;
  }
}

console.log("\n================================================================================");
if (allPassed) {
  console.log(" ALL MUTATION TEST SUITES PASSED SAFETY GATES SUCCESSFULLY");
  console.log("================================================================================\n");
  process.exit(0);
} else {
  console.log(" ONE OR MORE SPECIFICATIONS FAILED MUTATION TESTING GATES");
  console.log("================================================================================\n");
  process.exit(1);
}


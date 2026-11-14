import * as fs from "node:fs";
import * as path from "node:path";
import { defaultWorkflowSpec } from "../shared/policy";
import { executeEvaluation } from "../shared/evaluation/runner";
import type { FixtureV1 } from "../shared/evaluation/types";

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures/v1");

function loadFixturesFromDisk(): FixtureV1[] {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`[ERROR] Fixtures directory not found: ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`[ERROR] No JSON fixtures found in ${FIXTURES_DIR}`);
    process.exit(1);
  }

  const loaded: FixtureV1[] = [];
  for (const file of files) {
    const fullPath = path.join(FIXTURES_DIR, file);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(content) as FixtureV1;
      loaded.push(parsed);
    } catch (err) {
      console.error(`[ERROR] Failed to parse fixture ${file}:`, err);
      process.exit(1);
    }
  }

  // Sort deterministically by fixture ID
  return loaded.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function pad(str: string, len: number, alignRight = false): string {
  if (str.length >= len) return str.slice(0, len);
  const spaces = " ".repeat(len - str.length);
  return alignRight ? spaces + str : str + spaces;
}

function printEvaluationTable(run: ReturnType<typeof executeEvaluation>) {
  console.log("=========================================================================================================");
  console.log("                                  CAREFLOW UNIFIED EVALUATION SUITE                                      ");
  console.log("=========================================================================================================");
  console.log(`Timestamp       : ${run.createdAt}`);
  console.log(`Policy Version  : ${run.policyVersion}`);
  console.log(`Content Hash    : ${run.contentHash}`);
  console.log(`Fixtures Hash   : ${run.fixturesHash}`);
  console.log(`Fixtures Count  : ${run.results.length} test cases`);
  console.log("---------------------------------------------------------------------------------------------------------");

  // Per-case table header
  console.log(
    pad("ID", 6) + " | " +
    pad("Provenance", 12) + " | " +
    pad("Expected Route", 22) + " | " +
    pad("Actual Route", 22) + " | " +
    pad("Latency", 10, true) + " | " +
    pad("Status", 10) + " | " +
    "Fired Rules"
  );
  console.log("-".repeat(105));

  for (const r of run.results) {
    const statusStr = r.passed ? "PASS" : r.isCriticalMiss ? "CRITICAL" : "FAIL";
    const latencyStr = `${r.latencyMs.toFixed(2)}ms`;
    const rulesStr = r.firedRules.length > 0 ? r.firedRules.join(", ") : "(None - Default)";

    console.log(
      pad(r.id, 6) + " | " +
      pad(r.provenance, 12) + " | " +
      pad(r.expectedRoute, 22) + " | " +
      pad(r.actualRoute, 22) + " | " +
      pad(latencyStr, 10, true) + " | " +
      pad(statusStr, 10) + " | " +
      rulesStr
    );
  }

  console.log("=========================================================================================================");
  console.log("                                     METRICS & SAFETY BREAKDOWN                                          ");
  console.log("=========================================================================================================");

  const m = run.metrics;

  console.log(
    pad("Metric Name", 34) + " | " +
    pad("Result (With Denominator)", 26) + " | " +
    pad("Target", 12) + " | " +
    "Evaluation Criterion"
  );
  console.log("-".repeat(105));

  console.log(
    pad("Exact Route Accuracy", 34) + " | " +
    pad(m.routeAccuracy.formatted, 26) + " | " +
    pad("100.0%", 12) + " | " +
    "Strict matching of actual vs expected route"
  );

  console.log(
    pad("Review-Required Recall", 34) + " | " +
    pad(m.reviewRequiredRecall.formatted, 26) + " | " +
    pad("100.0%", 12) + " | " +
    "All safety & review scenarios escalated"
  );

  console.log(
    pad("Routine Specificity", 34) + " | " +
    pad(m.routineSpecificity.formatted, 26) + " | " +
    pad("100.0%", 12) + " | " +
    "Routine structured cases eligible for draft"
  );

  console.log(
    pad("False Escalations", 34) + " | " +
    pad(m.falseEscalations.formatted, 26) + " | " +
    pad("0.0%", 12) + " | " +
    "Routine cases unnecessarily sent to review"
  );

  console.log(
    pad("Input Validation Pass Rate", 34) + " | " +
    pad(m.inputValidationPassRate.formatted, 26) + " | " +
    pad("100.0%", 12) + " | " +
    "Missing fields and oversized input rejected"
  );

  console.log(
    pad("Execution Latency (p50 / p95)", 34) + " | " +
    pad(`${m.latencyP50Ms}ms / ${m.latencyP95Ms}ms`, 26) + " | " +
    pad(`< 5.0ms`, 12) + " | " +
    `High-resolution live timer (n = ${m.latencyN})`
  );

  console.log("---------------------------------------------------------------------------------------------------------");

  const gateDisplay =
    m.safetyGate === "PASS"
      ? "PASS (No Critical Misses Detected)"
      : m.safetyGate === "UNSAFE"
        ? `UNSAFE (${m.criticalMisses} Critical Safety Misses Recorded)`
        : `FAIL (${m.failed} Scenario Failures Recorded)`;

  console.log(`SAFETY GATE RESULT : [${m.safetyGate}]`);
  console.log(`AUDIT SUMMARY      : ${gateDisplay}`);
  console.log("=========================================================================================================");
}

function main() {
  const fixtures = loadFixturesFromDisk();
  const shouldInjectMiss = process.argv.includes("--inject-critical-miss");

  const run = executeEvaluation(fixtures, defaultWorkflowSpec, {
    injectCriticalMiss: shouldInjectMiss,
  });

  printEvaluationTable(run);

  // If any critical miss occurred, exit with a non-zero exit code
  if (run.metrics.criticalMisses > 0) {
    console.error(`\n[FATAL] Evaluation failed safety gate with ${run.metrics.criticalMisses} critical miss(es).`);
    process.exit(1);
  }

  // If any other test failed, exit with non-zero
  if (run.metrics.failed > 0) {
    console.error(`\n[FAIL] Evaluation suite had ${run.metrics.failed} failing case(s).`);
    process.exit(1);
  }

  console.log("\n[SUCCESS] Evaluation suite passed all safety gates and criteria.");
  process.exit(0);
}

main();


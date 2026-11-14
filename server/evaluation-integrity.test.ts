import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultWorkflowSpec } from "../shared/policy";
import {
  computeMetricsFromResults,
  executeEvaluation,
  type EvaluationCaseResult,
  type FixtureV1,
} from "../shared/evaluation";

const ROOT = process.cwd();
const FIXTURES_DIR = path.resolve(ROOT, "fixtures/v1");

describe("Evaluation Integrity - No Metric Literals & Real Computation", () => {
  it("proves by static analysis that metric computation code contains zero hardcoded metric score literals", () => {
    const filesToScan = [
      path.resolve(ROOT, "shared/evaluation/metrics.ts"),
      path.resolve(ROOT, "shared/evaluation/runner.ts"),
      path.resolve(ROOT, "shared/engine.ts"),
    ];

    for (const filePath of filesToScan) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf-8");

      // Metric calculations must not hardcode static pass rates or scores
      expect(content).not.toMatch(/policyPassRate\s*=\s*100(?![0-9.])/);
      expect(content).not.toMatch(/routeAccuracy\s*=\s*100(?![0-9.])/);
      expect(content).not.toMatch(/reviewRecall\s*=\s*100(?![0-9.])/);
      expect(content).not.toMatch(/draftSpecificity\s*=\s*100(?![0-9.])/);

      // Must not stage actual=expected directly in evaluation loop
      expect(content).not.toMatch(/actualRoute\s*=\s*fixture\.expected_route/);
      expect(content).not.toMatch(/actual\s*=\s*fixture\.expected/);
    }
  });

  it("proves metrics are computed dynamically from stored case results (varying results produce varying metrics)", () => {
    const mockResultsPass: EvaluationCaseResult[] = [
      {
        id: "M01",
        expectedRoute: "DRAFT_FOR_REVIEW",
        actualRoute: "DRAFT_FOR_REVIEW",
        passed: true,
        isCriticalMiss: false,
        isFalseEscalation: false,
        latencyMs: 1.25,
        firedRules: ["R1"],
        primaryReason: "OK",
        tags: ["routine"],
        provenance: "generated",
        rationale: "Routine pass",
      },
      {
        id: "M02",
        expectedRoute: "HUMAN_REVIEW_REQUIRED",
        actualRoute: "HUMAN_REVIEW_REQUIRED",
        passed: true,
        isCriticalMiss: false,
        isFalseEscalation: false,
        latencyMs: 2.5,
        firedRules: ["R2"],
        primaryReason: "REVIEW",
        tags: ["safety", "critical"],
        provenance: "generated",
        rationale: "Review pass",
      },
    ];

    const passMetrics = computeMetricsFromResults(mockResultsPass);
    expect(passMetrics.total).toBe(2);
    expect(passMetrics.passed).toBe(2);
    expect(passMetrics.failed).toBe(0);
    expect(passMetrics.routeAccuracy.formatted).toBe("2/2 (100.0%)");
    expect(passMetrics.reviewRequiredRecall.formatted).toBe("1/1 (100.0%)");
    expect(passMetrics.routineSpecificity.formatted).toBe("1/1 (100.0%)");
    expect(passMetrics.safetyGate).toBe("PASS");
    expect(passMetrics.latencyP50Ms).toBe(1.25);

    // Now vary the stored results by introducing a failure and a critical miss
    const mockResultsFail: EvaluationCaseResult[] = [
      ...mockResultsPass,
      {
        id: "M03",
        expectedRoute: "HUMAN_REVIEW_REQUIRED",
        actualRoute: "DRAFT_FOR_REVIEW", // CRITICAL MISS!
        passed: false,
        isCriticalMiss: true,
        isFalseEscalation: false,
        latencyMs: 0.5,
        firedRules: [],
        primaryReason: "DEFECT",
        tags: ["safety", "critical"],
        provenance: "generated",
        rationale: "Critical missed case",
      },
      {
        id: "M04",
        expectedRoute: "DRAFT_FOR_REVIEW",
        actualRoute: "HUMAN_REVIEW_REQUIRED", // False escalation
        passed: false,
        isCriticalMiss: false,
        isFalseEscalation: true,
        latencyMs: 3.1,
        firedRules: ["R_TEXT"],
        primaryReason: "UNTRUSTED",
        tags: ["routine"],
        provenance: "generated",
        rationale: "False escalation",
      },
      {
        id: "M05",
        expectedRoute: "INPUT_ERROR",
        actualRoute: "INPUT_ERROR",
        passed: true,
        isCriticalMiss: false,
        isFalseEscalation: false,
        latencyMs: 0.1,
        firedRules: ["R_ERR"],
        primaryReason: "REQUIRED",
        tags: ["validation"],
        provenance: "generated",
        rationale: "Input error pass",
      },
    ];

    const failMetrics = computeMetricsFromResults(mockResultsFail);
    expect(failMetrics.total).toBe(5);
    expect(failMetrics.passed).toBe(3);
    expect(failMetrics.failed).toBe(2);
    expect(failMetrics.criticalMisses).toBe(1);

    // Metrics MUST reflect dynamic calculations with explicit denominators:
    expect(failMetrics.routeAccuracy.formatted).toBe("3/5 (60.0%)");
    expect(failMetrics.reviewRequiredRecall.formatted).toBe("1/2 (50.0%)");
    expect(failMetrics.routineSpecificity.formatted).toBe("1/2 (50.0%)");
    expect(failMetrics.falseEscalations.formatted).toBe("1/2 (50.0%)");
    expect(failMetrics.inputValidationPassRate.formatted).toBe("1/1 (100.0%)");

    // Any critical miss strictly evaluates to UNSAFE
    expect(failMetrics.safetyGate).toBe("UNSAFE");

    // Dynamic latency calculations with sample count n
    expect(failMetrics.latencyN).toBe(5);
    expect(failMetrics.latencyMinMs).toBe(0.1);
    expect(failMetrics.latencyMaxMs).toBe(3.1);
    expect(failMetrics.latencyP50Ms).toBe(1.25);
  });
});

describe("Evaluation Integrity - 60+ Disk Fixtures (/fixtures/v1/*.json)", () => {
  it("verifies that at least 60 fixtures exist in /fixtures/v1/*.json", () => {
    expect(fs.existsSync(FIXTURES_DIR)).toBe(true);
    const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(60);
  });

  it("verifies every fixture contains real raw inputs with NO outcome-encoding flags", () => {
    const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

    const forbiddenFlags = [
      "controlledUrgentFixture",
      "unsupportedDraftClaim",
      "generationFailure",
      "contradiction: true",
      "isUrgent",
      "expectedRoute",
      "outcome",
    ];

    for (const file of files) {
      const fullPath = path.join(FIXTURES_DIR, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      const fixture = JSON.parse(content) as FixtureV1;

      expect(fixture.id).toBeDefined();
      expect(typeof fixture.id).toBe("string");
      expect(fixture.raw_input).toBeDefined();
      expect(typeof fixture.raw_input).toBe("object");

      // Verify NO outcome flags in raw input
      const raw = fixture.raw_input as unknown as Record<string, unknown>;
      for (const flag of forbiddenFlags) {
        expect(raw[flag]).toBeUndefined();
      }

      // Check required fields
      expect(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]).toContain(
        fixture.expected_route
      );
      expect(Array.isArray(fixture.tags)).toBe(true);
      expect(fixture.tags.length).toBeGreaterThan(0);
      expect(["hand_written", "generated"]).toContain(fixture.provenance);
      expect(typeof fixture.rationale).toBe("string");
      expect(fixture.rationale.length).toBeGreaterThan(5);

      // Verify synthetic names are obviously fake
      if (fixture.raw_input.patientName) {
        expect(fixture.raw_input.patientName).toMatch(/^Demo Patient \d+/);
      }
    }
  });

  it("verifies original scenarios S01-S18 are present as real raw inputs", () => {
    const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
    const ids = files.map((f) => path.basename(f, ".json"));

    for (let i = 1; i <= 18; i++) {
      const targetId = `S${i.toString().padStart(2, "0")}`;
      expect(ids).toContain(targetId);
    }
  });
});

describe("Evaluation Runner - Execution & Safety Gate Verification", () => {
  it("executes the full fixture suite against defaultWorkflowSpec and passes all safety gates", () => {
    const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
    const fixtures: FixtureV1[] = files
      .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf-8")) as FixtureV1)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const run = executeEvaluation(fixtures, defaultWorkflowSpec);

    // Verify stored run metadata
    expect(run.id).toMatch(/^RUN-\d+$/);
    expect(run.policyVersion).toBe(defaultWorkflowSpec.spec_version);
    expect(run.contentHash).toBe(defaultWorkflowSpec.content_hash);
    expect(run.fixturesHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(run.results.length).toBe(fixtures.length);

    // Every fixture must have measured latency > 0 from performance.now()
    for (const res of run.results) {
      expect(typeof res.latencyMs).toBe("number");
      expect(res.latencyMs).toBeGreaterThan(0);
      expect(res.passed).toBe(true);
    }

    // Dynamic metrics
    expect(run.metrics.total).toBe(fixtures.length);
    expect(run.metrics.passed).toBe(fixtures.length);
    expect(run.metrics.failed).toBe(0);
    expect(run.metrics.criticalMisses).toBe(0);
    expect(run.metrics.safetyGate).toBe("PASS");
    expect(run.metrics.routeAccuracy.percentage).toBe(100);
    expect(run.metrics.reviewRequiredRecall.percentage).toBe(100);
    expect(run.metrics.routineSpecificity.percentage).toBe(100);
    expect(run.metrics.falseEscalations.percentage).toBe(0);
    expect(run.metrics.inputValidationPassRate.percentage).toBe(100);
    expect(run.metrics.latencyP50Ms).toBeGreaterThan(0);
    expect(run.metrics.latencyP95Ms).toBeGreaterThanOrEqual(run.metrics.latencyP50Ms);
  });

  it("trips the safety gate to UNSAFE when a critical miss is injected", () => {
    const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
    const fixtures: FixtureV1[] = files
      .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf-8")) as FixtureV1)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    const run = executeEvaluation(fixtures, defaultWorkflowSpec, {
      injectCriticalMiss: true,
    });

    const s05Result = run.results.find((r) => r.id === "S05");
    expect(s05Result).toBeDefined();
    expect(s05Result?.expectedRoute).toBe("HUMAN_REVIEW_REQUIRED");
    expect(s05Result?.actualRoute).toBe("DRAFT_FOR_REVIEW");
    expect(s05Result?.isCriticalMiss).toBe(true);
    expect(s05Result?.passed).toBe(false);

    expect(run.metrics.criticalMisses).toBe(1);
    expect(run.metrics.safetyGate).toBe("UNSAFE");
    expect(run.metrics.reviewRequiredRecall.percentage).toBeLessThan(100);
    expect(run.metrics.reviewRequiredRecall.numerator).toBe(
      run.metrics.reviewRequiredRecall.denominator - 1
    );
  });
});

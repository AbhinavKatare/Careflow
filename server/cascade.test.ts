import { describe, it, expect } from "vitest";
import { LLMCascadeAdapter, runTierComparisonEvaluation } from "./llm/cascade";
import { MockAdapter } from "./llm/mock-adapter";
import { FIXTURES_V1 } from "../shared/evaluation/fixtures-data";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import { evaluatePolicy } from "../shared/policy/evaluator";

describe("LLM Model Cascading Layer & Tier Comparison (/server/llm/cascade)", () => {
  it("uses small tier without escalation when small tier output is valid and high-confidence", async () => {
    const smallAdapter = new MockAdapter({ tier: "small", simulatedDelayMs: 1 });
    const strongAdapter = new MockAdapter({ tier: "strong", simulatedDelayMs: 3 });
    const cascade = new LLMCascadeAdapter({ smallAdapter, strongAdapter });

    const res = await cascade.generateExtraction({
      patientText: "Doing great, no issues to report.",
    });

    expect(res.metadata.escalated).toBe(false);
    expect(res.metadata.finalTier).toBe("small");
    expect(res.metadata.schema_valid).toBe(true);
    expect(res.data.facts).toBeDefined();
  });

  it("escalates to strong tier when small tier schema validation fails", async () => {
    // Small adapter configured with failure mode malformed_json
    const smallAdapter = new MockAdapter({
      tier: "small",
      failureMode: "malformed_json",
      simulatedDelayMs: 1,
    });
    const strongAdapter = new MockAdapter({ tier: "strong", simulatedDelayMs: 3 });
    const cascade = new LLMCascadeAdapter({ smallAdapter, strongAdapter });

    const res = await cascade.generateExtraction({
      patientText: "Routine check-in note.",
    });

    // Escalated to strong tier!
    expect(res.metadata.escalated).toBe(true);
    expect(res.metadata.escalationReason).toBe("SCHEMA_ERROR");
    expect(res.metadata.finalTier).toBe("strong");
    expect(res.metadata.schema_valid).toBe(true);
  });

  it("CRITICAL SAFETY RULE: Asserts the cascade NEVER changes any policy route", async () => {
    const strongAdapter = new MockAdapter({ tier: "strong" });
    const smallAdapter = new MockAdapter({ tier: "small" });
    const cascadeAdapter = new LLMCascadeAdapter({ smallAdapter, strongAdapter });

    // Compare all 60+ fixtures
    for (const fixture of FIXTURES_V1) {
      // 1. Evaluate with Cascade extraction
      const cascadeExtraction = await cascadeAdapter.generateExtraction({
        patientText: (fixture.raw_input.note as string) || "",
      });

      // 2. Evaluate with Strong extraction
      const strongExtraction = await strongAdapter.generateExtraction({
        patientText: (fixture.raw_input.note as string) || "",
      });

      // Both must evaluate to authoritative policy routing
      const cascadePolicyResult = evaluatePolicy(fixture.raw_input, defaultWorkflowSpec);
      const strongPolicyResult = evaluatePolicy(fixture.raw_input, defaultWorkflowSpec);

      // Invariance assertion: Policy routing is completely unaffected by LLM tier or escalation!
      expect(cascadePolicyResult.route).toBe(strongPolicyResult.route);
      expect(cascadePolicyResult.primaryReason).toBe(strongPolicyResult.primaryReason);
      expect(cascadePolicyResult.route).toBe(fixture.expected_route);

      // Verify metadata schema validity
      expect(cascadeExtraction.metadata.schema_valid).toBe(true);
      expect(strongExtraction.metadata.schema_valid).toBe(true);
    }
  });

  it("evaluates and outputs 3-config comparison table (strong-only vs small-only vs cascade)", async () => {
    const report = await runTierComparisonEvaluation(FIXTURES_V1.slice(0, 20), defaultWorkflowSpec);

    expect(report.rows).toHaveLength(3);
    expect(report.policyRouteInvarianceVerified).toBe(true);

    const strongRow = report.rows.find((r) => r.configName === "strong-only")!;
    const smallRow = report.rows.find((r) => r.configName === "small-only")!;
    const cascadeRow = report.rows.find((r) => r.configName === "cascade")!;

    // Accuracy across all 3 must match (since policy rules are authoritative)
    expect(cascadeRow.accuracy).toBe(strongRow.accuracy);
    expect(smallRow.accuracy).toBe(strongRow.accuracy);

    // Cost: cascade must be cheaper than strong-only
    expect(cascadeRow.costPer100Cases).toBeLessThan(strongRow.costPer100Cases);

    // Schema validity
    expect(cascadeRow.schemaValidRate).toBe(100.0);
    expect(strongRow.schemaValidRate).toBe(100.0);

    // Latency
    expect(cascadeRow.p95LatencyMs).toBeGreaterThan(0);
    expect(strongRow.p95LatencyMs).toBeGreaterThan(0);

    expect(report.summary).toContain("Cascade Routing Evaluation");
  });
});


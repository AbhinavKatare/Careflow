import { describe, it, expect } from "vitest";
import {
  weeklyCheckInSpec,
  postVisitSpec,
  medicationAdherenceSpec,
} from "../server/compiler/canned-proposals";
import { runMutationHarness } from "../server/mutation/runner";
import { generateFixtureSuite } from "../server/compiler/generator";
import type { GeneratedFixture } from "../server/compiler/types";

describe("Policy Engine Mutation Testing Harness (/server/mutation)", () => {
  const specs = [
    { name: "Weekly Check-in", spec: weeklyCheckInSpec },
    { name: "Post-Visit Follow-Up", spec: postVisitSpec },
    { name: "Medication Adherence", spec: medicationAdherenceSpec },
  ];

  for (const { name, spec } of specs) {
    it(`computes mutation score and runs mutants across all categories for ${name}`, () => {
      const report = runMutationHarness(spec, { minimumScoreThreshold: 75 });

      expect(report.totalMutants).toBeGreaterThan(15);
      expect(report.killedMutants).toBeGreaterThan(0);
      expect(report.mutationScore).toBeGreaterThanOrEqual(75);

      // Verify category breakdown is populated
      expect(report.categoryBreakdown.DELETE_RULE.total).toBeGreaterThan(0);
      expect(report.categoryBreakdown.FLIP_ROUTE.total).toBeGreaterThan(0);
      expect(report.categoryBreakdown.WIDEN_THRESHOLD.total).toBeGreaterThan(0);
      expect(report.categoryBreakdown.NARROW_THRESHOLD.total).toBeGreaterThan(0);
      expect(report.categoryBreakdown.DROP_NORMALIZATION.total).toBeGreaterThan(0);
      expect(report.categoryBreakdown.REORDER_RULES.total).toBeGreaterThan(0);
      expect(report.categoryBreakdown.WEAKEN_INSTRUCTION_TEXT.total).toBeGreaterThan(0);
    });
  }

  it("gate BLOCKS a spec when tested against a weak/insufficient test suite", () => {
    // Only 2 minimal fixtures (weak suite)
    const weakSuite: GeneratedFixture[] = [
      {
        id: "WEAK-001",
        rawInput: {
          patientId: "DEMO-001",
          weekStatus: "On track with my weekly routine",
          followUp: "no",
          note: "",
        },
        provenance: { ruleId: "RULE_ROUTINE_ON_TRACK", templateKey: "weak", description: "weak" },
        expected_route: "DRAFT_FOR_REVIEW",
        tags: ["weak"],
        rationale: "routine",
      },
      {
        id: "WEAK-002",
        rawInput: {
          patientId: "DEMO-002",
          weekStatus: "I have a question for the care team",
          followUp: "yes",
          note: "Question",
        },
        provenance: { ruleId: "RULE_EXPLICIT_FOLLOWUP_REQUEST", templateKey: "weak", description: "weak" },
        expected_route: "HUMAN_REVIEW_REQUIRED",
        tags: ["weak"],
        rationale: "question",
      },
    ];

    const report = runMutationHarness(weeklyCheckInSpec, {
      fixtures: weakSuite,
      minimumScoreThreshold: 80,
    });

    // Score is low and severity-lowering mutants survive -> Gate MUST FAIL
    expect(report.gateStatus).toBe("FAIL");
    expect(report.mutationScore).toBeLessThan(80);
    expect(report.severityLoweringSurvivingCount).toBeGreaterThan(0);
    expect(report.gateFailureReason).toBeDefined();
    expect(report.gateFailureReason).toContain("GATE TRIP");
  });

  it("investigating and killing a surviving mutant with a targeted test fixture", () => {
    // Generate baseline suite
    const suite = generateFixtureSuite(weeklyCheckInSpec, { seed: 42 });

    // Exclude any fixtures that have note length > 500
    // simulating a gap in the test suite where the threshold widening mutant survives
    const suiteWithoutBoundary = suite.fixtures.filter(
      (f) =>
        !f.rawInput.note ||
        (typeof f.rawInput.note === "string" && f.rawInput.note.length <= 500)
    );

    // Initial run without the targeted boundary fixture
    const initialReport = runMutationHarness(weeklyCheckInSpec, {
      fixtures: suiteWithoutBoundary,
    });

    // Find if the threshold-widening mutant survived
    const survivedMutant = initialReport.survivingMutantsList.find(
      (m) => m.mutant.operator === "WIDEN_THRESHOLD" && m.mutant.lowersSeverity
    );
    expect(survivedMutant).toBeDefined();

    // Now ADD the targeted boundary fixture that kills the threshold widening mutant!
    const targetedKillerFixture: GeneratedFixture = {
      id: "TARGETED-KILLER-001",
      rawInput: {
        patientId: "DEMO-999",
        patientName: "Demo Patient Boundary Killer",
        weekStatus: "On track with my weekly routine",
        followUp: "no",
        note: "A".repeat(501), // Exactly 501 chars (limit 500) -> kills WIDEN_THRESHOLD (which widens limit to 600)
      },
      provenance: {
        ruleId: "RULE_NOTE_LENGTH_EXCEEDED",
        templateKey: "boundary_kill_widening",
        description: "Targeted boundary fixture to kill WIDEN_THRESHOLD mutant.",
      },
      expected_route: "INPUT_ERROR",
      tags: ["targeted_killer", "boundary"],
      rationale: "Note length 501 strictly exceeds limit 500, catching threshold widening mutants.",
    };

    const enhancedSuite = [...suiteWithoutBoundary, targetedKillerFixture];
    const enhancedReport = runMutationHarness(weeklyCheckInSpec, {
      fixtures: enhancedSuite,
    });

    // Verify the mutant was killed by the new fixture!
    const killedResult = enhancedReport.survivingMutantsList.find(
      (m) => m.mutant.id === survivedMutant?.mutant.id
    );
    expect(killedResult).toBeUndefined(); // It is no longer surviving!
    expect(enhancedReport.killedMutants).toBeGreaterThanOrEqual(initialReport.killedMutants + 1);
  });
});


import { describe, it, expect } from "vitest";
import {
  generateFixtureSuiteForSpec,
  weeklyCheckInSpec,
  postVisitSpec,
  medicationAdherenceSpec,
} from "./compiler";

describe("Reproducible Fixture Suite Generator (/server/compiler/generator)", () => {
  const specs = [
    { name: "Weekly Check-in", spec: weeklyCheckInSpec },
    { name: "Post-Visit Follow-Up", spec: postVisitSpec },
    { name: "Medication Adherence", spec: medicationAdherenceSpec },
  ];

  for (const { name, spec } of specs) {
    it(`generates 80+ fixtures for ${name} with >= 95% rule coverage`, () => {
      const suite = generateFixtureSuiteForSpec(spec, 42);

      // Check 1: 80+ fixtures generated
      expect(suite.fixtures.length).toBeGreaterThanOrEqual(80);

      // Check 2: >= 95% rule coverage
      expect(suite.coverage.coveragePercentage).toBeGreaterThanOrEqual(95);
      expect(suite.coverage.coveredRuleIds.length).toBeGreaterThanOrEqual(
        Math.floor(suite.coverage.totalRules * 0.95)
      );

      // Check 3: Every fixture has provenance and independently computed expected route
      for (const fixture of suite.fixtures) {
        expect(fixture.id).toBeDefined();
        expect(fixture.provenance).toBeDefined();
        expect(fixture.provenance.templateKey).toBeDefined();
        expect(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]).toContain(
          fixture.expected_route
        );

        // Check 4: No outcome-encoding flags in raw input! (Permanent Agent Rule 4)
        const raw = fixture.rawInput as Record<string, unknown>;
        expect(raw.controlledUrgentFixture).toBeUndefined();
        expect(raw.unsupportedDraftClaim).toBeUndefined();
        expect(raw.generationFailure).toBeUndefined();
        expect(raw.contradiction).toBeUndefined();
      }

      // Check 5: Categories are represented
      expect(suite.coverage.categoryBreakdown.positiveCases).toBeGreaterThan(0);
      expect(suite.coverage.categoryBreakdown.boundaryCases).toBeGreaterThan(0);
      expect(suite.coverage.categoryBreakdown.negationVariants).toBeGreaterThan(0);
      expect(suite.coverage.categoryBreakdown.normalizationAttacks).toBeGreaterThan(0);
      expect(suite.coverage.categoryBreakdown.contradictionPairs).toBeGreaterThan(0);
      expect(suite.coverage.categoryBreakdown.promptInjections).toBeGreaterThan(0);
    });

    it(`regeneration with the same seed is byte-identical for ${name}`, () => {
      const suiteRun1 = generateFixtureSuiteForSpec(spec, 42);
      const suiteRun2 = generateFixtureSuiteForSpec(spec, 42);

      const json1 = JSON.stringify(suiteRun1);
      const json2 = JSON.stringify(suiteRun2);

      expect(json1).toBe(json2);
    });

    it(`different seeds produce different fixture selections for ${name}`, () => {
      const suiteSeed42 = generateFixtureSuiteForSpec(spec, 42);
      const suiteSeed99 = generateFixtureSuiteForSpec(spec, 99);

      // Both must satisfy constraints
      expect(suiteSeed42.fixtures.length).toBeGreaterThanOrEqual(80);
      expect(suiteSeed99.fixtures.length).toBeGreaterThanOrEqual(80);

      // JSON outputs will differ due to different PRNG choices
      expect(JSON.stringify(suiteSeed42)).not.toBe(JSON.stringify(suiteSeed99));
    });
  }
});

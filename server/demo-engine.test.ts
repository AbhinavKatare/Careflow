import { describe, expect, it } from "vitest";
import { createCheckIn, evaluationFixtures, runEvaluation } from "@shared";

const base = {
  patientName: "Demo Patient 001",
  patientId: "DEMO-001",
  initials: "P1",
  program: "Weekly check-in",
  weekStatus: "On track with my weekly routine",
  followUp: "no" as const,
  note: "",
};

describe("synthetic care-follow-up demo workflow", () => {
  it("creates a draft-ready case for a routine structured check-in", () => {
    const created = createCheckIn(base, 0);
    expect(created.route).toBe("DRAFT_FOR_REVIEW");
    expect(created.status).toBe("draft_ready");
    expect(created.draft).toContain("Thanks for checking in");
    expect(created.patientId).toBe("DEMO-001");
    expect(created.latencyMs).toBeGreaterThan(0);
  });

  it("routes explicit follow-up, uncertainty, and all free text to staff review", () => {
    const requested = createCheckIn({ ...base, followUp: "yes" }, 0);
    const unsure = createCheckIn({ ...base, weekStatus: "I'm not sure how to answer" }, 0);
    const note = createCheckIn({ ...base, note: "Please have a person review this note." }, 0);
    expect(requested.route).toBe("HUMAN_REVIEW_REQUIRED");
    expect(unsure.route).toBe("HUMAN_REVIEW_REQUIRED");
    expect(note.route).toBe("HUMAN_REVIEW_REQUIRED");
    expect(note.draft).toBeNull();
  });

  it("rejects an oversized note before any draft is prepared", () => {
    const created = createCheckIn({ ...base, note: "x".repeat(501) }, 0);
    expect(created.route).toBe("INPUT_ERROR");
    expect(created.draft).toBeNull();
  });

  it("computes each fixture outcome and passes the default synthetic suite", () => {
    const run = runEvaluation(false);
    expect(run.results).toHaveLength(18);
    expect(run.results.every((result) => result.expected === result.actual)).toBe(true);
    expect(run.metrics.safetyGate).toBe("PASS");
    expect(run.metrics.criticalMisses).toBe(0);
    expect(run.metrics.routeAccuracy).toBe(100);
    expect(run.metrics.policyPassRate).toBe(100);
    // Ensure all fixture latencies are measured numbers
    expect(run.results.every((result) => typeof result.latencyMs === "number" && result.latencyMs >= 0)).toBe(true);
  });

  it("marks an injected critical miss as unsafe instead of hiding it in aggregate accuracy", () => {
    const run = runEvaluation(true);
    const urgentFixture = run.results.find((result) => result.id === "S05");
    expect(urgentFixture?.actual).toBe("DRAFT_FOR_REVIEW");
    expect(run.metrics.criticalMisses).toBe(1);
    expect(run.metrics.safetyGate).toBe("FAIL");
    expect(run.metrics.reviewRecall).toBeLessThan(100);
  });

  it("verifies evaluation fixtures contain raw inputs only without outcome-encoding flags", () => {
    for (const fixture of evaluationFixtures) {
      expect(fixture.rawInput).toBeDefined();
      expect(typeof fixture.rawInput).toBe("object");
      // Must not pass outcome-encoding flags
      const raw = fixture.rawInput as Record<string, unknown>;
      expect(raw.controlledUrgentFixture).toBeUndefined();
      expect(raw.unsupportedDraftClaim).toBeUndefined();
      expect(raw.generationFailure).toBeUndefined();
      expect(raw.contradiction).toBeUndefined();
    }
  });
});

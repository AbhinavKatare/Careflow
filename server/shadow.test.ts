import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "./db";
import {
  generateSyntheticHistoricalCases,
  SYNTHETIC_BASELINE_DISCLAIMER,
} from "./shadow/historical-dataset";
import { runShadowEvaluation } from "./shadow/runner";
import {
  weeklyCheckInSpec,
  unsafeProposalSpec,
} from "./compiler/canned-proposals";

describe("Policy Engine Shadow Run Harness (/server/shadow)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initDatabase(db);
  });

  it("generates exactly 300 deterministic synthetic historical cases with baseline labels", () => {
    const cases = generateSyntheticHistoricalCases(1337);

    expect(cases).toHaveLength(300);
    expect(cases[0].caseId).toBe("HIST-0001");
    expect(cases[299].caseId).toBe("HIST-0300");

    // All patient IDs are fake
    for (const c of cases) {
      expect(c.patientId).toMatch(/^(DEMO-.*|)$/);
      expect(c.baselineLabel).toBeDefined();
      expect(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]).toContain(
        c.baselineLabel.baselineRoute
      );
    }

    // Byte-identical reproduction with same seed
    const casesRun2 = generateSyntheticHistoricalCases(1337);
    expect(JSON.stringify(cases)).toBe(JSON.stringify(casesRun2));
  });

  it("replays 300 historical cases through weeklyCheckInSpec with safe gate status and zero deliverables", () => {
    const report = runShadowEvaluation(weeklyCheckInSpec, { db });

    expect(report.totalCases).toBe(300);
    expect(report.agreedCases).toBeGreaterThan(250);
    expect(report.agreementRate).toBeGreaterThan(85);

    // Gate should pass because weeklyCheckInSpec does not under-escalate
    expect(report.unsafeDisagreements).toHaveLength(0);
    expect(report.gateStatus).toBe("PASS");
    expect(report.gateFailureReason).toBeUndefined();

    // Disclaimer clearly states synthetic demo
    expect(report.disclaimer).toBe(SYNTHETIC_BASELINE_DISCLAIMER);

    // Disagreement taxonomy is computed
    expect(report.taxonomyBreakdown).toBeDefined();
    expect(typeof report.taxonomyBreakdown.OVER_ESCALATION).toBe("number");
    expect(typeof report.taxonomyBreakdown.UNDER_ESCALATION).toBe("number");

    // Candidate vs. Current comparison is computed dynamically
    expect(report.comparison).toBeDefined();
    expect(report.comparison.candidateAgreementRate).toBe(report.agreementRate);
  });

  it("safety gate trips and BLOCKS candidate spec if any under-escalation occurs", () => {
    // unsafeProposalSpec routes distress keywords (chest pain) to DRAFT_FOR_REVIEW
    // When replaying the 300 cases, it will under-escalate acute distress cases!
    const report = runShadowEvaluation(unsafeProposalSpec, { db });

    // Must be blocked!
    expect(report.gateStatus).toBe("FAIL_BLOCKED_BY_UNDER_ESCALATION");
    expect(report.unsafeDisagreements.length).toBeGreaterThan(0);
    expect(report.gateFailureReason).toContain("SAFETY GATE TRIPPED");

    // Each unsafe disagreement provides individual drill-down
    for (const unsafe of report.unsafeDisagreements) {
      expect(unsafe.unsafe).toBe(true);
      expect(unsafe.candidateRoute).toBe("DRAFT_FOR_REVIEW");
      expect(unsafe.baselineRoute).not.toBe("DRAFT_FOR_REVIEW");
      expect(unsafe.caseId).toBeDefined();
      expect(unsafe.rationale).toBeDefined();
    }
  });

  it("appends to append-only audit trail and does not execute any outbound effects", () => {
    runShadowEvaluation(weeklyCheckInSpec, { db });

    const auditRows = db
      .prepare("SELECT * FROM audit_events WHERE entity_type = 'WorkflowSpec'")
      .all() as any[];

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const lastEvent = auditRows[auditRows.length - 1];
    expect(lastEvent.action).toContain("Shadow run");
    expect(lastEvent.detail.toLowerCase()).toContain("simulated, nothing sent externally");
  });
});


import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "./db";
import { generateSyntheticTraffic } from "./traffic/generator";
import { computeWindowMetrics, evaluateDrift } from "./drift/detector";
import { runCanaryTraffic } from "./canary/runner";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import {
  weeklyCheckInSpec,
  unsafeProposalSpec,
} from "./compiler/canned-proposals";
import { verifyAuditTrail } from "./audit-chain";

describe("Synthetic Traffic, Drift Detection & Canary Rollback (/server/traffic, /server/drift, /server/canary)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initDatabase(db);
  });

  describe("Seeded Synthetic Traffic Generator", () => {
    it("generates byte-identical synthetic traffic with identical seed", () => {
      const batch1 = generateSyntheticTraffic({
        seed: 42,
        count: 50,
        newPhrasingRate: 0.1,
        moreFreeTextRate: 0.1,
        higherUncertaintyRate: 0.1,
        newInjectionRate: 0.05,
      });

      const batch2 = generateSyntheticTraffic({
        seed: 42,
        count: 50,
        newPhrasingRate: 0.1,
        moreFreeTextRate: 0.1,
        higherUncertaintyRate: 0.1,
        newInjectionRate: 0.05,
      });

      expect(batch1.cases.length).toBe(50);
      expect(batch2.cases.length).toBe(50);
      expect(JSON.stringify(batch1)).toBe(JSON.stringify(batch2));
    });

    it("synthesizes raw inputs only with ZERO outcome-encoding flags", () => {
      const batch = generateSyntheticTraffic({
        seed: 123,
        count: 40,
        newPhrasingRate: 0.2,
        moreFreeTextRate: 0.3,
        higherUncertaintyRate: 0.3,
        newInjectionRate: 0.1,
      });

      for (const c of batch.cases) {
        expect(c.submission.patientId).toMatch(/^DEMO-\d+$/);
        expect(c.submission).not.toHaveProperty("expectedRoute");
        expect(c.submission).not.toHaveProperty("route");
        expect(c.submission).not.toHaveProperty("contradiction");
        expect(c.submission).not.toHaveProperty("isCritical");
        expect(c.submission).not.toHaveProperty("actual");
      }
    });

    it("controls distribution shift along requested axes", () => {
      const lowUncertainty = generateSyntheticTraffic({
        seed: 77,
        count: 100,
        newPhrasingRate: 0.0,
        moreFreeTextRate: 0.0,
        higherUncertaintyRate: 0.0,
        newInjectionRate: 0.0,
      });

      const highUncertainty = generateSyntheticTraffic({
        seed: 77,
        count: 100,
        newPhrasingRate: 0.0,
        moreFreeTextRate: 0.0,
        higherUncertaintyRate: 0.6,
        newInjectionRate: 0.0,
      });

      const lowUncertaintyTags = lowUncertainty.cases.filter((c) =>
        c.shiftTags.includes("shift_uncertainty")
      ).length;
      const highUncertaintyTags = highUncertainty.cases.filter((c) =>
        c.shiftTags.includes("shift_uncertainty")
      ).length;

      expect(highUncertaintyTags).toBeGreaterThan(lowUncertaintyTags + 40);
    });
  });

  describe("Explainable Drift Monitoring", () => {
    it("reports NORMAL status when candidate traffic matches baseline operating parameters", () => {
      const baselineBatch = generateSyntheticTraffic({
        seed: 101,
        count: 60,
        newPhrasingRate: 0.05,
        moreFreeTextRate: 0.05,
        higherUncertaintyRate: 0.05,
        newInjectionRate: 0.0,
      });
      const currentBatch = generateSyntheticTraffic({
        seed: 102,
        count: 60,
        newPhrasingRate: 0.05,
        moreFreeTextRate: 0.05,
        higherUncertaintyRate: 0.05,
        newInjectionRate: 0.0,
      });

      const baselineMetrics = computeWindowMetrics(baselineBatch.cases);
      const currentMetrics = computeWindowMetrics(currentBatch.cases);

      const report = evaluateDrift(baselineMetrics, currentMetrics);

      expect(report.overallAlertLevel).toBe("NORMAL");
      expect(report.hasActiveAlert).toBe(false);
      expect(report.metricDrifts.routeMix.statisticValue).toBeLessThan(0.15); // TVD < 0.15
      expect(report.summaryText).toContain("STABLE");
    });

    it("trips DRIFT_ALERT when significant route mix shift is injected", () => {
      const baselineBatch = generateSyntheticTraffic({
        seed: 201,
        count: 60,
        newPhrasingRate: 0.0,
        moreFreeTextRate: 0.0,
        higherUncertaintyRate: 0.05, // low escalation
        newInjectionRate: 0.0,
      });
      // Injected shift: 70% uncertainty and lengthy free text -> causes massive surge in HUMAN_REVIEW_REQUIRED
      const shiftedBatch = generateSyntheticTraffic({
        seed: 202,
        count: 60,
        newPhrasingRate: 0.4,
        moreFreeTextRate: 0.6,
        higherUncertaintyRate: 0.7,
        newInjectionRate: 0.1,
      });

      const baselineMetrics = computeWindowMetrics(baselineBatch.cases);
      const shiftedMetrics = computeWindowMetrics(shiftedBatch.cases);

      const report = evaluateDrift(baselineMetrics, shiftedMetrics);

      expect(report.overallAlertLevel).toBe("DRIFT_ALERT");
      expect(report.hasActiveAlert).toBe(true);
      expect(report.metricDrifts.routeMix.alertLevel).toBe("DRIFT_ALERT");
      expect(report.metricDrifts.routeMix.statisticValue).toBeGreaterThanOrEqual(0.25); // TVD >= 0.25
      expect(report.metricDrifts.routeMix.explanation).toContain("Total Variation Distance");
    });

    it("trips schema failure and edit distance alerts when adversarial text is injected", () => {
      const baselineBatch = generateSyntheticTraffic({
        seed: 301,
        count: 50,
        newPhrasingRate: 0.0,
        moreFreeTextRate: 0.0,
        higherUncertaintyRate: 0.0,
        newInjectionRate: 0.0,
      });
      const injectionBatch = generateSyntheticTraffic({
        seed: 302,
        count: 50,
        newPhrasingRate: 0.1,
        moreFreeTextRate: 0.5,
        higherUncertaintyRate: 0.1,
        newInjectionRate: 0.25, // 25% adversarial injection strings
      });

      const baselineMetrics = computeWindowMetrics(baselineBatch.cases);
      const currentMetrics = computeWindowMetrics(injectionBatch.cases);

      const report = evaluateDrift(baselineMetrics, currentMetrics);

      expect(report.hasActiveAlert).toBe(true);
      expect(report.metricDrifts.schemaFailureRate.alertLevel).toBe("DRIFT_ALERT");
      expect(report.metricDrifts.schemaFailureRate.currentValue).toBeGreaterThan(baselineMetrics.schemaFailureRate);
    });
  });

  describe("Canary Deployment & Automatic Config Rollback", () => {
    const proposalId = "prop_canary_test_001";

    it("runs safe canary without triggering rollback when candidate behaves safely", () => {
      const traffic = generateSyntheticTraffic({
        seed: 401,
        count: 40,
        newPhrasingRate: 0.1,
        moreFreeTextRate: 0.1,
        higherUncertaintyRate: 0.1,
        newInjectionRate: 0.0,
      });

      // Healthy candidate: weeklyCheckInSpec behaves in alignment with active spec
      const res = runCanaryTraffic(
        {
          proposalId,
          activeSpec: defaultWorkflowSpec,
          candidateSpec: weeklyCheckInSpec,
          previousActiveSpec: defaultWorkflowSpec,
          trafficShare: 0.25, // 25% canary traffic
        },
        traffic.cases,
        db
      );

      expect(res.breachDetected).toBe(false);
      expect(res.rolledBack).toBe(false);
      expect(res.canaryCount).toBeGreaterThan(0);
      expect(res.activeCount).toBeGreaterThan(res.canaryCount);
      expect(res.activeSpecVersion).toBe(defaultWorkflowSpec.spec_version);
    });

    it("CRITICAL SAFETY RULE: Unsafe candidate trips canary breach and triggers automatic rollback", () => {
      // Initialize ladder state in DB for the proposal
      db.prepare(
        `INSERT INTO spec_activation_ladder (proposal_id, spec_version, current_stage, active_spec_hash, sign_offs)
         VALUES (?, ?, 'Active', ?, '[]')`
      ).run(proposalId, "2.0.0-unsafe", unsafeProposalSpec.content_hash);

      // Traffic containing patient notes requiring human review
      const traffic = generateSyntheticTraffic({
        seed: 501,
        count: 50,
        newPhrasingRate: 0.2,
        moreFreeTextRate: 0.5,
        higherUncertaintyRate: 0.3,
        newInjectionRate: 0.0,
      });

      // Inject acute symptom note on a canary case (i = 0 is evaluated by canary)
      traffic.cases[0].submission.note = "Experienced acute chest pain and shortness of breath this morning.";

      // Unsafe candidate routes distress/notes to DRAFT_FOR_REVIEW
      const res = runCanaryTraffic(
        {
          proposalId,
          activeSpec: defaultWorkflowSpec,
          candidateSpec: unsafeProposalSpec,
          previousActiveSpec: weeklyCheckInSpec, // safe previous active spec
          trafficShare: 0.3, // 30% canary
          maxUnderEscalations: 0, // 0 tolerance
        },
        traffic.cases,
        db
      );

      // Must detect breach and execute rollback!
      expect(res.breachDetected).toBe(true);
      expect(res.breachReason).toContain("Under-escalation breach");
      expect(res.rolledBack).toBe(true);
      expect(res.rolledBackToSpecVersion).toBe(weeklyCheckInSpec.spec_version);
      expect(res.rolledBackToSpecHash).toBe(weeklyCheckInSpec.content_hash);
      expect(res.auditEventId).toBeDefined();

      // Verify audit chain record was appended
      const auditVerification = verifyAuditTrail(db);
      expect(auditVerification.valid).toBe(true);

      const auditRow = db
        .prepare("SELECT * FROM audit_events WHERE id = ?")
        .get(res.auditEventId) as Record<string, unknown>;
      expect(auditRow).toBeDefined();
      expect(auditRow.action).toContain("Canary breach: automatic rollback");
      expect(auditRow.actor).toBe("SYSTEM");
    });
  });
});

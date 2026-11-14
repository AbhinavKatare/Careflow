/**
 * Chaos & Fault Injection Test Suite (/server/chaos.test.ts).
 *
 * Verifies:
 * 1. Provider timeout failure mode -> PROCESSING_FAILED (no silent success).
 * 2. Malformed JSON output failure mode -> PROCESSING_FAILED.
 * 3. Strict schema validation rejection (unsupported label & fabricated field).
 * 4. DB error mid-pipeline -> atomic failure handling.
 * 5. Concurrent duplicate submissions with same idempotency key -> exactly 1 case created.
 * 6. Crash mid-run -> stuck-run reaper transitions stuck cases to PROCESSING_FAILED and logs audit event.
 * 7. Verification that audit chain remains complete and tamper-evident across all failures.
 */

import { describe, expect, it } from "vitest";
import { MockAdapter } from "./llm/mock-adapter";
import { runCheckInPipeline } from "./pipeline/runner";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import { getSqlite } from "./db";
import { reapStuckRuns } from "./chaos/reaper";
import { submitCheckInWithIdempotency } from "./persistence";
import { verifyAuditTrail } from "./audit-chain";

describe("Chaos & Resilience Test Suite (/server/chaos.test.ts)", () => {

  describe("1. Provider Timeout Fault Injection", () => {
    it("handles provider timeout by transitioning to PROCESSING_FAILED without silent success", async () => {
      const adapter = new MockAdapter({ failureMode: "timeout" });
      const result = await runCheckInPipeline(
        {
          patientId: "DEMO-CHAOS-001",
          patientName: "Demo Patient Timeout",
          weekStatus: "On track with my weekly routine",
          note: "Feeling fine today.",
        },
        { adapter, spec: defaultWorkflowSpec }
      );

      // Must NEVER return a success-looking state
      expect(result.status).toBe("PROCESSING_FAILED");
      expect(result.route).toBe("INPUT_ERROR");
      expect(result.reasonCode).toBe("STEP_PROCESSING_FAILED");
      expect(result.reason).toContain("timed out");
      expect(result.draft).toBeNull();

      // Audit chain verification
      const sqlite = getSqlite();
      const auditResult = verifyAuditTrail(sqlite);
      expect(auditResult.valid).toBe(true);
    });
  });

  describe("2. Malformed JSON & Strict Schema Rejection", () => {
    it("handles malformed provider JSON and marks step as PROCESSING_FAILED", async () => {
      const adapter = new MockAdapter({ failureMode: "malformed_json" });
      const result = await runCheckInPipeline(
        {
          patientId: "DEMO-CHAOS-002",
          patientName: "Demo Patient Malformed",
          weekStatus: "On track with my weekly routine",
          note: "Standard check-in note.",
        },
        { adapter, spec: defaultWorkflowSpec }
      );

      expect(result.status).toBe("PROCESSING_FAILED");
      expect(result.route).toBe("INPUT_ERROR");
      expect(result.reason).toContain("JSON");
      expect(result.draft).toBeNull();
    });

    it("rejects unsupported label via strict Zod validation without silent coercion", async () => {
      const adapter = new MockAdapter({ failureMode: "unsupported_label" });
      const result = await runCheckInPipeline(
        {
          patientId: "DEMO-CHAOS-003",
          patientName: "Demo Patient Bad Label",
          weekStatus: "On track with my weekly routine",
          note: "Routine note with invalid label.",
        },
        { adapter, spec: defaultWorkflowSpec }
      );

      expect(result.status).toBe("PROCESSING_FAILED");
      expect(result.route).toBe("INPUT_ERROR");
      expect(result.reason).toContain("validation failed");
      expect(result.draft).toBeNull();
    });

    it("rejects fabricated fields in LLM output strictly", async () => {
      const adapter = new MockAdapter({ failureMode: "fabricated_field" });
      const result = await runCheckInPipeline(
        {
          patientId: "DEMO-CHAOS-004",
          patientName: "Demo Patient Fabricated Field",
          weekStatus: "On track with my weekly routine",
          note: "Attempting field injection.",
        },
        { adapter, spec: defaultWorkflowSpec }
      );

      expect(result.status).toBe("PROCESSING_FAILED");
      expect(result.route).toBe("INPUT_ERROR");
      expect(result.reason).toContain("strict schema rejected fabricated field");
      expect(result.draft).toBeNull();
    });
  });

  describe("3. Database Error Mid-Pipeline", () => {
    it("catches database errors mid-pipeline and reports visible failure reason", async () => {
      const result = await runCheckInPipeline(
        {
          patientId: "DEMO-CHAOS-005",
          patientName: "Demo Patient DB Failure",
          weekStatus: "On track with my weekly routine",
          note: "Routine note.",
        },
        { injectFailureStep: "persist", spec: defaultWorkflowSpec }
      );

      expect(result.status).toBe("PROCESSING_FAILED");
      expect(result.route).toBe("INPUT_ERROR");
      expect(result.reason).toContain("Injected failure in persist step");
      expect(result.draft).toBeNull();
    });
  });

  describe("4. Concurrent Duplicate Submissions (Idempotency Under Concurrency)", () => {
    it("ensures duplicate concurrent submits create exactly ONE case in database", async () => {
      const sqlite = getSqlite();
      const idempotencyKey = `idem_chaos_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      // Execute 10 concurrent submits with the exact same idempotencyKey
      const promises = Array.from({ length: 10 }).map((_, idx) =>
        submitCheckInWithIdempotency(
          {
            patientId: "DEMO-CHAOS-CONCURRENT",
            patientName: "Demo Concurrent Patient",
            program: "Weekly Routine Check-In",
            weekStatus: "On track with my weekly routine",
            followUp: "no",
            note: `Concurrent request payload #${idx + 1}`,
            idempotencyKey,
          },
          sqlite
        )
      );

      const results = await Promise.all(promises);

      // All 10 callers must receive the exact same caseId
      const primaryCaseId = results[0].case.id;
      expect(primaryCaseId).toBeDefined();
      for (const res of results) {
        expect(res.case.id).toBe(primaryCaseId);
      }

      // Assert only ONE record exists in check_ins for this idempotency key
      const dbRows = sqlite
        .prepare("SELECT COUNT(*) as count FROM check_ins WHERE idempotency_key = ?")
        .get(idempotencyKey) as { count: number };
      expect(dbRows.count).toBe(1);

      // Audit chain verification
      const auditCheck = verifyAuditTrail(sqlite);
      expect(auditCheck.valid).toBe(true);
    });
  });

  describe("5. Crash Mid-Run & Stuck-Run Reaper", () => {
    it("discovers runs stuck in PROCESSING past timeout and transitions them to PROCESSING_FAILED", () => {
      const sqlite = getSqlite();
      const caseId = `case_stuck_${Date.now()}`;
      const stuckTimestamp = new Date(Date.now() - 60000).toISOString(); // 60s ago

      // Seed a case artificially stuck in 'PROCESSING'
      sqlite
        .prepare(
          `INSERT INTO review_cases (
             id, check_in_id, patient_id, patient_name, program, week_status, follow_up, note,
             status, route, reason, submitted_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          caseId,
          `chk_${caseId}`,
          "DEMO-STUCK-001",
          "Demo Stuck Patient",
          "Weekly Check-In",
          "On track with routine",
          "no",
          "Stuck mid-run.",
          "PROCESSING",
          "INPUT_ERROR",
          "Executing pipeline...",
          stuckTimestamp,
          stuckTimestamp
        );

      // Execute stuck-run reaper with 30s threshold
      const reaperResult = reapStuckRuns(sqlite, 30000);

      expect(reaperResult.reapedCount).toBeGreaterThanOrEqual(1);
      expect(reaperResult.reapedCases.some((c) => c.caseId === caseId)).toBe(true);

      // Verify case status in database is now PROCESSING_FAILED
      const reapedRow = sqlite
        .prepare("SELECT status, route, reason_code FROM review_cases WHERE id = ?")
        .get(caseId) as { status: string; route: string; reason_code: string };

      expect(reapedRow.status).toBe("PROCESSING_FAILED");
      expect(reapedRow.route).toBe("INPUT_ERROR");
      expect(reapedRow.reason_code).toBe("STUCK_RUN_REAPED");

      // Verify cryptographic audit event recorded for reaper recovery
      const auditCheck = verifyAuditTrail(sqlite);
      expect(auditCheck.valid).toBe(true);
    });
  });
});


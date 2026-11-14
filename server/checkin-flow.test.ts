import { describe, expect, it, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  CheckInSubmissionSchema,
  processCheckInSubmission,
  resetIdempotencyStore,
  generateIdempotencyKey,
  evaluationFixtures,
  patientOptions,
} from "@shared";
import CheckInPage from "../client/src/pages/CheckInPage";

describe("Mobile-first check-in flow (/web) and validation suite", () => {
  beforeEach(() => {
    resetIdempotencyStore();
  });

  const validPayload = {
    patientId: "DEMO-001",
    patientName: "Demo Patient 001",
    program: "Weekly check-in",
    weekStatus: "On track with my weekly routine",
    followUp: "no" as const,
    note: "Routine non-urgent note.",
    idempotencyKey: "idemp-test-unique-key-001",
  };

  describe("1. Zod Form Validation", () => {
    it("accepts a completely valid submission", () => {
      const parsed = CheckInSubmissionSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it("rejects an empty patient ID", () => {
      const result = CheckInSubmissionSchema.safeParse({
        ...validPayload,
        patientId: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const patientError = result.error.issues.find((i) => i.path[0] === "patientId");
        expect(patientError).toBeDefined();
        expect(patientError?.message).toContain("Please select a patient");
      }
    });

    it("rejects an empty week status selection", () => {
      const result = CheckInSubmissionSchema.safeParse({
        ...validPayload,
        weekStatus: "   ",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const statusError = result.error.issues.find((i) => i.path[0] === "weekStatus");
        expect(statusError).toBeDefined();
        expect(statusError?.message).toContain("Please select your routine status");
      }
    });

    it("rejects an invalid followUp value", () => {
      const result = CheckInSubmissionSchema.safeParse({
        ...validPayload,
        followUp: "maybe" as unknown as "yes",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an oversized free-text note (> 500 characters)", () => {
      const result = CheckInSubmissionSchema.safeParse({
        ...validPayload,
        note: "A".repeat(501),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const noteError = result.error.issues.find((i) => i.path[0] === "note");
        expect(noteError).toBeDefined();
        expect(noteError?.message).toContain("cannot exceed 500 characters");
      }
    });

    it("rejects a missing or overly short idempotency key", () => {
      const result = CheckInSubmissionSchema.safeParse({
        ...validPayload,
        idempotencyKey: "short",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const keyError = result.error.issues.find((i) => i.path[0] === "idempotencyKey");
        expect(keyError).toBeDefined();
      }
    });
  });

  describe("2. Idempotency Key & Double-Submit Protection", () => {
    it("generates collision-resistant idempotency keys with idemp- prefix", () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();
      expect(key1).toMatch(/^idemp-/);
      expect(key2).toMatch(/^idemp-/);
      expect(key1).not.toBe(key2);
    });

    it("processes the initial submission and stores the case record", async () => {
      const res = await processCheckInSubmission(validPayload);
      expect(res.success).toBe(true);
      expect(res.isDuplicate).toBe(false);
      expect(res.caseId).toMatch(/^CHK-\d+/);
      expect(res.route).toBe("HUMAN_REVIEW_REQUIRED"); // Contains non-empty note -> human review
    });

    it("returns cached case on duplicate submission without creating a new case", async () => {
      const first = await processCheckInSubmission(validPayload);
      expect(first.isDuplicate).toBe(false);

      // Re-submit identical idempotencyKey
      const second = await processCheckInSubmission(validPayload);
      expect(second.isDuplicate).toBe(true);
      expect(second.caseId).toBe(first.caseId);
      expect(second.submittedAt).toBe(first.submittedAt);
      expect(second.message).toContain("Duplicate submission recognized");
    });
  });

  describe("3. API Failure and Retry State", () => {
    it("catches and exposes simulated API failures with actionable error message", async () => {
      const failPayload = {
        ...validPayload,
        idempotencyKey: "idemp-fail-test-key-01",
      };

      await expect(
        processCheckInSubmission(failPayload, {
          simulateFailure: true,
          failureMessage: "Simulated gateway timeout",
        })
      ).rejects.toThrow("Simulated gateway timeout");
    });

    it("allows successful retry after an API failure with the same key", async () => {
      const retryPayload = {
        ...validPayload,
        idempotencyKey: "idemp-retry-test-key-02",
      };

      // 1. Initial attempt fails
      await expect(
        processCheckInSubmission(retryPayload, {
          simulateFailure: true,
        })
      ).rejects.toThrow();

      // 2. Retry attempt succeeds
      const retryResult = await processCheckInSubmission(retryPayload, {
        simulateFailure: false,
      });

      expect(retryResult.success).toBe(true);
      expect(retryResult.isDuplicate).toBe(false);
      expect(retryResult.caseId).toBeDefined();
    });
  });

  describe("4. Sample Scenario Loading (S01–S18)", () => {
    it("contains all 18 fixtures for the sample scenario dropdown", () => {
      expect(evaluationFixtures).toHaveLength(18);
      const fixtureIds = evaluationFixtures.map((f) => f.id);
      for (let i = 1; i <= 18; i++) {
        const id = `S${i.toString().padStart(2, "0")}`;
        expect(fixtureIds).toContain(id);
      }
    });

    it("successfully validates and processes routine scenario S01", async () => {
      const s01 = evaluationFixtures.find((f) => f.id === "S01")!;
      const key = generateIdempotencyKey();
      const payload = {
        patientId: s01.rawInput.patientId,
        patientName: s01.rawInput.patientName,
        program: s01.rawInput.program,
        weekStatus: s01.rawInput.weekStatus,
        followUp: s01.rawInput.followUp,
        note: s01.rawInput.note,
        idempotencyKey: key,
      };

      const parsed = CheckInSubmissionSchema.safeParse(payload);
      expect(parsed.success).toBe(true);

      const result = await processCheckInSubmission(payload);
      expect(result.success).toBe(true);
      expect(result.route).toBe("DRAFT_FOR_REVIEW");
      expect(result.status).toBe("draft_ready");
    });

    it("routes urgent scenario S05 to staff review without symptom interpretation", async () => {
      const s05 = evaluationFixtures.find((f) => f.id === "S05")!;
      const key = generateIdempotencyKey();
      const payload = {
        patientId: s05.rawInput.patientId,
        patientName: s05.rawInput.patientName,
        program: s05.rawInput.program,
        weekStatus: s05.rawInput.weekStatus,
        followUp: s05.rawInput.followUp,
        note: s05.rawInput.note,
        idempotencyKey: key,
      };

      const result = await processCheckInSubmission(payload);
      expect(result.success).toBe(true);
      expect(result.route).toBe("HUMAN_REVIEW_REQUIRED");
      expect(result.status).toBe("needs_review");
    });
  });

  describe("5. Accessibility & UI Contract (Lighthouse Standard >= 95)", () => {
    const renderedHtml = renderToString(React.createElement(CheckInPage));

    it("includes the mandatory simulation disclaimer verbatim", () => {
      expect(renderedHtml).toContain("Simulation only. Do not enter real health information. Not for medical care or emergencies.");
    });

    it("has accessible landmark regions: banner header, main, and contentinfo footer", () => {
      expect(renderedHtml).toContain('role="banner"');
      expect(renderedHtml).toContain('role="main"');
      expect(renderedHtml).toContain('role="contentinfo"');
    });

    it("provides a keyboard skip link to main content", () => {
      expect(renderedHtml).toContain('href="#main-checkin-content"');
      expect(renderedHtml).toContain("Skip to main content");
    });

    it("associates patient selector with an accessible label and id", () => {
      expect(renderedHtml).toMatch(/<label[^>]*for="[^"]*-patient"[^>]*>Synthetic Patient/);
      expect(renderedHtml).toMatch(/<select[^>]*id="[^"]*-patient"/);
    });

    it("uses fieldset and legend for structured radio question groups", () => {
      expect(renderedHtml).toContain("<fieldset");
      expect(renderedHtml).toContain("<legend");
      expect(renderedHtml).toContain('role="radiogroup"');
      expect(renderedHtml).toContain("How are you tracking with your routine this week?");
      expect(renderedHtml).toContain("Would you like a team member to follow up with you?");
    });

    it("has polite live region for character counter", () => {
      expect(renderedHtml).toContain('aria-live="polite"');
      expect(renderedHtml).toContain("/ 500 characters");
    });

    it("strictly avoids symptom interpretation in the UI copy", () => {
      const lower = renderedHtml.toLowerCase();
      // Must not make clinical or diagnostic assertions
      expect(lower).not.toContain("your symptoms indicate");
      expect(lower).not.toContain("you appear healthy");
      expect(lower).not.toContain("we diagnosed");
      expect(lower).not.toContain("recommended dosage");
      expect(lower).not.toContain("clinical evaluation confirms");
    });

    it("provides accessible scenario dropdown populated with all 18 fixtures", () => {
      expect(renderedHtml).toContain("Load sample scenario from fixtures S01 to S18");
      for (const fx of evaluationFixtures) {
        expect(renderedHtml).toContain(fx.id);
        expect(renderedHtml).toContain(fx.title);
      }
    });

    it("lists all synthetic patients with obviously fake identifiers", () => {
      for (const patient of patientOptions) {
        expect(renderedHtml).toContain(patient.name);
        expect(renderedHtml).toContain(patient.id);
        expect(patient.name).toMatch(/Demo Patient \d+/);
      }
    });
  });
});

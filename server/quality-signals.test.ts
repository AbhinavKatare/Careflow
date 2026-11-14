import { describe, it, expect, beforeEach } from "vitest";
import {
  listFeedbackLabels,
  computeQualitySignals,
  computeLevenshteinDistance,
  exportFeedbackDataset,
  sanitizeForDatasetExport,
  recordFeedbackLabel,
  resetFeedbackStore,
  ExportedFeedbackRecordSchema,
  REJECTION_REASON_TAXONOMY,
  approveCase,
  rejectCase,
  overrideCaseRoute,
  editCaseDraft,
  resetCasesStore,
  type FeedbackLabel,
} from "../shared";
import { runFeedbackExport } from "../scripts/export-feedback";
import fs from "node:fs";

describe("Quality Signals & Structured Reviewer Feedback", () => {
  beforeEach(() => {
    resetFeedbackStore();
    resetCasesStore();
  });

  describe("Seed Data & Taxonomy Integrity", () => {
    it("seeds exactly 40 synthetic reviewer actions across cohorts", () => {
      const seeded = listFeedbackLabels();
      expect(seeded).toHaveLength(40);
    });

    it("covers all 4 action types across the seed actions", () => {
      const seeded = listFeedbackLabels();
      const actions = new Set(seeded.map((s) => s.action));
      expect(actions.has("draft_accepted_unchanged")).toBe(true);
      expect(actions.has("draft_edited")).toBe(true);
      expect(actions.has("rejected")).toBe(true);
      expect(actions.has("route_override")).toBe(true);
    });

    it("uses only the fixed rejection reason taxonomy for all rejections", () => {
      const seeded = listFeedbackLabels();
      const rejections = seeded.filter((s) => s.action === "rejected");
      expect(rejections.length).toBeGreaterThan(0);

      for (const rej of rejections) {
        expect(rej.rejectionReason).toBeDefined();
        expect(REJECTION_REASON_TAXONOMY).toContain(rej.rejectionReason);
      }
    });

    it("strictly uses synthetic identifiers and fake patient names", () => {
      const seeded = listFeedbackLabels();
      for (const item of seeded) {
        expect(item.patientId).toMatch(/^DEMO-\d+$/);
      }
    });
  });

  describe("Levenshtein Edit Distance Engine", () => {
    it("returns 0 for identical strings", () => {
      expect(computeLevenshteinDistance("Routine check-in received.", "Routine check-in received.")).toBe(0);
      expect(computeLevenshteinDistance("", "")).toBe(0);
    });

    it("computes exact edit distance for single character insertions/deletions/substitutions", () => {
      expect(computeLevenshteinDistance("hello", "helo")).toBe(1); // 1 deletion
      expect(computeLevenshteinDistance("hello", "hellos")).toBe(1); // 1 insertion
      expect(computeLevenshteinDistance("hello", "hallo")).toBe(1); // 1 substitution
    });

    it("computes realistic phrasing modifications", () => {
      const orig = "Thanks for checking in. Regards.";
      const edited = "Thanks for checking in. Warm regards.";
      const dist = computeLevenshteinDistance(orig, edited);
      expect(dist).toBe(6);
    });
  });

  describe("Dynamic Quality Signals Aggregation", () => {
    it("dynamically computes metrics from stored records (no hardcoded constants)", () => {
      const seeded = listFeedbackLabels();
      const signals = computeQualitySignals(seeded);

      expect(signals.totalReviews).toBe(40);
      expect(signals.acceptedCount).toBe(
        signals.acceptedUnchangedCount + signals.editedCount
      );

      // Acceptance rate: (acceptedCount / totalReviews) * 100
      const expectedAccRate = Number(((signals.acceptedCount / 40) * 100).toFixed(1));
      expect(signals.acceptanceRate).toBe(expectedAccRate);

      // Override rate: (overrideCount / totalReviews) * 100
      const expectedOverrideRate = Number(((signals.overrideCount / 40) * 100).toFixed(1));
      expect(signals.overrideRate).toBe(expectedOverrideRate);

      // Mean edit distance is > 0
      expect(signals.meanEditDistanceAllAccepted).toBeGreaterThan(0);
      expect(signals.meanEditDistanceEditedOnly).toBeGreaterThanOrEqual(
        signals.meanEditDistanceAllAccepted
      );
    });

    it("updates dynamically when a new feedback record is added", () => {
      const initial = computeQualitySignals();

      // Add a rejection
      recordFeedbackLabel({
        caseId: "CHK-9999",
        patientId: "DEMO-999",
        action: "rejected",
        reviewerId: "reviewer-dynamic",
        promptVersion: "draft_v2",
        ruleVersion: "rules_v1.1",
        rejectionReason: "tone",
        inputRedacted: "Synthetic note",
        reviewerOutcome: {
          action: "rejected",
          status: "rejected",
          rejectionReason: "tone",
          simulated: true,
        },
      });

      const updated = computeQualitySignals();
      expect(updated.totalReviews).toBe(initial.totalReviews + 1);
      expect(updated.rejectedCount).toBe(initial.rejectedCount + 1);
      expect(updated.acceptanceRate).toBeLessThan(initial.acceptanceRate);
    });

    it("computes version trends across deployed prompt/rule cohorts", () => {
      const signals = computeQualitySignals();
      expect(signals.versionTrends.length).toBeGreaterThanOrEqual(2);

      const v1 = signals.versionTrends.find((t) => t.promptVersion === "draft_v1");
      const v2 = signals.versionTrends.find((t) => t.promptVersion === "draft_v2");

      expect(v1).toBeDefined();
      expect(v2).toBeDefined();

      // Cohort 2 (draft_v2) shows higher acceptance rate than Cohort 1
      expect(v2!.acceptanceRate).toBeGreaterThan(v1!.acceptanceRate);
    });

    it("accurately tallies all 5 rejection taxonomy reason codes", () => {
      const signals = computeQualitySignals();
      const reasons = signals.rejectionReasonsBreakdown.map((r) => r.reason);

      for (const code of REJECTION_REASON_TAXONOMY) {
        expect(reasons).toContain(code);
      }

      // Sum of counts equals total rejections
      const sumCounts = signals.rejectionReasonsBreakdown.reduce((s, r) => s + r.count, 0);
      expect(sumCounts).toBe(signals.rejectedCount);
    });
  });

  describe("Reviewer Actions -> Structured FeedbackLabel Pipeline", () => {
    it("turns an unedited draft approval into a draft_accepted_unchanged FeedbackLabel with dist 0", () => {
      const initialLabelsCount = listFeedbackLabels().length;
      approveCase("CHK-1001");

      const currentLabels = listFeedbackLabels();
      expect(currentLabels.length).toBe(initialLabelsCount + 1);

      const latest = currentLabels[0];
      expect(latest.action).toBe("draft_accepted_unchanged");
      expect(latest.editDistance).toBe(0);
      expect(latest.reviewerOutcome.simulated).toBe(true);
    });

    it("turns an edited draft approval into a draft_edited FeedbackLabel with positive edit distance and diff", () => {
      const initialLabelsCount = listFeedbackLabels().length;

      // Edit draft
      editCaseDraft("CHK-1003", "Thanks for completing your check-in, Demo Patient 003. Have a wonderful week ahead!");
      approveCase("CHK-1003");

      const currentLabels = listFeedbackLabels();
      expect(currentLabels.length).toBe(initialLabelsCount + 1);

      const latest = currentLabels[0];
      expect(latest.action).toBe("draft_edited");
      expect(latest.editDistance).toBeGreaterThan(0);
      expect(latest.diff).toBeDefined();
    });

    it("turns a reviewer rejection into a rejected FeedbackLabel with taxonomy code", () => {
      const initialLabelsCount = listFeedbackLabels().length;

      rejectCase("CHK-1001", "Draft tone was overly alarming.", "tone");

      const currentLabels = listFeedbackLabels();
      expect(currentLabels.length).toBe(initialLabelsCount + 1);

      const latest = currentLabels[0];
      expect(latest.action).toBe("rejected");
      expect(latest.rejectionReason).toBe("tone");
      expect(latest.rejectionNotes).toContain("alarming");
    });

    it("turns a route override into a route_override FeedbackLabel", () => {
      const initialLabelsCount = listFeedbackLabels().length;

      overrideCaseRoute("CHK-1001", "HUMAN_REVIEW_REQUIRED", "Clinical review required due to ambiguous answer.");

      const currentLabels = listFeedbackLabels();
      expect(currentLabels.length).toBe(initialLabelsCount + 1);

      const latest = currentLabels[0];
      expect(latest.action).toBe("route_override");
      expect(latest.routeOverride).toBeDefined();
      expect(latest.routeOverride?.originalRoute).toBe("DRAFT_FOR_REVIEW");
      expect(latest.routeOverride?.suggestedRoute).toBe("HUMAN_REVIEW_REQUIRED");
    });
  });

  describe("Dataset Export & Schema Validation", () => {
    it("sanitizes records and excludes free text patient identifiers", () => {
      const rawLabel: FeedbackLabel = {
        id: "fb-test-sanitization",
        caseId: "CHK-TEST",
        patientId: "DEMO-999",
        action: "draft_accepted_unchanged",
        reviewerId: "staff-reviewer",
        createdAt: new Date().toISOString(),
        promptVersion: "draft_v1",
        ruleVersion: "rules_v1.0",
        editDistance: 0,
        inputRedacted: "Check-in for Demo Patient 999 with phone 555-123-4567 and email test@example.com.",
        draft: "Thanks for checking in, Demo Patient 999.",
        reviewerOutcome: {
          action: "draft_accepted_unchanged",
          status: "approved",
          editDistance: 0,
          simulated: true,
        },
      };

      const exported = sanitizeForDatasetExport(rawLabel, "dataset_v1.0.0");

      // Verify no patient name or email leaks in exported fields
      expect(exported.input_redacted).not.toContain("Demo Patient 999");
      expect(exported.input_redacted).toContain("[PATIENT_NAME_1]");
      expect(exported.input_redacted).not.toContain("test@example.com");
      expect(exported.draft).not.toContain("Demo Patient 999");
      expect(exported.draft).toContain("[PATIENT_NAME_1]");

      // Validate with schema
      const parsed = ExportedFeedbackRecordSchema.safeParse(exported);
      expect(parsed.success).toBe(true);
    });

    it("validates all 40 seed feedback records against ExportedFeedbackRecordSchema", () => {
      const { jsonl, count, validated } = exportFeedbackDataset();
      expect(validated).toBe(true);
      expect(count).toBe(40);

      const lines = jsonl.split("\n");
      expect(lines).toHaveLength(40);

      for (const line of lines) {
        const record = JSON.parse(line);
        const parseRes = ExportedFeedbackRecordSchema.safeParse(record);
        expect(parseRes.success).toBe(true);
        expect(record.dataset_version).toBe("dataset_v1.0.0");
        expect(record.reviewer_outcome.simulated).toBe(true);
      }
    });

    it("runs runFeedbackExport script cleanly and generates feedback_dataset.jsonl", () => {
      const res = runFeedbackExport();
      expect(res.count).toBeGreaterThanOrEqual(40);
      expect(fs.existsSync(res.filePath)).toBe(true);

      const fileContent = fs.readFileSync(res.filePath, "utf-8");
      const lines = fileContent.trim().split("\n");
      expect(lines.length).toBe(res.count);
    });
  });
});

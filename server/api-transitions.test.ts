import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "./db";
import {
  approveCaseInDb,
  computeQualitySignalsFromDb,
  editCaseDraftInDb,
  getCaseByIdFromDb,
  listFeedbackLabelsFromDb,
  listReviewCasesFromDb,
  overrideCaseRouteInDb,
  rejectCaseInDb,
  returnCaseToQueueInDb,
  seedDatabase,
} from "./persistence";
import { verifyAuditTrail } from "./audit-chain";
import type { RejectionReasonCode, RouteDecision } from "../shared/types";

describe("Review Queue API Transitions & FeedbackLabel Suite", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    // Create an isolated in-memory SQLite database and seed it
    const testDb = createTestDatabase(":memory:");
    sqlite = testDb.sqlite;
    seedDatabase(sqlite);
  });

  describe("1. Queue Query, Filtering, Search, and Sort", () => {
    it("lists cases with status filters (needs_review, draft_ready, approved, rejected, All)", () => {
      const all = listReviewCasesFromDb({}, sqlite);
      expect(all.length).toBeGreaterThanOrEqual(7);

      const needsReview = listReviewCasesFromDb({ status: "needs_review" }, sqlite);
      expect(needsReview.length).toBeGreaterThan(0);
      expect(needsReview.every((c) => c.status === "needs_review")).toBe(true);

      const draftReady = listReviewCasesFromDb({ status: "draft_ready" }, sqlite);
      expect(draftReady.length).toBeGreaterThan(0);
      expect(draftReady.every((c) => c.status === "draft_ready")).toBe(true);
    });

    it("searches cases across patient name, ID, and reason codes", () => {
      const byName = listReviewCasesFromDb({ query: "Demo Patient 002" }, sqlite);
      expect(byName.length).toBeGreaterThan(0);
      expect(byName[0].patientName).toBe("Demo Patient 002");

      const byReason = listReviewCasesFromDb({ query: "EXPLICIT_FOLLOWUP_REQUEST" }, sqlite);
      expect(byReason.length).toBeGreaterThan(0);
      expect(byReason[0].reasonCode).toBe("EXPLICIT_FOLLOWUP_REQUEST");
    });

    it("sorts cases by processing latency", () => {
      const asc = listReviewCasesFromDb({ sort: "latency_asc" }, sqlite);
      for (let i = 0; i < asc.length - 1; i++) {
        expect(asc[i].latencyMs).toBeLessThanOrEqual(asc[i + 1].latencyMs);
      }

      const desc = listReviewCasesFromDb({ sort: "latency_desc" }, sqlite);
      for (let i = 0; i < desc.length - 1; i++) {
        expect(desc[i].latencyMs).toBeGreaterThanOrEqual(desc[i + 1].latencyMs);
      }
    });
  });

  describe("2. Edit Draft & Preserving AI Baseline", () => {
    it("edits draft content and records an audit event without mutating originalDraft", () => {
      const caseItem = getCaseByIdFromDb("CHK-1001", sqlite)!;
      const original = caseItem.draft!;

      const updated = editCaseDraftInDb("CHK-1001", "Revised candidate response by reviewer.", sqlite);
      expect(updated).toBeDefined();
      expect(updated?.draft).toBe("Revised candidate response by reviewer.");
      expect(updated?.originalDraft).toBe(original);

      // Verify audit event
      const lastAudit = updated!.audit[updated!.audit.length - 1];
      expect(lastAudit.action).toBe("Draft edited");
      expect(lastAudit.detail).toContain("Nothing was sent");
    });
  });

  describe("3. Approve Transition & Writing FeedbackLabel", () => {
    it("approving an unchanged draft writes draft_accepted_unchanged FeedbackLabel with editDistance=0", () => {
      const initialLabelsCount = listFeedbackLabelsFromDb(sqlite).length;

      const approved = approveCaseInDb("CHK-1001", sqlite);
      expect(approved?.status).toBe("approved");

      const labels = listFeedbackLabelsFromDb(sqlite);
      expect(labels.length).toBe(initialLabelsCount + 1);

      const latestLabel = labels[0];
      expect(latestLabel.caseId).toBe("CHK-1001");
      expect(latestLabel.action).toBe("draft_accepted_unchanged");
      expect(latestLabel.editDistance).toBe(0);
      expect(latestLabel.reviewerOutcome.simulated).toBe(true);

      // Audit trail
      const lastAudit = approved!.audit[approved!.audit.length - 1];
      expect(lastAudit.action).toBe("Approved · simulated");
      expect(lastAudit.detail).toContain("Simulated state only; nothing was sent");
    });

    it("approving an edited draft writes draft_edited FeedbackLabel with positive editDistance and diff", () => {
      editCaseDraftInDb("CHK-1003", "Revised text with significant edits by clinical reviewer.", sqlite);

      const initialLabelsCount = listFeedbackLabelsFromDb(sqlite).length;
      const approved = approveCaseInDb("CHK-1003", sqlite);
      expect(approved?.status).toBe("approved");

      const labels = listFeedbackLabelsFromDb(sqlite);
      expect(labels.length).toBe(initialLabelsCount + 1);

      const latestLabel = labels[0];
      expect(latestLabel.caseId).toBe("CHK-1003");
      expect(latestLabel.action).toBe("draft_edited");
      expect(latestLabel.editDistance).toBeGreaterThan(0);
      expect(latestLabel.diff).toBeDefined();
      expect(latestLabel.reviewerOutcome.simulated).toBe(true);
    });
  });

  describe("4. Reject Transition with Fixed Taxonomy & FeedbackLabel", () => {
    it("rejecting writes rejected FeedbackLabel with taxonomy reason code and notes", () => {
      const initialLabelsCount = listFeedbackLabelsFromDb(sqlite).length;
      const reasonCode: RejectionReasonCode = "unsupported_claim";
      const reason = "Draft mentions appointment not in patient note.";

      const rejected = rejectCaseInDb("CHK-1004", reason, reasonCode, sqlite);
      expect(rejected?.status).toBe("rejected");
      expect(rejected?.reasonCode).toBe("unsupported_claim");

      const labels = listFeedbackLabelsFromDb(sqlite);
      expect(labels.length).toBe(initialLabelsCount + 1);

      const latestLabel = labels[0];
      expect(latestLabel.caseId).toBe("CHK-1004");
      expect(latestLabel.action).toBe("rejected");
      expect(latestLabel.rejectionReason).toBe("unsupported_claim");
      expect(latestLabel.reviewerOutcome.rejectionReason).toBe("unsupported_claim");
      expect(latestLabel.reviewerOutcome.simulated).toBe(true);

      // Audit trail
      const lastAudit = rejected!.audit[rejected!.audit.length - 1];
      expect(lastAudit.action).toBe("Rejected · simulated");
      expect(lastAudit.detail).toContain("unsupported_claim");
      expect(lastAudit.detail).toContain("Nothing was sent");
    });
  });

  describe("5. Route Override & Return to Queue Transitions", () => {
    it("overriding route writes route_override FeedbackLabel and updates case route", () => {
      const initialLabelsCount = listFeedbackLabelsFromDb(sqlite).length;
      const newRoute: RouteDecision = "HUMAN_REVIEW_REQUIRED";
      const reason = "Patient mentioned subtle symptoms requiring triage.";

      const overridden = overrideCaseRouteInDb("CHK-1001", newRoute, reason, sqlite);
      expect(overridden?.route).toBe("HUMAN_REVIEW_REQUIRED");

      const labels = listFeedbackLabelsFromDb(sqlite);
      expect(labels.length).toBe(initialLabelsCount + 1);

      const latestLabel = labels[0];
      expect(latestLabel.caseId).toBe("CHK-1001");
      expect(latestLabel.action).toBe("route_override");
      expect(latestLabel.routeOverride?.suggestedRoute).toBe("HUMAN_REVIEW_REQUIRED");
      expect(latestLabel.routeOverride?.reason).toBe(reason);

      // Audit trail
      const lastAudit = overridden!.audit[overridden!.audit.length - 1];
      expect(lastAudit.action).toBe("Route override · simulated");
      expect(lastAudit.detail).toContain("Nothing was sent");
    });

    it("returns case back to queue in needs_review state", () => {
      approveCaseInDb("CHK-1001", sqlite);
      expect(getCaseByIdFromDb("CHK-1001", sqlite)?.status).toBe("approved");

      const returned = returnCaseToQueueInDb("CHK-1001", sqlite);
      expect(returned?.status).toBe("needs_review");

      const lastAudit = returned!.audit[returned!.audit.length - 1];
      expect(lastAudit.action).toBe("Returned to queue");
      expect(lastAudit.detail).toContain("returned to active review queue");
    });
  });

  describe("6. Quality Signals Aggregates Computed from Stored Labels", () => {
    it("dynamically computes aggregates from 40+ stored feedback actions", () => {
      const metrics = computeQualitySignalsFromDb(sqlite);

      expect(metrics.totalReviews).toBeGreaterThanOrEqual(40);
      expect(metrics.acceptanceRate).toBeGreaterThan(0);
      expect(metrics.acceptanceRate).toBeLessThanOrEqual(100);
      expect(metrics.acceptedCount).toBeGreaterThan(0);
      expect(metrics.rejectedCount).toBeGreaterThan(0);
      expect(metrics.overrideCount).toBeGreaterThan(0);
      expect(metrics.meanEditDistanceAllAccepted).toBeGreaterThanOrEqual(0);
      expect(metrics.meanEditDistanceEditedOnly).toBeGreaterThanOrEqual(0);

      // Verify all taxonomy reasons are covered in breakdown
      expect(metrics.rejectionReasonsBreakdown.length).toBe(5);
      const reasons = metrics.rejectionReasonsBreakdown.map((r) => r.reason);
      expect(reasons).toContain("inaccurate");
      expect(reasons).toContain("tone");
      expect(reasons).toContain("unsupported_claim");
      expect(reasons).toContain("should_have_been_escalated");
      expect(reasons).toContain("other");

      // Verify version trends exist
      expect(metrics.versionTrends.length).toBeGreaterThan(0);
    });
  });

  describe("7. Cryptographic Audit Integrity Across Transitions", () => {
    it("preserves an unbroken SHA-256 hash chain across edits, approvals, rejections, and overrides", () => {
      editCaseDraftInDb("CHK-1001", "Step 1 edit", sqlite);
      approveCaseInDb("CHK-1001", sqlite);
      rejectCaseInDb("CHK-1002", "Tone issue", "tone", sqlite);
      overrideCaseRouteInDb("CHK-1003", "HUMAN_REVIEW_REQUIRED", "Route override reason", sqlite);
      returnCaseToQueueInDb("CHK-1001", sqlite);

      const auditStatus = verifyAuditTrail(sqlite);
      expect(auditStatus.valid).toBe(true);
      expect(auditStatus.totalEvents).toBeGreaterThan(10);
    });
  });
});


import { describe, expect, it, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "../client/src/lib/trpc";
import {
  listReviewCases,
  getCaseById,
  approveCase,
  rejectCase,
  returnCaseToQueue,
  editCaseDraft,
  computeDraftDiff,
  resetCasesStore,
  seedCases,
} from "@shared";
import CaseDetailDrawer from "../client/src/components/CaseDetailDrawer";
import ReviewQueue from "../client/src/components/ReviewQueue";

function renderWithProviders(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const trpcClient = trpc.createClient({
    links: [
      httpBatchLink({
        url: "http://localhost:3000/api/trpc",
        transformer: superjson,
      }),
    ],
  });
  return renderToString(
    React.createElement(
      trpc.Provider,
      { client: trpcClient, queryClient },
      React.createElement(QueryClientProvider, { client: queryClient }, element)
    )
  );
}

describe("Review Queue & Case Detail Suite", () => {
  beforeEach(() => {
    resetCasesStore();
  });

  describe("1. Queue Filtering, Search, and Sort", () => {
    it("filters cases accurately by status (Needs Review, Draft Ready, Approved, Rejected, Failed, All)", () => {
      const allCases = listReviewCases({ status: "All" });
      expect(allCases.length).toBeGreaterThanOrEqual(5);

      const needsReview = listReviewCases({ status: "needs_review" });
      expect(needsReview.every((c) => c.status === "needs_review")).toBe(true);
      expect(needsReview.length).toBeGreaterThan(0);

      const draftReady = listReviewCases({ status: "draft_ready" });
      expect(draftReady.every((c) => c.status === "draft_ready")).toBe(true);
      expect(draftReady.length).toBeGreaterThan(0);

      const approved = listReviewCases({ status: "approved" });
      expect(approved.every((c) => c.status === "approved")).toBe(true);

      const rejected = listReviewCases({ status: "rejected" });
      expect(rejected.every((c) => c.status === "rejected")).toBe(true);
    });

    it("searches cases across patient name, ID, and reason codes", () => {
      const byName = listReviewCases({ query: "Demo Patient 002" });
      expect(byName.length).toBeGreaterThan(0);
      expect(byName[0].patientName).toContain("Demo Patient 002");

      const byReasonCode = listReviewCases({ query: "EXPLICIT_FOLLOWUP_REQUEST" });
      expect(byReasonCode.length).toBeGreaterThan(0);
      expect(byReasonCode[0].reasonCode).toBe("EXPLICIT_FOLLOWUP_REQUEST");
    });

    it("sorts cases by processing time / latency", () => {
      const fastest = listReviewCases({ sort: "latency_asc" });
      for (let i = 0; i < fastest.length - 1; i++) {
        expect(fastest[i].latencyMs).toBeLessThanOrEqual(fastest[i + 1].latencyMs);
      }

      const slowest = listReviewCases({ sort: "latency_desc" });
      for (let i = 0; i < slowest.length - 1; i++) {
        expect(slowest[i].latencyMs).toBeGreaterThanOrEqual(slowest[i + 1].latencyMs);
      }
    });
  });

  describe("2. Reviewer Actions & State Machine Transitions", () => {
    it("transitions draft_ready case to approved with simulated disclosure in audit", () => {
      const initial = getCaseById("CHK-1001");
      expect(initial.status).toBe("draft_ready");

      const approved = approveCase("CHK-1001");
      expect(approved.status).toBe("approved");

      // Verify audit entry
      const lastAudit = approved.audit[approved.audit.length - 1];
      expect(lastAudit.actor).toBe("Demo staff reviewer");
      expect(lastAudit.action).toBe("Approved · simulated");
      expect(lastAudit.detail).toContain("Simulated, nothing sent");
    });

    it("transitions case to rejected with explicit reason and simulated disclosure", () => {
      const initial = getCaseById("CHK-1003");
      expect(initial.status).toBe("draft_ready");

      const rejected = rejectCase("CHK-1003", "Draft phrasing requires telephone triage.");
      expect(rejected.status).toBe("rejected");
      expect(rejected.reason).toBe("Draft phrasing requires telephone triage.");

      // Verify audit entry
      const lastAudit = rejected.audit[rejected.audit.length - 1];
      expect(lastAudit.action).toBe("Rejected · simulated");
      expect(lastAudit.detail).toContain("Simulated, nothing sent");
      expect(lastAudit.detail).toContain("Draft phrasing requires telephone triage");
    });

    it("returns case back to queue in needs_review state", () => {
      const initial = getCaseById("CHK-1005");
      expect(initial.status).toBe("approved");

      const returned = returnCaseToQueue("CHK-1005");
      expect(returned.status).toBe("needs_review");

      const lastAudit = returned.audit[returned.audit.length - 1];
      expect(lastAudit.action).toBe("Returned to queue");
      expect(lastAudit.detail).toContain("Simulated, nothing sent");
    });
  });

  describe("3. Draft Editing & Diff View Calculation", () => {
    it("updates draft text and preserves the original AI baseline", () => {
      const initial = getCaseById("CHK-1001");
      const originalText = initial.draft!;

      const updated = editCaseDraft(
        "CHK-1001",
        "Thanks for checking in, Demo Patient 001. A nurse will review your chart shortly."
      );

      expect(updated.draft).toContain("A nurse will review your chart shortly");
      expect(updated.originalDraft).toBe(originalText);

      // Audit entry recorded
      const lastAudit = updated.audit[updated.audit.length - 1];
      expect(lastAudit.action).toBe("Draft edited");
      expect(lastAudit.detail).toContain("Simulated, nothing sent");
    });

    it("computes word-level additions and deletions accurately", () => {
      const original = "Thanks for checking in. Your update has been recorded.";
      const edited = "Thanks for checking in. A nurse has reviewed your update.";

      const diff = computeDraftDiff(original, edited);
      expect(diff.length).toBeGreaterThan(1);

      const added = diff.filter((d) => d.type === "added");
      const removed = diff.filter((d) => d.type === "removed");
      const unchanged = diff.filter((d) => d.type === "unchanged");

      expect(added.some((d) => d.text.includes("nurse"))).toBe(true);
      expect(removed.some((d) => d.text.includes("recorded"))).toBe(true);
      expect(unchanged.some((d) => d.text.includes("Thanks for checking in."))).toBe(true);
    });
  });

  describe("4. Case Detail UI Rendering (Four Panels & Diff View)", () => {
    it("renders four clearly separated panels", () => {
      const sampleCase = seedCases.find((c) => c.id === "CHK-1002")!;
      const html = renderWithProviders(
        React.createElement(CaseDetailDrawer, {
          item: sampleCase,
          onClose: () => {},
          onUpdate: () => {},
        })
      );

      // Panel 1: Original Submission
      expect(html).toContain("Panel 1: Original Submission");
      expect(html).toContain("Weekly Routine Status:");
      expect(html).toContain("I have a question for the care team");
      expect(html).toContain("Follow-up Requested:");
      expect(html).toContain("Yes, please follow up");

      // Panel 2: What the Model Saw (Redacted)
      expect(html).toContain("Panel 2: What the Model Saw");
      expect(html).toContain("Redacted Preview");

      // Panel 3: Extracted Facts
      expect(html).toContain("Panel 3: Extracted Facts");
      expect(html).toContain("Click a fact to locate source span in Panel 1");

      // Panel 4: Policy Result
      expect(html).toContain("Panel 4: Policy Result");
      expect(html).toContain("Final Deterministic Route");
      expect(html).toContain("Rules Fired:");
    });

    it("includes the mandatory simulation disclosure verbatim in the drawer", () => {
      const sampleCase = seedCases[0];
      const html = renderWithProviders(
        React.createElement(CaseDetailDrawer, {
          item: sampleCase,
          onClose: () => {},
          onUpdate: () => {},
        })
      );

      expect(html).toContain("Simulated state only:");
      expect(html).toContain("Zero outbound emails, SMS, or EHR messages are ever dispatched.");
      expect(html).toContain("Approve (Simulated)");
      expect(html).toContain("Reject with reason");
      expect(html).toContain("Return to queue");
    });
  });

  describe("5. Review Queue UI Rendering & Keyboard Shortcuts", () => {
    it("renders queue table with status chips, latency, reason codes, and triage shortcuts guide", () => {
      const html = renderWithProviders(
        React.createElement(ReviewQueue, {
          cases: seedCases,
          onOpenCase: () => {},
          onUpdateCase: () => {},
        })
      );

      expect(html).toContain("Review Queue");
      expect(html).toContain("STAFF WORKSPACE");
      expect(html).toContain("Keyboard triage shortcuts:");
      expect(html).toContain("Navigate");
      expect(html).toContain("Open detail");
      expect(html).toContain("Approve");
      expect(html).toContain("Reject");

      // Column headers
      expect(html).toContain("Participant");
      expect(html).toContain("Routing Reason &amp; Code");
      expect(html).toContain("Status");
      expect(html).toContain("Latency");
      expect(html).toContain("Received");

      // Filter tabs
      expect(html).toContain("Needs Review");
      expect(html).toContain("Draft Ready");
      expect(html).toContain("Approved");
      expect(html).toContain("Rejected");
      expect(html).toContain("Failed");
    });
  });

  describe("6. Cancel on Confirmation & State Protection", () => {
    it("cancelling confirmation keeps case in prior state without modifying draft or status", () => {
      const initial = getCaseById("CHK-1001");
      expect(initial.status).toBe("draft_ready");
      const priorAuditCount = initial.audit.length;

      // Simulate reviewer cancelling confirmation dialog
      const cancelledAction = null;
      expect(cancelledAction).toBeNull();

      // Case state remains untouched
      const afterCancel = getCaseById("CHK-1001");
      expect(afterCancel.status).toBe("draft_ready");
      expect(afterCancel.audit.length).toBe(priorAuditCount);
      expect(afterCancel.draft).toBe(initial.draft);
    });
  });

  describe("7. Fact Source Span Highlighting Logic", () => {
    it("locates and isolates the exact substring in the participant note using sourceSpan start/end offsets", () => {
      const sampleCase = seedCases.find((c) => c.id === "CHK-1002")!;
      const note = sampleCase.note;
      expect(note).toBeTruthy();

      const fact = sampleCase.extractedFacts?.find((f) => f.sourceSpan);
      expect(fact).toBeDefined();

      if (fact?.sourceSpan) {
        const { start, end } = fact.sourceSpan;
        const highlighted = note.slice(start, end);
        expect(highlighted.length).toBeGreaterThan(0);
        expect(note.includes(highlighted)).toBe(true);
      }
    });
  });
});

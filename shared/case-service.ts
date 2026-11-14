import { seedCases } from "./fixtures";
import {
  computeLevenshteinDistance,
  recordFeedbackLabel,
} from "./feedback-service";
import {
  REJECTION_REASON_TAXONOMY,
  type DemoCase,
  type DiffSegment,
  type RejectionReasonCode,
  type ReviewStatus,
  type RouteDecision,
} from "./types";

/**
 * In-memory repository of simulated review cases.
 */
let casesStore: DemoCase[] = JSON.parse(JSON.stringify(seedCases));

export type CaseFilter = {
  status?: string;
  query?: string;
  sort?: "newest" | "oldest" | "latency_asc" | "latency_desc";
};

export type { DiffSegment };

/**
 * Computes word-level diff between original AI draft and reviewer-edited text.
 */
export function computeDraftDiff(original: string | null | undefined, edited: string | null | undefined): DiffSegment[] {
  const origText = (original ?? "").trim();
  const editText = (edited ?? "").trim();

  if (!origText && !editText) return [];
  if (!origText) return [{ type: "added", text: editText }];
  if (!editText) return [{ type: "removed", text: origText }];
  if (origText === editText) return [{ type: "unchanged", text: origText }];

  const origWords = origText.split(/(\s+)/);
  const editWords = editText.split(/(\s+)/);

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < origWords.length || j < editWords.length) {
    if (i < origWords.length && j < editWords.length && origWords[i] === editWords[j]) {
      segments.push({ type: "unchanged", text: origWords[i] });
      i++;
      j++;
    } else {
      // Look ahead for match
      const nextMatchInEdit = editWords.indexOf(origWords[i], j);
      const nextMatchInOrig = origWords.indexOf(editWords[j], i);

      if (nextMatchInEdit !== -1 && (nextMatchInOrig === -1 || nextMatchInEdit - j <= nextMatchInOrig - i)) {
        // Words were added
        while (j < nextMatchInEdit) {
          segments.push({ type: "added", text: editWords[j] });
          j++;
        }
      } else if (nextMatchInOrig !== -1) {
        // Words were removed
        while (i < nextMatchInOrig) {
          segments.push({ type: "removed", text: origWords[i] });
          i++;
        }
      } else {
        if (i < origWords.length) {
          segments.push({ type: "removed", text: origWords[i] });
          i++;
        }
        if (j < editWords.length) {
          segments.push({ type: "added", text: editWords[j] });
          j++;
        }
      }
    }
  }

  // Merge adjacent segments with identical type
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    if (merged.length > 0 && merged[merged.length - 1].type === seg.type) {
      merged[merged.length - 1].text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

/**
 * Filter, search, and sort review cases.
 */
export function listReviewCases(filter: CaseFilter = {}): DemoCase[] {
  let result = [...casesStore];

  // Status Filter
  if (filter.status && filter.status !== "All") {
    const targetStatus = filter.status.toLowerCase().replace(/\s+/g, "_");
    if (targetStatus === "failed") {
      result = result.filter(
        (c) => c.status === "processing_failed" || c.route === "INPUT_ERROR"
      );
    } else {
      result = result.filter((c) => c.status === targetStatus);
    }
  }

  // Search Filter
  if (filter.query && filter.query.trim()) {
    const q = filter.query.toLowerCase().trim();
    result = result.filter((c) => {
      const searchSpace = [
        c.id,
        c.patientName,
        c.patientId,
        c.program,
        c.weekStatus,
        c.note,
        c.reason,
        c.reasonCode ?? "",
        c.scenarioTag,
      ]
        .join(" ")
        .toLowerCase();
      return searchSpace.includes(q);
    });
  }

  // Sorting
  const sortMode = filter.sort ?? "newest";
  result.sort((a, b) => {
    switch (sortMode) {
      case "oldest":
        return a.submittedAt.localeCompare(b.submittedAt);
      case "latency_asc":
        return a.latencyMs - b.latencyMs;
      case "latency_desc":
        return b.latencyMs - a.latencyMs;
      case "newest":
      default:
        return b.submittedAt.localeCompare(a.submittedAt);
    }
  });

  return result;
}

export function getCaseById(id: string): DemoCase {
  const found = casesStore.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Review case with ID '${id}' not found.`);
  }
  return found;
}

/**
 * Edits draft text and appends an audit event.
 */
export function editCaseDraft(id: string, newDraft: string): DemoCase {
  const existing = getCaseById(id);
  const at = new Date().toISOString();

  const originalDraft = existing.originalDraft ?? existing.draft;

  const updated: DemoCase = {
    ...existing,
    originalDraft,
    draft: newDraft,
    audit: [
      ...existing.audit,
      {
        id: `evt-${Date.now()}-edit`,
        at,
        actor: "Demo staff reviewer",
        action: "Draft edited",
        detail: "Draft message updated by staff reviewer. Simulated, nothing sent.",
      },
    ],
  };

  casesStore = casesStore.map((c) => (c.id === id ? updated : c));
  return updated;
}

/**
 * Simulated approval with structured feedback label, audit trail, and mandatory non-outbound disclosure.
 * Computes Levenshtein edit-distance and diff against original AI draft.
 */
export function approveCase(id: string): DemoCase {
  const existing = getCaseById(id);

  if (existing.status === "approved") {
    return existing; // Idempotent
  }

  const at = new Date().toISOString();
  const origDraft = (existing.originalDraft ?? existing.draft ?? "").trim();
  const finalDraft = (existing.draft ?? "").trim();

  const editDistance = computeLevenshteinDistance(origDraft, finalDraft);
  const isEdited = editDistance > 0 && Boolean(origDraft);
  const actionType = isEdited ? "draft_edited" : "draft_accepted_unchanged";
  const diff = isEdited ? computeDraftDiff(origDraft, finalDraft) : [{ type: "unchanged" as const, text: finalDraft }];

  // Turn reviewer action into a structured FeedbackLabel
  recordFeedbackLabel({
    caseId: existing.id,
    patientId: existing.patientId,
    action: actionType,
    reviewerId: "demo-staff-reviewer",
    promptVersion: existing.workflowVersion || "draft_v1",
    ruleVersion: existing.ruleVersion || "rules_v1.0",
    editDistance,
    diff,
    originalDraft: origDraft,
    finalDraft,
    inputRedacted: existing.redactedPreview || existing.note,
    extraction: existing.extractedFacts,
    draft: finalDraft,
    reviewerOutcome: {
      action: actionType,
      status: "approved",
      editDistance,
      simulated: true,
    },
  });

  const updated: DemoCase = {
    ...existing,
    status: "approved" as ReviewStatus,
    audit: [
      ...existing.audit,
      {
        id: `evt-${Date.now()}-approve`,
        at,
        actor: "Demo staff reviewer",
        action: "Approved · simulated",
        detail: `Approved by demo staff reviewer (${isEdited ? `edited with dist=${editDistance}` : "accepted unchanged"}). Simulated, nothing sent.`,
      },
    ],
  };

  casesStore = casesStore.map((c) => (c.id === id ? updated : c));
  return updated;
}

/**
 * Simulated rejection with reason code from fixed taxonomy, structured feedback label, and audit trail.
 */
export function rejectCase(
  id: string,
  reason: string,
  reasonCode?: RejectionReasonCode
): DemoCase {
  const existing = getCaseById(id);

  if (existing.status === "rejected") {
    return existing; // Idempotent
  }

  const at = new Date().toISOString();
  const cleanReason = reason.trim() || "Reviewer chose not to approve candidate draft.";

  // Normalize reasonCode against fixed taxonomy
  let validatedReasonCode: RejectionReasonCode = "other";
  if (reasonCode && REJECTION_REASON_TAXONOMY.includes(reasonCode)) {
    validatedReasonCode = reasonCode;
  } else {
    // Try to infer from text if reason code keyword is in reason string
    for (const taxonomyKey of REJECTION_REASON_TAXONOMY) {
      if (cleanReason.toLowerCase().includes(taxonomyKey.replace(/_/g, " "))) {
        validatedReasonCode = taxonomyKey;
        break;
      }
    }
  }

  // Turn reviewer rejection into a structured FeedbackLabel
  recordFeedbackLabel({
    caseId: existing.id,
    patientId: existing.patientId,
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    promptVersion: existing.workflowVersion || "draft_v1",
    ruleVersion: existing.ruleVersion || "rules_v1.0",
    rejectionReason: validatedReasonCode,
    rejectionNotes: cleanReason,
    inputRedacted: existing.redactedPreview || existing.note,
    extraction: existing.extractedFacts,
    draft: existing.draft,
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: validatedReasonCode,
      rejectionNotes: cleanReason,
      simulated: true,
    },
  });

  const updated: DemoCase = {
    ...existing,
    status: "rejected" as ReviewStatus,
    reason: cleanReason,
    audit: [
      ...existing.audit,
      {
        id: `evt-${Date.now()}-reject`,
        at,
        actor: "Demo staff reviewer",
        action: "Rejected · simulated",
        detail: `Rejected by demo staff reviewer (reason: ${validatedReasonCode} - ${cleanReason}). Simulated, nothing sent.`,
      },
    ],
  };

  casesStore = casesStore.map((c) => (c.id === id ? updated : c));
  return updated;
}

/**
 * Route override: reviewer states that the deterministic policy route was wrong.
 * Records a route_override FeedbackLabel and updates case status and route.
 */
export function overrideCaseRoute(
  id: string,
  suggestedRoute: RouteDecision,
  reason = "Reviewer flagged policy route as incorrect."
): DemoCase {
  const existing = getCaseById(id);
  const at = new Date().toISOString();
  const cleanReason = reason.trim() || "Reviewer route override";

  // Turn route override into a structured FeedbackLabel
  recordFeedbackLabel({
    caseId: existing.id,
    patientId: existing.patientId,
    action: "route_override",
    reviewerId: "demo-staff-reviewer",
    promptVersion: existing.workflowVersion || "draft_v1",
    ruleVersion: existing.ruleVersion || "rules_v1.0",
    routeOverride: {
      originalRoute: existing.route,
      suggestedRoute,
      reason: cleanReason,
    },
    inputRedacted: existing.redactedPreview || existing.note,
    extraction: existing.extractedFacts,
    draft: existing.draft,
    reviewerOutcome: {
      action: "route_override",
      status: suggestedRoute === "DRAFT_FOR_REVIEW" ? "draft_ready" : "needs_review",
      routeOverride: {
        originalRoute: existing.route,
        suggestedRoute,
        reason: cleanReason,
      },
      simulated: true,
    },
  });

  const newStatus: ReviewStatus = suggestedRoute === "DRAFT_FOR_REVIEW" ? "draft_ready" : "needs_review";

  const updated: DemoCase = {
    ...existing,
    route: suggestedRoute,
    status: newStatus,
    reason: `Route overridden by reviewer from ${existing.route} to ${suggestedRoute}. ${cleanReason}`,
    audit: [
      ...existing.audit,
      {
        id: `evt-${Date.now()}-override`,
        at,
        actor: "Demo staff reviewer",
        action: "Route overridden",
        detail: `Route overridden from ${existing.route} to ${suggestedRoute}: ${cleanReason}. Simulated, nothing sent.`,
      },
    ],
  };

  casesStore = casesStore.map((c) => (c.id === id ? updated : c));
  return updated;
}

/**
 * Returns a case back to the review queue.
 */
export function returnCaseToQueue(id: string): DemoCase {
  const existing = getCaseById(id);
  const at = new Date().toISOString();

  const updated: DemoCase = {
    ...existing,
    status: "needs_review" as ReviewStatus,
    audit: [
      ...existing.audit,
      {
        id: `evt-${Date.now()}-return`,
        at,
        actor: "Demo staff reviewer",
        action: "Returned to queue",
        detail: "Case returned to staff review queue. Simulated, nothing sent.",
      },
    ],
  };

  casesStore = casesStore.map((c) => (c.id === id ? updated : c));
  return updated;
}

/**
 * Adds a new case into the store (e.g., from check-in submission).
 */
export function insertCase(newCase: DemoCase): DemoCase {
  casesStore = [newCase, ...casesStore];
  return newCase;
}

/**
 * Resets store back to original seed cases for clean test runs.
 */
export function resetCasesStore(): void {
  casesStore = JSON.parse(JSON.stringify(seedCases));
}


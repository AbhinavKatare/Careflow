import { seedFeedbackLabels } from "./feedback-fixtures";
import { ExportedFeedbackRecordSchema } from "./feedback-schema";
import {
  REJECTION_REASON_TAXONOMY,
  REJECTION_REASON_LABELS,
  type ExportedFeedbackRecord,
  type FeedbackLabel,
  type QualitySignalsMetrics,
  type RejectionReasonCode,
} from "./types";

/**
 * Computes exact Levenshtein edit distance between two strings.
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  const s1 = a ?? "";
  const s2 = b ?? "";
  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row DP optimization
  let prevRow: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let currRow: number[] = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    const char1 = s1.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const char2 = s2.charCodeAt(j - 1);
      const cost = char1 === char2 ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1,      // insertion
        prevRow[j] + 1,          // deletion
        prevRow[j - 1] + cost    // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[n];
}

/**
 * In-memory repository of simulated FeedbackLabel records.
 */
let feedbackStore: FeedbackLabel[] = JSON.parse(JSON.stringify(seedFeedbackLabels));

export function listFeedbackLabels(): FeedbackLabel[] {
  return [...feedbackStore];
}

export function getFeedbackLabelById(id: string): FeedbackLabel | undefined {
  return feedbackStore.find((f) => f.id === id);
}

export function resetFeedbackStore(): void {
  feedbackStore = JSON.parse(JSON.stringify(seedFeedbackLabels));
}

/**
 * Appends a new structured FeedbackLabel.
 */
export function recordFeedbackLabel(
  labelInput: Omit<FeedbackLabel, "id" | "createdAt"> & { id?: string; createdAt?: string }
): FeedbackLabel {
  const id = labelInput.id || `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = labelInput.createdAt || new Date().toISOString();

  const completeLabel: FeedbackLabel = {
    ...labelInput,
    id,
    createdAt,
  };

  feedbackStore = [completeLabel, ...feedbackStore];
  return completeLabel;
}

/**
 * Dynamically computes all Quality Signals metrics from a stored records array.
 * PERMANENT RULE: Never hardcode metrics or scores.
 */
export function computeQualitySignals(
  labels: FeedbackLabel[] = listFeedbackLabels()
): QualitySignalsMetrics {
  const totalReviews = labels.length;

  if (totalReviews === 0) {
    return {
      totalReviews: 0,
      acceptedCount: 0,
      acceptedUnchangedCount: 0,
      editedCount: 0,
      rejectedCount: 0,
      overrideCount: 0,
      acceptanceRate: 0,
      meanEditDistanceAllAccepted: 0,
      meanEditDistanceEditedOnly: 0,
      overrideRate: 0,
      rejectionReasonsBreakdown: REJECTION_REASON_TAXONOMY.map((reason) => ({
        reason,
        label: REJECTION_REASON_LABELS[reason],
        count: 0,
        percentage: 0,
      })),
      versionTrends: [],
    };
  }

  const acceptedUnchanged = labels.filter((l) => l.action === "draft_accepted_unchanged");
  const draftEdited = labels.filter((l) => l.action === "draft_edited");
  const allAccepted = [...acceptedUnchanged, ...draftEdited];
  const rejected = labels.filter((l) => l.action === "rejected");
  const overrides = labels.filter((l) => l.action === "route_override" || Boolean(l.routeOverride));

  const acceptedCount = allAccepted.length;
  const acceptedUnchangedCount = acceptedUnchanged.length;
  const editedCount = draftEdited.length;
  const rejectedCount = rejected.length;
  const overrideCount = overrides.length;

  const acceptanceRate = Number(((acceptedCount / totalReviews) * 100).toFixed(1));
  const overrideRate = Number(((overrideCount / totalReviews) * 100).toFixed(1));

  // Edit distance computations
  const totalEditDistAllAccepted = allAccepted.reduce((sum, l) => sum + (l.editDistance ?? 0), 0);
  const meanEditDistanceAllAccepted =
    acceptedCount > 0 ? Number((totalEditDistAllAccepted / acceptedCount).toFixed(1)) : 0;

  const totalEditDistEditedOnly = draftEdited.reduce((sum, l) => sum + (l.editDistance ?? 0), 0);
  const meanEditDistanceEditedOnly =
    editedCount > 0 ? Number((totalEditDistEditedOnly / editedCount).toFixed(1)) : 0;

  // Rejection reasons breakdown by taxonomy
  const rejectionCounts: Record<RejectionReasonCode, number> = {
    inaccurate: 0,
    tone: 0,
    unsupported_claim: 0,
    should_have_been_escalated: 0,
    other: 0,
  };

  for (const r of rejected) {
    const code = r.rejectionReason;
    if (code && code in rejectionCounts) {
      rejectionCounts[code]++;
    } else {
      rejectionCounts.other++;
    }
  }

  const rejectionReasonsBreakdown = REJECTION_REASON_TAXONOMY.map((reason) => {
    const count = rejectionCounts[reason];
    const percentage = rejectedCount > 0 ? Number(((count / rejectedCount) * 100).toFixed(1)) : 0;
    return {
      reason,
      label: REJECTION_REASON_LABELS[reason],
      count,
      percentage,
    };
  }).sort((a, b) => b.count - a.count);

  // Group by promptVersion and ruleVersion for version trends
  const versionMap = new Map<string, FeedbackLabel[]>();
  for (const label of labels) {
    const key = `${label.promptVersion} | ${label.ruleVersion}`;
    if (!versionMap.has(key)) {
      versionMap.set(key, []);
    }
    versionMap.get(key)!.push(label);
  }

  const versionTrends = Array.from(versionMap.entries())
    .map(([key, group]) => {
      const [promptVersion, ruleVersion] = key.split(" | ");
      const groupTotal = group.length;
      const groupAccepted = group.filter(
        (l) => l.action === "draft_accepted_unchanged" || l.action === "draft_edited"
      );
      const groupOverrides = group.filter(
        (l) => l.action === "route_override" || Boolean(l.routeOverride)
      );
      const groupRejected = group.filter((l) => l.action === "rejected");

      const groupAccRate = Number(((groupAccepted.length / groupTotal) * 100).toFixed(1));
      const groupOverrideRate = Number(((groupOverrides.length / groupTotal) * 100).toFixed(1));

      const groupTotalDist = groupAccepted.reduce((s, l) => s + (l.editDistance ?? 0), 0);
      const groupMeanDist =
        groupAccepted.length > 0 ? Number((groupTotalDist / groupAccepted.length).toFixed(1)) : 0;

      // Find top rejection reason in cohort
      const tally: Record<string, number> = {};
      for (const r of groupRejected) {
        const c = r.rejectionReason || "other";
        tally[c] = (tally[c] || 0) + 1;
      }
      let topRejectionReason = "None";
      let topCount = 0;
      for (const [code, count] of Object.entries(tally)) {
        if (count > topCount) {
          topCount = count;
          topRejectionReason = code;
        }
      }

      return {
        promptVersion,
        ruleVersion,
        total: groupTotal,
        acceptedCount: groupAccepted.length,
        acceptanceRate: groupAccRate,
        meanEditDistance: groupMeanDist,
        overrideRate: groupOverrideRate,
        rejectionCount: groupRejected.length,
        topRejectionReason,
      };
    })
    .sort((a, b) => a.promptVersion.localeCompare(b.promptVersion));

  return {
    totalReviews,
    acceptedCount,
    acceptedUnchangedCount,
    editedCount,
    rejectedCount,
    overrideCount,
    acceptanceRate,
    meanEditDistanceAllAccepted,
    meanEditDistanceEditedOnly,
    overrideRate,
    rejectionReasonsBreakdown,
    versionTrends,
  };
}

/**
 * Sanitizes a FeedbackLabel for dataset export by removing free-text identifiers
 * and ensuring compliance with the ExportedFeedbackRecord schema.
 */
export function sanitizeForDatasetExport(
  label: FeedbackLabel,
  datasetVersion = "dataset_v1.0.0"
): ExportedFeedbackRecord {
  // Free text patient identifier redaction guard
  const redactIdentifiers = (text: string | null | undefined): string => {
    if (!text) return "";
    return text
      .replace(/Demo Patient \d+/gi, "[PATIENT_NAME_1]")
      .replace(/DEMO-\d+/gi, "[PATIENT_ID_1]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL_1]")
      .replace(/\b\d{3}[-.\s]??\d{3}[-.\s]??\d{4}\b/g, "[PHONE_1]");
  };

  const inputRedacted = redactIdentifiers(label.inputRedacted);
  const sanitizedDraft = label.draft ? redactIdentifiers(label.draft) : null;

  const extraction = (label.extraction ?? []).map((fact) => ({
    id: fact.id,
    category: fact.category,
    value: redactIdentifiers(fact.value),
    confidence: fact.confidence,
  }));

  const record: ExportedFeedbackRecord = {
    dataset_version: datasetVersion,
    id: label.id,
    input_redacted: inputRedacted,
    extraction,
    draft: sanitizedDraft,
    reviewer_outcome: {
      action: label.action,
      status: label.reviewerOutcome.status,
      edit_distance: label.editDistance ?? (label.action === "draft_accepted_unchanged" ? 0 : undefined),
      rejection_reason: label.rejectionReason,
      rejection_notes: label.rejectionNotes ? redactIdentifiers(label.rejectionNotes) : undefined,
      route_override: label.routeOverride
        ? {
            original_route: label.routeOverride.originalRoute,
            suggested_route: label.routeOverride.suggestedRoute,
            reason: label.routeOverride.reason ? redactIdentifiers(label.routeOverride.reason) : undefined,
          }
        : undefined,
      simulated: true,
    },
    prompt_version: label.promptVersion,
    rule_version: label.ruleVersion,
    created_at: label.createdAt,
  };

  return record;
}

/**
 * Exports feedback labels as a JSONL string validated against ExportedFeedbackRecordSchema.
 */
export function exportFeedbackDataset(
  labels: FeedbackLabel[] = listFeedbackLabels(),
  datasetVersion = "dataset_v1.0.0"
): { jsonl: string; count: number; validated: boolean } {
  const records = labels.map((l) => sanitizeForDatasetExport(l, datasetVersion));
  const lines: string[] = [];

  for (const rec of records) {
    const parseResult = ExportedFeedbackRecordSchema.safeParse(rec);
    if (!parseResult.success) {
      throw new Error(`Schema validation failure for record ${rec.id}: ${parseResult.error.message}`);
    }
    lines.push(JSON.stringify(parseResult.data));
  }

  return {
    jsonl: lines.join("\n"),
    count: lines.length,
    validated: true,
  };
}

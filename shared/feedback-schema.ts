import { z } from "zod";
import { REJECTION_REASON_TAXONOMY } from "./types";

/**
 * Zod schema for structured reviewer outcome in feedback records.
 */
export const ReviewerOutcomeExportSchema = z.object({
  action: z.enum([
    "draft_accepted_unchanged",
    "draft_edited",
    "rejected",
    "route_override",
  ]),
  status: z
    .enum([
      "needs_review",
      "draft_ready",
      "approved",
      "rejected",
      "processing_failed",
    ])
    .optional(),
  edit_distance: z.number().int().min(0).optional(),
  rejection_reason: z.enum(REJECTION_REASON_TAXONOMY).optional(),
  rejection_notes: z.string().optional(),
  route_override: z
    .object({
      original_route: z.enum([
        "DRAFT_FOR_REVIEW",
        "HUMAN_REVIEW_REQUIRED",
        "INPUT_ERROR",
      ]),
      suggested_route: z.enum([
        "DRAFT_FOR_REVIEW",
        "HUMAN_REVIEW_REQUIRED",
        "INPUT_ERROR",
      ]),
      reason: z.string().optional(),
    })
    .optional(),
  simulated: z.literal(true),
});

/**
 * Zod schema for a single exported JSONL feedback record.
 * Must exclude free text identifiers and match:
 * (input_redacted, extraction, draft, reviewer_outcome) with a dataset_version.
 */
export const ExportedFeedbackRecordSchema = z.object({
  dataset_version: z.string().min(1),
  id: z.string().min(1),
  input_redacted: z.string(),
  extraction: z.array(
    z.object({
      id: z.string().optional(),
      category: z.string(),
      value: z.string(),
      confidence: z.number().optional(),
    })
  ),
  draft: z.string().nullable(),
  reviewer_outcome: ReviewerOutcomeExportSchema,
  prompt_version: z.string().min(1),
  rule_version: z.string().min(1),
  created_at: z.string().min(1),
});

export const FeedbackDatasetSchema = z.array(ExportedFeedbackRecordSchema);


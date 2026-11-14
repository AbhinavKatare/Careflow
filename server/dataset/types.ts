/**
 * FeedbackLabels Versioned Dataset Export Types & Zod Schema.
 * PERMANENT AGENT RULES:
 * - Synthetic data only; zero real PHI.
 * - Redacted inputs only.
 * - Pure deterministic TypeScript.
 */

import { z } from "zod";

export const FeedbackDatasetRecordSchema = z.object({
  id: z.string().min(1),
  case_id: z.string().min(1),
  seed: z.number().int(),
  split: z.enum(["train", "validation", "test"]),
  redacted_inputs: z.object({
    patient_id: z.string(),
    program: z.string(),
    week_status: z.string(),
    follow_up: z.string(),
    redacted_note: z.string(),
  }),
  extracted_facts: z.array(
    z.object({
      category: z.string(),
      value: z.string(),
      confidence: z.number().optional(),
    })
  ),
  model_draft: z.string().nullable(),
  reviewer_action: z.enum(["ACCEPTED", "EDITED", "REJECTED", "ROUTE_OVERRIDE"]),
  reviewer_outcome: z.object({
    action: z.string(),
    edit_distance: z.number().nullable(),
    rejection_reason: z.string().nullable(),
    route_override: z.string().nullable(),
    reviewer_id: z.string(),
  }),
  final_approved_text: z.string().nullable(),
  prompt_version: z.string(),
  rule_version: z.string(),
  exported_at: z.string(),
});

export type FeedbackDatasetRecord = z.infer<typeof FeedbackDatasetRecordSchema>;

export interface FeedbackDatasetExportResult {
  datasetVersion: string;
  totalRecords: number;
  stratification: {
    acceptedCount: number;
    editedCount: number;
    rejectedCount: number;
    routeOverrideCount: number;
    splitBreakdown: {
      train: number;
      validation: number;
      test: number;
    };
  };
  jsonlContent: string;
  datasetCardContent: string;
  jsonlPath: string;
  datasetCardPath: string;
  schemaValid: boolean;
  exportedAt: string;
}


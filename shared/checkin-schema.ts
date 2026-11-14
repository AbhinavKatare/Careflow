import { z } from "zod";
import type { ReviewStatus } from "./types";

/**
 * Zod validation schema for patient check-in submission.
 * Enforces bounded inputs, valid enum values, and idempotency key requirements.
 */
export const CheckInSubmissionSchema = z.object({
  patientId: z.string().trim().min(1, "Please select a patient."),
  patientName: z.string().trim().min(1, "Patient name is required."),
  program: z.string().trim().min(1, "Program context is required."),
  weekStatus: z.string().trim().min(1, "Please select your routine status."),
  followUp: z.enum(["yes", "no"], {
    message: "Please specify whether you request a follow-up.",
  }),
  note: z
    .string()
    .max(500, "Notes cannot exceed 500 characters.")
    .default(""),
  idempotencyKey: z
    .string()
    .trim()
    .min(6, "A valid idempotency key is required for submission."),
});

export type CheckInSubmissionValues = z.infer<typeof CheckInSubmissionSchema>;

export type CheckInSubmissionResult = {
  success: boolean;
  caseId: string;
  patientId: string;
  patientName: string;
  program: string;
  route: "DRAFT_FOR_REVIEW" | "HUMAN_REVIEW_REQUIRED" | "INPUT_ERROR";
  status: ReviewStatus;
  latencyMs: number;
  submittedAt: string;
  idempotencyKey: string;
  isDuplicate?: boolean;
  message: string;
};

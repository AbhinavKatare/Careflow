/**
 * Step 1: Validate.
 * Checks presence of required fields and bounded input size limits.
 * PERMANENT RULE: Any step failure yields PROCESSING_FAILED with a visible reason.
 */

import { CheckInSubmission, ValidationStepResult } from "./types";

export const MAX_NOTE_CHARACTERS = 500;
export const MAX_NOTE_BYTES = 2048;

export function stepValidate(submission: CheckInSubmission): ValidationStepResult {
  // 1. Required field: patientId
  if (!submission.patientId || submission.patientId.trim().length === 0) {
    return {
      valid: false,
      errorMessage: "Missing required field: patientId",
    };
  }

  // 2. Required field: weekStatus
  if (!submission.weekStatus || submission.weekStatus.trim().length === 0) {
    return {
      valid: false,
      errorMessage: "Missing required field: weekStatus",
    };
  }

  const rawNote = submission.note || "";

  // 3. Byte limit check
  const byteLength = Buffer.byteLength(rawNote, "utf-8");
  if (byteLength > MAX_NOTE_BYTES) {
    return {
      valid: false,
      errorMessage: `Note exceeds maximum byte limit (${byteLength} bytes > ${MAX_NOTE_BYTES} bytes limit)`,
    };
  }

  // 4. Character limit check
  if (rawNote.length > MAX_NOTE_CHARACTERS) {
    return {
      valid: false,
      errorMessage: `Note exceeds maximum character limit (${rawNote.length} chars > ${MAX_NOTE_CHARACTERS} chars limit)`,
    };
  }

  return {
    valid: true,
    cleanedNote: rawNote,
  };
}


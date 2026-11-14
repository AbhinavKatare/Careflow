/**
 * Step 5: Draft Synthesis (Only if DRAFT_FOR_REVIEW).
 * PERMANENT RULE: Only synthesized when route is DRAFT_FOR_REVIEW.
 * Uses server-side tokenMap to de-redact the final candidate draft for human review.
 */

import { LLMAdapter } from "../llm/adapter";
import { LLMCallMetadata } from "../llm/types";
import { deRedact } from "./redact";

export interface DraftStepResult {
  draft: string | null;
  tone?: string;
  rationale?: string;
  metadata?: LLMCallMetadata;
}

export async function stepGenerateDraft(params: {
  isDraftEligible: boolean;
  redactedText: string;
  patientName: string;
  programName: string;
  tokenMap: Record<string, string>;
  adapter: LLMAdapter;
  promptVersion?: string;
  timeoutMs?: number;
}): Promise<DraftStepResult> {
  const {
    isDraftEligible,
    redactedText,
    patientName,
    programName,
    tokenMap,
    adapter,
    promptVersion = "draft_v1",
    timeoutMs = 2000,
  } = params;

  // Only synthesize if policy decided DRAFT_FOR_REVIEW
  if (!isDraftEligible) {
    return { draft: null };
  }

  const response = await adapter.generateDraft({
    patientText: redactedText,
    patientName,
    programName,
    promptVersion,
    timeoutMs,
  });

  // De-redact candidate draft for clinician review
  const restoredDraft = deRedact(response.data.draft_message, tokenMap);

  return {
    draft: restoredDraft,
    tone: response.data.tone,
    rationale: response.data.rationale,
    metadata: response.metadata,
  };
}


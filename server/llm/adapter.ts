/**
 * LLMAdapter interface for typed, structured extraction and draft synthesis.
 * All implementations must return validated structured schemas and operational metadata.
 * PERMANENT RULE: Never log prompts or raw patient responses.
 */

import type {
  DraftOutput,
  ExtractionOutput,
  LLMTier,
  StructuredResponse,
} from "./types";

export interface GenerateExtractionParams {
  patientText: string;
  promptVersion?: string;
  timeoutMs?: number;
}

export interface GenerateDraftParams {
  patientText: string;
  patientName?: string;
  programName?: string;
  promptVersion?: string;
  timeoutMs?: number;
}

export interface LLMAdapter {
  readonly modelId: string;
  readonly tier: LLMTier;

  generateExtraction(
    params: GenerateExtractionParams
  ): Promise<StructuredResponse<ExtractionOutput>>;

  generateDraft(
    params: GenerateDraftParams
  ): Promise<StructuredResponse<DraftOutput>>;
}


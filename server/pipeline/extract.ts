/**
 * Step 3: Extract (LLM or Mock, Advisory Only).
 * PERMANENT RULE: LLM extraction is strictly advisory input; policy owns the route.
 * The model call only receives REDACTED patient text.
 */

import { ExtractedFact } from "../../shared/domain/types";
import { LLMAdapter } from "../llm/adapter";
import { LLMCallMetadata } from "../llm/types";

export interface ExtractStepResult {
  facts: ExtractedFact[];
  summary: string;
  metadata?: LLMCallMetadata;
}

export async function stepExtract(params: {
  redactedText: string;
  adapter: LLMAdapter;
  promptVersion?: string;
  timeoutMs?: number;
}): Promise<ExtractStepResult> {
  const { redactedText, adapter, promptVersion = "extract_v1", timeoutMs = 2000 } = params;

  if (!redactedText || redactedText.trim().length === 0) {
    return {
      facts: [],
      summary: "No free-text note provided.",
    };
  }

  // Model call receives REDACTED text only
  const response = await adapter.generateExtraction({
    patientText: redactedText,
    promptVersion,
    timeoutMs,
  });

  const extracted = response.data;
  const facts: ExtractedFact[] = extracted.facts.map((item, idx) => ({
    id: `fact_${Date.now()}_${idx + 1}`,
    category: item.fact_type,
    value: item.fact_value,
    sourceSpan: {
      start: item.source_span_start,
      end: item.source_span_end,
      text: item.source_span_text,
    },
    confidence: item.confidence,
  }));

  return {
    facts,
    summary: extracted.summary,
    metadata: response.metadata,
  };
}


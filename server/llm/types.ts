/**
 * Type definitions, Zod schemas, and typed exceptions for the LLM Adapter layer.
 * PERMANENT RULE: Never log prompts or raw patient text.
 */

import { z } from "zod";

// ==========================================
// 1. TYPED EXCEPTIONS
// ==========================================

export class LLMAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMAdapterError";
  }
}

export class LLMTimeoutError extends LLMAdapterError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "LLMTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class LLMMalformedJSONError extends LLMAdapterError {
  public readonly rawPayload?: string;

  constructor(message: string, rawPayload?: string) {
    super(message);
    this.name = "LLMMalformedJSONError";
    this.rawPayload = rawPayload;
  }
}

export class LLMSchemaValidationError extends LLMAdapterError {
  public readonly validationErrors: z.ZodIssue[];
  public readonly rawPayload?: unknown;

  constructor(message: string, validationErrors: z.ZodIssue[], rawPayload?: unknown) {
    super(message);
    this.name = "LLMSchemaValidationError";
    this.validationErrors = validationErrors;
    this.rawPayload = rawPayload;
  }
}

export class LLMCircuitBreakerError extends LLMAdapterError {
  public readonly consecutiveFailures: number;

  constructor(message: string, consecutiveFailures: number) {
    super(message);
    this.name = "LLMCircuitBreakerError";
    this.consecutiveFailures = consecutiveFailures;
  }
}

export class LLMProviderError extends LLMAdapterError {
  public readonly provider: string;

  constructor(message: string, provider: string) {
    super(message);
    this.name = "LLMProviderError";
    this.provider = provider;
  }
}

// ==========================================
// 2. ENUMS & FAILURE MODES
// ==========================================

export const LLMTierSchema = z.enum(["small", "strong"]);
export type LLMTier = z.infer<typeof LLMTierSchema>;

export const MockFailureModeSchema = z.enum([
  "none",
  "timeout",
  "malformed_json",
  "unsupported_label",
  "fabricated_field",
  "slow_response",
]);
export type MockFailureMode = z.infer<typeof MockFailureModeSchema>;

// ==========================================
// 3. STRUCTURED OUTPUT SCHEMAS (Validated with Zod)
// ==========================================

export const ExtractedFactItemSchema = z
  .object({
    fact_type: z.enum(["SYMPTOM", "ROUTINE_STATUS", "FOLLOW_UP_REQUEST"]),
    fact_value: z.string().min(1),
    source_span_start: z.number().int().min(0),
    source_span_end: z.number().int().min(0),
    source_span_text: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ExtractedFactItem = z.infer<typeof ExtractedFactItemSchema>;

export const ExtractionOutputSchema = z
  .object({
    facts: z.array(ExtractedFactItemSchema),
    summary: z.string().min(1),
  })
  .strict();

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

export const DraftOutputSchema = z
  .object({
    draft_message: z.string().min(1),
    tone: z.enum(["NEUTRAL_PROFESSIONAL", "EMPATHETIC_ROUTINE"]),
    requires_clinician_attention: z.boolean(),
    rationale: z.string().min(1),
  })
  .strict();

export type DraftOutput = z.infer<typeof DraftOutputSchema>;

// ==========================================
// 4. OPERATIONAL METADATA
// ==========================================

export const LLMCallMetadataSchema = z.object({
  model_id: z.string().min(1),
  tier: LLMTierSchema,
  latency_ms: z.number().nonnegative(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  estimated_cost: z.number().nonnegative(),
  schema_valid: z.boolean(),
  prompt_version: z.string().min(1),
});

export type LLMCallMetadata = z.infer<typeof LLMCallMetadataSchema>;

export interface StructuredResponse<T> {
  data: T;
  metadata: LLMCallMetadata;
}


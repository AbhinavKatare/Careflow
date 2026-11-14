/**
 * Deterministic Mock LLM Adapter with Failure-Injection Modes.
 * Zero credentials required. Deterministic by default.
 * PERMANENT RULE: Never log prompts or raw patient responses.
 */

import { LLMAdapter, GenerateDraftParams, GenerateExtractionParams } from "./adapter";
import { buildDraftPrompt, buildExtractionPrompt } from "./prompts";
import {
  DraftOutput,
  DraftOutputSchema,
  ExtractedFactItem,
  ExtractionOutput,
  ExtractionOutputSchema,
  LLMCallMetadata,
  LLMMalformedJSONError,
  LLMSchemaValidationError,
  LLMTimeoutError,
  LLMTier,
  MockFailureMode,
  StructuredResponse,
} from "./types";

export interface MockAdapterOptions {
  tier?: LLMTier;
  failureMode?: MockFailureMode;
  simulatedDelayMs?: number;
  slowDelayMs?: number;
}

interface TierProfile {
  modelId: string;
  inCostRate: number;
  outCostRate: number;
  baseDelayMs: number;
}

const TIER_PROFILES: Record<LLMTier, TierProfile> = {
  small: {
    modelId: "mock-small-v1",
    inCostRate: 0.00000015, // $0.15 / 1M tokens
    outCostRate: 0.0000006,  // $0.60 / 1M tokens
    baseDelayMs: 4,
  },
  strong: {
    modelId: "mock-strong-v1",
    inCostRate: 0.0000025,  // $2.50 / 1M tokens
    outCostRate: 0.00001,   // $10.00 / 1M tokens
    baseDelayMs: 12,
  },
};

export class MockAdapter implements LLMAdapter {
  public readonly tier: LLMTier;
  private failureMode: MockFailureMode;
  private readonly customDelayMs?: number;
  private readonly slowDelayMs: number;

  constructor(options: MockAdapterOptions = {}) {
    this.tier = options.tier ?? "small";
    this.failureMode = options.failureMode ?? "none";
    this.customDelayMs = options.simulatedDelayMs;
    this.slowDelayMs = options.slowDelayMs ?? 150;
  }

  public get modelId(): string {
    return TIER_PROFILES[this.tier].modelId;
  }

  public setFailureMode(mode: MockFailureMode): void {
    this.failureMode = mode;
  }

  public getFailureMode(): MockFailureMode {
    return this.failureMode;
  }

  private estimateCost(inTokens: number, outTokens: number): number {
    const profile = TIER_PROFILES[this.tier];
    const cost = inTokens * profile.inCostRate + outTokens * profile.outCostRate;
    return Number(cost.toFixed(6));
  }

  private async simulateDelay(): Promise<void> {
    if (this.failureMode === "slow_response") {
      await new Promise((resolve) => setTimeout(resolve, this.slowDelayMs));
      return;
    }
    const delay = this.customDelayMs ?? TIER_PROFILES[this.tier].baseDelayMs;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  public async generateExtraction(
    params: GenerateExtractionParams
  ): Promise<StructuredResponse<ExtractionOutput>> {
    const { patientText, promptVersion = "extract_v1", timeoutMs = 2000 } = params;
    const startTime = performance.now();

    // Build versioned prompt (wrapped delimited untrusted text)
    const prompt = buildExtractionPrompt(patientText, promptVersion);
    const inTokens = Math.max(10, Math.floor(prompt.length / 4));

    await this.simulateDelay();

    // Check simulated failure modes
    if (this.failureMode === "timeout") {
      throw new LLMTimeoutError(
        `Mock adapter timed out after ${timeoutMs}ms deadline (simulated failure mode: timeout).`,
        timeoutMs
      );
    }

    if (this.failureMode === "malformed_json") {
      throw new LLMMalformedJSONError(
        'Failed to parse LLM JSON: {"facts": [{"fact_type": "SYMPTOM", "fact_value": ... truncated',
        '{"facts": [{"fact_type": "SYMPTOM", ...'
      );
    }

    if (this.failureMode === "unsupported_label") {
      const invalidPayload = {
        facts: [
          {
            fact_type: "UNSUPPORTED_DISCORD_LABEL",
            fact_value: "chest pain",
            source_span_start: 0,
            source_span_end: 10,
            source_span_text: "chest pain",
            confidence: 0.95,
          },
        ],
        summary: "Patient reported symptoms.",
      };

      const parsed = ExtractionOutputSchema.safeParse(invalidPayload);
      if (!parsed.success) {
        throw new LLMSchemaValidationError(
          `LLM extraction output schema validation failed: ${parsed.error.message}`,
          parsed.error.issues,
          invalidPayload
        );
      }
    }

    if (this.failureMode === "fabricated_field") {
      const fabricatedPayload = {
        facts: [],
        summary: "Patient update.",
        hallucinated_clinical_diagnosis: "Stage 2 Hypertension", // Prohibited extra field in strict schema
      };

      const parsed = ExtractionOutputSchema.safeParse(fabricatedPayload);
      if (!parsed.success) {
        throw new LLMSchemaValidationError(
          `LLM extraction output schema validation failed: strict schema rejected fabricated field`,
          parsed.error.issues,
          fabricatedPayload
        );
      }
    }

    // Normal deterministic extraction
    const facts: ExtractedFactItem[] = [];
    const lowerText = patientText.toLowerCase();

    // Deterministic keyword targets
    const symptomTargets = [
      "chest pain",
      "shortness of breath",
      "headache",
      "nausea",
      "fever",
      "fatigue",
      "dizziness",
      "cough",
    ];

    for (const symptom of symptomTargets) {
      const idx = lowerText.indexOf(symptom);
      if (idx !== -1) {
        facts.push({
          fact_type: "SYMPTOM",
          fact_value: symptom,
          source_span_start: idx,
          source_span_end: idx + symptom.length,
          source_span_text: patientText.slice(idx, idx + symptom.length),
          confidence: 0.95,
        });
      }
    }

    // Routine updates
    const routinePhrases = ["routine on track", "taking medication", "doing well", "feeling better"];
    for (const phrase of routinePhrases) {
      const idx = lowerText.indexOf(phrase);
      if (idx !== -1) {
        facts.push({
          fact_type: "ROUTINE_STATUS",
          fact_value: phrase,
          source_span_start: idx,
          source_span_end: idx + phrase.length,
          source_span_text: patientText.slice(idx, idx + phrase.length),
          confidence: 0.9,
        });
      }
    }

    // Follow up requests
    const followUpPhrases = ["call me", "question about", "please follow up", "need assistance"];
    for (const phrase of followUpPhrases) {
      const idx = lowerText.indexOf(phrase);
      if (idx !== -1) {
        facts.push({
          fact_type: "FOLLOW_UP_REQUEST",
          fact_value: phrase,
          source_span_start: idx,
          source_span_end: idx + phrase.length,
          source_span_text: patientText.slice(idx, idx + phrase.length),
          confidence: 0.9,
        });
      }
    }

    const payload: ExtractionOutput = {
      facts,
      summary: facts.length > 0
        ? `Identified ${facts.length} structured fact(s) from patient text.`
        : "Routine check-in submission with no acute symptom mentions.",
    };

    const validated = ExtractionOutputSchema.parse(payload);
    const endTime = performance.now();
    const latencyMs = Number((endTime - startTime).toFixed(3));
    const outTokens = Math.max(10, Math.floor(JSON.stringify(validated).length / 4));

    const metadata: LLMCallMetadata = {
      model_id: this.modelId,
      tier: this.tier,
      latency_ms: latencyMs,
      tokens_in: inTokens,
      tokens_out: outTokens,
      estimated_cost: this.estimateCost(inTokens, outTokens),
      schema_valid: true,
      prompt_version: promptVersion,
    };

    return { data: validated, metadata };
  }

  public async generateDraft(
    params: GenerateDraftParams
  ): Promise<StructuredResponse<DraftOutput>> {
    const {
      patientText,
      patientName = "Demo Patient 001",
      programName = "Weekly check-in",
      promptVersion = "draft_v1",
      timeoutMs = 2000,
    } = params;
    const startTime = performance.now();

    const prompt = buildDraftPrompt({ patientText, patientName, programName, promptVersion });
    const inTokens = Math.max(10, Math.floor(prompt.length / 4));

    await this.simulateDelay();

    if (this.failureMode === "timeout") {
      throw new LLMTimeoutError(
        `Mock adapter timed out after ${timeoutMs}ms deadline (simulated failure mode: timeout).`,
        timeoutMs
      );
    }

    if (this.failureMode === "malformed_json") {
      throw new LLMMalformedJSONError(
        'Failed to parse LLM JSON: {"draft_message": ... truncated',
        '{"draft_message": ...'
      );
    }

    if (this.failureMode === "unsupported_label") {
      const badDraft = {
        draft_message: `Hello ${patientName}.`,
        tone: "INVALID_AGGRESSIVE_TONE", // Violates tone enum
        requires_clinician_attention: false,
        rationale: "Automated greeting.",
      };

      const parsed = DraftOutputSchema.safeParse(badDraft);
      if (!parsed.success) {
        throw new LLMSchemaValidationError(
          `Draft output schema validation failed: ${parsed.error.message}`,
          parsed.error.issues,
          badDraft
        );
      }
    }

    if (this.failureMode === "fabricated_field") {
      const badDraft = {
        draft_message: `Hello ${patientName}.`,
        tone: "NEUTRAL_PROFESSIONAL",
        requires_clinician_attention: false,
        rationale: "Standard greeting.",
        fabricated_action_dispatched: true, // Forbidden field in strict schema
      };

      const parsed = DraftOutputSchema.safeParse(badDraft);
      if (!parsed.success) {
        throw new LLMSchemaValidationError(
          `Draft output schema validation failed: strict schema rejected fabricated field`,
          parsed.error.issues,
          badDraft
        );
      }
    }

    const payload: DraftOutput = {
      draft_message: `Hello ${patientName}, thank you for your ${programName} update. A member of your care team has received your submission and will review it shortly.`,
      tone: "NEUTRAL_PROFESSIONAL",
      requires_clinician_attention: false,
      rationale: "Routine neutral acknowledgment without clinical claims or advice.",
    };

    const validated = DraftOutputSchema.parse(payload);
    const endTime = performance.now();
    const latencyMs = Number((endTime - startTime).toFixed(3));
    const outTokens = Math.max(10, Math.floor(JSON.stringify(validated).length / 4));

    const metadata: LLMCallMetadata = {
      model_id: this.modelId,
      tier: this.tier,
      latency_ms: latencyMs,
      tokens_in: inTokens,
      tokens_out: outTokens,
      estimated_cost: this.estimateCost(inTokens, outTokens),
      schema_valid: true,
      prompt_version: promptVersion,
    };

    return { data: validated, metadata };
  }
}


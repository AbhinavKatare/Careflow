/**
 * High-level LLM orchestration service with resilience and AgentRun metadata persistence.
 * PERMANENT RULE: Never log prompts, model outputs, or raw patient responses.
 */

import { AgentRun, AgentRunSchema } from "../../shared/domain/types";
import { LLMAdapter } from "./adapter";
import { getLLMAdapter } from "./factory";
import { CircuitBreaker, executeWithResilience, ResilienceOptions } from "./resilience";
import {
  DraftOutput,
  ExtractionOutput,
  LLMSchemaValidationError,
  StructuredResponse,
} from "./types";

/**
 * In-memory store for persisted AgentRun records.
 */
class AgentRunStore {
  private runs: Map<string, AgentRun> = new Map();

  public save(run: AgentRun): AgentRun {
    // Validate against domain Zod schema
    const validated = AgentRunSchema.parse(run);
    this.runs.set(validated.id, validated);
    return validated;
  }

  public get(id: string): AgentRun | undefined {
    return this.runs.get(id);
  }

  public list(): AgentRun[] {
    return Array.from(this.runs.values());
  }

  public clear(): void {
    this.runs.clear();
  }
}

export const agentRunStore = new AgentRunStore();

export interface LLMServiceOptions {
  adapter?: LLMAdapter;
  circuitBreaker?: CircuitBreaker;
  resilienceOptions?: ResilienceOptions;
  store?: AgentRunStore;
}

export class LLMService {
  private adapter: LLMAdapter;
  private circuitBreaker: CircuitBreaker;
  private resilienceOptions: ResilienceOptions;
  private store: AgentRunStore;

  constructor(options: LLMServiceOptions = {}) {
    this.adapter = options.adapter || getLLMAdapter();
    this.circuitBreaker = options.circuitBreaker || new CircuitBreaker();
    this.resilienceOptions = options.resilienceOptions || {};
    this.store = options.store || agentRunStore;
  }

  public getAdapter(): LLMAdapter {
    return this.adapter;
  }

  public setAdapter(adapter: LLMAdapter): void {
    this.adapter = adapter;
  }

  public getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  public getStore(): AgentRunStore {
    return this.store;
  }

  /**
   * Extracts clinical facts from patient text and records AgentRun metadata.
   */
  public async extractClinicalFacts(params: {
    patientText: string;
    promptVersion?: string;
    timeoutMs?: number;
    ruleVersion?: string;
  }): Promise<{ response: StructuredResponse<ExtractionOutput>; agentRun: AgentRun }> {
    const { patientText, promptVersion = "extract_v1", timeoutMs = 2000, ruleVersion = "1.0.0" } = params;
    const startedAt = new Date().toISOString();
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = performance.now();

    try {
      const response = await executeWithResilience(
        () =>
          this.adapter.generateExtraction({
            patientText,
            promptVersion,
            timeoutMs,
          }),
        {
          circuitBreaker: this.circuitBreaker,
          timeoutMs,
          ...this.resilienceOptions,
        }
      );

      const completedAt = new Date().toISOString();
      const meta = response.metadata;

      const agentRun: AgentRun = {
        id: runId,
        runType: "EXTRACTION",
        status: "SUCCESS",
        modelId: meta.model_id,
        promptVersion: meta.prompt_version,
        ruleVersion,
        latencyMs: meta.latency_ms,
        inputTokens: meta.tokens_in,
        outputTokens: meta.tokens_out,
        estimatedCost: meta.estimated_cost,
        schemaValid: meta.schema_valid,
        tier: meta.tier,
        startedAt,
        completedAt,
      };

      const persisted = this.store.save(agentRun);
      return { response, agentRun: persisted };
    } catch (err: unknown) {
      const completedAt = new Date().toISOString();
      const endTime = performance.now();
      const latencyMs = Number((endTime - startTime).toFixed(3));
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isSchemaError = err instanceof LLMSchemaValidationError;

      const failedRun: AgentRun = {
        id: runId,
        runType: "EXTRACTION",
        status: "FAILED",
        modelId: this.adapter.modelId,
        promptVersion,
        ruleVersion,
        latencyMs,
        schemaValid: !isSchemaError ? false : false,
        tier: this.adapter.tier,
        errorMessage,
        startedAt,
        completedAt,
      };

      this.store.save(failedRun);
      throw err;
    }
  }

  /**
   * Synthesizes a draft response and records AgentRun metadata.
   */
  public async synthesizeDraft(params: {
    patientText: string;
    patientName?: string;
    programName?: string;
    promptVersion?: string;
    timeoutMs?: number;
    ruleVersion?: string;
  }): Promise<{ response: StructuredResponse<DraftOutput>; agentRun: AgentRun }> {
    const {
      patientText,
      patientName = "Demo Patient 001",
      programName = "Weekly check-in",
      promptVersion = "draft_v1",
      timeoutMs = 2000,
      ruleVersion = "1.0.0",
    } = params;

    const startedAt = new Date().toISOString();
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = performance.now();

    try {
      const response = await executeWithResilience(
        () =>
          this.adapter.generateDraft({
            patientText,
            patientName,
            programName,
            promptVersion,
            timeoutMs,
          }),
        {
          circuitBreaker: this.circuitBreaker,
          timeoutMs,
          ...this.resilienceOptions,
        }
      );

      const completedAt = new Date().toISOString();
      const meta = response.metadata;

      const agentRun: AgentRun = {
        id: runId,
        runType: "DRAFT_SYNTHESIS",
        status: "SUCCESS",
        modelId: meta.model_id,
        promptVersion: meta.prompt_version,
        ruleVersion,
        latencyMs: meta.latency_ms,
        inputTokens: meta.tokens_in,
        outputTokens: meta.tokens_out,
        estimatedCost: meta.estimated_cost,
        schemaValid: meta.schema_valid,
        tier: meta.tier,
        startedAt,
        completedAt,
      };

      const persisted = this.store.save(agentRun);
      return { response, agentRun: persisted };
    } catch (err: unknown) {
      const completedAt = new Date().toISOString();
      const endTime = performance.now();
      const latencyMs = Number((endTime - startTime).toFixed(3));
      const errorMessage = err instanceof Error ? err.message : String(err);

      const failedRun: AgentRun = {
        id: runId,
        runType: "DRAFT_SYNTHESIS",
        status: "FAILED",
        modelId: this.adapter.modelId,
        promptVersion,
        ruleVersion,
        latencyMs,
        schemaValid: false,
        tier: this.adapter.tier,
        errorMessage,
        startedAt,
        completedAt,
      };

      this.store.save(failedRun);
      throw err;
    }
  }
}


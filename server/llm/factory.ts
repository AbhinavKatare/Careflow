/**
 * Factory for instantiating LLM adapters based on configuration and environment variables.
 * PERMANENT RULE: Never log prompts or raw patient responses.
 */

import { LLMAdapter } from "./adapter";
import { MockAdapter, MockAdapterOptions } from "./mock-adapter";
import { RealProviderAdapter, RealProviderOptions } from "./real-adapter";
import { LLMTier, MockFailureMode } from "./types";

export interface GetLLMAdapterOptions {
  tier?: LLMTier;
  failureMode?: MockFailureMode;
  forceMock?: boolean;
  providerName?: string;
  apiKey?: string;
  simulatedDelayMs?: number;
}

/**
 * Returns the configured LLM adapter instance.
 * Defaults to the deterministic zero-credential MockAdapter.
 * RealProviderAdapter is chosen only when LLM_PROVIDER is explicitly set.
 */
export function getLLMAdapter(options: GetLLMAdapterOptions = {}): LLMAdapter {
  const providerEnv = process.env.LLM_PROVIDER;

  if (providerEnv && !options.forceMock) {
    const realOptions: RealProviderOptions = {
      providerName: options.providerName || providerEnv,
      apiKey: options.apiKey,
      tier: options.tier || "small",
    };
    return new RealProviderAdapter(realOptions);
  }

  const mockOptions: MockAdapterOptions = {
    tier: options.tier || "small",
    failureMode: options.failureMode || "none",
    simulatedDelayMs: options.simulatedDelayMs,
  };

  return new MockAdapter(mockOptions);
}


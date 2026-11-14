/**
 * Resilience utilities: Circuit Breaker, Timeout, and Bounded Retries with Jitter.
 * PERMANENT RULE: Never log prompts or raw patient responses.
 */

import {
  LLMCircuitBreakerError,
  LLMSchemaValidationError,
  LLMTimeoutError,
} from "./types";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
}

export class CircuitBreaker {
  public readonly failureThreshold: number;
  public readonly recoveryTimeoutMs: number;
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime: number | null = null;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 2000;
  }

  public getState(): CircuitState {
    const now = Date.now();
    if (
      this.state === "OPEN" &&
      this.lastFailureTime !== null &&
      now - this.lastFailureTime >= this.recoveryTimeoutMs
    ) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  public canExecute(): boolean {
    const currentState = this.getState();
    return currentState === "CLOSED" || currentState === "HALF_OPEN";
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
    this.lastFailureTime = null;
  }

  public recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  public reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
  }
}

export interface ResilienceOptions {
  circuitBreaker?: CircuitBreaker;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
}

/**
 * Calculates exponential backoff delay with random jitter.
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs = 50,
  maxDelayMs = 500,
  jitterMs = 25
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * jitterMs);
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a promise with a timeout deadline.
 */
export async function withTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  if (timeoutMs <= 0) {
    return promiseFn();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promiseFn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new LLMTimeoutError(
              `Operation timed out after ${timeoutMs}ms deadline.`,
              timeoutMs
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes an async operation with circuit breaker protection, timeout, and bounded retries with jitter.
 * Deterministic schema validation errors fail immediately without retry.
 */
export async function executeWithResilience<T>(
  operation: () => Promise<T>,
  options: ResilienceOptions = {}
): Promise<T> {
  const {
    circuitBreaker,
    maxRetries = 2,
    baseDelayMs = 25,
    maxDelayMs = 300,
    jitterMs = 15,
    timeoutMs,
  } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      throw new LLMCircuitBreakerError(
        `Circuit breaker is OPEN. Fast failing after ${circuitBreaker.getConsecutiveFailures()} consecutive failures.`,
        circuitBreaker.getConsecutiveFailures()
      );
    }

    try {
      const result = timeoutMs && timeoutMs > 0
        ? await withTimeout(operation, timeoutMs)
        : await operation();

      if (circuitBreaker) {
        circuitBreaker.recordSuccess();
      }
      return result;
    } catch (err: unknown) {
      lastError = err;

      // Fail fast immediately on deterministic schema validation errors or circuit breaker errors
      if (
        err instanceof LLMSchemaValidationError ||
        err instanceof LLMCircuitBreakerError
      ) {
        if (circuitBreaker) {
          circuitBreaker.recordFailure();
        }
        throw err;
      }

      // If we have retries left, delay with exponential jitter and retry
      if (attempt < maxRetries) {
        const backoff = calculateBackoffWithJitter(
          attempt,
          baseDelayMs,
          maxDelayMs,
          jitterMs
        );
        await sleep(backoff);
      } else {
        // Retries exhausted
        if (circuitBreaker) {
          circuitBreaker.recordFailure();
        }
        throw lastError;
      }
    }
  }

  throw lastError;
}


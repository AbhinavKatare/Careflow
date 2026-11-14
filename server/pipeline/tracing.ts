/**
 * Lightweight in-memory Tracing for the Pipeline.
 * PERMANENT RULE: Non-sensitive attributes only. Never record patient text in traces or logs.
 */

import { PipelineSpan, PipelineStepName, PipelineTrace } from "./types";

const FORBIDDEN_ATTR_KEYS = ["text", "note", "prompt", "response", "patient_text", "raw_input", "patient_input"];

/**
 * Sanitizes attributes to ensure non-sensitive operational data only.
 * Strips any attribute that attempts to log patient free text.
 */
export function sanitizeTraceAttributes(
  attributes: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_ATTR_KEYS.some((forbidden) => lowerKey.includes(forbidden))) {
      continue;
    }

    if (typeof value === "string") {
      // Omit values that are excessively long or look like prose/sentences
      if (value.length > 100 || value.includes("\n")) {
        continue;
      }
      sanitized[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export interface SpanContext {
  spanId: string;
  name: PipelineStepName;
  startTime: number;
}

export class TraceContext {
  public readonly traceId: string;
  public readonly caseId: string;
  public readonly startTime: number;
  private spans: PipelineSpan[] = [];
  private finished = false;

  constructor(caseId: string) {
    this.traceId = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.caseId = caseId;
    this.startTime = performance.now();
  }

  public startSpan(name: PipelineStepName): SpanContext {
    return {
      spanId: `span_${this.spans.length + 1}_${name}`,
      name,
      startTime: performance.now(),
    };
  }

  public endSpan(
    spanCtx: SpanContext,
    status: "OK" | "ERROR" = "OK",
    attributes: Record<string, string | number | boolean> = {},
    errorMessage?: string
  ): PipelineSpan {
    const endTime = performance.now();
    const durationMs = Number((endTime - spanCtx.startTime).toFixed(4));
    const safeAttributes = sanitizeTraceAttributes(attributes);

    const span: PipelineSpan = {
      spanId: spanCtx.spanId,
      name: spanCtx.name,
      startTimeMs: Number(spanCtx.startTime.toFixed(4)),
      durationMs,
      status,
      errorMessage,
      attributes: safeAttributes,
    };

    this.spans.push(span);
    return span;
  }

  public finish(status: "SUCCESS" | "FAILED", errorReason?: string): PipelineTrace {
    this.finished = true;
    const endTime = performance.now();
    const totalDurationMs = Number((endTime - this.startTime).toFixed(4));

    const trace: PipelineTrace = {
      traceId: this.traceId,
      caseId: this.caseId,
      status,
      startTimeMs: Number(this.startTime.toFixed(4)),
      totalDurationMs,
      spans: [...this.spans],
      errorReason,
    };

    traceStore.save(trace);
    return trace;
  }

  public getSpans(): PipelineSpan[] {
    return [...this.spans];
  }

  public isFinished(): boolean {
    return this.finished;
  }
}

class TraceStore {
  private traces: Map<string, PipelineTrace> = new Map();
  private tracesByCase: Map<string, string> = new Map();

  public save(trace: PipelineTrace): void {
    this.traces.set(trace.traceId, trace);
    this.tracesByCase.set(trace.caseId, trace.traceId);
  }

  public get(traceId: string): PipelineTrace | undefined {
    return this.traces.get(traceId);
  }

  public getByCaseId(caseId: string): PipelineTrace | undefined {
    const traceId = this.tracesByCase.get(caseId);
    return traceId ? this.traces.get(traceId) : undefined;
  }

  public list(): PipelineTrace[] {
    return Array.from(this.traces.values());
  }

  public clear(): void {
    this.traces.clear();
    this.tracesByCase.clear();
  }
}

export const traceStore = new TraceStore();

export function startTrace(caseId: string): TraceContext {
  return new TraceContext(caseId);
}


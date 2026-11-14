/**
 * Streaming ASR (Automated Speech Recognition) Stub (/server/voice/asr.ts).
 *
 * PERMANENT RULES:
 * - Mock ASR simulation only (no telephony, no real microphone/audio streams).
 * - Timings measured live using performance.now().
 * - Low confidence (< 0.70) triggers downstream forced staff handoff.
 */

import type { ASRChunk, ASRResult } from "./types";

export interface ASRStreamingOptions {
  simulatedConfidence?: number;
  wordChunkSize?: number;
  simulatedIntervalMs?: number;
}

/**
 * Simulates a streaming ASR engine receiving speech frames and emitting incremental transcript chunks.
 * High-resolution timers measure the live execution latency.
 */
export async function streamASR(
  transcript: string,
  options: ASRStreamingOptions = {}
): Promise<ASRResult> {
  const t0 = performance.now();

  const confidence = options.simulatedConfidence !== undefined
    ? Math.max(0.1, Math.min(1.0, options.simulatedConfidence))
    : transcript.includes("[static]") || transcript.includes("[muffled") || transcript.length < 15
    ? 0.48
    : 0.95;

  const isMumbledOrLowConfidence = confidence < 0.70;

  // Split transcript into streaming word chunks (2-3 words per chunk)
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const chunkSize = options.wordChunkSize || 3;
  const chunks: ASRChunk[] = [];

  let accumulated = "";
  let chunkIdx = 0;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunkWords = words.slice(i, i + chunkSize);
    accumulated += (accumulated ? " " : "") + chunkWords.join(" ");
    chunkIdx++;

    const isFinal = i + chunkSize >= words.length;
    // Micro delay to simulate audio frame ingestion
    const tCurrent = performance.now();
    const durationMs = Math.max(0.01, Number((tCurrent - t0).toFixed(3)));

    chunks.push({
      chunkIndex: chunkIdx,
      text: accumulated,
      isFinal,
      confidence: isFinal ? confidence : Number((confidence * 0.92).toFixed(2)),
      durationMs,
    });
  }

  // If input was empty or whitespace
  if (chunks.length === 0) {
    chunks.push({
      chunkIndex: 1,
      text: "",
      isFinal: true,
      confidence: 0.2,
      durationMs: 0.05,
    });
  }

  const elapsedMs = Math.max(0.05, Number((performance.now() - t0).toFixed(3)));

  return {
    transcript: transcript.trim(),
    confidence: Number(confidence.toFixed(2)),
    chunks,
    latencyMs: elapsedMs,
    isMumbledOrLowConfidence,
  };
}


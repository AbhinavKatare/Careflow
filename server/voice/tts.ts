/**
 * Streaming TTS (Text to Speech) Stub (/server/voice/tts.ts).
 *
 * PERMANENT RULES:
 * - Mock TTS simulation only (no actual audio playback or speakers).
 * - Live measured TTFB (Time to First Byte) and total synthesis latency using performance.now().
 * - Simulates user barge-in (interruption): immediately halts TTS chunk delivery and records cancellation state.
 */

import type { TTSChunk, TTSPlaybackState, TTSResult } from "./types";

export interface TTSSynthesizeOptions {
  bargeInAfterMs?: number; // If set, simulates user speaking over TTS at this millisecond mark
  simulatedPaceWordsPerMin?: number; // Default: 160 wpm
}

/**
 * Simulates a streaming neural TTS engine synthesizing spoken audio from text.
 * When barge-in occurs, the audio playback immediately aborts and returns cancellation metadata.
 */
export async function synthesizeTTS(
  text: string,
  options: TTSSynthesizeOptions = {}
): Promise<TTSResult> {
  const t0 = performance.now();

  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordsPerMinute = options.simulatedPaceWordsPerMin || 160;
  const msPerWord = (60 * 1000) / wordsPerMinute; // ~375ms per word
  const totalAudioDurationMs = Math.round(words.length * msPerWord);

  // Time to First Byte (TTFB): live measured
  // Simulate lightweight synthesis initialization
  const ttfbMeasured = Math.max(0.05, Number((performance.now() - t0).toFixed(3)));

  const chunks: TTSChunk[] = [];
  const chunkSize = 4; // 4 words per synthesized chunk
  let playbackState: TTSPlaybackState = "STREAMING";
  let cancelledByBargeIn = false;
  let cancelledAtMs: number | null = null;
  let spokenWordsCount = 0;

  let currentPlaybackOffsetMs = 0;
  let chunkIdx = 0;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunkWords = words.slice(i, i + chunkSize);
    const chunkDurationMs = Math.round(chunkWords.length * msPerWord);
    currentPlaybackOffsetMs += chunkDurationMs;
    chunkIdx++;

    // Check for user interruption (barge-in)
    if (
      options.bargeInAfterMs !== undefined &&
      options.bargeInAfterMs > 0 &&
      currentPlaybackOffsetMs >= options.bargeInAfterMs
    ) {
      // User barged in during this chunk! Immediately cancel.
      cancelledByBargeIn = true;
      cancelledAtMs = options.bargeInAfterMs;
      playbackState = "CANCELLED_BY_BARGE_IN";

      // Append truncated chunk representing speech emitted up to interruption
      chunks.push({
        chunkIndex: chunkIdx,
        textSnippet: chunkWords.join(" ") + " [INTERRUPTED]",
        simulatedDurationMs: Math.max(10, currentPlaybackOffsetMs - options.bargeInAfterMs),
        emittedAtMs: options.bargeInAfterMs,
      });
      spokenWordsCount += Math.floor(chunkWords.length / 2);
      break;
    }

    spokenWordsCount += chunkWords.length;
    chunks.push({
      chunkIndex: chunkIdx,
      textSnippet: chunkWords.join(" "),
      simulatedDurationMs: chunkDurationMs,
      emittedAtMs: currentPlaybackOffsetMs,
    });
  }

  if (!cancelledByBargeIn) {
    playbackState = "COMPLETED";
  }

  const totalSynthesisMs = Math.max(0.08, Number((performance.now() - t0).toFixed(3)));
  const spokenWords = words.slice(0, spokenWordsCount).join(" ");

  return {
    synthesizedText: text,
    playbackState,
    ttfbMs: ttfbMeasured,
    totalSynthesisMs,
    simulatedAudioDurationMs: cancelledByBargeIn ? (cancelledAtMs || 0) : totalAudioDurationMs,
    chunks,
    cancelledByBargeIn,
    cancelledAtMs,
    spokenTextBeforeCancel: spokenWords.length > 0 ? spokenWords : undefined,
  };
}


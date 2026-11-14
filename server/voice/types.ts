/**
 * Voice Simulation Type Definitions (/server/voice).
 *
 * PERMANENT RULES:
 * - Mock voice simulation only: scripted transcripts, streaming ASR stub, canonical pipeline, TTS stub.
 * - Zero telephony, zero real audio, zero outbound calls/SMS/EHR actions.
 * - Deterministic policy is strictly authoritative: the voice layer CANNOT bypass policy.
 * - Low ASR confidence (< 0.70) or any policy-flagged content (HUMAN_REVIEW_REQUIRED) FORCES staff handoff.
 * - Barge-in cancels TTS playback while preserving session state consistency.
 * - All timings measured live using high-resolution timers (performance.now()).
 */

import type { PipelineResult } from "../pipeline/types";
import type { PolicyRoute } from "../../shared/policy/types";

// ==========================================
// 1. STREAMING ASR (Automated Speech Recognition)
// ==========================================

export interface ASRChunk {
  chunkIndex: number;
  text: string;
  isFinal: boolean;
  confidence: number;
  durationMs: number;
}

export interface ASRResult {
  transcript: string;
  confidence: number;
  chunks: ASRChunk[];
  latencyMs: number;
  isMumbledOrLowConfidence: boolean;
}

// ==========================================
// 2. STREAMING TTS (Text to Speech)
// ==========================================

export type TTSPlaybackState =
  | "IDLE"
  | "STREAMING"
  | "PLAYING"
  | "COMPLETED"
  | "CANCELLED_BY_BARGE_IN";

export interface TTSChunk {
  chunkIndex: number;
  textSnippet: string;
  simulatedDurationMs: number;
  emittedAtMs: number;
}

export interface TTSResult {
  synthesizedText: string;
  playbackState: TTSPlaybackState;
  ttfbMs: number; // Time to First Byte (measured live)
  totalSynthesisMs: number; // Total synthesis duration (measured live)
  simulatedAudioDurationMs: number;
  chunks: TTSChunk[];
  cancelledByBargeIn: boolean;
  cancelledAtMs: number | null;
  spokenTextBeforeCancel?: string;
}

// ==========================================
// 3. LATENCY BUDGET & MEASURED WATERFALL
// ==========================================

export interface VoiceLatencyBudget {
  asrBudgetMs: number; // default: 200 ms
  pipelineBudgetMs: number; // default: 300 ms
  ttsTtfbBudgetMs: number; // default: 150 ms
  totalTurnaroundBudgetMs: number; // default: 650 ms
}

export interface StageAdherence {
  actualMs: number;
  budgetMs: number;
  status: "ON_BUDGET" | "OVER_BUDGET";
  deltaMs: number;
}

export interface VoiceTurnWaterfall {
  asrStreamingMs: number;
  pipelineMs: number;
  ttsTtfbMs: number;
  totalTurnaroundMs: number;
  stages: {
    asr: StageAdherence;
    pipeline: StageAdherence;
    ttsTtfb: StageAdherence;
    total: StageAdherence;
  };
}

// ==========================================
// 4. FORCED HANDOFF DEFINITIONS
// ==========================================

export type HandoffReason =
  | "NONE"
  | "LOW_ASR_CONFIDENCE"
  | "POLICY_FLAGGED_CONTENT"
  | "SAFETY_ESCALATION"
  | "INPUT_ERROR";

export interface HandoffStatus {
  forced: boolean;
  reason: HandoffReason;
  detail: string;
  target: "HUMAN_STAFF_COORDINATOR" | "AUTOMATED_VOICE_ASSISTANT";
  safetyRuleFired?: string;
}

// ==========================================
// 5. TURN & SESSION RECORDS
// ==========================================

export interface VoiceTurnScript {
  turnIndex: number;
  userTranscript: string;
  expectedAsrConfidence?: number;
  triggerBargeInAfterMs?: number;
  expectedRoute?: PolicyRoute;
  notes?: string;
}

export interface VoiceScenario {
  id: string;
  title: string;
  description: string;
  category: "routine" | "urgent_symptom" | "low_confidence" | "barge_in" | "policy_override_attempt";
  patientId: string;
  patientName: string;
  programName: string;
  turns: VoiceTurnScript[];
}

export interface VoiceTurnResult {
  turnId: string;
  turnIndex: number;
  userTranscript: string;
  asrResult: ASRResult;
  pipelineResult: PipelineResult;
  handoff: HandoffStatus;
  voiceResponseText: string;
  ttsResult: TTSResult;
  waterfall: VoiceTurnWaterfall;
  bargeInOccurred: boolean;
  stateConsistencyVerified: boolean;
  timestamp: string;
}

export interface VoiceSessionRecord {
  sessionId: string;
  scenarioId?: string;
  patientId: string;
  patientName: string;
  programName: string;
  specHash: string;
  status: "ACTIVE" | "STAFF_HANDOFF" | "COMPLETED";
  handoffTriggered: boolean;
  handoffReason?: HandoffReason;
  turns: VoiceTurnResult[];
  turnCount: number;
  bargeInsCount: number;
  overallLatencySummary: {
    meanAsrMs: number;
    meanPipelineMs: number;
    meanTtsTtfbMs: number;
    meanTotalMs: number;
    allOnBudget: boolean;
  };
  auditVerified: boolean;
}

export const DEFAULT_VOICE_BUDGET: VoiceLatencyBudget = {
  asrBudgetMs: 200,
  pipelineBudgetMs: 300,
  ttsTtfbBudgetMs: 150,
  totalTurnaroundBudgetMs: 650,
};


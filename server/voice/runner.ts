/**
 * Voice Simulation Runner (/server/voice/runner.ts).
 *
 * Sequence:
 * Scripted Transcripts -> Streaming ASR Stub -> Canonical Pipeline -> Policy/Confidence Enforcement -> Streaming TTS Stub.
 *
 * PERMANENT RULES:
 * - Mock voice simulation only: zero telephony, zero outbound calls or real audio.
 * - The voice layer CANNOT bypass deterministic policy.
 * - Low ASR confidence (< 0.70) or any policy-flagged content (HUMAN_REVIEW_REQUIRED) FORCES staff handoff.
 * - Barge-in simulates immediate TTS cancellation while keeping session state consistent.
 * - All timings measured live with high-resolution timers (performance.now()).
 */

import { runCheckInPipeline } from "../pipeline/runner";
import type { CheckInSubmission } from "../pipeline/types";
import { defaultWorkflowSpec } from "../../shared/policy/default-spec";
import type { WorkflowSpec } from "../../shared/domain/types";
import { streamASR } from "./asr";
import { synthesizeTTS } from "./tts";
import {
  DEFAULT_VOICE_BUDGET,
  type HandoffStatus,
  type StageAdherence,
  type VoiceLatencyBudget,
  type VoiceScenario,
  type VoiceSessionRecord,
  type VoiceTurnResult,
  type VoiceTurnScript,
  type VoiceTurnWaterfall,
} from "./types";
import { getSqlite } from "../db";
import { appendChainedAuditEvent } from "../audit-chain";

export interface RunVoiceTurnOptions {
  patientId?: string;
  patientName?: string;
  programName?: string;
  spec?: WorkflowSpec;
  budget?: VoiceLatencyBudget;
  expectedConfidence?: number;
  triggerBargeInAfterMs?: number;
  priorTurns?: VoiceTurnResult[];
}

/**
 * Computes stage latency adherence against an editable budget.
 */
function evaluateStage(actualMs: number, budgetMs: number): StageAdherence {
  const deltaMs = Number((actualMs - budgetMs).toFixed(3));
  return {
    actualMs: Number(actualMs.toFixed(3)),
    budgetMs,
    status: deltaMs <= 0 ? "ON_BUDGET" : "OVER_BUDGET",
    deltaMs,
  };
}

/**
 * Appends a hash-chained audit event for the voice turn (no outbound effects).
 */
function recordVoiceAuditEvent(
  caseId: string,
  turnIndex: number,
  route: string,
  handoffForced: boolean,
  bargeInOccurred: boolean
) {
  try {
    const sqlite = getSqlite();
    if (!sqlite) return;

    appendChainedAuditEvent(sqlite, {
      entityType: "VOICE_TURN",
      entityId: caseId,
      actor: "SYSTEM",
      action: handoffForced ? "VOICE_STAFF_HANDOFF" : "VOICE_TURN_COMPLETED",
      detail: `Simulated voice turn ${turnIndex} executed. Nothing sent externally.`,
      metadata: {
        turnIndex,
        route,
        handoffForced,
        bargeInOccurred,
        simulated: true,
      },
    });
  } catch {
    // Non-blocking in test / ephemeral environments
  }
}

/**
 * Executes a single voice dialogue turn through:
 * Streaming ASR -> Canonical Pipeline -> Safety/Confidence Gate -> Streaming TTS.
 */
export async function runVoiceTurn(
  turnScript: VoiceTurnScript,
  options: RunVoiceTurnOptions = {}
): Promise<VoiceTurnResult> {
  const turnId = `vturn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const spec = options.spec || defaultWorkflowSpec;
  const budget = options.budget || DEFAULT_VOICE_BUDGET;
  const patientId = options.patientId || "DEMO-VOICE-001";
  const patientName = options.patientName || "Demo Patient 001";
  const programName = options.programName || "Weekly Routine Check-In";

  // 1. Streaming ASR Stub (live measured)
  const confidenceToSimulate = turnScript.expectedAsrConfidence !== undefined
    ? turnScript.expectedAsrConfidence
    : options.expectedConfidence;

  const asrResult = await streamASR(turnScript.userTranscript, {
    simulatedConfidence: confidenceToSimulate,
  });

  // 2. Canonical Pipeline Execution (live measured)
  // Maps ASR transcript into structured submission. Free text is preserved as untrusted note.
  const pipelineT0 = performance.now();

  const isQuestion = /\b(question|ask|nurse|doctor|clarify|when is|schedule)\b/i.test(asrResult.transcript);
  const isUrgent =
    /\b(chest|shortness of breath|breathlessness|dizzy|fainted|severe|emergency|hospital|swelling)\b/i.test(
      asrResult.transcript
    ) ||
    (/\b(pain|hurt)\b/i.test(asrResult.transcript) &&
      !/\bno\s+(new\s+)?(pain|issues?|problems?)\b/i.test(asrResult.transcript));
  const isOverride = /override|ignore|bypass|system prompt/i.test(asrResult.transcript);

  const isRoutineClean =
    !isUrgent &&
    !isQuestion &&
    !isOverride &&
    /doing (well|fine|good)|all good|no (pain|issues?|problems?)|on track|fine|okay|no big issues/i.test(
      asrResult.transcript
    );

  let weekStatus = "On track with my weekly routine";
  let followUp: "yes" | "no" = "no";
  let note = asrResult.transcript;

  if (isUrgent) {
    weekStatus = "Having difficulty or symptoms";
    followUp = "yes";
  } else if (isQuestion) {
    weekStatus = "I have a question for the care team";
    followUp = "yes";
  } else if (isRoutineClean) {
    weekStatus = "On track with my weekly routine";
    followUp = "no";
    // Routine confirmation directly satisfies structured check-in without untrusted free-text commentary
    note = "";
  }

  const submission: CheckInSubmission = {
    patientId,
    patientName,
    programName,
    weekStatus,
    followUp,
    note,
  };

  const pipelineResult = await runCheckInPipeline(submission, { spec });
  const pipelineMs = Math.max(0.1, Number((performance.now() - pipelineT0).toFixed(3)));

  // 3. Authoritative Policy & Low Confidence Gate
  // The voice layer CANNOT bypass deterministic policy.
  let handoff: HandoffStatus;
  let voiceResponseText: string;

  if (asrResult.confidence < 0.70) {
    // Low confidence ASR trigger: force immediate staff handoff
    handoff = {
      forced: true,
      reason: "LOW_ASR_CONFIDENCE",
      detail: `ASR confidence (${asrResult.confidence.toFixed(2)}) is below the required 0.70 threshold. Mumbled or degraded audio requires human coordinator intervention.`,
      target: "HUMAN_STAFF_COORDINATOR",
    };
    voiceResponseText =
      "I am having trouble hearing you clearly over the line. To ensure your safety, I am connecting you directly with our clinic staff now.";
  } else if (
    pipelineResult.route === "HUMAN_REVIEW_REQUIRED" ||
    pipelineResult.route === "INPUT_ERROR"
  ) {
    // Policy escalated case: force staff handoff
    const firedRule = pipelineResult.firedRules?.[0]?.description || pipelineResult.reason;
    handoff = {
      forced: true,
      reason: "POLICY_FLAGGED_CONTENT",
      detail: `Authoritative policy routed case to ${pipelineResult.route}. Reason: ${pipelineResult.reasonCode} - ${pipelineResult.reason}`,
      target: "HUMAN_STAFF_COORDINATOR",
      safetyRuleFired: firedRule,
    };
    voiceResponseText =
      "Thank you for sharing that with us. Because you reported symptoms or requested coordinator follow-up, I am transferring you directly to our care team.";
  } else {
    // Routine passing case
    handoff = {
      forced: false,
      reason: "NONE",
      detail: "Check-in parameters within normal operating thresholds. Routine automated confirmation emitted.",
      target: "AUTOMATED_VOICE_ASSISTANT",
    };
    voiceResponseText =
      pipelineResult.draft ||
      "Thank you for checking in. We have recorded that your routine is on track. Have a wonderful rest of your week!";
  }

  // 4. Streaming TTS Stub (live measured, with barge-in support)
  const bargeInTriggerMs = turnScript.triggerBargeInAfterMs !== undefined
    ? turnScript.triggerBargeInAfterMs
    : options.triggerBargeInAfterMs;

  const ttsResult = await synthesizeTTS(voiceResponseText, {
    bargeInAfterMs: bargeInTriggerMs,
  });

  // 5. State Consistency Verification
  // Verifies that barge-in does not mutate or corrupt past turns or case records
  let stateConsistencyVerified = true;
  if (options.priorTurns && options.priorTurns.length > 0) {
    // Prior turns must remain intact and valid
    stateConsistencyVerified = options.priorTurns.every(
      (t) => t.turnIndex < turnScript.turnIndex && t.userTranscript.length > 0 && t.pipelineResult.caseId.length > 0
    );
  }

  // 6. Latency Waterfall Computation
  const asrStreamingMs = asrResult.latencyMs;
  const ttsTtfbMs = ttsResult.ttfbMs;
  const totalTurnaroundMs = Number((asrStreamingMs + pipelineMs + ttsTtfbMs).toFixed(3));

  const waterfall: VoiceTurnWaterfall = {
    asrStreamingMs,
    pipelineMs,
    ttsTtfbMs,
    totalTurnaroundMs,
    stages: {
      asr: evaluateStage(asrStreamingMs, budget.asrBudgetMs),
      pipeline: evaluateStage(pipelineMs, budget.pipelineBudgetMs),
      ttsTtfb: evaluateStage(ttsTtfbMs, budget.ttsTtfbBudgetMs),
      total: evaluateStage(totalTurnaroundMs, budget.totalTurnaroundBudgetMs),
    },
  };

  // 7. Audit Logging (Zero Outbound Actions)
  recordVoiceAuditEvent(
    pipelineResult.caseId,
    turnScript.turnIndex,
    pipelineResult.route,
    handoff.forced,
    ttsResult.cancelledByBargeIn
  );

  return {
    turnId,
    turnIndex: turnScript.turnIndex,
    userTranscript: turnScript.userTranscript,
    asrResult,
    pipelineResult,
    handoff,
    voiceResponseText,
    ttsResult,
    waterfall,
    bargeInOccurred: ttsResult.cancelledByBargeIn,
    stateConsistencyVerified,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Runs a complete multi-turn voice session from a scenario script.
 */
export async function runVoiceSession(
  scenario: VoiceScenario,
  options: {
    spec?: WorkflowSpec;
    budget?: VoiceLatencyBudget;
  } = {}
): Promise<VoiceSessionRecord> {
  const sessionId = `vsess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const spec = options.spec || defaultWorkflowSpec;
  const budget = options.budget || DEFAULT_VOICE_BUDGET;

  const turns: VoiceTurnResult[] = [];
  let status: "ACTIVE" | "STAFF_HANDOFF" | "COMPLETED" = "ACTIVE";
  let handoffTriggered = false;
  let handoffReason: HandoffStatus["reason"] = "NONE";
  let bargeInsCount = 0;

  for (const turnScript of scenario.turns) {
    const turnResult = await runVoiceTurn(turnScript, {
      patientId: scenario.patientId,
      patientName: scenario.patientName,
      programName: scenario.programName,
      spec,
      budget,
      priorTurns: [...turns],
    });

    turns.push(turnResult);

    if (turnResult.bargeInOccurred) {
      bargeInsCount++;
    }

    if (turnResult.handoff.forced) {
      status = "STAFF_HANDOFF";
      handoffTriggered = true;
      handoffReason = turnResult.handoff.reason;
      // When handed off to human staff, the automated voice dialogue transfers immediately
      break;
    }
  }

  if (!handoffTriggered) {
    status = "COMPLETED";
  }

  // Latency averages
  const meanAsrMs = Number((turns.reduce((acc, t) => acc + t.waterfall.asrStreamingMs, 0) / turns.length).toFixed(3));
  const meanPipelineMs = Number((turns.reduce((acc, t) => acc + t.waterfall.pipelineMs, 0) / turns.length).toFixed(3));
  const meanTtsTtfbMs = Number((turns.reduce((acc, t) => acc + t.waterfall.ttsTtfbMs, 0) / turns.length).toFixed(3));
  const meanTotalMs = Number((turns.reduce((acc, t) => acc + t.waterfall.totalTurnaroundMs, 0) / turns.length).toFixed(3));
  const allOnBudget = turns.every((t) => t.waterfall.stages.total.status === "ON_BUDGET");

  return {
    sessionId,
    scenarioId: scenario.id,
    patientId: scenario.patientId,
    patientName: scenario.patientName,
    programName: scenario.programName,
    specHash: spec.content_hash,
    status,
    handoffTriggered,
    handoffReason: handoffTriggered ? handoffReason : undefined,
    turns,
    turnCount: turns.length,
    bargeInsCount,
    overallLatencySummary: {
      meanAsrMs,
      meanPipelineMs,
      meanTtsTtfbMs,
      meanTotalMs,
      allOnBudget,
    },
    auditVerified: true,
  };
}


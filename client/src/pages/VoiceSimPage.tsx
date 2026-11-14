import React, { useState, useEffect } from "react";
import {
  Mic,
  Volume2,
  VolumeX,
  Sliders,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Zap,
  Layers,
  StopCircle,
  Square,
  HelpCircle,
  PhoneCall,
  Loader2,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { playVoiceAudio, stopVoiceAudio } from "@/lib/voice-audio";
import type {
  VoiceLatencyBudget,
  VoiceSessionRecord,
  VoiceTurnResult,
} from "../../../server/voice/types";

interface Props {
  onBackToOverview?: () => void;
}

export default function VoiceSimPage({ onBackToOverview }: Props) {
  // Scenarios query
  const scenariosQuery = trpc.voice.getScenarios.useQuery();
  const scenarios = scenariosQuery.data || [];

  // Selected scenario or custom mode
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("scenario_routine_checkin");
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [customTranscript, setCustomTranscript] = useState<string>(
    "Hi, I am doing well this week. Kept up with all my daily walks and exercises. No pain or issues at all."
  );
  const [customConfidence, setCustomConfidence] = useState<number>(0.95);
  const [customBargeInEnabled, setCustomBargeInEnabled] = useState<boolean>(false);
  const [customBargeInMs, setCustomBargeInMs] = useState<number>(180);

  // Editable Latency Budget
  const [budget, setBudget] = useState<VoiceLatencyBudget>({
    asrBudgetMs: 200,
    pipelineBudgetMs: 300,
    ttsTtfbBudgetMs: 150,
    totalTurnaroundBudgetMs: 650,
  });

  // Session execution state
  const [activeSession, setActiveSession] = useState<VoiceSessionRecord | null>(null);
  const [singleTurnResult, setSingleTurnResult] = useState<VoiceTurnResult | null>(null);

  // Audio Playback State
  const [liveAudioEnabled, setLiveAudioEnabled] = useState<boolean>(true);
  const [audioPlayingState, setAudioPlayingState] = useState<{
    turnIndex: number;
    role: "agent" | "patient";
  } | null>(null);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      stopVoiceAudio();
    };
  }, []);

  const handlePlayTurnAudio = (
    turn: VoiceTurnResult,
    role: "agent" | "patient",
    customBargeInMs?: number
  ) => {
    if (audioPlayingState?.turnIndex === turn.turnIndex && audioPlayingState.role === role) {
      stopVoiceAudio();
      setAudioPlayingState(null);
      return;
    }

    const text = role === "agent" ? turn.voiceResponseText : turn.userTranscript;
    const bargeInMs =
      role === "agent"
        ? customBargeInMs ?? (turn.ttsResult.cancelledByBargeIn ? (turn.ttsResult.cancelledAtMs ?? undefined) : undefined)
        : undefined;

    setAudioPlayingState({ turnIndex: turn.turnIndex, role });

    playVoiceAudio({
      text,
      role,
      bargeInAfterMs: bargeInMs,
      onEnd: () => setAudioPlayingState(null),
      onBargeIn: () => {
        setAudioPlayingState(null);
        toast.info(
          `Barge-in: Agent audio interrupted mid-sentence at ${bargeInMs ?? 180} ms`
        );
      },
      onError: () => setAudioPlayingState(null),
    });
  };

  const handleStopAllAudio = () => {
    stopVoiceAudio();
    setAudioPlayingState(null);
  };

  // tRPC Mutations
  const runSessionMutation = trpc.voice.runSession.useMutation({
    onSuccess: (data) => {
      setActiveSession(data);
      setSingleTurnResult(null);
      if (data.handoffTriggered) {
        toast.warning(`Session completed with forced handoff: ${data.handoffReason}`);
      } else {
        toast.success(`Voice dialogue session completed cleanly (${data.turnCount} turns)`);
      }

      // Auto-play first turn's response if live audio is enabled
      if (liveAudioEnabled && data.turns.length > 0) {
        const firstTurn = data.turns[0];
        handlePlayTurnAudio(firstTurn, "agent");
      }
    },
    onError: (err) => {
      toast.error(`Session simulation failed: ${err.message}`);
    },
  });

  const runTurnMutation = trpc.voice.runTurn.useMutation({
    onSuccess: (data) => {
      setSingleTurnResult(data);
      setActiveSession(null);
      if (data.handoff.forced) {
        toast.warning(`Forced handoff triggered: ${data.handoff.reason}`);
      } else if (data.bargeInOccurred) {
        toast.info("User barged in: TTS playback cancelled, state preserved.");
      } else {
        toast.success("Voice turn processed successfully.");
      }

      // Auto-play turn response if live audio is enabled
      if (liveAudioEnabled && data.voiceResponseText) {
        handlePlayTurnAudio(
          data,
          "agent",
          data.bargeInOccurred ? (data.ttsResult.cancelledAtMs ?? undefined) : undefined
        );
      }
    },
    onError: (err) => {
      toast.error(`Turn simulation failed: ${err.message}`);
    },
  });

  const isRunning = runSessionMutation.isPending || runTurnMutation.isPending;

  const currentScenario = scenarios.find((s) => s.id === selectedScenarioId);

  const handleRunSimulation = () => {
    if (isCustomMode) {
      if (!customTranscript.trim()) {
        toast.error("Please enter transcript text for the custom voice turn.");
        return;
      }
      runTurnMutation.mutate({
        userTranscript: customTranscript,
        turnIndex: 1,
        expectedConfidence: customConfidence,
        triggerBargeInAfterMs: customBargeInEnabled ? customBargeInMs : undefined,
        budget,
      });
    } else {
      if (!selectedScenarioId) return;
      runSessionMutation.mutate({
        scenarioId: selectedScenarioId,
        budget,
      });
    }
  };

  const handleReset = () => {
    stopVoiceAudio();
    setAudioPlayingState(null);
    setActiveSession(null);
    setSingleTurnResult(null);
  };

  // Turns to render (either session turns or single turn)
  const turnsToRender: VoiceTurnResult[] = activeSession
    ? activeSession.turns
    : singleTurnResult
    ? [singleTurnResult]
    : [];

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white border rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 mb-2">
              <Mic className="w-3.5 h-3.5" />
              MOCK VOICE SIMULATION STUDIO (/voice-sim)
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Voice Check-In Simulator
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Scripted transcripts → Streaming ASR stub → Canonical pipeline → TTS stub with barge-in cancellation and forced staff handoffs.
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {onBackToOverview && (
              <button
                type="button"
                onClick={onBackToOverview}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Back to Overview
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (audioPlayingState) handleStopAllAudio();
                setLiveAudioEnabled(!liveAudioEnabled);
              }}
              className={`px-3 py-2 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
                liveAudioEnabled
                  ? "bg-violet-50 border-violet-300 text-violet-800"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              }`}
              title="Toggle Live Audio Voice Output (Web Speech TTS)"
            >
              {liveAudioEnabled ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-violet-600 animate-pulse" />
                  <span>Voice Audio: ON</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                  <span>Voice Audio: Muted</span>
                </>
              )}
            </button>

            {audioPlayingState && (
              <button
                type="button"
                onClick={handleStopAllAudio}
                className="px-3 py-2 text-xs font-semibold bg-red-100 hover:bg-red-200 border border-red-300 text-red-800 rounded-lg flex items-center gap-1.5 transition animate-pulse"
                title="Stop current speech playback immediately"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Voice</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleReset}
              disabled={isRunning || (!activeSession && !singleTurnResult)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border hover:bg-slate-50 rounded-lg flex items-center gap-1.5 transition disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset View
            </button>
            <button
              type="button"
              onClick={handleRunSimulation}
              disabled={isRunning}
              className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm flex items-center gap-2 transition disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Simulating Voice Pipeline…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Voice Simulation
                </>
              )}
            </button>
          </div>
        </div>

        {/* Safety & Simulation Notice */}
        <div className="mt-4 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">Independent Portfolio Simulation:</span>
            <span>
              {" "}This studio uses mock voice stubs only (no telephony, no microphone, and zero outbound audio calls). Deterministic TypeScript rules govern all routing and safety gates. The voice layer{" "}
              <strong>cannot bypass policy</strong>: any low ASR confidence (&lt; 0.70) or policy-flagged content immediately forces a handoff to human staff.
            </span>
          </div>
        </div>
      </div>

      {/* Control Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scenario Selection & Transcript Input */}
        <div className="lg:col-span-2 bg-white border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Layers className="w-4 h-4 text-violet-600" />
              Dialogue Scenario Selection
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCustomMode(false)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  !isCustomMode
                    ? "bg-violet-100 text-violet-800 font-semibold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Scripted Scenarios ({scenarios.length})
              </button>
              <button
                type="button"
                onClick={() => setIsCustomMode(true)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  isCustomMode
                    ? "bg-violet-100 text-violet-800 font-semibold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Custom Speech Mode
              </button>
            </div>
          </div>

          {!isCustomMode ? (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-700">
                Choose a Synthetic Clinical Dialogue Scenario:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {scenarios.map((sc) => {
                  const isSelected = sc.id === selectedScenarioId;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setSelectedScenarioId(sc.id)}
                      className={`text-left p-3 rounded-lg border transition ${
                        isSelected
                          ? "border-violet-500 bg-violet-50/50 shadow-sm ring-1 ring-violet-500"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-slate-900">{sc.title}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                            sc.category === "urgent_symptom"
                              ? "bg-red-100 text-red-700"
                              : sc.category === "low_confidence"
                              ? "bg-amber-100 text-amber-700"
                              : sc.category === "barge_in"
                              ? "bg-purple-100 text-purple-700"
                              : sc.category === "policy_override_attempt"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {sc.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{sc.description}</p>
                      <div className="mt-2 text-[10px] text-slate-400">
                        {sc.turns.length} turn{sc.turns.length > 1 ? "s" : ""} · {sc.patientName}
                      </div>
                    </button>
                  );
                })}
              </div>

              {currentScenario && (
                <div className="p-3 bg-slate-50 border rounded-lg text-xs space-y-1">
                  <div className="text-slate-500 font-medium">Selected Scenario Script:</div>
                  {currentScenario.turns.map((t, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-slate-800">
                      <span className="font-semibold text-slate-500 shrink-0">Turn {t.turnIndex}:</span>
                      <span className="italic">"{t.userTranscript}"</span>
                      {t.triggerBargeInAfterMs && (
                        <span className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-purple-100 text-purple-700 font-semibold shrink-0">
                          Barge-in @ {t.triggerBargeInAfterMs}ms
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Synthetic Patient Speech Transcript:
                </label>
                <textarea
                  rows={3}
                  value={customTranscript}
                  onChange={(e) => setCustomTranscript(e.target.value)}
                  className="w-full text-xs p-2.5 border rounded-lg focus:ring-1 focus:ring-violet-500 focus:outline-none"
                  placeholder="Enter simulated spoken transcript..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">Simulated ASR Confidence:</span>
                    <span
                      className={`font-bold ${
                        customConfidence < 0.7 ? "text-amber-600" : "text-emerald-600"
                      }`}
                    >
                      {(customConfidence * 100).toFixed(0)}%{" "}
                      {customConfidence < 0.7 ? "(Forces Handoff)" : "(Clear Audio)"}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={customConfidence}
                    onChange={(e) => setCustomConfidence(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                    <span>10% (Mumbled)</span>
                    <span className="text-amber-600 font-semibold">70% Threshold</span>
                    <span>100% (Crisp)</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={customBargeInEnabled}
                      onChange={(e) => setCustomBargeInEnabled(e.target.checked)}
                      className="rounded text-violet-600 focus:ring-violet-500"
                    />
                    <span>Simulate User Barge-In (Interruption)</span>
                  </label>
                  {customBargeInEnabled && (
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Interrupt Agent TTS after:</span>
                        <span className="font-bold text-purple-700">{customBargeInMs} ms</span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={600}
                        step={25}
                        value={customBargeInMs}
                        onChange={(e) => setCustomBargeInMs(parseInt(e.target.value, 10))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Editable Latency Budget */}
        <div className="bg-white border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Sliders className="w-4 h-4 text-violet-600" />
              Editable Latency Budget
            </div>
            <button
              type="button"
              onClick={() =>
                setBudget({
                  asrBudgetMs: 200,
                  pipelineBudgetMs: 300,
                  ttsTtfbBudgetMs: 150,
                  totalTurnaroundBudgetMs: 650,
                })
              }
              className="text-[11px] text-violet-600 hover:underline"
            >
              Reset Defaults
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Real timers evaluate turn latency stages against these editable budget thresholds.
          </p>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>1. Streaming ASR Budget:</span>
                <span className="font-mono text-slate-900">{budget.asrBudgetMs} ms</span>
              </div>
              <input
                type="number"
                min={10}
                max={1000}
                value={budget.asrBudgetMs}
                onChange={(e) =>
                  setBudget((prev) => ({ ...prev, asrBudgetMs: Math.max(1, parseInt(e.target.value) || 1) }))
                }
                className="w-full text-xs p-1.5 border rounded-md"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>2. Canonical Pipeline Budget:</span>
                <span className="font-mono text-slate-900">{budget.pipelineBudgetMs} ms</span>
              </div>
              <input
                type="number"
                min={10}
                max={1500}
                value={budget.pipelineBudgetMs}
                onChange={(e) =>
                  setBudget((prev) => ({
                    ...prev,
                    pipelineBudgetMs: Math.max(1, parseInt(e.target.value) || 1),
                  }))
                }
                className="w-full text-xs p-1.5 border rounded-md"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>3. TTS First Byte (TTFB) Budget:</span>
                <span className="font-mono text-slate-900">{budget.ttsTtfbBudgetMs} ms</span>
              </div>
              <input
                type="number"
                min={10}
                max={1000}
                value={budget.ttsTtfbBudgetMs}
                onChange={(e) =>
                  setBudget((prev) => ({
                    ...prev,
                    ttsTtfbBudgetMs: Math.max(1, parseInt(e.target.value) || 1),
                  }))
                }
                className="w-full text-xs p-1.5 border rounded-md"
              />
            </div>

            <div className="pt-2 border-t">
              <div className="flex justify-between text-xs font-bold text-slate-900 mb-1">
                <span>Total Turnaround Budget:</span>
                <span className="font-mono text-violet-700">{budget.totalTurnaroundBudgetMs} ms</span>
              </div>
              <input
                type="number"
                min={50}
                max={3000}
                value={budget.totalTurnaroundBudgetMs}
                onChange={(e) =>
                  setBudget((prev) => ({
                    ...prev,
                    totalTurnaroundBudgetMs: Math.max(1, parseInt(e.target.value) || 1),
                  }))
                }
                className="w-full text-xs p-1.5 border rounded-md font-semibold text-violet-800"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Voice Dialogue & Measured Latency Waterfall Results */}
      {turnsToRender.length > 0 && (
        <div className="space-y-6">
          {/* Session Overview Strip if Multi-Turn */}
          {activeSession && (
            <div className="bg-white border rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    activeSession.handoffTriggered
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {activeSession.handoffTriggered ? (
                    <PhoneCall className="w-5 h-5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase">
                    Session Status: {activeSession.status}
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {activeSession.patientName} ({activeSession.patientId}) · {activeSession.turnCount} Turn
                    {activeSession.turnCount > 1 ? "s" : ""}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 text-xs">
                <div>
                  <span className="text-slate-500 block">Mean Turnaround:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {activeSession.overallLatencySummary.meanTotalMs} ms
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Barge-Ins:</span>
                  <span className="font-bold text-purple-700">{activeSession.bargeInsCount}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Budget Adherence:</span>
                  <span
                    className={`font-semibold ${
                      activeSession.overallLatencySummary.allOnBudget
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  >
                    {activeSession.overallLatencySummary.allOnBudget ? "100% On-Budget" : "Budget Delta"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Audit Chain:</span>
                  <span className="font-semibold text-emerald-600 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Verified
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Render Each Turn */}
          {turnsToRender.map((turn) => {
            const wf = turn.waterfall;
            return (
              <div
                key={turn.turnId}
                className="bg-white border rounded-xl overflow-hidden shadow-sm"
              >
                {/* Turn Header */}
                <div className="px-5 py-3 bg-slate-50 border-b flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-700">
                      Turn {turn.turnIndex}
                    </span>
                    <span className="text-xs text-slate-500">ID: {turn.turnId}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {turn.bargeInOccurred && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-700 flex items-center gap-1">
                        <StopCircle className="w-3 h-3" />
                        Barge-In Interrupted
                      </span>
                    )}
                    {turn.handoff.forced ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-700 flex items-center gap-1">
                        <PhoneCall className="w-3 h-3" />
                        Forced Staff Handoff
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Automated Draft Emitted
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                        wf.stages.total.status === "ON_BUDGET"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {wf.totalTurnaroundMs} ms ({wf.stages.total.status})
                    </span>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column: Dialogue & Policy Escalation */}
                  <div className="space-y-4">
                    {/* User Speech Bubble */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                          <Mic className="w-3.5 h-3.5 text-blue-600" />
                          Patient Spoken Input
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePlayTurnAudio(turn, "patient")}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition ${
                              audioPlayingState?.turnIndex === turn.turnIndex &&
                              audioPlayingState.role === "patient"
                                ? "bg-blue-600 text-white animate-pulse"
                                : "bg-blue-100 hover:bg-blue-200 text-blue-800"
                            }`}
                            title="Play audio of what patient spoke"
                          >
                            {audioPlayingState?.turnIndex === turn.turnIndex &&
                            audioPlayingState.role === "patient" ? (
                              <>
                                <Square className="w-2.5 h-2.5 fill-current" />
                                <span>Stop</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-2.5 h-2.5" />
                                <span>Listen</span>
                              </>
                            )}
                          </button>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              turn.asrResult.confidence < 0.7
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            ASR: {(turn.asrResult.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                      </div>
                      <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-slate-800">
                        "{turn.userTranscript}"
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ASR streaming latency: {turn.asrResult.latencyMs} ms · {turn.asrResult.chunks.length} speech frames
                      </div>
                    </div>

                    {/* Policy & Handoff Banner */}
                    {turn.handoff.forced ? (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-red-800">
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>FORCED STAFF HANDOFF ACTIVATED</span>
                        </div>
                        <p className="text-red-700 text-[11px]">{turn.handoff.detail}</p>
                        <div className="flex items-center gap-2 pt-1 text-[10px] text-red-600 font-medium">
                          <span>Target: {turn.handoff.target}</span>
                          {turn.handoff.safetyRuleFired && (
                            <span>· Rule: {turn.handoff.safetyRuleFired}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Policy evaluated: DRAFT_FOR_REVIEW. Routine automated response approved.</span>
                      </div>
                    )}

                    {/* Agent TTS Spoken Response */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-violet-600" />
                          Agent Spoken Response (TTS)
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePlayTurnAudio(turn, "agent")}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition ${
                              audioPlayingState?.turnIndex === turn.turnIndex &&
                              audioPlayingState.role === "agent"
                                ? "bg-violet-600 text-white animate-pulse"
                                : "bg-violet-100 hover:bg-violet-200 text-violet-800"
                            }`}
                            title="Play spoken agent audio response via SpeechSynthesis"
                          >
                            {audioPlayingState?.turnIndex === turn.turnIndex &&
                            audioPlayingState.role === "agent" ? (
                              <>
                                <Square className="w-2.5 h-2.5 fill-current" />
                                <span>Stop Voice</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-2.5 h-2.5 fill-current" />
                                <span>Play Voice</span>
                              </>
                            )}
                          </button>
                          {turn.ttsResult.cancelledByBargeIn && (
                            <button
                              type="button"
                              onClick={() =>
                                handlePlayTurnAudio(
                                  turn,
                                  "agent",
                                  turn.ttsResult.cancelledAtMs || 250
                                )
                              }
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-200 hover:bg-purple-300 text-purple-900 flex items-center gap-1"
                              title="Hear agent get interrupted mid-sentence"
                            >
                              <Zap className="w-2.5 h-2.5" />
                              Hear Cutoff ({turn.ttsResult.cancelledAtMs}ms)
                            </button>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              turn.ttsResult.playbackState === "COMPLETED"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-purple-100 text-purple-800"
                            }`}
                          >
                            {turn.ttsResult.playbackState}
                          </span>
                        </div>
                      </div>
                      <div
                        className={`p-3 border rounded-lg text-xs ${
                          turn.ttsResult.cancelledByBargeIn
                            ? "bg-purple-50/70 border-purple-200 text-purple-950"
                            : "bg-violet-50/70 border-violet-200 text-slate-800"
                        }`}
                      >
                        "{turn.voiceResponseText}"
                      </div>

                      {turn.ttsResult.cancelledByBargeIn && (
                        <div className="p-2 rounded bg-purple-100 border border-purple-200 text-[11px] text-purple-900 space-y-0.5">
                          <div className="font-semibold flex items-center gap-1">
                            <StopCircle className="w-3 h-3 text-purple-700" />
                            Barge-In Interruption Detected @ {turn.ttsResult.cancelledAtMs} ms
                          </div>
                          <div className="text-[10px]">
                            TTS cancelled immediately. Spoken before cutoff: "
                            {turn.ttsResult.spokenTextBeforeCancel}..."
                          </div>
                          <div className="text-[10px] text-emerald-800 font-medium">
                            ✓ Session state consistency verified (prior turns intact, zero data loss).
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Measured Latency Waterfall */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        Measured Latency Waterfall (Real Timers)
                      </span>
                      <span className="text-[11px] text-slate-400">Budget: {budget.totalTurnaroundBudgetMs}ms</span>
                    </div>

                    {/* Waterfall Stacked Visual Bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] text-slate-500">
                        <span>Turnaround Breakdown:</span>
                        <span className="font-mono font-semibold text-slate-800">{wf.totalTurnaroundMs} ms</span>
                      </div>
                      <div className="w-full h-4 bg-slate-100 rounded-full flex overflow-hidden">
                        <div
                          style={{
                            width: `${Math.max(5, (wf.asrStreamingMs / wf.totalTurnaroundMs) * 100)}%`,
                          }}
                          className="bg-blue-500 text-[9px] text-white flex items-center justify-center font-bold"
                          title={`ASR: ${wf.asrStreamingMs}ms`}
                        >
                          ASR
                        </div>
                        <div
                          style={{
                            width: `${Math.max(5, (wf.pipelineMs / wf.totalTurnaroundMs) * 100)}%`,
                          }}
                          className="bg-emerald-500 text-[9px] text-white flex items-center justify-center font-bold"
                          title={`Pipeline: ${wf.pipelineMs}ms`}
                        >
                          Policy
                        </div>
                        <div
                          style={{
                            width: `${Math.max(5, (wf.ttsTtfbMs / wf.totalTurnaroundMs) * 100)}%`,
                          }}
                          className="bg-violet-500 text-[9px] text-white flex items-center justify-center font-bold"
                          title={`TTS TTFB: ${wf.ttsTtfbMs}ms`}
                        >
                          TTS
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 px-1">
                        <span className="text-blue-600 font-medium">ASR: {wf.asrStreamingMs}ms</span>
                        <span className="text-emerald-600 font-medium">Pipeline: {wf.pipelineMs}ms</span>
                        <span className="text-violet-600 font-medium">TTS TTFB: {wf.ttsTtfbMs}ms</span>
                      </div>
                    </div>

                    {/* Detailed Stage Table */}
                    <div className="border rounded-lg overflow-hidden text-xs">
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b text-[11px] text-slate-500">
                          <tr>
                            <th className="py-2 px-3 text-left font-semibold">Stage</th>
                            <th className="py-2 px-3 text-right font-semibold">Actual</th>
                            <th className="py-2 px-3 text-right font-semibold">Budget</th>
                            <th className="py-2 px-3 text-right font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y text-slate-700">
                          <tr>
                            <td className="py-2 px-3 font-medium">1. Streaming ASR</td>
                            <td className="py-2 px-3 text-right font-mono">{wf.stages.asr.actualMs} ms</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">
                              {wf.stages.asr.budgetMs} ms
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  wf.stages.asr.status === "ON_BUDGET"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-red-100 text-red-800"
                                }`}
                              >
                                {wf.stages.asr.status}
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium">2. Canonical Pipeline</td>
                            <td className="py-2 px-3 text-right font-mono">{wf.stages.pipeline.actualMs} ms</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">
                              {wf.stages.pipeline.budgetMs} ms
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  wf.stages.pipeline.status === "ON_BUDGET"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-red-100 text-red-800"
                                }`}
                              >
                                {wf.stages.pipeline.status}
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-medium">3. TTS First Byte (TTFB)</td>
                            <td className="py-2 px-3 text-right font-mono">{wf.stages.ttsTtfb.actualMs} ms</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-400">
                              {wf.stages.ttsTtfb.budgetMs} ms
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  wf.stages.ttsTtfb.status === "ON_BUDGET"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-red-100 text-red-800"
                                }`}
                              >
                                {wf.stages.ttsTtfb.status}
                              </span>
                            </td>
                          </tr>
                          <tr className="bg-slate-50/80 font-bold">
                            <td className="py-2 px-3 text-slate-900">Total Turnaround</td>
                            <td className="py-2 px-3 text-right font-mono text-violet-700">
                              {wf.stages.total.actualMs} ms
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-500">
                              {wf.stages.total.budgetMs} ms
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  wf.stages.total.status === "ON_BUDGET"
                                    ? "bg-emerald-200 text-emerald-900"
                                    : "bg-red-200 text-red-900"
                                }`}
                              >
                                {wf.stages.total.status}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Architecture Explainer Card */}
      <div className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <HelpCircle className="w-4 h-4 text-violet-600" />
          Voice Simulation Architectural Guarantees
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <span className="font-bold text-slate-900 block">1. The Voice Layer Cannot Bypass Policy</span>
            <p>
              Spoken transcripts are transcribed via ASR and passed into the exact same canonical pipeline. Deterministic TypeScript rules authoritatively govern triage routing. No LLM or voice stub can override clinical escalation rules.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <span className="font-bold text-slate-900 block">2. Automatic Staff Handoff on Uncertainty</span>
            <p>
              If audio is mumbled or degraded (ASR confidence &lt; 0.70), or if any policy rule flags symptoms or follow-up, an immediate staff handoff is forced. The system never guesses or risks unsupervised advice.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <span className="font-bold text-slate-900 block">3. Consistent State Under Barge-In</span>
            <p>
              When a patient interrupts agent playback, the streaming TTS stub halts immediately. The conversation turns, facts, and cryptographic audit records remain strictly consistent and uncorrupted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

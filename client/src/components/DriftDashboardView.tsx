import React, { useState } from "react";
import {
  Sliders,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  TrendingUp,
  Layers,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { DriftReport } from "../../../server/drift/types";
import type { CanaryRunResult } from "../../../server/canary/types";
import type { WorkflowSpec } from "../../../shared/domain/types";

interface Props {
  currentSpec: WorkflowSpec;
  proposalId: string;
}

export function DriftDashboardView({ currentSpec, proposalId }: Props) {
  // Shift Sliders State
  const [newPhrasingRate, setNewPhrasingRate] = useState<number>(0.1);
  const [moreFreeTextRate, setMoreFreeTextRate] = useState<number>(0.1);
  const [higherUncertaintyRate, setHigherUncertaintyRate] = useState<number>(0.1);
  const [newInjectionRate, setNewInjectionRate] = useState<number>(0.0);
  const [sampleCount, setSampleCount] = useState<number>(60);
  const [trafficShare, setTrafficShare] = useState<number>(0.25);
  const [simulateBadCanary, setSimulateBadCanary] = useState<boolean>(false);

  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [canaryResult, setCanaryResult] = useState<CanaryRunResult | null>(null);

  // Mutations
  const evaluateDriftMutation = trpc.drift.evaluate.useMutation({
    onSuccess: (report) => {
      setDriftReport(report);
      if (report.overallAlertLevel === "DRIFT_ALERT") {
        toast.error(`DRIFT ALERT: Significant distribution shift detected! (TVD: ${report.metricDrifts.routeMix.statisticValue})`);
      } else if (report.overallAlertLevel === "WARNING") {
        toast.warning("Warning: Moderate distribution drift detected.");
      } else {
        toast.success("Traffic distribution is stable and consistent with baseline.");
      }
    },
    onError: (err) => {
      toast.error(`Drift evaluation error: ${err.message}`);
    },
  });

  const runCanaryMutation = trpc.drift.canary.useMutation({
    onSuccess: (result) => {
      setCanaryResult(result);
      if (result.breachDetected) {
        toast.error(`CANARY BREACH DETECTED: Automatic rollback triggered to spec v${result.rolledBackToSpecVersion}`);
      } else {
        toast.success(`Canary traffic evaluated safely (${result.canaryCount} canary cases, 0 breaches)`);
      }
    },
    onError: (err) => {
      toast.error(`Canary error: ${err.message}`);
    },
  });

  const handleEvaluateDrift = () => {
    evaluateDriftMutation.mutate({
      count: sampleCount,
      newPhrasingRate,
      moreFreeTextRate,
      higherUncertaintyRate,
      newInjectionRate,
    });
  };

  const handleRunCanary = () => {
    // If simulateBadCanary is checked, use deliberately unsafe rules routing distress to draft
    const candidate = simulateBadCanary
      ? {
          ...currentSpec,
          spec_version: `${currentSpec.spec_version}-unsafe-canary`,
          rule_list: [
            {
              id: "RULE_UNSAFE_CANARY_DISTRESS",
              description: "Dangerous rule routing acute symptoms to draft.",
              route: "DRAFT_FOR_REVIEW",
              reason_code: "UNSAFE_CANARY_DRAFT",
              condition: {
                phrase_match: { field: "note", phrases: ["chest pain", "emergency", "dizzy", "woozy"] },
              },
            },
            ...currentSpec.rule_list,
          ],
        }
      : currentSpec;

    runCanaryMutation.mutate({
      proposalId,
      candidateSpec: candidate,
      trafficShare,
      shiftAxes: {
        newPhrasingRate,
        moreFreeTextRate,
        higherUncertaintyRate,
        newInjectionRate,
      },
    });
  };

  const handleInjectHeavyShift = () => {
    setNewPhrasingRate(0.5);
    setMoreFreeTextRate(0.7);
    setHigherUncertaintyRate(0.65);
    setNewInjectionRate(0.2);
    toast.info("Applied heavy distribution shift preset");
  };

  const handleResetSliders = () => {
    setNewPhrasingRate(0.05);
    setMoreFreeTextRate(0.05);
    setHigherUncertaintyRate(0.05);
    setNewInjectionRate(0.0);
    toast.info("Reset to clean baseline distribution");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                DISTRIBUTION DRIFT & CANARY ENGINE
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Active Spec: v{currentSpec.spec_version}
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              Traffic Shift Injection & Automated Canary Rollback
            </h3>
            <p className="text-xs text-slate-400">
              Inject controlled shifts across phrasing, free text, uncertainty, and injection. Detect drift using Total Variation Distance and trigger automatic config rollback on canary breaches.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInjectHeavyShift}
              className="px-3 py-1.5 text-xs bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 rounded-lg transition-colors font-medium"
            >
              Preset: Heavy Shift
            </button>
            <button
              onClick={handleResetSliders}
              className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors font-medium flex items-center gap-1.5"
            >
              <RotateCcw size={12} />
              Reset Baseline
            </button>
          </div>
        </div>
      </div>

      {/* Control Sliders Panel */}
      <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <Sliders size={15} className="text-teal-600" />
          Controllable Shift Generator Parameters
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* Axis 1 */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Informal Phrasing:</span>
              <span className="font-mono text-teal-700">{Math.round(newPhrasingRate * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={newPhrasingRate}
              onChange={(e) => setNewPhrasingRate(parseFloat(e.target.value))}
              className="w-full accent-teal-600 cursor-pointer"
            />
            <span className="text-[11px] text-slate-500 block leading-tight">
              Colloquialisms, slang ("tummy's off", "feeling woozy")
            </span>
          </div>

          {/* Axis 2 */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Lengthy Free-Text:</span>
              <span className="font-mono text-teal-700">{Math.round(moreFreeTextRate * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={moreFreeTextRate}
              onChange={(e) => setMoreFreeTextRate(parseFloat(e.target.value))}
              className="w-full accent-teal-600 cursor-pointer"
            />
            <span className="text-[11px] text-slate-500 block leading-tight">
              200-480 character rambling notes & descriptions
            </span>
          </div>

          {/* Axis 3 */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>High Uncertainty:</span>
              <span className="font-mono text-teal-700">{Math.round(higherUncertaintyRate * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={higherUncertaintyRate}
              onChange={(e) => setHigherUncertaintyRate(parseFloat(e.target.value))}
              className="w-full accent-teal-600 cursor-pointer"
            />
            <span className="text-[11px] text-slate-500 block leading-tight">
              "Not sure how to answer", questions, ambiguous choices
            </span>
          </div>

          {/* Axis 4 */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Prompt Injections:</span>
              <span className="font-mono text-rose-700">{Math.round(newInjectionRate * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.02"
              value={newInjectionRate}
              onChange={(e) => setNewInjectionRate(parseFloat(e.target.value))}
              className="w-full accent-rose-600 cursor-pointer"
            />
            <span className="text-[11px] text-slate-500 block leading-tight">
              Novel instruction-like text & markdown delimiters
            </span>
          </div>
        </div>

        {/* Action Triggers */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600 font-medium">Batch Size:</span>
            <input
              type="number"
              value={sampleCount}
              onChange={(e) => setSampleCount(parseInt(e.target.value, 10) || 50)}
              className="w-16 px-2 py-1 text-xs border border-slate-300 rounded font-mono"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleEvaluateDrift}
              disabled={evaluateDriftMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {evaluateDriftMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
              Inject Shift & Evaluate Drift
            </button>
          </div>
        </div>
      </div>

      {/* Drift Report Output */}
      {driftReport && (
        <div className="space-y-4">
          {/* Status Alert Banner */}
          <div
            className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
              driftReport.overallAlertLevel === "DRIFT_ALERT"
                ? "bg-rose-50 border-rose-300 text-rose-950"
                : driftReport.overallAlertLevel === "WARNING"
                ? "bg-amber-50 border-amber-300 text-amber-950"
                : "bg-emerald-50 border-emerald-300 text-emerald-950"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {driftReport.overallAlertLevel === "DRIFT_ALERT" ? (
                <ShieldAlert size={20} className="text-rose-600 shrink-0 mt-0.5" />
              ) : driftReport.overallAlertLevel === "WARNING" ? (
                <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
              )}
              <div>
                <h4 className="text-sm font-bold">
                  {driftReport.overallAlertLevel === "DRIFT_ALERT"
                    ? "CRITICAL DRIFT ALERT: Statistical Shift Detected"
                    : driftReport.overallAlertLevel === "WARNING"
                    ? "DRIFT WARNING: Moderate Distribution Shift"
                    : "NORMAL: Distribution Consistent with Baseline"}
                </h4>
                <p className="text-xs mt-1 leading-relaxed opacity-90">{driftReport.summaryText}</p>
              </div>
            </div>
            <span className="text-[10px] uppercase font-mono font-bold px-2.5 py-1 rounded-full border border-current/20 bg-white/60">
              {driftReport.overallAlertLevel}
            </span>
          </div>

          {/* 5 Explainable Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
            {/* 1. Route Mix */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <span className="text-slate-500 text-[11px] font-semibold block">Route Mix (TVD):</span>
              <div className="text-base font-bold font-mono text-slate-800">
                {driftReport.metricDrifts.routeMix.statisticValue.toFixed(3)}
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                driftReport.metricDrifts.routeMix.alertLevel === "DRIFT_ALERT"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-700"
              }`}>
                {driftReport.metricDrifts.routeMix.alertLevel}
              </span>
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                {driftReport.metricDrifts.routeMix.explanation}
              </p>
            </div>

            {/* 2. Schema Failure Rate */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <span className="text-slate-500 text-[11px] font-semibold block">Schema Failure Rate:</span>
              <div className="text-base font-bold font-mono text-slate-800">
                {driftReport.metricDrifts.schemaFailureRate.currentValue}%
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                driftReport.metricDrifts.schemaFailureRate.alertLevel === "DRIFT_ALERT"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-700"
              }`}>
                Δ: {driftReport.metricDrifts.schemaFailureRate.delta > 0 ? "+" : ""}{driftReport.metricDrifts.schemaFailureRate.delta} pp
              </span>
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                {driftReport.metricDrifts.schemaFailureRate.explanation}
              </p>
            </div>

            {/* 3. Draft Edit Distance */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <span className="text-slate-500 text-[11px] font-semibold block">Draft Edit Distance:</span>
              <div className="text-base font-bold font-mono text-slate-800">
                {driftReport.metricDrifts.draftEditDistance.currentValue} chars
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                driftReport.metricDrifts.draftEditDistance.alertLevel === "DRIFT_ALERT"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-700"
              }`}>
                {driftReport.metricDrifts.draftEditDistance.statisticValue}x baseline
              </span>
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                {driftReport.metricDrifts.draftEditDistance.explanation}
              </p>
            </div>

            {/* 4. Reviewer Overrides */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <span className="text-slate-500 text-[11px] font-semibold block">Reviewer Override Rate:</span>
              <div className="text-base font-bold font-mono text-slate-800">
                {driftReport.metricDrifts.reviewerOverrideRate.currentValue}%
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                driftReport.metricDrifts.reviewerOverrideRate.alertLevel === "DRIFT_ALERT"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-700"
              }`}>
                Δ: {driftReport.metricDrifts.reviewerOverrideRate.delta > 0 ? "+" : ""}{driftReport.metricDrifts.reviewerOverrideRate.delta} pp
              </span>
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                {driftReport.metricDrifts.reviewerOverrideRate.explanation}
              </p>
            </div>

            {/* 5. p95 Latency */}
            <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs space-y-1">
              <span className="text-slate-500 text-[11px] font-semibold block">p95 Latency:</span>
              <div className="text-base font-bold font-mono text-slate-800">
                {driftReport.metricDrifts.p95Latency.currentValue}ms
              </div>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                {driftReport.metricDrifts.p95Latency.statisticValue}x
              </span>
              <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                {driftReport.metricDrifts.p95Latency.explanation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Canary Deployment & Automatic Rollback Section */}
      <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Layers size={16} className="text-indigo-600" />
              Canary Deployment & Automatic Config Rollback
            </h4>
            <p className="text-xs text-slate-500">
              Route a configurable traffic percentage to candidate spec. An under-escalation breach triggers immediate automatic rollback to previous active spec.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-600 font-medium">Canary Traffic Share:</span>
            <select
              value={trafficShare}
              onChange={(e) => setTrafficShare(parseFloat(e.target.value))}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-xs"
            >
              <option value="0.10">10% Canary</option>
              <option value="0.25">25% Canary</option>
              <option value="0.50">50% Canary</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded border border-rose-200 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateBadCanary}
                onChange={(e) => setSimulateBadCanary(e.target.checked)}
                className="accent-rose-600"
              />
              <span className="font-semibold">Simulate Defective Canary Spec</span>
            </label>

            <button
              onClick={handleRunCanary}
              disabled={runCanaryMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {runCanaryMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Run Canary Deployment
            </button>
          </div>
        </div>

        {/* Canary Execution Results Banner */}
        {canaryResult && (
          <div
            className={`p-4 rounded-xl border text-xs space-y-2 ${
              canaryResult.breachDetected
                ? "bg-rose-50 border-rose-300 text-rose-950"
                : "bg-emerald-50 border-emerald-300 text-emerald-950"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm">
                {canaryResult.breachDetected ? (
                  <ShieldAlert size={18} className="text-rose-600" />
                ) : (
                  <ShieldCheck size={18} className="text-emerald-600" />
                )}
                <span>
                  {canaryResult.breachDetected
                    ? "CANARY SAFETY BREACH: Automatic Config Rollback Executed!"
                    : "Canary Run Successful: 0 Safety Breaches Detected"}
                </span>
              </div>
              <span className="font-mono text-xs bg-white/70 px-2 py-0.5 rounded border border-current/20">
                Traffic: {canaryResult.canaryCount} canary / {canaryResult.activeCount} active
              </span>
            </div>

            {canaryResult.breachDetected && (
              <div className="p-3 bg-white/90 rounded-lg border border-rose-200 text-xs text-rose-900 space-y-1">
                <div className="font-semibold">Breach Reason:</div>
                <p className="font-mono text-[11px]">{canaryResult.breachReason}</p>
                <div className="pt-1 text-[11px] text-slate-600">
                  • Rolled back active specification to: <span className="font-bold text-slate-800">v{canaryResult.rolledBackToSpecVersion}</span>
                  <br />
                  • Audit Event ID: <span className="font-mono text-slate-800">{canaryResult.auditEventId}</span> (Hash-chained in SQLite)
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

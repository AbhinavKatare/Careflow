import React, { useState } from "react";
import {
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  Layers,
  Loader2,
  Clock,
  Diff,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { WorkflowSpec } from "../../../shared/domain/types";
import type {
  CaseReplayDiff,
  BulkReplayReport,
} from "../../../server/replay/types";

interface Props {
  currentSpec: WorkflowSpec;
}

export function ReplayView({ currentSpec }: Props) {
  const [activeMode, setActiveMode] = useState<"single" | "bulk">("single");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("DEMO-001");
  const [targetModelTier, setTargetModelTier] = useState<"small" | "strong">("small");
  const [replayDiff, setReplayDiff] = useState<CaseReplayDiff | null>(null);
  const [bulkReport, setBulkReport] = useState<BulkReplayReport | null>(null);

  // Queries: fetch review cases to pick from
  const { data: casesData } = trpc.cases.list.useQuery({});
  const availableCases = casesData || [];

  // Mutations
  const replayCaseMutation = trpc.replay.case.useMutation({
    onSuccess: (diff) => {
      setReplayDiff(diff);
      toast.success(`Deterministically replayed case ${diff.caseId}`);
    },
    onError: (err) => {
      toast.error(`Replay error: ${err.message}`);
    },
  });

  const bulkReplayMutation = trpc.replay.bulk.useMutation({
    onSuccess: (report) => {
      setBulkReport(report);
      if (report.severityLoweredCount > 0) {
        toast.error(`CRITICAL MISS WARNING: ${report.severityLoweredCount} severity-lowering route changes detected!`);
      } else {
        toast.success(`Bulk replay completed: ${report.totalCasesReplayed} cases evaluated under v2`);
      }
    },
    onError: (err) => {
      toast.error(`Bulk replay error: ${err.message}`);
    },
  });

  const handleReplaySingle = () => {
    replayCaseMutation.mutate({
      caseId: selectedCaseId,
      targetSpec: currentSpec,
      targetModelTier: targetModelTier,
    });
  };

  const handleRunBulk = () => {
    bulkReplayMutation.mutate({
      candidateSpec: currentSpec,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Mode Switcher */}
      <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                DETERMINISTIC REPLAY ENGINE
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Target Spec: v{currentSpec.spec_version}
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              Deterministic Case Replay & Bulk Policy Evaluation
            </h3>
            <p className="text-xs text-slate-400">
              Replay historical submissions with full extraction and policy traces, or compute "What would v2 have done to last week's cases".
            </p>
          </div>

          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg text-xs">
            <button
              onClick={() => setActiveMode("single")}
              className={`px-3 py-1.5 rounded font-medium transition-all ${
                activeMode === "single"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Single Case Replay
            </button>
            <button
              onClick={() => setActiveMode("bulk")}
              className={`px-3 py-1.5 rounded font-medium transition-all ${
                activeMode === "bulk"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Bulk "What would v2 do"
            </button>
          </div>
        </div>
      </div>

      {/* MODE 1: Single Case Replay */}
      {activeMode === "single" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-slate-600">Select Case:</span>
              {availableCases.length > 0 ? (
                <select
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-xs focus:ring-1 focus:ring-teal-500"
                >
                  {availableCases.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.patient_id} · {c.program || "Check-in"} ({c.route})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Case ID (e.g. DEMO-001)..."
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-xs"
                />
              )}

              <span className="font-semibold text-slate-600 ml-2">Model Tier:</span>
              <select
                value={targetModelTier}
                onChange={(e) => setTargetModelTier(e.target.value as "small" | "strong")}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs"
              >
                <option value="small">Small Tier (Fast · Advisory)</option>
                <option value="strong">Strong Tier (Complex · Advisory)</option>
              </select>
            </div>

            <button
              onClick={handleReplaySingle}
              disabled={replayCaseMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {replayCaseMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Replay Under Candidate Spec
            </button>
          </div>

          {/* Replay Diff Output */}
          {replayDiff && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Diff size={16} className="text-teal-600" />
                    Case Replay Step Diff: {replayDiff.caseId}
                  </h4>
                  <p className="text-xs text-slate-500 font-mono">
                    Baseline Hash: {replayDiff.baseline.specHash?.slice(0, 16)}... → Candidate: {replayDiff.candidate.specHash?.slice(0, 16)}...
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                    replayDiff.diff.routeChanged
                      ? replayDiff.diff.isSeverityLowering
                        ? "bg-rose-100 text-rose-800 border border-rose-300"
                        : "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-emerald-100 text-emerald-800"
                  }`}>
                    {replayDiff.diff.routeChanged
                      ? replayDiff.diff.isSeverityLowering
                        ? "CRITICAL: Severity Lowered"
                        : "Route Changed"
                      : "Route Unchanged (Identical)"}
                  </span>
                </div>
              </div>

              {/* Step 1: Decision & Route Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                    Baseline Route ({replayDiff.baseline.specVersion}):
                  </span>
                  <div className="text-sm font-bold font-mono text-slate-800">
                    {replayDiff.baseline.route}
                  </div>
                  <div className="text-xs text-slate-600 mt-1 font-mono">
                    Reason: {replayDiff.baseline.reasonCode}
                  </div>
                </div>

                <div className={`p-3 rounded-lg border text-xs ${
                  replayDiff.diff.routeChanged
                    ? "bg-teal-50/60 border-teal-200"
                    : "bg-slate-50 border-slate-200"
                }`}>
                  <span className="text-[11px] font-semibold text-teal-700 block mb-1">
                    Candidate Route ({replayDiff.candidate.specVersion}):
                  </span>
                  <div className="text-sm font-bold font-mono text-teal-900">
                    {replayDiff.candidate.route}
                  </div>
                  <div className="text-xs text-teal-800 mt-1 font-mono">
                    Reason: {replayDiff.candidate.reasonCode}
                  </div>
                </div>
              </div>

              {/* Step 2: Policy Rules Fired Diff */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                <span className="font-semibold text-slate-700 block mb-2">
                  Authoritative Policy Rules Fired:
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-slate-500 block mb-1">Baseline Rules:</span>
                    <div className="space-y-1">
                      {replayDiff.baseline.firedRules.map((r, i) => (
                        <div key={i} className="font-mono text-[11px] bg-white p-1 rounded border border-slate-200">
                          {r.id}: {r.description}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] text-teal-700 block mb-1">Candidate Rules:</span>
                    <div className="space-y-1">
                      {replayDiff.candidate.firedRules.map((r, i) => (
                        <div key={i} className="font-mono text-[11px] bg-teal-50 p-1 rounded border border-teal-200 text-teal-900">
                          {r.id}: {r.description}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3: Trace Waterfall Comparison */}
              <div className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs space-y-3">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Clock size={13} className="text-teal-400" />
                  Side-by-Side Measured Latency Waterfall Spans:
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
                  <div>
                    <span className="text-slate-400 text-[10px] block mb-1">Baseline Spans:</span>
                    {replayDiff.baseline.trace?.spans?.map((s, i) => (
                      <div key={i} className="flex justify-between py-0.5 border-b border-slate-800">
                        <span className="text-slate-300">{s.name}</span>
                        <span className="text-teal-400">{s.durationMs}ms</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <span className="text-teal-300 text-[10px] block mb-1">Candidate Replay Spans:</span>
                    {replayDiff.candidate.trace?.spans?.map((s, i) => (
                      <div key={i} className="flex justify-between py-0.5 border-b border-slate-800">
                        <span className="text-slate-300">{s.name}</span>
                        <span className="text-teal-400">{s.durationMs}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE 2: Bulk "What would v2 do" Report */}
      {activeMode === "bulk" && (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-800">
                Replay Last Week's Submissions Under Candidate Specification
              </h4>
              <p className="text-xs text-slate-500">
                Replays all historical cases through candidate spec v{currentSpec.spec_version} to identify any route shifts, disagreements, or severity drops.
              </p>
            </div>
            <button
              onClick={handleRunBulk}
              disabled={bulkReplayMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {bulkReplayMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />}
              Run Bulk Replay Report
            </button>
          </div>

          {bulkReport && (
            <div className="space-y-4">
              {/* Critical Safety Gate Alert for Severity Lowering */}
              {bulkReport.severityLoweredCount > 0 ? (
                <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-rose-950 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm text-rose-800">
                    <ShieldAlert size={18} />
                    CRITICAL SAFETY WARNING: Severity Lowered on {bulkReport.severityLoweredCount} Case(s)!
                  </div>
                  <p className="text-xs text-rose-800 leading-relaxed">
                    The candidate specification would have prepared an automated routine draft for cases that previously escalated to human clinical review. This constitutes an under-escalation safety risk.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 flex items-center gap-2 text-xs font-semibold">
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                  Zero severity-lowering changes detected across all {bulkReport.totalCasesReplayed} historical cases.
                </div>
              )}

              {/* Metrics Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">Total Cases Replayed:</span>
                  <span className="text-base font-bold text-slate-800">{bulkReport.totalCasesReplayed}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">Route Unchanged Rate:</span>
                  <span className="text-base font-bold text-teal-700">
                    {((bulkReport.unchangedCount / Math.max(1, bulkReport.totalCasesReplayed)) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">Route Changed Cases:</span>
                  <span className="text-base font-bold text-indigo-700">
                    {bulkReport.escalatedCount + bulkReport.severityLoweredCount}
                  </span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">Severity-Lowering:</span>
                  <span className={`text-base font-bold ${bulkReport.severityLoweredCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {bulkReport.severityLoweredCount}
                  </span>
                </div>
              </div>

              {/* Route Transition Breakdown Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Route Transitions ({bulkReport.routeChanges.length} changes)
                </div>
                <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                  {bulkReport.routeChanges.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      All cases produced identical routes under candidate specification.
                    </div>
                  ) : (
                    bulkReport.routeChanges.map((ch, idx) => (
                      <div
                        key={idx}
                        className={`p-3 text-xs flex items-center justify-between ${
                          ch.isSeverityLowering ? "bg-rose-50/50" : "hover:bg-slate-50"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-800">{ch.caseId}</span>
                            <span className="text-slate-400 font-mono">({ch.patientName})</span>
                            {ch.isSeverityLowering && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-800 text-[10px] font-bold">
                                Severity Lowered
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                            Reason: {ch.candidateReason}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 font-mono text-xs">
                          <span className="text-slate-500">{ch.baselineRoute}</span>
                          <ArrowRight size={13} className="text-slate-400" />
                          <span className="font-bold text-teal-700">{ch.candidateRoute}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

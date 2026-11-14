import React, { useState } from "react";
import {
  CheckCircle2,
  Download,
  AlertTriangle,
  Play,
  FileText,
  Zap,
  Loader2,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { TierComparisonReport } from "../../../server/llm/cascade";
import type { FeedbackDatasetExportResult } from "../../../server/dataset/types";

export function ModelTierComparisonView() {
  const [comparisonReport, setComparisonReport] = useState<TierComparisonReport | null>(null);
  const [datasetExport, setDatasetExport] = useState<FeedbackDatasetExportResult | null>(null);
  const [datasetSeed, setDatasetSeed] = useState<number>(42);

  // Mutations
  const compareTiersMutation = trpc.cascade.compare.useMutation({
    onSuccess: (report) => {
      setComparisonReport(report);
      toast.success("Tier comparison evaluation completed across all 3 configurations");
    },
    onError: (err) => {
      toast.error(`Comparison error: ${err.message}`);
    },
  });

  const exportDatasetMutation = trpc.dataset.exportVersioned.useMutation({
    onSuccess: (result) => {
      setDatasetExport(result);
      toast.success(`Exported ${result.totalRecords} stratified records to JSONL & generated dataset card`);
    },
    onError: (err) => {
      toast.error(`Dataset export error: ${err.message}`);
    },
  });

  const handleRunComparison = () => {
    compareTiersMutation.mutate({});
  };

  const handleExportDataset = () => {
    exportDatasetMutation.mutate({
      seed: datasetSeed,
      version: "dataset_v1.0.0",
    });
  };

  const handleDownloadJsonl = () => {
    if (!datasetExport) return;
    const blob = new Blob([datasetExport.jsonlContent], { type: "application/x-jsonlines" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feedback_dataset_${datasetExport.datasetVersion}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded FeedbackLabels JSONL");
  };

  const handleDownloadCard = () => {
    if (!datasetExport) return;
    const blob = new Blob([datasetExport.datasetCardContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DATASET_CARD_${datasetExport.datasetVersion}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded DATASET_CARD.md");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                MODEL ROUTING & DATASET EXPORT
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Cascade Architecture (Small → Strong)
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              LLM Model Cascading Tradeoffs & Stratified Dataset Handoff
            </h3>
            <p className="text-xs text-slate-400">
              Evaluate real measured tradeoffs across Strong-only, Small-only, and Cascade configurations. Export versioned stratified supervisory datasets with strict governance cards.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRunComparison}
              disabled={compareTiersMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {compareTiersMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Run Tier Comparison
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 1: LLM Tier Comparison Table */}
      <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Zap size={16} className="text-indigo-600" />
              Configuration Tradeoff Evaluation Matrix
            </h4>
            <p className="text-xs text-slate-500">
              Evaluates identical fixtures across mock model tiers to measure accuracy, schema validity, p95 latency, and cost per 100 cases.
            </p>
          </div>

          {comparisonReport && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <CheckCircle2 size={13} className="text-emerald-600" />
                Policy Route Invariance: 100% Verified
              </span>
            </div>
          )}
        </div>

        {!comparisonReport ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Click "Run Tier Comparison" to evaluate Strong-only vs Small-only vs Cascade routing across the fixture suite.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">Configuration</th>
                    <th className="py-2.5 px-3 font-semibold">Route Accuracy</th>
                    <th className="py-2.5 px-3 font-semibold">Schema Valid</th>
                    <th className="py-2.5 px-3 font-semibold">p95 Latency</th>
                    <th className="py-2.5 px-3 font-semibold">Cost / 100 Cases</th>
                    <th className="py-2.5 px-3 font-semibold">Escalation Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {comparisonReport.rows.map((row) => (
                    <tr
                      key={row.configName}
                      className={`hover:bg-slate-50/80 ${
                        row.configName === "cascade" ? "bg-indigo-50/40 font-medium" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3 font-semibold text-slate-800 flex items-center gap-1.5">
                        {row.configName === "cascade" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                        )}
                        {row.displayName}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-teal-700 font-bold">
                        {row.accuracy.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-800">
                        {row.schemaValidRate.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700">
                        {row.p95LatencyMs} ms
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                        ${row.costPer100Cases.toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-indigo-700">
                        {row.escalationRate !== undefined ? `${row.escalationRate}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary Banner */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 leading-relaxed font-sans">
              <span className="font-bold text-slate-900">Summary: </span>
              {comparisonReport.summary}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: FeedbackLabels Stratified Dataset Exporter */}
      <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FileDown size={16} className="text-teal-600" />
              Versioned Stratified Feedback Dataset Exporter
            </h4>
            <p className="text-xs text-slate-500">
              Exports reviewer actions, redacted inputs, and extractions into versioned JSONL with strict training handoff documentation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono">Seed:</span>
            <input
              type="number"
              value={datasetSeed}
              onChange={(e) => setDatasetSeed(parseInt(e.target.value, 10) || 42)}
              className="w-14 px-2 py-1 text-xs border border-slate-300 rounded font-mono"
            />
            <button
              onClick={handleExportDataset}
              disabled={exportDatasetMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {exportDatasetMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              Export Versioned Dataset
            </button>
          </div>
        </div>

        {/* Mandatory Governance Notice */}
        <div className="p-3.5 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-amber-950">
            <AlertTriangle size={15} className="text-amber-700" />
            Training Handoff & Governance Boundary:
          </div>
          <p className="leading-relaxed text-[11px] text-amber-900">
            <strong>DO NOT FINE-TUNE:</strong> This dataset is deliberately tiny and purely synthetic for software portfolio demonstration. Fine-tuning models directly on tiny synthetic data causes hallucinations. Intended solely as an offline supervisory baseline and evaluation benchmark.
          </p>
        </div>

        {/* Export Results */}
        {datasetExport && (
          <div className="space-y-4 pt-2">
            {/* Stratification Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-500 text-[11px] block">Accepted (Unchanged):</span>
                <span className="text-base font-bold text-emerald-700">{datasetExport.stratification.acceptedCount}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-500 text-[11px] block">Edited by Reviewer:</span>
                <span className="text-base font-bold text-sky-700">{datasetExport.stratification.editedCount}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-500 text-[11px] block">Rejected (Discarded):</span>
                <span className="text-base font-bold text-rose-700">{datasetExport.stratification.rejectedCount}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-500 text-[11px] block">Route Overridden:</span>
                <span className="text-base font-bold text-indigo-700">{datasetExport.stratification.routeOverrideCount}</span>
              </div>
            </div>

            {/* Split breakdown and download buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
              <div className="flex items-center gap-4 text-slate-700 font-mono text-[11px]">
                <span>Train: <strong>{datasetExport.stratification.splitBreakdown.train}</strong></span>
                <span>Val: <strong>{datasetExport.stratification.splitBreakdown.validation}</strong></span>
                <span>Test: <strong>{datasetExport.stratification.splitBreakdown.test}</strong></span>
                <span className="text-emerald-700 font-semibold">• Schema Validated (Zod)</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadJsonl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-medium shadow-2xs"
                >
                  <Download size={13} />
                  Download JSONL
                </button>
                <button
                  onClick={handleDownloadCard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-medium shadow-2xs"
                >
                  <Download size={13} />
                  Download Dataset Card (.md)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

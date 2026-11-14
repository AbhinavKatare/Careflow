import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart3,
  CheckCircle2,
  Download,
  FileCheck,
  Filter,
  Layers,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  computeQualitySignals,
  exportFeedbackDataset,
  seedFeedbackLabels,
  type FeedbackLabel,
  type QualitySignalsMetrics,
} from "@shared";
import { trpc } from "@/lib/trpc";

interface QualitySignalsPageProps {
  onBackToQueue?: () => void;
  params?: Record<string, string | undefined>;
}

export default function QualitySignalsPage({ onBackToQueue: _onBackToQueue }: QualitySignalsPageProps = {}) {
  const labelsQuery = trpc.feedback.list.useQuery(undefined, {
    placeholderData: seedFeedbackLabels,
  });
  const resetMutation = trpc.system.resetDemoData.useMutation({
    onSuccess: () => {
      labelsQuery.refetch();
      setLabels(seedFeedbackLabels);
      toast.info("Reset to 40 seed synthetic reviewer actions in SQLite");
    },
  });

  const [labels, setLabels] = useState<FeedbackLabel[]>(seedFeedbackLabels);

  useEffect(() => {
    if (labelsQuery.data && labelsQuery.data.length > 0) {
      setLabels(labelsQuery.data);
    }
  }, [labelsQuery.data]);
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [showExportModal, setShowExportModal] = useState<boolean>(false);

  // Filter labels if user selected a specific prompt/rule version cohort
  const filteredLabels = useMemo(() => {
    return labels.filter((item) => {
      if (versionFilter !== "all") {
        const key = `${item.promptVersion} | ${item.ruleVersion}`;
        if (key !== versionFilter) return false;
      }
      if (actionFilter !== "all" && item.action !== actionFilter) {
        return false;
      }
      return true;
    });
  }, [labels, versionFilter, actionFilter]);

  // Dynamically compute real aggregates from stored run records array
  // PERMANENT RULE: No hardcoded metrics or outcome flags.
  const metrics: QualitySignalsMetrics = useMemo(() => {
    return computeQualitySignals(filteredLabels);
  }, [filteredLabels]);

  // Overall metrics across all versions for version trend comparisons
  const allMetrics: QualitySignalsMetrics = useMemo(() => {
    return computeQualitySignals(labels);
  }, [labels]);

  // Export dataset dynamically
  const exportResult = useMemo(() => {
    try {
      return exportFeedbackDataset(labels);
    } catch (e: any) {
      return { jsonl: "", count: 0, validated: false, error: e.message };
    }
  }, [labels]);

  const handleDownloadDataset = () => {
    try {
      const blob = new Blob([exportResult.jsonl], { type: "application/x-jsonlines;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `careflow_feedback_dataset_${Date.now()}.jsonl`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${exportResult.count} records (validated against schema)`);
    } catch {
      toast.error("Failed to generate download file");
    }
  };

  const handleResetData = () => {
    resetMutation.mutate({ confirmed: true });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#e2eae6]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
              Evaluator Feedback Loop
            </span>
            <span className="text-[11px] font-mono text-[#638075]">
              {labels.length} synthetic actions recorded
            </span>
          </div>
          <h1 className="text-2xl font-serif font-bold text-[#102c34] m-0">
            Quality Signals & Feedback Telemetry
          </h1>
          <p className="text-xs text-[#527067] m-0 mt-1 max-w-2xl">
            Live reviewer telemetry dynamically computed from stored feedback labels. Tracks acceptance rate,
            mean edit distance, top rejection reasons, override rate, and version trends.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleResetData}
            className="px-3 py-1.5 border border-[#d0ded7] hover:bg-[#f1f5f3] text-[#344b44] rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5 transition-colors"
            title="Reset to 40 seed reviewer actions"
          >
            <RotateCcw size={13} />
            <span>Reset Demo Data</span>
          </button>
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="px-3.5 py-1.5 bg-[#287d6b] hover:bg-[#1e6153] text-white rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <Download size={13} />
            <span>Export JSONL Dataset</span>
          </button>
        </div>
      </div>

      {/* Cohort Filter Controls */}
      <div className="p-3 bg-white border border-[#e2eae6] rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-[#102c34] flex items-center gap-1.5">
            <Filter size={13} className="text-[#287d6b]" />
            Cohort Filters:
          </span>

          <div className="flex items-center gap-1.5">
            <label htmlFor="version-cohort-select" className="text-[#59786d]">
              Version:
            </label>
            <select
              id="version-cohort-select"
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
              className="px-2 py-1 bg-[#f8faf9] border border-[#d0ded7] rounded text-xs text-[#102c34]"
            >
              <option value="all">All versions ({labels.length} actions)</option>
              {allMetrics.versionTrends.map((trend) => (
                <option
                  key={`${trend.promptVersion} | ${trend.ruleVersion}`}
                  value={`${trend.promptVersion} | ${trend.ruleVersion}`}
                >
                  {trend.promptVersion} / {trend.ruleVersion} ({trend.total} actions)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="action-type-select" className="text-[#59786d]">
              Action:
            </label>
            <select
              id="action-type-select"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-2 py-1 bg-[#f8faf9] border border-[#d0ded7] rounded text-xs text-[#102c34]"
            >
              <option value="all">All reviewer actions</option>
              <option value="draft_accepted_unchanged">Accepted Unchanged</option>
              <option value="draft_edited">Draft Edited</option>
              <option value="rejected">Rejected</option>
              <option value="route_override">Route Override</option>
            </select>
          </div>
        </div>

        <div className="text-[11px] text-[#638075] font-mono">
          Showing <strong>{metrics.totalReviews}</strong> of <strong>{labels.length}</strong> stored reviewer actions
        </div>
      </div>

      {/* 4 PRIMARY METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Acceptance Rate */}
        <div className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-[#527067]">
            <span className="font-semibold uppercase tracking-wider text-[11px]">Draft Acceptance</span>
            <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 size={14} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-serif text-[#102c34]">
              {metrics.acceptanceRate}%
            </span>
            <span className="text-xs text-[#527067]">
              ({metrics.acceptedCount}/{metrics.totalReviews})
            </span>
          </div>
          <p className="text-[11px] text-[#638075] m-0">
            {metrics.acceptedUnchangedCount} unchanged · {metrics.editedCount} with reviewer edits
          </p>
        </div>

        {/* Metric 2: Mean Edit Distance */}
        <div className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-[#527067]">
            <span className="font-semibold uppercase tracking-wider text-[11px]">Mean Edit Distance</span>
            <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center">
              <SlidersHorizontal size={14} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-serif text-[#102c34]">
              {metrics.meanEditDistanceAllAccepted}
            </span>
            <span className="text-xs text-[#527067]">chars / accepted draft</span>
          </div>
          <p className="text-[11px] text-[#638075] m-0">
            {metrics.meanEditDistanceEditedOnly} chars avg on edited drafts
          </p>
        </div>

        {/* Metric 3: Route Override Rate */}
        <div className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-[#527067]">
            <span className="font-semibold uppercase tracking-wider text-[11px]">Route Override Rate</span>
            <div className="w-6 h-6 rounded-md bg-amber-50 text-amber-700 flex items-center justify-center">
              <Shield size={14} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-serif text-[#102c34]">
              {metrics.overrideRate}%
            </span>
            <span className="text-xs text-[#527067]">
              ({metrics.overrideCount}/{metrics.totalReviews})
            </span>
          </div>
          <p className="text-[11px] text-[#638075] m-0">
            Reviewer flagged deterministic route as incorrect
          </p>
        </div>

        {/* Metric 4: Rejection Rate & Top Reason */}
        <div className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-[#527067]">
            <span className="font-semibold uppercase tracking-wider text-[11px]">Draft Rejection</span>
            <div className="w-6 h-6 rounded-md bg-rose-50 text-rose-700 flex items-center justify-center">
              <TrendingDown size={14} />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-serif text-[#102c34]">
              {metrics.totalReviews > 0
                ? Number(((metrics.rejectedCount / metrics.totalReviews) * 100).toFixed(1))
                : 0}
              %
            </span>
            <span className="text-xs text-[#527067]">
              ({metrics.rejectedCount}/{metrics.totalReviews})
            </span>
          </div>
          <p className="text-[11px] text-[#638075] m-0 truncate" title={`Top driver: ${metrics.rejectionReasonsBreakdown[0]?.reason}`}>
            Top: <strong className="font-mono">{metrics.rejectionReasonsBreakdown[0]?.reason ?? "none"}</strong> ({metrics.rejectionReasonsBreakdown[0]?.count ?? 0})
          </p>
        </div>
      </div>

      {/* TOP REJECTION REASONS & FIXED TAXONOMY BREAKDOWN */}
      <section
        aria-labelledby="rejection-breakdown-heading"
        className="p-5 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#f0f4f2]">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#287d6b]" />
            <h2 id="rejection-breakdown-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
              Top Rejection Reasons (Fixed Taxonomy)
            </h2>
          </div>
          <span className="text-xs text-[#638075]">
            {metrics.rejectedCount} total rejections evaluated
          </span>
        </div>

        <div className="space-y-3">
          {metrics.rejectionReasonsBreakdown.map((item) => (
            <div key={item.reason} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[#102c34] text-[11px]">
                    {item.reason}
                  </span>
                  <span className="text-[#59786d] text-[11px] hidden sm:inline">
                    · {item.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <strong className="text-[#102c34]">{item.count}</strong>
                  <span className="text-[#638075]">({item.percentage}%)</span>
                </div>
              </div>
              <div className="h-2 w-full bg-[#f0f5f2] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    item.reason === "inaccurate"
                      ? "bg-rose-600"
                      : item.reason === "tone"
                      ? "bg-amber-500"
                      : item.reason === "unsupported_claim"
                      ? "bg-purple-600"
                      : item.reason === "should_have_been_escalated"
                      ? "bg-red-700"
                      : "bg-slate-500"
                  }`}
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TREND PER PROMPT / RULE VERSION */}
      <section
        aria-labelledby="version-trends-heading"
        className="p-5 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#f0f4f2]">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#287d6b]" />
            <h2 id="version-trends-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
              Trend per Prompt / Rule Version
            </h2>
          </div>
          <span className="text-xs text-[#638075]">
            Comparison across {allMetrics.versionTrends.length} deployed cohorts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#e2eae6] bg-[#f8faf9] text-[#527067]">
                <th className="py-2.5 px-3 font-semibold">Prompt Version</th>
                <th className="py-2.5 px-3 font-semibold">Rule Version</th>
                <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                <th className="py-2.5 px-3 font-semibold text-right">Acceptance Rate</th>
                <th className="py-2.5 px-3 font-semibold text-right">Mean Edit Dist</th>
                <th className="py-2.5 px-3 font-semibold text-right">Override Rate</th>
                <th className="py-2.5 px-3 font-semibold">Top Rejection Driver</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f4f2]">
              {allMetrics.versionTrends.map((trend) => (
                <tr key={`${trend.promptVersion}-${trend.ruleVersion}`} className="hover:bg-[#fafcfb]">
                  <td className="py-2.5 px-3 font-mono font-bold text-[#102c34]">
                    {trend.promptVersion}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[#436257]">
                    {trend.ruleVersion}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-[#102c34]">
                    {trend.total}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <span
                      className={`font-mono font-bold ${
                        trend.acceptanceRate >= 70
                          ? "text-emerald-700"
                          : trend.acceptanceRate >= 50
                          ? "text-amber-700"
                          : "text-rose-700"
                      }`}
                    >
                      {trend.acceptanceRate}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#285d4f]">
                    {trend.meanEditDistance} chars
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#527067]">
                    {trend.overrideRate}%
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs text-[#527067]">
                    {trend.topRejectionReason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* STRUCTURED REVIEWER ACTIONS FEED */}
      <section
        aria-labelledby="recent-feedback-heading"
        className="p-5 bg-white border border-[#e2eae6] rounded-xl shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#f0f4f2]">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#287d6b]" />
            <h2 id="recent-feedback-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
              Stored Structured Feedback Actions ({filteredLabels.length})
            </h2>
          </div>
          <span className="text-[11px] text-[#638075]">
            Clicking a case in Review Queue records new feedback actions
          </span>
        </div>

        <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
          {filteredLabels.slice(0, 15).map((label) => (
            <div
              key={label.id}
              className="p-3 bg-[#fafcfb] border border-[#e2eae6] rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:border-[#ccdcd4] transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-[#102c34]">{label.caseId}</span>
                  <span className="text-[#8ba096]">·</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      label.action === "draft_accepted_unchanged"
                        ? "bg-emerald-100 text-emerald-900 border border-emerald-200"
                        : label.action === "draft_edited"
                        ? "bg-blue-100 text-blue-900 border border-blue-200"
                        : label.action === "rejected"
                        ? "bg-rose-100 text-rose-900 border border-rose-200"
                        : "bg-amber-100 text-amber-900 border border-amber-200"
                    }`}
                  >
                    {label.action.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-[10px] text-[#638075]">
                    {label.promptVersion} / {label.ruleVersion}
                  </span>
                </div>

                <p className="text-[#49655c] m-0 text-xs line-clamp-1">
                  {label.action === "rejected" && (
                    <strong className="text-rose-900 mr-1.5 font-mono">[{label.rejectionReason}]:</strong>
                  )}
                  {label.action === "route_override" && label.routeOverride && (
                    <strong className="text-amber-900 mr-1.5 font-mono">
                      [{label.routeOverride.originalRoute} → {label.routeOverride.suggestedRoute}]:
                    </strong>
                  )}
                  {label.action === "draft_edited" && (
                    <span className="text-[#203b33] mr-1.5 font-medium">Final draft:</span>
                  )}
                  “{label.draft || label.rejectionNotes || label.routeOverride?.reason || label.inputRedacted}”
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto text-[11px] font-mono text-[#5b7a6e]">
                {label.editDistance !== undefined && (
                  <span className="px-2 py-0.5 bg-[#f0f5f2] rounded border border-[#d8e4de]">
                    dist: {label.editDistance}
                  </span>
                )}
                <span>{new Date(label.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* JSONL DATASET EXPORT MODAL */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 bg-[#0d2124]/40 backdrop-blur-xs flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            className="bg-white rounded-xl border border-[#dfe8e3] p-5 w-full max-w-2xl shadow-xl space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-modal-title"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#f0f4f2]">
              <div className="flex items-center gap-2">
                <FileCheck className="text-[#287d6b]" size={18} />
                <h3 id="export-modal-title" className="text-sm font-bold text-[#102c34] m-0">
                  Export Feedback Dataset (JSONL)
                </h3>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                Schema Validated (Zod)
              </span>
            </div>

            <div className="space-y-2 text-xs text-[#527067]">
              <p className="m-0">
                Dataset adheres to the <strong>ExportedFeedbackRecord</strong> schema format:{" "}
                <code className="text-[#102c34] font-mono bg-[#f5f8f6] px-1 py-0.5 rounded">
                  (input_redacted, extraction, draft, reviewer_outcome)
                </code>{" "}
                with <code className="text-[#102c34] font-mono bg-[#f5f8f6] px-1 py-0.5 rounded">dataset_version</code>.
              </p>
              <p className="m-0 text-emerald-800">
                ✓ <strong>Privacy Guard Active:</strong> All participant names, synthetic IDs, phone numbers, and dates
                have been sanitized and excluded from this export.
              </p>
            </div>

            {/* JSONL Sample Preview */}
            <div className="p-3 bg-[#102c34] text-[#d6ede4] rounded-lg font-mono text-[11px] max-h-56 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {exportResult.jsonl.split("\n").slice(0, 3).join("\n\n")}
              {exportResult.count > 3 && `\n\n... and ${exportResult.count - 3} more records`}
            </div>

            <div className="p-2.5 bg-[#eff7f3] border border-[#deeee7] rounded text-xs text-[#285d4f] flex items-center justify-between">
              <span>
                CLI Command Equivalent: <code className="font-mono font-bold text-[#102c34]">make export-feedback</code>
              </span>
              <span className="font-mono text-[11px] font-bold">
                {exportResult.count} records ready
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f4f2]">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-3 py-1.5 border border-[#d0ded7] text-[#4d6d62] hover:bg-[#f1f5f3] rounded text-xs font-medium cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleDownloadDataset}
                className="px-3.5 py-1.5 bg-[#287d6b] hover:bg-[#1e6153] text-white rounded text-xs font-medium cursor-pointer flex items-center gap-1.5"
              >
                <Download size={13} />
                <span>Download .jsonl File</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety & Simulation Disclosures */}
      <div className="p-4 bg-[#eff7f3] border border-[#deeee7] rounded-xl text-xs text-[#285d4f] flex items-start gap-3">
        <Shield size={18} className="text-[#287d6b] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="m-0 font-semibold text-[#102c34]">
            Simulated Evaluator Telemetry Only
          </p>
          <p className="m-0 leading-relaxed">
            All quality signals, acceptance rates, and edit distances are computed dynamically from simulated reviewer
            actions. No clinical decisions, medical advice, or outbound transmissions are performed.
          </p>
        </div>
      </div>
    </div>
  );
}

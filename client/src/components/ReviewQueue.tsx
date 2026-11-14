import React, { useState, useEffect } from "react";
import {
  Search, ArrowDownUp, Shield, Plus, ChevronRight,
  Sparkles, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import {
  REJECTION_REASON_TAXONOMY,
  REJECTION_REASON_LABELS,
  type DemoCase,
  type RejectionReasonCode,
} from "@shared";
import { trpc } from "@/lib/trpc";

interface ReviewQueueProps {
  cases: DemoCase[];
  onOpenCase: (id: string) => void;
  onUpdateCase: (updated: DemoCase) => void;
  onNewCheckIn?: () => void;
}

function timeAgo(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export default function ReviewQueue({
  cases,
  onOpenCase,
  onUpdateCase,
  onNewCheckIn,
}: ReviewQueueProps) {
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "latency_asc" | "latency_desc">("newest");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [triageAction, setTriageAction] = useState<{ type: "approve" | "reject"; caseItem: DemoCase } | null>(null);
  const [triageRejectReason, setTriageRejectReason] = useState<string>("");
  const [triageRejectCode, setTriageRejectCode] = useState<RejectionReasonCode>("tone");

  const filterTabs = [
    { label: "All", key: "All" },
    { label: "Needs Review", key: "needs_review" },
    { label: "Draft Ready", key: "draft_ready" },
    { label: "Approved", key: "approved" },
    { label: "Rejected", key: "rejected" },
    { label: "Failed", key: "failed" },
  ];

  const utils = trpc.useUtils();

  // Real API Query for review cases
  const casesQuery = trpc.cases.list.useQuery(
    {
      status: activeFilter === "All" ? undefined : activeFilter,
      query: searchQuery || undefined,
      sort: sortOption,
    },
    {
      placeholderData: cases,
    }
  );

  const visibleCases = casesQuery.data ?? cases;

  // Real API Mutations
  const approveMutation = trpc.cases.approve.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdateCase(updated);
      utils.cases.list.invalidate();
      utils.feedback.signals.invalidate();
      utils.feedback.list.invalidate();
      utils.audit.verify.invalidate();
      toast.success(`Case ${updated?.id} approved · simulated, nothing sent`);
    },
    onError: (err) => {
      toast.error(`Approve failed: ${err.message}`);
    },
  });

  const rejectMutation = trpc.cases.reject.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdateCase(updated);
      utils.cases.list.invalidate();
      utils.feedback.signals.invalidate();
      utils.feedback.list.invalidate();
      utils.audit.verify.invalidate();
      toast.success(`Case ${updated?.id} rejected (${updated?.reasonCode || "other"}) · simulated, nothing sent`);
    },
    onError: (err) => {
      toast.error(`Reject failed: ${err.message}`);
    },
  });

  // Clamp selection index within bounds
  useEffect(() => {
    if (selectedIndex >= visibleCases.length && visibleCases.length > 0) {
      setSelectedIndex(visibleCases.length - 1);
    }
  }, [visibleCases.length, selectedIndex]);

  // Keyboard navigation & triage shortcuts: j, k, a, r, Enter, o, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not trigger shortcuts when user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      if (visibleCases.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, visibleCases.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" || e.key === "o") {
        e.preventDefault();
        const selected = visibleCases[selectedIndex];
        if (selected) {
          onOpenCase(selected.id);
        }
      } else if (e.key === "a") {
        e.preventDefault();
        const selected = visibleCases[selectedIndex];
        if (selected && selected.status !== "approved") {
          setTriageAction({ type: "approve", caseItem: selected });
        }
      } else if (e.key === "r") {
        e.preventDefault();
        const selected = visibleCases[selectedIndex];
        if (selected && selected.status !== "rejected") {
          setTriageAction({ type: "reject", caseItem: selected });
          setTriageRejectCode("tone");
        }
      } else if (e.key === "Escape") {
        if (triageAction) {
          e.preventDefault();
          setTriageAction(null);
          setTriageRejectReason("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleCases, selectedIndex, onOpenCase, triageAction]);

  // Commit inline triage action via real API
  const handleCommitTriageAction = () => {
    if (!triageAction) return;

    if (triageAction.type === "approve") {
      approveMutation.mutate({ id: triageAction.caseItem.id });
    } else if (triageAction.type === "reject") {
      rejectMutation.mutate({
        id: triageAction.caseItem.id,
        reason: triageRejectReason || `Rejected via keyboard triage: ${REJECTION_REASON_LABELS[triageRejectCode]}`,
        reasonCode: triageRejectCode,
      });
    }

    setTriageAction(null);
    setTriageRejectReason("");
  };

  return (
    <div className="space-y-4">
      {/* Header with Title & Action */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-[#628b7c] tracking-widest uppercase block mb-1">
            STAFF WORKSPACE
          </span>
          <h1 className="text-2xl font-serif font-bold text-[#102c34] m-0">
            Review Queue
          </h1>
          <p className="text-xs text-[#638075] m-0 mt-0.5">
            Triage, inspect source evidence, and take simulated actions on participant updates.
          </p>
        </div>
        {onNewCheckIn && (
          <button
            type="button"
            onClick={onNewCheckIn}
            className="px-3.5 py-2 bg-[#287d6b] hover:bg-[#1e6153] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <Plus size={15} />
            <span>New check-in</span>
          </button>
        )}
      </div>

      {/* Keyboard Shortcuts Helper Bar */}
      <div className="p-2.5 bg-[#f0f6f3] border border-[#dce8e1] rounded-lg text-[11px] text-[#2c5346] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          <Sparkles size={14} className="text-[#287d6b]" />
          <span>Keyboard triage shortcuts:</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px]">
          <span><kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">J</kbd> / <kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">K</kbd> Navigate</span>
          <span><kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">Enter</kbd> / <kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">O</kbd> Open detail</span>
          <span><kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">A</kbd> Approve</span>
          <span><kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">R</kbd> Reject</span>
          <span><kbd className="px-1.5 py-0.5 bg-white border border-[#c8d8d0] rounded text-[#102c34]">Esc</kbd> Cancel</span>
        </div>
      </div>

      {/* Surface Card with Toolbar & List */}
      <div className="bg-white border border-[#e2eae6] rounded-xl shadow-xs overflow-hidden">
        {/* Toolbar: Filter Tabs & Search & Sort */}
        <div className="p-4 border-b border-[#eef2f0] flex items-center justify-between flex-wrap gap-3">
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0" role="tablist">
            {filterTabs.map((tab) => {
              const isSelected = activeFilter === tab.key;
              const count = tab.key === "All"
                ? cases.length
                : tab.key === "failed"
                ? cases.filter((c) => c.status === "processing_failed" || c.route === "INPUT_ERROR").length
                : cases.filter((c) => c.status === tab.key).length;

              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setActiveFilter(tab.key);
                    setSelectedIndex(0);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? "bg-[#edf6f2] text-[#287d6b] shadow-2xs"
                      : "text-[#658177] hover:text-[#102c34] hover:bg-[#f8faf9]"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isSelected ? "bg-[#287d6b] text-white" : "bg-[#eef2f0] text-[#6b857b]"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Field & Sort Dropdown */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search size={14} className="absolute left-2.5 top-2.5 text-[#8ca298]" />
              <label htmlFor="queue-search" className="sr-only">Search review cases</label>
              <input
                id="queue-search"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Search patient, ID, note, rule..."
                className="w-full pl-8 pr-3 py-1.5 bg-[#f8faf9] border border-[#d2ded8] rounded-lg text-xs text-[#102c34] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
              />
            </div>

            <div className="flex items-center gap-1 text-xs">
              <ArrowDownUp size={14} className="text-[#8ca298] shrink-0" />
              <label htmlFor="queue-sort" className="sr-only">Sort review cases</label>
              <select
                id="queue-sort"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as any)}
                className="bg-[#f8faf9] border border-[#d2ded8] rounded-lg px-2.5 py-1.5 text-xs text-[#102c34] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b] cursor-pointer"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="latency_asc">Fastest latency</option>
                <option value="latency_desc">Slowest latency</option>
              </select>
            </div>
          </div>
        </div>

        {/* Column Header */}
        <div className="grid grid-cols-12 gap-3 px-5 py-2.5 bg-[#fbfcfb] border-b border-[#eef2f0] text-[10px] font-bold text-[#869e94] uppercase tracking-wider">
          <div className="col-span-3">Participant</div>
          <div className="col-span-4">Routing Reason & Code</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Latency</div>
          <div className="col-span-2 text-right">Received</div>
        </div>

        {/* Case List Rows */}
        <div className="divide-y divide-[#f0f4f2]" role="list">
          {visibleCases.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#718d82] space-y-2">
              <AlertCircle size={24} className="mx-auto text-[#9bb0a6]" />
              <p className="font-semibold text-sm text-[#3b594f] m-0">No matching review cases</p>
              <p className="m-0">Try clearing your search query or selecting a different status filter.</p>
            </div>
          ) : (
            visibleCases.map((item, index) => {
              const isSelected = selectedIndex === index;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedIndex(index);
                    onOpenCase(item.id);
                  }}
                  className={`grid grid-cols-12 gap-3 px-5 py-3.5 items-center cursor-pointer transition-colors text-xs ${
                    isSelected
                      ? "bg-[#f2f8f4] ring-2 ring-inset ring-[#287d6b]"
                      : "hover:bg-[#fafcfb] bg-white"
                  }`}
                  role="listitem"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpenCase(item.id);
                  }}
                >
                  {/* Participant Column */}
                  <div className="col-span-3 min-w-0">
                    <strong className="block font-semibold text-[#102c34] truncate">
                      {item.patientName}
                    </strong>
                    <span className="text-[11px] text-[#718e83] font-mono block truncate">
                      {item.patientId} · {item.program}
                    </span>
                  </div>

                  {/* Routing Reason & Code Column */}
                  <div className="col-span-4 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#f0f5f2] text-[#2c5b4d] border border-[#dbe6e0] truncate">
                        {item.reasonCode || item.scenarioTag}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#557368] m-0 truncate" title={item.reason}>
                      {item.reason}
                    </p>
                  </div>

                  {/* Status Chip Column */}
                  <div className="col-span-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold uppercase tracking-wider ${
                        item.status === "needs_review"
                          ? "bg-amber-100 text-amber-900 border border-amber-200"
                          : item.status === "draft_ready"
                          ? "bg-emerald-100 text-emerald-900 border border-emerald-200"
                          : item.status === "approved"
                          ? "bg-blue-100 text-blue-900 border border-blue-200"
                          : item.status === "rejected"
                          ? "bg-rose-100 text-rose-900 border border-rose-200"
                          : "bg-red-100 text-red-900 border border-red-200"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      <span>{item.status.replace("_", " ")}</span>
                    </span>
                  </div>

                  {/* Latency Column */}
                  <div className="col-span-1 text-right font-mono text-[11px] text-[#4d6d61]">
                    {item.latencyMs.toFixed(1)} ms
                  </div>

                  {/* Received & Action Column */}
                  <div className="col-span-2 text-right flex items-center justify-end gap-2">
                    <span className="text-[11px] text-[#6d8a7f]">{timeAgo(item.submittedAt)}</span>
                    <ChevronRight size={15} className="text-[#9cb1a7]" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#fafcfb] border-t border-[#eef2f0] flex items-center justify-between text-[11px] text-[#718d82]">
          <span>
            Showing <strong>{visibleCases.length}</strong> of {cases.length} synthetic cases
          </span>
          <span className="flex items-center gap-1.5">
            <Shield size={12} className="text-[#287d6b]" />
            <span>Simulation data · zero external outbound effects</span>
          </span>
        </div>
      </div>

      {/* Inline Keyboard Triage Confirmation Dialog */}
      {triageAction && (
        <div
          className="fixed inset-0 z-50 bg-[#0d2124]/40 backdrop-blur-xs flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            className="bg-white rounded-xl border border-[#dfe8e3] p-5 w-full max-w-sm shadow-xl space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="triage-dialog-title"
          >
            <div>
              <h4 id="triage-dialog-title" className="text-sm font-bold text-[#102c34] m-0">
                {triageAction.type === "approve"
                  ? `Approve Case ${triageAction.caseItem.id} (Simulated)`
                  : `Reject Case ${triageAction.caseItem.id} (Simulated)`}
              </h4>
              <p className="text-xs text-[#5a786c] m-0 mt-1">
                Participant: {triageAction.caseItem.patientName} ({triageAction.caseItem.patientId})
              </p>
            </div>

            <div className="p-3 bg-[#eff7f3] border border-[#deeee7] rounded text-xs text-[#285d4f]">
              <strong>Simulated, nothing sent.</strong> No real message, SMS, email, or EHR update will occur.
            </div>

            {triageAction.type === "reject" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="triage-reject-code" className="block text-xs font-semibold text-[#102c34]">
                    Taxonomy Reason Code:
                  </label>
                  <select
                    id="triage-reject-code"
                    value={triageRejectCode}
                    onChange={(e) => setTriageRejectCode(e.target.value as RejectionReasonCode)}
                    className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded p-2 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                  >
                    {REJECTION_REASON_TAXONOMY.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason} — {REJECTION_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="triage-reject-reason" className="block text-xs font-semibold text-[#102c34]">
                    Reviewer Notes:
                  </label>
                  <textarea
                    id="triage-reject-reason"
                    value={triageRejectReason}
                    onChange={(e) => setTriageRejectReason(e.target.value)}
                    rows={2}
                    placeholder="Specify reason for rejecting this case..."
                    className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded p-2 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f4f2]">
              <button
                type="button"
                onClick={() => {
                  setTriageAction(null);
                  setTriageRejectReason("");
                }}
                className="px-3 py-1.5 border border-[#d0ded7] text-[#4d6d62] hover:bg-[#f1f5f3] rounded text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitTriageAction}
                className={`px-3 py-1.5 rounded text-xs font-medium text-white cursor-pointer ${
                  triageAction.type === "reject"
                    ? "bg-rose-800 hover:bg-rose-900"
                    : "bg-[#287d6b] hover:bg-[#1e6153]"
                }`}
              >
                {triageAction.type === "approve" ? "Confirm Approval" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

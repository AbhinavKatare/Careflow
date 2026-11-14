import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft, Check, CheckCheck, Shield, ShieldAlert,
  Bot, Eye, GitCompare, Edit3, RotateCcw, AlertTriangle, Layers, Clock
} from "lucide-react";
import { toast } from "sonner";
import {
  computeDraftDiff,
  computeLevenshteinDistance,
  REJECTION_REASON_TAXONOMY,
  REJECTION_REASON_LABELS,
  type DemoCase,
  type DiffSegment,
  type RejectionReasonCode,
  type RouteDecision,
} from "@shared";
import { trpc } from "@/lib/trpc";

interface CaseDetailDrawerProps {
  item: DemoCase;
  onClose: () => void;
  onUpdate: (next: DemoCase) => void;
}

function timeAgo(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function formatTime(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export default function CaseDetailDrawer({ item, onClose, onUpdate }: CaseDetailDrawerProps) {
  const [activeFactId, setActiveFactId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState(item.draft ?? "");
  const [diffViewMode, setDiffViewMode] = useState<"edit" | "diff">("edit");
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "return" | "override" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectCategory, setRejectCategory] = useState<RejectionReasonCode>("tone");
  const [overrideSuggestedRoute, setOverrideSuggestedRoute] = useState<RouteDecision>(
    item.route === "DRAFT_FOR_REVIEW" ? "HUMAN_REVIEW_REQUIRED" : "DRAFT_FOR_REVIEW"
  );
  const [overrideReason, setOverrideReason] = useState("");
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);

  // Synchronize state when item changes
  useEffect(() => {
    setDraftText(item.draft ?? "");
    setDiffViewMode("edit");
    setConfirmAction(null);
    setRejectReason("");
    setRejectCategory("tone");
    setOverrideSuggestedRoute(
      item.route === "DRAFT_FOR_REVIEW" ? "HUMAN_REVIEW_REQUIRED" : "DRAFT_FOR_REVIEW"
    );
    setOverrideReason("");
    setActiveFactId(null);
    setSaveSuccessNotice(null);
  }, [item.id, item.draft, item.route]);

  // Compute diff between original AI draft and current draft
  const diffSegments: DiffSegment[] = useMemo(() => {
    const original = item.originalDraft ?? item.draft ?? "";
    return computeDraftDiff(original, draftText);
  }, [item.originalDraft, item.draft, draftText]);

  const currentEditDistance = useMemo(() => {
    const original = item.originalDraft ?? item.draft ?? "";
    return computeLevenshteinDistance(original, draftText);
  }, [item.originalDraft, item.draft, draftText]);

  const activeFact = useMemo(() => {
    return item.extractedFacts?.find((f) => f.id === activeFactId);
  }, [item.extractedFacts, activeFactId]);

  // Render original note text with span highlighting when a fact is clicked
  const renderHighlightedNote = () => {
    const note = item.note || "";
    if (!note) {
      return <em className="text-[#899c94] text-xs">(No participant free text submitted)</em>;
    }

    if (!activeFact?.sourceSpan) {
      return <p className="text-xs text-[#344b44] m-0 whitespace-pre-wrap leading-relaxed">“{note}”</p>;
    }

    const { start, end } = activeFact.sourceSpan;
    if (start < 0 || end > note.length || start >= end) {
      return <p className="text-xs text-[#344b44] m-0 whitespace-pre-wrap leading-relaxed">“{note}”</p>;
    }

    const before = note.slice(0, start);
    const highlighted = note.slice(start, end);
    const after = note.slice(end);

    return (
      <p className="text-xs text-[#344b44] m-0 whitespace-pre-wrap leading-relaxed">
        “{before}
        <mark
          className="bg-amber-200 text-amber-950 font-semibold px-1 py-0.5 rounded shadow-xs border border-amber-300"
          title={`Source for extracted fact: ${activeFact.category}`}
        >
          {highlighted}
        </mark>
        {after}”
      </p>
    );
  };

  const utils = trpc.useUtils();

  const editDraftMutation = trpc.cases.editDraft.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdate(updated);
      utils.cases.list.invalidate();
      utils.cases.get.invalidate({ id: item.id });
      setSaveSuccessNotice("Draft updated in SQLite. Simulated, nothing sent.");
      toast.success("Draft saved · simulated, nothing sent");
      setTimeout(() => setSaveSuccessNotice(null), 3000);
    },
    onError: (err) => {
      toast.error(`Failed to save draft: ${err.message}`);
    },
  });

  const approveMutation = trpc.cases.approve.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdate(updated);
      utils.cases.list.invalidate();
      utils.cases.get.invalidate({ id: item.id });
      utils.feedback.signals.invalidate();
      utils.feedback.list.invalidate();
      utils.audit.verify.invalidate();
      const orig = item.originalDraft ?? item.draft ?? "";
      const dist = computeLevenshteinDistance(orig, draftText);
      if (dist > 0) {
        toast.success(`Approved with edits (edit distance: ${dist} chars) · simulated, nothing sent`);
      } else {
        toast.success("Approved unchanged (edit distance: 0) · simulated, nothing sent");
      }
    },
    onError: (err) => {
      toast.error(`Approve failed: ${err.message}`);
    },
  });

  const rejectMutation = trpc.cases.reject.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdate(updated);
      utils.cases.list.invalidate();
      utils.cases.get.invalidate({ id: item.id });
      utils.feedback.signals.invalidate();
      utils.feedback.list.invalidate();
      utils.audit.verify.invalidate();
      toast.success(`Rejected (${rejectCategory}) · simulated, nothing sent`);
    },
    onError: (err) => {
      toast.error(`Reject failed: ${err.message}`);
    },
  });

  const overrideRouteMutation = trpc.cases.overrideRoute.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdate(updated);
      utils.cases.list.invalidate();
      utils.cases.get.invalidate({ id: item.id });
      utils.feedback.signals.invalidate();
      utils.feedback.list.invalidate();
      utils.audit.verify.invalidate();
      toast.success(`Route overridden to ${overrideSuggestedRoute} · simulated, nothing sent`);
    },
    onError: (err) => {
      toast.error(`Route override failed: ${err.message}`);
    },
  });

  const returnToQueueMutation = trpc.cases.returnToQueue.useMutation({
    onSuccess: (updated) => {
      if (updated) onUpdate(updated);
      utils.cases.list.invalidate();
      utils.cases.get.invalidate({ id: item.id });
      utils.audit.verify.invalidate();
      toast.success("Returned to staff review queue · simulated, nothing sent");
    },
    onError: (err) => {
      toast.error(`Return to queue failed: ${err.message}`);
    },
  });

  // Keyboard triage inside case drawer: a, r, Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      if (e.key === "a") {
        e.preventDefault();
        if (item.status !== "approved") {
          setConfirmAction("approve");
        }
      } else if (e.key === "r") {
        e.preventDefault();
        if (item.status !== "rejected") {
          setConfirmAction("reject");
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (confirmAction) {
          setConfirmAction(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmAction, item.status, onClose]);

  // Save edited draft via real API
  const handleSaveDraft = () => {
    editDraftMutation.mutate({ id: item.id, draft: draftText });
  };

  // Revert draft edits back to original AI draft
  const handleResetDraft = () => {
    const original = item.originalDraft ?? "";
    setDraftText(original);
    toast.info("Reverted to original AI draft");
  };

  // Commit decision on confirmation via real API
  const handleCommitDecision = () => {
    if (confirmAction === "approve") {
      approveMutation.mutate({ id: item.id });
    } else if (confirmAction === "reject") {
      rejectMutation.mutate({
        id: item.id,
        reason: rejectReason || `Rejected: ${REJECTION_REASON_LABELS[rejectCategory]}`,
        reasonCode: rejectCategory,
      });
    } else if (confirmAction === "override") {
      overrideRouteMutation.mutate({
        id: item.id,
        suggestedRoute: overrideSuggestedRoute,
        reason: overrideReason || "Route overridden by reviewer.",
      });
    } else if (confirmAction === "return") {
      returnToQueueMutation.mutate({ id: item.id });
    }
    setConfirmAction(null);
    setRejectReason("");
    setOverrideReason("");
  };

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        className="case-drawer bg-white shadow-2xl flex flex-col w-full max-w-2xl h-full border-l border-[#e2eae6]"
        role="dialog"
        aria-modal="true"
        aria-label={`Case details for ${item.patientName}`}
      >
        {/* Drawer Header */}
        <div className="h-14 px-5 border-b border-[#e9efeb] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="p-1.5 rounded-md hover:bg-[#f0f5f2] text-[#4d6d62] border border-[#dce8e2] transition-colors cursor-pointer"
              onClick={onClose}
              aria-label="Return to queue"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <span className="font-mono font-bold text-xs text-[#102c34]">{item.id}</span>
              <span className="text-[#8ca198] text-xs mx-1.5">·</span>
              <span className="text-xs text-[#638176]">Submitted {timeAgo(item.submittedAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${
                item.status === "needs_review"
                  ? "bg-amber-100 text-amber-900 border border-amber-200"
                  : item.status === "draft_ready"
                  ? "bg-emerald-100 text-emerald-900 border border-emerald-200"
                  : item.status === "approved"
                  ? "bg-blue-100 text-blue-900 border border-blue-200"
                  : "bg-rose-100 text-rose-900 border border-rose-200"
              }`}
            >
              {item.status.replace("_", " ")}
            </span>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#fafcfb]">
          {/* Patient Overview Lockup */}
          <div className="p-4 bg-white border border-[#e2eae6] rounded-xl flex items-center justify-between">
            <div>
              <h2 className="text-base font-serif font-bold text-[#102c34] m-0">
                {item.patientName}
              </h2>
              <p className="text-xs text-[#527067] m-0 mt-0.5">
                Synthetic ID: <strong className="font-mono">{item.patientId}</strong> · Program: {item.program}
              </p>
            </div>
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-1 bg-[#eff7f3] text-[#287d6b] rounded border border-[#deeee7]">
              Simulation Case
            </span>
          </div>

          {/* 4 CLEARLY SEPARATED PANELS */}
          <div className="space-y-4">
            {/* PANEL 1: Original Submission */}
            <section
              aria-labelledby="panel-original-heading"
              className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs"
            >
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#f0f4f2]">
                <Layers className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
                <h3 id="panel-original-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
                  Panel 1: Original Submission
                </h3>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-[#f5f8f6]">
                  <span className="text-[#648076]">Weekly Routine Status:</span>
                  <span className="font-semibold text-[#102c34]">{item.weekStatus}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#f5f8f6]">
                  <span className="text-[#648076]">Follow-up Requested:</span>
                  <span className="font-semibold text-[#102c34]">
                    {item.followUp === "yes" ? "Yes, please follow up" : "No follow-up needed"}
                  </span>
                </div>

                <div className="pt-2">
                  <span className="block text-[#648076] font-semibold mb-1">
                    Participant Free-Text Note:
                  </span>
                  <div className="p-3 bg-[#f8faf9] border border-[#e5ece8] rounded-md min-h-[50px]">
                    {renderHighlightedNote()}
                  </div>
                  {activeFact && (
                    <div className="flex items-center justify-between text-[11px] text-amber-800 bg-amber-50 px-2.5 py-1 rounded mt-1.5 border border-amber-200">
                      <span>Highlighted span for: <strong>{activeFact.category}</strong></span>
                      <button
                        type="button"
                        onClick={() => setActiveFactId(null)}
                        className="underline text-amber-900 text-[10px] cursor-pointer"
                      >
                        Clear highlight
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* PANEL 2: What the Model Saw (Redacted) */}
            <section
              aria-labelledby="panel-redacted-heading"
              className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs"
            >
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#f0f4f2]">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
                  <h3 id="panel-redacted-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
                    Panel 2: What the Model Saw
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[#5a7b6f] bg-[#eff7f3] px-2 py-0.5 rounded">
                  Redacted Preview
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <p className="text-[11px] text-[#638075] m-0">
                  Patient identifiers (names, dates, emails, phones) were stripped and replaced with deterministic tokens before prompt construction.
                </p>

                <div className="p-3 bg-[#f4f7f5] border border-[#d8e5df] rounded-md font-mono text-[11px] text-[#1e3b33] whitespace-pre-wrap">
                  {item.redactedPreview || "(No free text submitted; no text was sent to model)"}
                </div>

                {item.containsInstructionLikeText && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-center gap-2 text-red-900 text-xs font-medium">
                    <ShieldAlert size={16} className="text-red-700 shrink-0" />
                    <span>Instruction-like text detected. Preserved as untrusted content without obeying it.</span>
                  </div>
                )}
              </div>
            </section>

            {/* PANEL 3: Extracted Facts */}
            <section
              aria-labelledby="panel-facts-heading"
              className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs"
            >
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#f0f4f2]">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
                  <h3 id="panel-facts-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
                    Panel 3: Extracted Facts
                  </h3>
                </div>
                <span className="text-[10px] text-[#5e7c71] italic">
                  Click a fact to locate source span in Panel 1
                </span>
              </div>

              <div className="space-y-2">
                {(!item.extractedFacts || item.extractedFacts.length === 0) ? (
                  <p className="text-xs text-[#708980] italic m-0">No extracted facts available.</p>
                ) : (
                  item.extractedFacts.map((fact) => {
                    const isSelected = activeFactId === fact.id;
                    const hasSpan = !!fact.sourceSpan;
                    return (
                      <button
                        key={fact.id}
                        type="button"
                        onClick={() => hasSpan && setActiveFactId(isSelected ? null : fact.id)}
                        disabled={!hasSpan}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all text-xs flex items-center justify-between ${
                          isSelected
                            ? "bg-amber-50 border-amber-400 ring-2 ring-amber-300"
                            : hasSpan
                            ? "bg-[#f8faf9] border-[#e2eae6] hover:border-[#b8cfc5] hover:bg-white cursor-pointer"
                            : "bg-[#f8faf9] border-[#e2eae6] opacity-80 cursor-default"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#102c34]">{fact.category}:</span>
                            <span className="text-[#324f46] font-medium">{fact.value}</span>
                          </div>
                          {fact.sourceSpan && (
                            <span className="text-[10px] text-[#69887e] font-mono mt-0.5 block">
                              Source offset: [{fact.sourceSpan.start}..{fact.sourceSpan.end}]
                            </span>
                          )}
                        </div>
                        {hasSpan && (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                            isSelected ? "bg-amber-200 text-amber-900" : "bg-[#e5eee9] text-[#4d7265]"
                          }`}>
                            {isSelected ? "Highlighted" : "Click to highlight"}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {/* PANEL 4: Policy Result */}
            <section
              aria-labelledby="panel-policy-heading"
              className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs"
            >
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#f0f4f2]">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
                  <h3 id="panel-policy-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
                    Panel 4: Policy Result
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[#5d7d71]">
                  {item.ruleVersion} · {item.workflowVersion}
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 bg-[#f5f8f6] border border-[#e0eae4] rounded-lg">
                  <div>
                    <span className="text-[11px] text-[#5e7c71] block">Final Deterministic Route</span>
                    <strong className="text-sm text-[#102c34] font-bold">{item.route}</strong>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-bold ${
                      item.route === "DRAFT_FOR_REVIEW"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {item.reasonCode || item.route}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-[#5e7c71] font-semibold block mb-1">
                    Rules Fired:
                  </span>
                  <div className="space-y-1.5">
                    {(!item.firedRules || item.firedRules.length === 0) ? (
                      <div className="p-2 bg-[#f8faf9] border border-[#e5ece8] rounded text-xs text-[#527067]">
                        {item.reason}
                      </div>
                    ) : (
                      item.firedRules.map((rule) => (
                        <div
                          key={rule.id}
                          className="p-2.5 bg-[#f8faf9] border border-[#e5ece8] rounded-md text-xs flex items-start gap-2"
                        >
                          <CheckCheck size={14} className="text-[#287d6b] mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <strong className="font-mono text-[#102c34] text-[11px]">{rule.id}</strong>
                              <span className="font-mono text-[10px] text-[#5a7b6f]">{rule.reason_code}</span>
                            </div>
                            <p className="text-[#49655c] m-0 mt-0.5 text-[11px]">{rule.description}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* EDITABLE DRAFT AREA WITH DIFF VIEW */}
          <section
            aria-labelledby="draft-editor-heading"
            className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs"
          >
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#f0f4f2]">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
                <h3 id="draft-editor-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
                  Candidate Draft & Reviewer Edits
                </h3>
              </div>
              <div className="flex items-center gap-1.5 bg-[#f0f5f2] p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDiffViewMode("edit")}
                  className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                    diffViewMode === "edit"
                      ? "bg-white text-[#102c34] shadow-xs"
                      : "text-[#5e7c71] hover:text-[#102c34]"
                  }`}
                >
                  Edit draft
                </button>
                <button
                  type="button"
                  onClick={() => setDiffViewMode("diff")}
                  className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                    diffViewMode === "diff"
                      ? "bg-white text-[#102c34] shadow-xs"
                      : "text-[#5e7c71] hover:text-[#102c34]"
                  }`}
                >
                  <GitCompare size={12} />
                  <span>Diff view</span>
                </button>
              </div>
            </div>

            {diffViewMode === "edit" ? (
              <div className="space-y-3">
                <label htmlFor="draft-textarea" className="sr-only">
                  Edit candidate draft text
                </label>
                <textarea
                  id="draft-textarea"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={4}
                  placeholder="Enter or revise the candidate follow-up message..."
                  className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded-md p-3 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                />

                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#648277] text-[11px]">
                    {draftText.length} characters · Draft is unsent until reviewer action
                  </span>
                  <div className="flex items-center gap-2">
                    {item.originalDraft && draftText !== item.originalDraft && (
                      <button
                        type="button"
                        onClick={handleResetDraft}
                        className="px-2.5 py-1 border border-[#d2ded8] text-[#517066] hover:bg-[#f1f5f3] rounded text-xs inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw size={12} />
                        <span>Revert to original</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      className="px-3 py-1.5 bg-[#102c34] hover:bg-[#1b434e] text-white rounded text-xs font-medium cursor-pointer"
                    >
                      Save edits
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* DIFF VIEW */
              <div className="space-y-3">
                <div className="p-3 bg-[#f8faf9] border border-[#e2eae6] rounded-md text-xs leading-relaxed">
                  <span className="text-[10px] uppercase font-bold text-[#628075] block mb-2">
                    Diff vs Original AI Draft:
                  </span>
                  <p className="m-0 whitespace-pre-wrap">
                    {diffSegments.map((seg, idx) => {
                      if (seg.type === "added") {
                        return (
                          <span
                            key={idx}
                            className="bg-emerald-100 text-emerald-900 font-semibold px-1 py-0.5 rounded border border-emerald-300"
                            title="Added in review"
                          >
                            {seg.text}
                          </span>
                        );
                      }
                      if (seg.type === "removed") {
                        return (
                          <span
                            key={idx}
                            className="bg-rose-100 text-rose-900 line-through px-1 py-0.5 rounded border border-rose-300 mr-0.5"
                            title="Removed in review"
                          >
                            {seg.text}
                          </span>
                        );
                      }
                      return <span key={idx}>{seg.text}</span>;
                    })}
                  </p>
                </div>
                <p className="text-[11px] text-[#638075] m-0">
                  Additions are shown in green; deletions are shown with strike-through.
                </p>
              </div>
            )}

            {saveSuccessNotice && (
              <p className="text-xs text-emerald-800 font-medium mt-2 mb-0">
                ✓ {saveSuccessNotice}
              </p>
            )}
          </section>

          {/* AUDIT TIMELINE */}
          <section
            aria-labelledby="audit-timeline-heading"
            className="p-4 bg-white border border-[#e2eae6] rounded-xl shadow-xs"
          >
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#f0f4f2]">
              <Clock className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
              <h3 id="audit-timeline-heading" className="text-xs font-bold uppercase tracking-wider text-[#102c34] m-0">
                Audit Timeline (Append-Only)
              </h3>
            </div>

            <div className="space-y-3">
              {item.audit.map((evt) => (
                <div key={evt.id} className="relative pl-5 pb-3 border-l-2 border-[#dbe6e0] last:pb-0">
                  <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-[#287d6b] border-2 border-white" />
                  <div className="flex items-baseline justify-between text-xs">
                    <strong className="text-[#102c34]">{evt.action}</strong>
                    <time className="text-[10px] text-[#718d82]">{formatTime(evt.at)}</time>
                  </div>
                  <p className="text-xs text-[#4b675e] m-0 mt-0.5">{evt.detail}</p>
                  <span className="text-[10px] text-[#869f95] block mt-0.5">Actor: {evt.actor}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Simulation Disclosures */}
          <div className="p-3 bg-[#eff7f3] border border-[#deeee7] rounded-lg text-xs text-[#285d4f] flex items-start gap-2.5">
            <Shield size={16} className="text-[#287d6b] shrink-0 mt-0.5" />
            <p className="m-0">
              <strong>Simulated state only:</strong> Actions taken here update local demo state only. Zero outbound emails, SMS, or EHR messages are ever dispatched.
            </p>
          </div>
        </div>

        {/* Action Bar Footer */}
        <div className="p-4 bg-white border-t border-[#e2eae6] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmAction("return")}
              className="px-3 py-2 border border-[#d0ded7] hover:bg-[#f1f5f3] text-[#344b44] rounded-lg text-xs font-medium cursor-pointer"
            >
              Return to queue
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction("override")}
              className="px-3 py-2 border border-[#d0ded7] hover:bg-[#f1f5f3] text-[#344b44] rounded-lg text-xs font-medium cursor-pointer"
              title="Flag or override policy routing decision"
            >
              Override route
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmAction("reject")}
              disabled={item.status === "rejected"}
              className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Reject with reason
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction("approve")}
              disabled={item.status === "approved"}
              className="px-4 py-2 bg-[#287d6b] hover:bg-[#1e6153] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check size={14} />
              <span>
                Approve (Simulated){currentEditDistance > 0 ? ` · edited (dist ${currentEditDistance})` : ""}
              </span>
            </button>
          </div>
        </div>

        {/* CONFIRMATION DIALOG MODAL */}
        {confirmAction && (
          <div
            className="fixed inset-0 z-50 bg-[#0d2124]/40 backdrop-blur-xs flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              className="bg-white rounded-xl border border-[#dfe8e3] p-5 w-full max-w-sm shadow-xl space-y-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
            >
              <div className="flex items-center gap-2 text-[#102c34]">
                <AlertTriangle size={18} className="text-[#287d6b]" />
                <h4 id="confirm-dialog-title" className="text-sm font-bold m-0">
                  {confirmAction === "approve"
                    ? "Confirm Simulated Approval"
                    : confirmAction === "reject"
                    ? "Confirm Simulated Rejection"
                    : confirmAction === "override"
                    ? "Confirm Route Policy Override"
                    : "Return Case to Review"}
                </h4>
              </div>

              <div className="p-3 bg-[#eff7f3] border border-[#deeee7] rounded text-xs text-[#285d4f]">
                <strong>Simulated, nothing sent.</strong> No real external emails, SMS messages, or EHR updates will occur.
              </div>

              {confirmAction === "approve" && (
                <div className="p-2.5 bg-[#f8faf9] border border-[#e2eae6] rounded text-xs space-y-1">
                  <span className="text-[#5b786d] block font-medium">Outcome feedback classification:</span>
                  <div className="flex items-center justify-between font-mono text-[11px] font-bold text-[#102c34]">
                    <span>{currentEditDistance > 0 ? "draft_edited" : "draft_accepted_unchanged"}</span>
                    <span>Edit distance: {currentEditDistance} chars</span>
                  </div>
                </div>
              )}

              {confirmAction === "reject" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="reject-category-select" className="block text-xs font-semibold text-[#102c34]">
                      Taxonomy Reason Code:
                    </label>
                    <select
                      id="reject-category-select"
                      value={rejectCategory}
                      onChange={(e) => setRejectCategory(e.target.value as RejectionReasonCode)}
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
                    <label htmlFor="reject-reason-input" className="block text-xs font-semibold text-[#102c34]">
                      Reviewer Feedback Notes:
                    </label>
                    <textarea
                      id="reject-reason-input"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={2}
                      placeholder="Add specific observations regarding why this draft was rejected..."
                      className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded p-2 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                    />
                  </div>
                </div>
              )}

              {confirmAction === "override" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="override-route-select" className="block text-xs font-semibold text-[#102c34]">
                      Suggested Route (Override Policy):
                    </label>
                    <select
                      id="override-route-select"
                      value={overrideSuggestedRoute}
                      onChange={(e) => setOverrideSuggestedRoute(e.target.value as RouteDecision)}
                      className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded p-2 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                    >
                      <option value="DRAFT_FOR_REVIEW">DRAFT_FOR_REVIEW — Routine scenario</option>
                      <option value="HUMAN_REVIEW_REQUIRED">HUMAN_REVIEW_REQUIRED — Clinical triage required</option>
                      <option value="INPUT_ERROR">INPUT_ERROR — Malformed or unprocessable</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="override-reason-input" className="block text-xs font-semibold text-[#102c34]">
                      Override Justification:
                    </label>
                    <textarea
                      id="override-reason-input"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                      placeholder="Explain why the automated policy route is incorrect..."
                      className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded p-2 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f4f2]">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="px-3 py-1.5 border border-[#d0ded7] text-[#4d6d62] hover:bg-[#f1f5f3] rounded text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCommitDecision}
                  className={`px-3 py-1.5 rounded text-xs font-medium text-white cursor-pointer ${
                    confirmAction === "reject"
                      ? "bg-rose-800 hover:bg-rose-900"
                      : confirmAction === "override"
                      ? "bg-amber-800 hover:bg-amber-900"
                      : "bg-[#287d6b] hover:bg-[#1e6153]"
                  }`}
                >
                  {confirmAction === "approve"
                    ? "Confirm Approval"
                    : confirmAction === "reject"
                    ? "Confirm Rejection"
                    : confirmAction === "override"
                    ? "Confirm Route Override"
                    : "Confirm Return"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

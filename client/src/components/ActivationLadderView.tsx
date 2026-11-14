import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  UserCheck,
  Check,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { WorkflowSpec } from "../../../shared/domain/types";
import type {
  ActivationStage,
  GateCheckResult,
} from "../../../server/ladder/types";

interface Props {
  proposalId: string;
  spec: WorkflowSpec;
  onLadderUpdated?: () => void;
}

const STAGES: ActivationStage[] = [
  "Draft",
  "Evaluated",
  "Shadowed",
  "Reviewed-by-all",
  "Active",
];

export function ActivationLadderView({ proposalId, spec, onLadderUpdated }: Props) {
  const [activeSignOffRole, setActiveSignOffRole] = useState<string>("Clinical Lead");
  const [reviewerName, setReviewerName] = useState<string>("Dr. Elena Rostova");
  const [signOffNotes, setSignOffNotes] = useState<string>("");
  const [resetReason, setResetReason] = useState<string>("");
  const [showResetDialog, setShowResetDialog] = useState<boolean>(false);
  const [lastGateResults, setLastGateResults] = useState<GateCheckResult[]>([]);

  // Queries
  const { data: ladderState, refetch: refetchLadder, isLoading } = trpc.ladder.getState.useQuery(
    { proposalId },
    { enabled: !!proposalId }
  );

  // Mutations
  const transitionMutation = trpc.ladder.transition.useMutation({
    onSuccess: (res) => {
      setLastGateResults(res.gates || []);
      refetchLadder();
      onLadderUpdated?.();
      if (res.success) {
        toast.success(`Advanced proposal to stage: ${res.newStage} (Simulated · Audit Chained)`);
      } else {
        toast.error(`Stage transition blocked: ${res.errorMessage}`);
      }
    },
    onError: (err) => {
      toast.error(`Transition error: ${err.message}`);
    },
  });

  const signOffMutation = trpc.ladder.signOff.useMutation({
    onSuccess: (updated) => {
      refetchLadder();
      onLadderUpdated?.();
      toast.success(`Recorded reviewer sign-off for "${activeSignOffRole}". Stage: ${updated.currentStage}`);
      setSignOffNotes("");
    },
    onError: (err) => {
      toast.error(`Sign-off error: ${err.message}`);
    },
  });

  const resetMutation = trpc.ladder.reset.useMutation({
    onSuccess: (state) => {
      refetchLadder();
      onLadderUpdated?.();
      setShowResetDialog(false);
      setResetReason("");
      toast.info(`Activation ladder reset to Draft: ${state.lastResetReason || "Manual reset"}`);
    },
    onError: (err) => {
      toast.error(`Reset error: ${err.message}`);
    },
  });

  const currentStage = ladderState?.currentStage || "Draft";
  const currentIndex = STAGES.indexOf(currentStage);

  const requiredRoles = spec.reviewer_roles && spec.reviewer_roles.length > 0
    ? spec.reviewer_roles
    : ["Clinical Lead", "Compliance Officer", "QA Reviewer"];

  const handleAdvance = (targetStage: ActivationStage) => {
    transitionMutation.mutate({
      proposalId,
      targetStage,
      spec,
      actor: "DEMO_REVIEWER",
      notes: `Advancing to ${targetStage} via Stage Activation Ladder`,
    });
  };

  const handleSignOff = () => {
    signOffMutation.mutate({
      proposalId,
      reviewerId: reviewerName || "demo_reviewer",
      role: activeSignOffRole,
      spec,
      notes: signOffNotes || `Sign-off recorded for ${activeSignOffRole}`,
    });
  };

  const handleReset = () => {
    resetMutation.mutate({
      proposalId,
      reason: resetReason || "Manual reset by administrator",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        <span className="text-sm">Loading activation ladder state...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner: Stage Overview */}
      <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                PROPOSAL {proposalId}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                v{spec.spec_version}
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              Staged Activation Ladder
            </h3>
            <p className="text-xs text-slate-400">
              Machine-checked gates must pass to advance: Draft → Evaluated → Shadowed → Reviewed-by-all → Active
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 text-xs font-bold rounded-full uppercase tracking-wider ${
                currentStage === "Active"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : currentStage === "Reviewed-by-all"
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                  : currentStage === "Shadowed"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                  : currentStage === "Evaluated"
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                  : "bg-slate-700 text-slate-300"
              }`}
            >
              Stage: {currentStage}
            </span>

            <button
              onClick={() => setShowResetDialog(!showResetDialog)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors"
            >
              <RotateCcw size={12} />
              Reset Ladder
            </button>
          </div>
        </div>

        {/* Reset Dialog */}
        {showResetDialog && (
          <div className="p-3 mb-4 bg-slate-800/80 rounded-lg border border-rose-500/30 space-y-2">
            <div className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              Reset Ladder to Draft (Clears hashes & sign-offs)
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Reason for reset..."
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                className="flex-1 text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
              <button
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded disabled:opacity-50"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        )}

        {/* Stage Progression Steps */}
        <div className="grid grid-cols-5 gap-2 pt-2">
          {STAGES.map((stg, idx) => {
            const isCompleted = idx < currentIndex || currentStage === "Active";
            const isCurrent = currentStage === stg;

            return (
              <div
                key={stg}
                className={`p-3 rounded-lg border text-center transition-all ${
                  isCurrent
                    ? "bg-teal-950/60 border-teal-500 text-teal-200 ring-1 ring-teal-500"
                    : isCompleted
                    ? "bg-slate-800/80 border-slate-700 text-slate-300"
                    : "bg-slate-900/40 border-slate-800/60 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-center mb-1.5">
                  {isCompleted ? (
                    <CheckCircle2 size={16} className="text-teal-400" />
                  ) : isCurrent ? (
                    <div className="w-4 h-4 rounded-full border-2 border-teal-400 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-600 text-[10px] flex items-center justify-center text-slate-500">
                      {idx + 1}
                    </div>
                  )}
                </div>
                <div className="text-xs font-bold">{stg}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                  {idx === 0 && "Authoring"}
                  {idx === 1 && "Eval + Mutants"}
                  {idx === 2 && "300 Shadow"}
                  {idx === 3 && "Governance"}
                  {idx === 4 && "Active"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Critical Rule Notice: Edit resets ladder */}
      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
        <ShieldAlert size={16} className="text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Permanent Machine-Checked Safety Gate:</span> Any modification or edit to the specification immediately resets the activation ladder back to <code className="bg-amber-100 px-1 py-0.5 rounded font-mono">Draft</code>, clears all recorded hashes, and voids previous sign-offs. An unsafe or edited specification can never be activated.
        </div>
      </div>

      {/* Action Panels depending on Current Stage */}
      {currentStage === "Draft" && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-800">
                Gate 1: Advance to Evaluated
              </h4>
              <p className="text-xs text-slate-500">
                Requires: 1) Validator pass (0 fatal errors), 2) Zero critical misses across fixtures, 3) Mutation score ≥ 80% with 0 severity-lowering mutants.
              </p>
            </div>
            <button
              onClick={() => handleAdvance("Evaluated")}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {transitionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Advance to Evaluated
            </button>
          </div>
        </div>
      )}

      {currentStage === "Evaluated" && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-800">
                Gate 2: Advance to Shadowed
              </h4>
              <p className="text-xs text-slate-500">
                Requires: 1) Spec hash unchanged since evaluation, 2) Shadow replay agreement ≥ 85% on 300 synthetic cases, 3) ZERO unsafe under-escalations.
              </p>
            </div>
            <button
              onClick={() => handleAdvance("Shadowed")}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {transitionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Advance to Shadowed
            </button>
          </div>
        </div>
      )}

      {currentStage === "Shadowed" && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div>
            <h4 className="text-sm font-bold text-slate-800">
              Gate 3: Required Reviewer Sign-Offs
            </h4>
            <p className="text-xs text-slate-500">
              Multi-stakeholder governance: All required clinical and compliance roles must record sign-offs before advancing to Reviewed-by-all.
            </p>
          </div>

          {/* Role Sign-off Checklist */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {requiredRoles.map((role) => {
              const signOff = ladderState?.signOffs.find(
                (s) => s.role.toLowerCase() === role.toLowerCase()
              );
              const isSigned = !!signOff;

              return (
                <div
                  key={role}
                  className={`p-3 rounded-lg border text-xs ${
                    isSigned
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold mb-1">
                    <span className="flex items-center gap-1.5">
                      {isSigned ? (
                        <Check size={14} className="text-emerald-600" />
                      ) : (
                        <UserCheck size={14} className="text-slate-400" />
                      )}
                      {role}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isSigned ? "bg-emerald-200 text-emerald-800" : "bg-slate-200 text-slate-600"
                    }`}>
                      {isSigned ? "Signed" : "Pending"}
                    </span>
                  </div>
                  {signOff ? (
                    <div className="text-[11px] text-slate-500 mt-1">
                      <div>By: <span className="font-mono text-slate-700">{signOff.reviewerId}</span></div>
                      <div className="text-[10px] text-slate-400">{new Date(signOff.signedAt).toLocaleString()}</div>
                      {signOff.notes && <p className="italic mt-1 text-slate-600">"{signOff.notes}"</p>}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 mt-1">
                      Awaiting review sign-off
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Record Sign-off Form */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <span className="text-xs font-semibold text-slate-700">Record Simulated Reviewer Sign-off:</span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select
                value={activeSignOffRole}
                onChange={(e) => setActiveSignOffRole(e.target.value)}
                className="text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                {requiredRoles.map((r) => (
                  <option key={r} value={r}>
                    Role: {r}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Reviewer ID / Name..."
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <input
                type="text"
                placeholder="Sign-off notes (optional)..."
                value={signOffNotes}
                onChange={(e) => setSignOffNotes(e.target.value)}
                className="text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={handleSignOff}
                disabled={signOffMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded shadow-xs disabled:opacity-50 transition-colors"
              >
                <UserCheck size={13} />
                Submit Simulated Sign-off
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStage === "Reviewed-by-all" && (
        <div className="p-4 bg-white rounded-xl border border-indigo-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                All Governance Sign-Offs Collected
              </h4>
              <p className="text-xs text-slate-500">
                Specification has satisfied all evaluation, shadow agreement, and reviewer sign-off requirements. Ready for activation.
              </p>
            </div>
            <button
              onClick={() => handleAdvance("Active")}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50 transition-colors"
            >
              {transitionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Activate Specification (v{spec.spec_version})
            </button>
          </div>
        </div>
      )}

      {currentStage === "Active" && (
        <div className="p-5 bg-emerald-50 rounded-xl border border-emerald-300 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-950">
                Specification is Active
              </h4>
              <p className="text-xs text-emerald-700 font-mono">
                Active Hash: {ladderState?.activeSpecHash || spec.content_hash}
              </p>
              <p className="text-[11px] text-emerald-600 mt-0.5">
                Simulated portfolio state only · Zero outbound effects · Append-only audit chain
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Gate Results History Table */}
      {lastGateResults.length > 0 && (
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Latest Machine-Checked Gate Validations
          </h4>
          <div className="space-y-2">
            {lastGateResults.map((g, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-lg border text-xs flex items-start gap-2.5 ${
                  g.passed
                    ? "bg-emerald-50/50 border-emerald-200 text-slate-800"
                    : "bg-rose-50 border-rose-200 text-rose-900"
                }`}
              >
                {g.passed ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-semibold text-[11px] font-mono text-slate-700">
                    {g.gate}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{g.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


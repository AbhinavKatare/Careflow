import React, { useState } from "react";
import {
  FileText,
  ShieldCheck,
  CheckCircle2,
  Download,
  ShieldAlert,
  Loader2,
  FileCheck2,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { WorkflowSpec } from "../../../shared/domain/types";
import type { SOPTrace } from "../../../server/compiler/types";
import type {
  EvidencePackExport,
  EvidencePackVerificationResult,
} from "../../../server/evidence/types";

interface Props {
  spec: WorkflowSpec;
  traces: SOPTrace[];
}

export function EvidencePackView({ spec, traces }: Props) {
  const [packExport, setPackExport] = useState<EvidencePackExport | null>(null);
  const [verificationResult, setVerificationResult] = useState<EvidencePackVerificationResult | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<"summary" | "markdown" | "json">("summary");
  const [copied, setCopied] = useState<boolean>(false);

  // Mutations
  const exportMutation = trpc.evidence.export.useMutation({
    onSuccess: (exported) => {
      setPackExport(exported);
      toast.success("Evidence Pack generated & canonical hash computed");
    },
    onError: (err) => {
      toast.error(`Evidence Pack export error: ${err.message}`);
    },
  });

  const verifyMutation = trpc.evidence.verify.useMutation({
    onSuccess: (res) => {
      setVerificationResult(res);
      if (res.valid) {
        toast.success("Cryptographic integrity verified: 0 tampering detected");
      } else {
        toast.error(`TAMPER DETECTED: ${res.errors.join("; ")}`);
      }
    },
    onError: (err) => {
      toast.error(`Verification error: ${err.message}`);
    },
  });

  const handleGenerate = () => {
    exportMutation.mutate({
      spec,
      traces,
    });
  };

  const handleVerify = () => {
    if (!packExport) return;
    verifyMutation.mutate({
      packInput: packExport.json,
    });
  };

  const handleDownloadJson = () => {
    if (!packExport) return;
    const blob = new Blob([packExport.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-pack-${spec.spec_version}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded Evidence Pack JSON");
  };

  const handleDownloadMarkdown = () => {
    if (!packExport) return;
    const blob = new Blob([packExport.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-pack-${spec.spec_version}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded Evidence Pack Markdown");
  };

  const handleCopyHash = () => {
    if (!packExport) return;
    navigator.clipboard.writeText(packExport.packContentHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.info("Copied packContentHash to clipboard");
  };

  return (
    <div className="space-y-6">
      {/* Header and Action Bar */}
      <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                EVIDENCE PACK
              </span>
              <span className="text-xs text-slate-400 font-mono">
                v{spec.spec_version}
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-1">
              Specification Evidence Pack
            </h3>
            <p className="text-xs text-slate-400">
              Audit artifact combining SOP traceability, dynamic evaluation, test coverage, mutation harness score, shadow agreement, and audit chain verification.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={exportMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50 transition-colors"
            >
              {exportMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />}
              {packExport ? "Re-Generate Pack" : "Generate Evidence Pack"}
            </button>

            {packExport && (
              <>
                <button
                  onClick={handleVerify}
                  disabled={verifyMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-50 transition-colors"
                >
                  {verifyMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  Verify Integrity
                </button>

                <button
                  onClick={handleDownloadJson}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
                >
                  <Download size={13} />
                  JSON
                </button>

                <button
                  onClick={handleDownloadMarkdown}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
                >
                  <Download size={13} />
                  Markdown
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content Hash Banner */}
        {packExport && (
          <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-medium">Canonical Pack Content Hash:</span>
              <span className="font-mono text-teal-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {packExport.packContentHash}
              </span>
              <button
                onClick={handleCopyHash}
                className="text-slate-400 hover:text-slate-200 p-1"
                title="Copy hash"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>
            </div>
            <div className="text-[11px] text-slate-400">
              Generated: {new Date(packExport.pack.generatedAt).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Verification Result Banner */}
      {verificationResult && (
        <div
          className={`p-4 rounded-xl border text-xs ${
            verificationResult.valid
              ? "bg-emerald-50 border-emerald-300 text-emerald-950"
              : "bg-rose-50 border-rose-300 text-rose-950"
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-2">
            {verificationResult.valid ? (
              <CheckCircle2 size={18} className="text-emerald-600" />
            ) : (
              <ShieldAlert size={18} className="text-rose-600" />
            )}
            <span>
              {verificationResult.valid
                ? "Cryptographic Verification PASSED: Evidence Pack is Authentic & Untampered"
                : "CRYPTOGRAPHIC INTEGRITY FAILURE: Tampering or Spec Hash Mismatch Detected"}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] mt-2">
            <div className="p-2 bg-white/80 rounded border border-current/20">
              <span className="text-slate-500 block">Pack Content Hash:</span>
              <span className="font-semibold font-mono">
                {verificationResult.packContentHashMatch ? "MATCH (Valid)" : "MISMATCH (Tampered)"}
              </span>
            </div>
            <div className="p-2 bg-white/80 rounded border border-current/20">
              <span className="text-slate-500 block">Spec Hash:</span>
              <span className="font-semibold font-mono">
                {verificationResult.specHashMatch ? "MATCH (Authentic)" : "MISMATCH (Edited)"}
              </span>
            </div>
            <div className="p-2 bg-white/80 rounded border border-current/20">
              <span className="text-slate-500 block">Audit Trail:</span>
              <span className="font-semibold font-mono">
                {verificationResult.auditChainValid ? "VALID (Hash-Chained)" : "BROKEN (Corrupted)"}
              </span>
            </div>
            <div className="p-2 bg-white/80 rounded border border-current/20">
              <span className="text-slate-500 block">Safety Gate:</span>
              <span className="font-semibold font-mono">
                {verificationResult.valid ? "0 Critical Misses" : "CRITICAL MISS FAIL"}
              </span>
            </div>
          </div>

          {verificationResult.errors.length > 0 && (
            <div className="mt-3 p-2 bg-rose-100 rounded text-rose-900 text-xs font-mono space-y-1">
              {verificationResult.errors.map((e, idx) => (
                <div key={idx}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pack Display Tabs */}
      {!packExport ? (
        <div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-slate-400">
          <FileText size={40} className="mx-auto mb-2 text-slate-300 stroke-[1.2]" />
          <h4 className="text-sm font-semibold text-slate-700">No Evidence Pack Generated Yet</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Click "Generate Evidence Pack" to evaluate all fixtures, calculate test coverage, run the mutation harness, shadow 300 cases, and verify the hash-chained audit trail.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Sub-tabs */}
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg text-xs">
              <button
                onClick={() => setActiveSubTab("summary")}
                className={`px-3 py-1 rounded font-medium transition-all ${
                  activeSubTab === "summary"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Executive Summary
              </button>
              <button
                onClick={() => setActiveSubTab("markdown")}
                className={`px-3 py-1 rounded font-medium transition-all ${
                  activeSubTab === "markdown"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Markdown Export
              </button>
              <button
                onClick={() => setActiveSubTab("json")}
                className={`px-3 py-1 rounded font-medium transition-all ${
                  activeSubTab === "json"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Raw JSON
              </button>
            </div>
          </div>

          {/* Sub-tab 1: Executive Summary */}
          {activeSubTab === "summary" && (
            <div className="p-6 space-y-6">
              {/* Plain Language Summary */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  1. Clinical Intent & Plain-Language Summary
                </h4>
                <p className="text-xs text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed font-sans">
                  {packExport.pack.plainLanguageSummary}
                </p>
              </div>

              {/* Evaluation Metrics Cards */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  2. Dynamic Evaluation Results (0 Staged Outcome Flags)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Total Test Cases:</span>
                    <span className="text-base font-bold text-slate-800">{packExport.pack.evaluationResults.totalCases}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Critical Misses:</span>
                    <span className="text-base font-bold text-emerald-600">{packExport.pack.evaluationResults.criticalMisses}</span>
                    <span className="text-[10px] text-slate-400 block">(Safety Gate: 0)</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Route Accuracy:</span>
                    <span className="text-base font-bold text-teal-700">{packExport.pack.evaluationResults.routeAccuracy.toFixed(1)}%</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Measured Latency:</span>
                    <span className="text-xs font-mono font-bold text-slate-700">p50: {packExport.pack.evaluationResults.latencyP50Ms}ms</span>
                    <span className="text-[10px] text-slate-400 block">p95: {packExport.pack.evaluationResults.latencyP95Ms}ms</span>
                  </div>
                </div>
              </div>

              {/* Test Suite Coverage & Mutation Harness */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    3. Test Suite Rule Coverage
                  </h5>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Exercised Rules:</span>
                    <span className="font-bold text-slate-800">
                      {packExport.pack.coverageReport.exercisedRulesCount} / {packExport.pack.coverageReport.totalRules}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Coverage Percentage:</span>
                    <span className="font-bold text-teal-700">
                      {packExport.pack.coverageReport.ruleCoveragePercent.toFixed(1)}% (Threshold: ≥ 95%)
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    4. Mutation Harness Score
                  </h5>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Killed Mutants:</span>
                    <span className="font-bold text-slate-800">
                      {packExport.pack.mutationReport.killedMutants} / {packExport.pack.mutationReport.totalMutants}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Mutation Score:</span>
                    <span className="font-bold text-indigo-700">
                      {packExport.pack.mutationReport.mutationScore}% (Gate: {packExport.pack.mutationReport.gateStatus})
                    </span>
                  </div>
                </div>
              </div>

              {/* Shadow Evaluation & Audit Trail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    5. Shadow Replay (300 Cases)
                  </h5>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Agreement Rate:</span>
                    <span className="font-bold text-purple-700">
                      {packExport.pack.shadowReport.agreementRate.toFixed(1)}% (Target: ≥ 85%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Unsafe Under-Escalations:</span>
                    <span className="font-bold text-emerald-600">
                      {packExport.pack.shadowReport.unsafeDisagreementsCount} (Gate: 0)
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    6. Cryptographic Audit Chain
                  </h5>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Audit Trail Integrity:</span>
                    <span className="font-bold text-emerald-600">
                      {packExport.pack.auditChainVerification.valid ? "100% Valid & Untampered" : "Invalid"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">Total Chained Events:</span>
                    <span className="font-mono text-slate-700">
                      {packExport.pack.auditChainVerification.totalEvents}
                    </span>
                  </div>
                </div>
              </div>

              {/* Known Limitations */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  7. Known Operational Boundaries & Safety Guardrails
                </h4>
                <div className="space-y-1.5">
                  {packExport.pack.knownLimitations.map((lim, idx) => (
                    <div key={idx} className="p-2 bg-slate-50 rounded border border-slate-200 text-xs text-slate-700">
                      {lim}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 2: Markdown Export */}
          {activeSubTab === "markdown" && (
            <div className="p-4">
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-[600px] whitespace-pre-wrap">
                {packExport.markdown}
              </pre>
            </div>
          )}

          {/* Sub-tab 3: Raw JSON */}
          {activeSubTab === "json" && (
            <div className="p-4">
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto max-h-[600px]">
                {packExport.json}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

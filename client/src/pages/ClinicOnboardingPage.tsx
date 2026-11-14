import React, { useState, useEffect } from "react";
import {
  FileText,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Play,
  Sparkles,
  Layers,
  ArrowRight,
  Code2,
  Zap,
  BarChart3,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ActivationLadderView } from "@/components/ActivationLadderView";
import { EvidencePackView } from "@/components/EvidencePackView";
import { ReplayView } from "@/components/ReplayView";
import { DriftDashboardView } from "@/components/DriftDashboardView";
import { ModelTierComparisonView } from "@/components/ModelTierComparisonView";
import type {
  CompilationProposal,
  GeneratedFixtureSuite,
} from "../../../server/compiler/types";
import type { MutationSuiteReport } from "../../../server/mutation/types";
import type { ShadowRunReport } from "../../../server/shadow/types";

interface Props {
  onBackToOverview?: () => void;
}

export default function ClinicOnboardingPage({ onBackToOverview: _onBackToOverview }: Props) {
  const [selectedSampleId, setSelectedSampleId] = useState<string>("sample_weekly_checkin");
  const [customSopMarkdown, setCustomSopMarkdown] = useState<string>("");
  const [activeSopName, setActiveSopName] = useState<string>("Weekly Check-in");
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null);
  const [highlightedRuleId, setHighlightedRuleId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    | "spec"
    | "validation"
    | "fixtures"
    | "mutation"
    | "shadow"
    | "ladder"
    | "evidence"
    | "replay"
    | "drift"
    | "cascade"
    | "edit"
  >("spec");
  const [reviewerNotes, setReviewerNotes] = useState<string>("");
  const [editedSpecJson, setEditedSpecJson] = useState<string>("");
  const [seed, setSeed] = useState<number>(42);

  // Queries & Mutations
  const { data: samples } = trpc.compiler.listSamples.useQuery();
  const { data: proposals, refetch: refetchProposals } = trpc.compiler.listProposals.useQuery();

  const [currentProposal, setCurrentProposal] = useState<CompilationProposal | null>(null);
  const [fixtureSuite, setFixtureSuite] = useState<GeneratedFixtureSuite | null>(null);
  const [mutationReport, setMutationReport] = useState<MutationSuiteReport | null>(null);
  const [shadowReport, setShadowReport] = useState<ShadowRunReport | null>(null);

  const compileMutation = trpc.compiler.compile.useMutation({
    onSuccess: (data) => {
      setCurrentProposal(data);
      setEditedSpecJson(JSON.stringify(data.proposedSpec, null, 2));
      refetchProposals();
      toast.success(`Compiled "${data.sopName}" into non-binding proposal ${data.id}`);
    },
    onError: (err) => {
      toast.error(`Compilation error: ${err.message}`);
    },
  });

  const decideMutation = trpc.compiler.decide.useMutation({
    onSuccess: (updated) => {
      if (updated) {
        setCurrentProposal(updated);
        refetchProposals();
        toast.success(`Proposal marked as ${updated.status} (Simulated · stored in DB)`);
      }
    },
    onError: (err) => {
      toast.error(`Decision error: ${err.message}`);
    },
  });

  const generateFixturesMutation = trpc.compiler.generateFixtures.useMutation({
    onSuccess: (suite) => {
      setFixtureSuite(suite);
      setActiveTab("fixtures");
      toast.success(`Generated ${suite.fixtures.length} fixtures with ${suite.coverage.coveragePercentage.toFixed(1)}% rule coverage`);
    },
    onError: (err) => {
      toast.error(`Fixture generation error: ${err.message}`);
    },
  });

  const mutationMutation = trpc.mutation.run.useMutation({
    onSuccess: (report) => {
      setMutationReport(report);
      setActiveTab("mutation");
      if (report.gateStatus === "PASS") {
        toast.success(`Mutation Score: ${report.mutationScore}% (${report.killedMutants}/${report.totalMutants} killed) · Gate PASSED`);
      } else {
        toast.error(`Mutation Gate BLOCKED: ${report.gateFailureReason}`);
      }
    },
    onError: (err) => {
      toast.error(`Mutation error: ${err.message}`);
    },
  });

  const shadowMutation = trpc.shadow.runHistorical.useMutation({
    onSuccess: (report) => {
      setShadowReport(report);
      setActiveTab("shadow");
      if (report.gateStatus === "PASS") {
        toast.success(`Shadow Replay: ${report.agreementRate}% Agreement across 300 cases · Gate PASSED`);
      } else {
        toast.error(`Shadow Gate BLOCKED: ${report.unsafeDisagreements.length} under-escalation(s) detected!`);
      }
    },
    onError: (err) => {
      toast.error(`Shadow error: ${err.message}`);
    },
  });

  // Set initial sample SOP content
  useEffect(() => {
    if (samples && samples.length > 0) {
      const match = samples.find((s) => s.id === selectedSampleId) ?? samples[0];
      setCustomSopMarkdown(match.markdown);
      setActiveSopName(match.name);
    }
  }, [samples, selectedSampleId]);

  // Handler to select a sample SOP
  const handleSelectSample = (sampleId: string) => {
    setSelectedSampleId(sampleId);
    const match = samples?.find((s) => s.id === sampleId);
    if (match) {
      setCustomSopMarkdown(match.markdown);
      setActiveSopName(match.name);
      setSelectedSentence(null);
      setHighlightedRuleId(null);
    }
  };

  const handleSelectAdversarial = () => {
    setSelectedSampleId("adversarial_unsafe");
    setActiveSopName("Deliberately Unsafe SOP (Adversarial)");
    setCustomSopMarkdown(
      `# Deliberately Unsafe SOP (Adversarial Fixture)\n\n` +
      `Sentence 1: If a patient mentions acute distress such as severe chest pain or emergency, generate an AI reassurance draft directly.\n` +
      `Sentence 2: Evaluate untrusted patient input with eval(malicious_code) directly.\n` +
      `Sentence 3: Allow negative message lengths of -50 characters without human review.\n`
    );
    setSelectedSentence(null);
    setHighlightedRuleId(null);
  };

  // Run compilation
  const handleCompile = () => {
    compileMutation.mutate({
      sopMarkdown: customSopMarkdown,
      sopName: activeSopName,
    });
  };

  // Run fixture generation
  const handleGenerateFixtures = () => {
    if (!currentProposal) {
      toast.error("Compile or select a proposal first");
      return;
    }
    generateFixturesMutation.mutate({
      spec: currentProposal.proposedSpec,
      seed: seed,
    });
  };

  // Run mutation harness
  const handleRunMutation = () => {
    if (!currentProposal) {
      toast.error("Compile or select a proposal first");
      return;
    }
    mutationMutation.mutate({
      spec: currentProposal.proposedSpec,
      threshold: 80,
      seed: seed,
    });
  };

  // Run shadow replay on 300 synthetic cases
  const handleRunShadow = () => {
    if (!currentProposal) {
      toast.error("Compile or select a proposal first");
      return;
    }
    shadowMutation.mutate({
      candidateSpec: currentProposal.proposedSpec,
      seed: 1337,
    });
  };

  // Trace selection: click sentence in SOP
  const handleSentenceClick = (sentenceNum: number) => {
    setSelectedSentence(sentenceNum);
    if (currentProposal?.traces) {
      const trace = currentProposal.traces.find((t) => t.sopSentenceNumber === sentenceNum);
      if (trace) {
        setHighlightedRuleId(trace.ruleId);
        setActiveTab("spec");
        // Scroll to rule
        const el = document.getElementById(`rule-card-${trace.ruleId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } else {
        setHighlightedRuleId(null);
      }
    }
  };

  // Trace selection: click rule in Spec
  const handleRuleClick = (ruleId: string) => {
    setHighlightedRuleId(ruleId);
    if (currentProposal?.traces) {
      const trace = currentProposal.traces.find((t) => t.ruleId === ruleId);
      if (trace) {
        setSelectedSentence(trace.sopSentenceNumber);
        // Scroll to sentence in SOP
        const el = document.getElementById(`sop-sentence-${trace.sopSentenceNumber}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } else {
        setSelectedSentence(null);
      }
    }
  };

  // Decision actions
  const handleAccept = () => {
    if (!currentProposal) return;
    decideMutation.mutate({
      id: currentProposal.id,
      decision: "ACCEPTED",
      reviewerNotes,
    });
  };

  const handleReject = () => {
    if (!currentProposal) return;
    decideMutation.mutate({
      id: currentProposal.id,
      decision: "REJECTED",
      reviewerNotes: reviewerNotes || "Rejected during clinical reviewer inspection.",
    });
  };

  const handleSaveEdit = () => {
    if (!currentProposal) return;
    try {
      const parsed = JSON.parse(editedSpecJson);
      decideMutation.mutate({
        id: currentProposal.id,
        decision: "EDITED",
        reviewerNotes: reviewerNotes || "Edited specification JSON by reviewer.",
        editedSpec: parsed,
      });
    } catch (e: any) {
      toast.error(`Invalid JSON: ${e.message}`);
    }
  };

  // Parse lines for sentence-level interactive SOP view
  const renderSopSentences = () => {
    const lines = customSopMarkdown.split("\n");
    return lines.map((line, idx) => {
      // Check if line contains "Sentence N:"
      const match = line.match(/^Sentence\s+(\d+):\s*(.*)$/i);
      if (match) {
        const sentenceNum = parseInt(match[1], 10);
        const sentenceText = match[2];
        const isSelected = selectedSentence === sentenceNum;
        const trace = currentProposal?.traces.find((t) => t.sopSentenceNumber === sentenceNum);

        return (
          <div
            key={idx}
            id={`sop-sentence-${sentenceNum}`}
            onClick={() => handleSentenceClick(sentenceNum)}
            className={`p-3 my-1.5 rounded-md border text-sm cursor-pointer transition-all duration-150 ${
              isSelected
                ? "bg-teal-50 border-teal-500 shadow-sm ring-1 ring-teal-500"
                : "bg-white hover:bg-slate-50 border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">
                <FileText size={12} />
                Sentence {sentenceNum}
              </span>
              {trace && (
                <span className="inline-flex items-center gap-1 text-xs text-teal-700 font-mono font-medium bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  <ArrowRight size={11} />
                  {trace.ruleId}
                </span>
              )}
            </div>
            <p className="text-slate-800 leading-relaxed font-sans">{sentenceText}</p>
            {trace && isSelected && (
              <div className="mt-2 pt-2 border-t border-teal-100 text-xs text-teal-900 bg-teal-50/50 p-2 rounded">
                <strong>Trace Rationale:</strong> {trace.rationale}
              </div>
            )}
          </div>
        );
      }

      // Non-sentence headers/markdown lines
      if (line.startsWith("# ")) {
        return (
          <h2 key={idx} className="text-lg font-bold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200">
            {line.replace("# ", "")}
          </h2>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h3 key={idx} className="text-sm font-semibold text-slate-700 uppercase tracking-wider mt-3 mb-1">
            {line.replace("## ", "")}
          </h3>
        );
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-2" />;
      }
      return (
        <p key={idx} className="text-xs text-slate-500 italic mb-2">
          {line}
        </p>
      );
    });
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner / Disclaimer */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-teal-900 to-slate-900 text-white shadow-md">
        <div>
          <div className="flex items-center gap-2 text-teal-300 text-xs font-semibold tracking-wider uppercase mb-1">
            <Sparkles size={14} />
            Careflow SOP Compiler & Workflow Studio
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Onboard a Clinic</h1>
          <p className="text-sm text-slate-300 max-w-2xl mt-1">
            Transform synthetic clinic SOPs into deterministic, auditable Workflow Specifications.
            All proposals are non-binding; LLMs never make clinical or routing decisions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs bg-slate-800/80 border border-slate-700 px-3 py-2 rounded-lg text-slate-300">
            <span className="font-semibold text-teal-400">Simulation Only:</span> Zero outbound actions.
          </div>
        </div>
      </div>

      {/* Control Bar: Select SOP, Trigger Compilation, Generate Fixtures */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">
            Select SOP:
          </span>
          {samples?.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelectSample(s.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                selectedSampleId === s.id
                  ? "bg-teal-50 border-teal-600 text-teal-900 font-semibold shadow-xs"
                  : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            onClick={handleSelectAdversarial}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              selectedSampleId === "adversarial_unsafe"
                ? "bg-rose-50 border-rose-500 text-rose-800 font-semibold shadow-xs"
                : "bg-slate-50 border-slate-200 text-rose-600 hover:bg-rose-50/50"
            }`}
          >
            Adversarial Test (Unsafe SOP)
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCompile}
            disabled={compileMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium text-xs shadow-sm transition-colors disabled:opacity-50"
          >
            <Play size={14} />
            {compileMutation.isPending ? "Compiling..." : "Compile SOP Proposal"}
          </button>

          {currentProposal && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 font-mono">Seed:</span>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value, 10) || 42)}
                className="w-14 px-2 py-1 text-xs border border-slate-300 rounded font-mono"
              />
              <button
                onClick={handleGenerateFixtures}
                disabled={generateFixturesMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
              >
                <Layers size={13} />
                {generateFixturesMutation.isPending ? "Generating..." : `Fixtures (${fixtureSuite?.fixtures.length ?? "80+"})`}
              </button>
              <button
                onClick={handleRunMutation}
                disabled={mutationMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
              >
                <Zap size={13} />
                {mutationMutation.isPending ? "Mutating..." : `Mutate (${mutationReport ? `${mutationReport.mutationScore}%` : "Run"})`}
              </button>
              <button
                onClick={handleRunShadow}
                disabled={shadowMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
              >
                <BarChart3 size={13} />
                {shadowMutation.isPending ? "Replaying..." : `Shadow (${shadowReport ? `${shadowReport.agreementRate}%` : "300"})`}
              </button>
            </div>
          )}
          {proposals && proposals.length > 0 && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
              Stored Proposals: {proposals.length}
            </span>
          )}
        </div>
      </div>

      {/* Main Split Layout: Left SOP, Right Proposed Spec */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Synthetic Clinic SOP with Numbered Sentences */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[750px]">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-xl">
            <div className="flex items-center gap-2">
              <FileText size={18} className="text-teal-600" />
              <h2 className="text-sm font-bold text-slate-800">
                Clinic Standard Operating Procedure (SOP)
              </h2>
            </div>
            <span className="text-xs bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded font-mono">
              Click sentence to trace rule
            </span>
          </div>

          <div className="p-4 overflow-y-auto flex-1 font-sans">
            {renderSopSentences()}
          </div>

          <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between rounded-b-xl">
            <span>{selectedSentence ? `Selected Sentence: #${selectedSentence}` : "No sentence selected"}</span>
            {selectedSentence && (
              <button
                onClick={() => {
                  setSelectedSentence(null);
                  setHighlightedRuleId(null);
                }}
                className="text-xs text-teal-600 hover:underline"
              >
                Clear Selection
              </button>
            )}
          </div>
        </div>

        {/* Right: Proposed WorkflowSpec & Traceability */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-[750px]">
          {/* Header & Tabs */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-xl">
            <div className="flex items-center gap-2">
              <Code2 size={18} className="text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-800">
                Proposed Workflow Specification
              </h2>
              {currentProposal && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    currentProposal.validation.valid
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-rose-100 text-rose-800 border border-rose-300"
                  }`}
                >
                  {currentProposal.validation.valid ? "Validator: PASS" : "Validator: REJECTED"}
                </span>
              )}
            </div>

            {/* Tab Buttons */}
            <div className="flex flex-wrap items-center gap-1 bg-slate-200/60 p-1 rounded-lg text-xs">
              <button
                onClick={() => setActiveTab("spec")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "spec" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Rules ({currentProposal?.proposedSpec.rule_list.length ?? 0})
              </button>
              <button
                onClick={() => setActiveTab("validation")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "validation"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Checks ({currentProposal?.validation.checks.length ?? 0})
              </button>
              <button
                onClick={() => setActiveTab("fixtures")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "fixtures" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Fixtures ({fixtureSuite?.fixtures.length ?? 0})
              </button>
              <button
                onClick={() => setActiveTab("mutation")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "mutation" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Mutants {mutationReport ? `(${mutationReport.mutationScore}%)` : ""}
              </button>
              <button
                onClick={() => setActiveTab("shadow")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "shadow" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Shadow (300)
              </button>
              <button
                onClick={() => setActiveTab("ladder")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "ladder" ? "bg-white text-teal-900 font-bold shadow-xs ring-1 ring-teal-500" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Activation Ladder
              </button>
              <button
                onClick={() => setActiveTab("evidence")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "evidence" ? "bg-white text-emerald-900 font-bold shadow-xs ring-1 ring-emerald-500" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Evidence Pack
              </button>
              <button
                onClick={() => setActiveTab("replay")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "replay" ? "bg-white text-sky-900 font-bold shadow-xs ring-1 ring-sky-500" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Replay & Bulk Diff
              </button>
              <button
                onClick={() => setActiveTab("drift")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "drift" ? "bg-white text-amber-900 font-bold shadow-xs ring-1 ring-amber-500" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Drift & Canary
              </button>
              <button
                onClick={() => setActiveTab("cascade")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "cascade" ? "bg-white text-indigo-900 font-bold shadow-xs ring-1 ring-indigo-500" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Cascade & Datasets
              </button>
              <button
                onClick={() => setActiveTab("edit")}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeTab === "edit" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Spec JSON
              </button>
            </div>
          </div>

          {/* Tab Content Area */}
          <div className="p-4 overflow-y-auto flex-1">
            {!currentProposal ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 p-8">
                <FileText size={48} className="stroke-[1.2] mb-3 text-slate-300" />
                <p className="text-sm font-medium text-slate-600">No Workflow Proposal Loaded</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Click "Compile SOP Proposal" above to run the deterministic compiler on the selected clinic SOP.
                </p>
              </div>
            ) : (
              <>
                {/* TAB 1: Rules & Line-level Traceability */}
                {activeTab === "spec" && (
                  <div className="space-y-4">
                    {/* Proposal Meta */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between text-xs text-slate-600">
                      <div>
                        <strong>Proposal ID:</strong> {currentProposal.id}
                      </div>
                      <div>
                        <strong>Version:</strong> {currentProposal.proposedSpec.spec_version}
                      </div>
                      <div>
                        <strong>Hash:</strong>{" "}
                        <span className="font-mono text-slate-500">
                          {currentProposal.proposedSpec.content_hash.slice(0, 16)}...
                        </span>
                      </div>
                      <div>
                        <strong>Status:</strong>{" "}
                        <span className="font-semibold text-teal-700">{currentProposal.status}</span>
                      </div>
                    </div>

                    {/* Rules List */}
                    <div className="space-y-3">
                      {currentProposal.proposedSpec.rule_list.map((rule) => {
                        const isHighlighted = highlightedRuleId === rule.id;
                        const trace = currentProposal.traces.find((t) => t.ruleId === rule.id);

                        return (
                          <div
                            key={rule.id}
                            id={`rule-card-${rule.id}`}
                            onClick={() => handleRuleClick(rule.id)}
                            className={`p-3.5 rounded-lg border text-xs cursor-pointer transition-all duration-150 ${
                              isHighlighted
                                ? "bg-indigo-50 border-indigo-500 shadow-sm ring-1 ring-indigo-500"
                                : "bg-white hover:bg-slate-50 border-slate-200"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-mono font-semibold text-slate-800 text-xs">
                                {rule.id}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase ${
                                  rule.route === "INPUT_ERROR"
                                    ? "bg-rose-100 text-rose-800"
                                    : rule.route === "HUMAN_REVIEW_REQUIRED"
                                    ? "bg-amber-100 text-amber-900"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {rule.route}
                              </span>
                            </div>

                            <p className="text-slate-600 mb-2 leading-relaxed">{rule.description}</p>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                              <div>
                                <span className="font-medium text-slate-700">Reason:</span>{" "}
                                <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">
                                  {rule.reason_code}
                                </code>
                              </div>
                              {trace && (
                                <span className="inline-flex items-center gap-1 text-teal-700 font-medium">
                                  <FileText size={11} />
                                  Traced from SOP Sentence #{trace.sopSentenceNumber}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* TAB 2: Validator Results */}
                {activeTab === "validation" && (
                  <div className="space-y-4">
                    <div
                      className={`p-4 rounded-lg border flex items-start gap-3 ${
                        currentProposal.validation.valid
                          ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                          : "bg-rose-50 border-rose-300 text-rose-900"
                      }`}
                    >
                      {currentProposal.validation.valid ? (
                        <CheckCircle2 size={24} className="text-emerald-600 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle size={24} className="text-rose-600 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <h3 className="font-bold text-sm">
                          {currentProposal.validation.valid
                            ? "Workflow Specification Passed All Deterministic Safety Checks"
                            : "Deterministic Safety Validator REJECTED Proposal"}
                        </h3>
                        <p className="text-xs mt-1 leading-relaxed opacity-90">
                          {currentProposal.validation.valid
                            ? "All required safety rules (untrusted-text, uncertainty, contradiction, limits) are present. No concerning text is routed to draft."
                            : "The specification violates non-negotiable safety guardrails and cannot be activated or accepted."}
                        </p>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                      {currentProposal.validation.checks.map((chk, i) => (
                        <div key={i} className="p-3 bg-white flex items-start gap-3 text-xs">
                          {chk.passed ? (
                            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <XCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800">{chk.name}</span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  chk.passed
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                {chk.passed ? "PASS" : "FAIL"}
                              </span>
                            </div>
                            <p className="text-slate-500 mt-0.5">{chk.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB 3: Fixture Generator & Coverage Report */}
                {activeTab === "fixtures" && (
                  <div className="space-y-4">
                    {!fixtureSuite ? (
                      <div className="text-center py-12 text-slate-400">
                        <Layers size={36} className="mx-auto mb-2 text-slate-300" />
                        <p className="text-sm font-medium text-slate-600">No Fixture Suite Generated Yet</p>
                        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                          Click "Generate Fixtures (Seed 42)" to generate 80+ seeded test fixtures with coverage.
                        </p>
                        <button
                          onClick={handleGenerateFixtures}
                          className="mt-3 px-3 py-1.5 bg-slate-800 text-white text-xs rounded-md font-medium"
                        >
                          Generate Fixtures Now
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Coverage Highlights */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-slate-900">
                              {fixtureSuite.fixtures.length}
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium">Total Fixtures</div>
                          </div>
                          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-teal-800">
                              {fixtureSuite.coverage.coveragePercentage.toFixed(1)}%
                            </div>
                            <div className="text-[11px] text-teal-600 font-medium">
                              Rule Coverage (≥95%)
                            </div>
                          </div>
                          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-indigo-800">
                              {fixtureSuite.coverage.coveredRuleIds.length}/
                              {fixtureSuite.coverage.totalRules}
                            </div>
                            <div className="text-[11px] text-indigo-600 font-medium">Rules Exercised</div>
                          </div>
                        </div>

                        {/* Fixtures List */}
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700 flex justify-between">
                            <span>Seeded Test Fixtures ({fixtureSuite.fixtures.length})</span>
                            <span className="font-mono text-[10px] text-slate-500">Seed: {fixtureSuite.seed}</span>
                          </div>
                          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
                            {fixtureSuite.fixtures.slice(0, 30).map((f) => (
                              <div key={f.id} className="p-2.5 hover:bg-slate-50 flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-medium text-slate-800">{f.id}</span>
                                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                      {f.provenance.templateKey}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                                    {f.rawInput.note ? `Note: "${f.rawInput.note}"` : "Empty note (routine)"}
                                  </p>
                                </div>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                                    f.expected_route === "INPUT_ERROR"
                                      ? "bg-rose-100 text-rose-800"
                                      : f.expected_route === "HUMAN_REVIEW_REQUIRED"
                                      ? "bg-amber-100 text-amber-900"
                                      : "bg-emerald-100 text-emerald-800"
                                  }`}
                                >
                                  {f.expected_route}
                                </span>
                              </div>
                            ))}
                          </div>
                          {fixtureSuite.fixtures.length > 30 && (
                            <div className="p-2 bg-slate-50 text-center text-xs text-slate-500 border-t border-slate-200">
                              Showing 30 of {fixtureSuite.fixtures.length} fixtures. Full suite persisted and verifiable.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 4: Mutation Testing */}
                {activeTab === "mutation" && (
                  <div className="space-y-4">
                    {!mutationReport ? (
                      <div className="text-center py-12 text-slate-400">
                        <Zap size={36} className="mx-auto mb-2 text-indigo-400" />
                        <p className="text-sm font-medium text-slate-600">No Mutation Suite Run Yet</p>
                        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                          Introduce deliberate mutations (deleted rules, flipped routes, threshold tweaks, dropped normalizations) to evaluate test suite kill rate.
                        </p>
                        <button
                          onClick={handleRunMutation}
                          disabled={mutationMutation.isPending}
                          className="mt-3 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs rounded-md font-medium"
                        >
                          {mutationMutation.isPending ? "Running..." : "Run Mutation Harness (Threshold 80%)"}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Top Metrics Banner */}
                        <div className="grid grid-cols-4 gap-3">
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-slate-900">
                              {mutationReport.totalMutants}
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium">Total Mutants</div>
                          </div>
                          <div className={`p-3 rounded-lg border text-center ${mutationReport.scorePassed ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
                            <div className={`text-xl font-bold ${mutationReport.scorePassed ? "text-emerald-800" : "text-rose-800"}`}>
                              {mutationReport.mutationScore}%
                            </div>
                            <div className={`text-[11px] font-medium ${mutationReport.scorePassed ? "text-emerald-600" : "text-rose-600"}`}>
                              Mutation Score (Req: ≥{mutationReport.threshold}%)
                            </div>
                          </div>
                          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-indigo-800">
                              {mutationReport.killedMutants} / {mutationReport.totalMutants}
                            </div>
                            <div className="text-[11px] text-indigo-600 font-medium">Mutants Killed</div>
                          </div>
                          <div className={`p-3 rounded-lg border text-center ${mutationReport.gateStatus === "PASS" ? "bg-emerald-50 border-emerald-300" : "bg-rose-50 border-rose-300"}`}>
                            <div className={`text-xs font-bold uppercase mt-1 ${mutationReport.gateStatus === "PASS" ? "text-emerald-800" : "text-rose-800"}`}>
                              {mutationReport.gateStatus === "PASS" ? "Gate: PASS" : "Gate: BLOCKED"}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {mutationReport.severityLoweringSurvivingCount > 0 ? `${mutationReport.severityLoweringSurvivingCount} severity drops survived!` : "No severity drops"}
                            </div>
                          </div>
                        </div>

                        {mutationReport.gateFailureReason && (
                          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg flex items-start gap-2">
                            <ShieldAlert size={16} className="shrink-0 mt-0.5 text-rose-600" />
                            <div>
                              <strong>Safety Gate Blocked:</strong> {mutationReport.gateFailureReason}
                            </div>
                          </div>
                        )}

                        {/* Category Breakdown Table */}
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700">
                            Mutation Operator Breakdown
                          </div>
                          <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                              <tr>
                                <th className="p-2">Operator</th>
                                <th className="p-2">Total</th>
                                <th className="p-2">Killed</th>
                                <th className="p-2">Survived</th>
                                <th className="p-2">Kill Rate</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {Object.entries(mutationReport.categoryBreakdown).map(([op, counts]) => (
                                <tr key={op} className="hover:bg-slate-50">
                                  <td className="p-2 font-mono text-[11px]">{op}</td>
                                  <td className="p-2">{counts.total}</td>
                                  <td className="p-2 text-emerald-700 font-semibold">{counts.killed}</td>
                                  <td className="p-2 text-slate-600">{counts.survived}</td>
                                  <td className="p-2 font-semibold">
                                    {counts.total > 0 ? `${((counts.killed / counts.total) * 100).toFixed(0)}%` : "N/A"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Surviving Mutants List */}
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700 flex justify-between">
                            <span>Surviving Mutants ({mutationReport.survivingMutants})</span>
                            <span className="text-[11px] text-slate-500 font-normal">Exact modifications uncaught by suite</span>
                          </div>
                          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
                            {mutationReport.survivingMutantsList.length === 0 ? (
                              <div className="p-4 text-center text-emerald-700 font-medium">
                                ✓ Zero surviving mutants! 100% of tested mutations were caught and killed by the test suite.
                              </div>
                            ) : (
                              mutationReport.survivingMutantsList.map((m) => (
                                <div key={m.mutant.id} className="p-3 hover:bg-slate-50 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-slate-800">{m.mutant.id}</span>
                                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                        {m.mutant.operator}
                                      </span>
                                      {m.mutant.lowersSeverity && (
                                        <span className="text-[10px] bg-rose-100 text-rose-800 font-semibold px-1.5 py-0.5 rounded">
                                          SEVERITY-LOWERING
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                      SURVIVED
                                    </span>
                                  </div>
                                  <p className="text-slate-700 text-[11px]">{m.mutant.description}</p>
                                  <div className="font-mono text-[10px] bg-slate-900 text-slate-100 p-1.5 rounded">
                                    {m.mutant.diff}
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

                {/* TAB 5: Shadow Replay (300 Historical Cases) */}
                {activeTab === "shadow" && (
                  <div className="space-y-4">
                    {/* Disclaimer Banner */}
                    <div className="p-2.5 bg-slate-100 border border-slate-200 text-slate-600 text-[11px] rounded-lg">
                      <strong>Synthetic Dataset Notice:</strong> All 300 historical cases and reviewer baseline labels are entirely synthetic. Demonstration simulation only; zero outbound actions.
                    </div>

                    {!shadowReport ? (
                      <div className="text-center py-12 text-slate-400">
                        <BarChart3 size={36} className="mx-auto mb-2 text-purple-400" />
                        <p className="text-sm font-medium text-slate-600">No Shadow Replay Executed Yet</p>
                        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                          Replay 300 synthetic historical cases through this candidate specification without producing any deliverable.
                        </p>
                        <button
                          onClick={handleRunShadow}
                          disabled={shadowMutation.isPending}
                          className="mt-3 px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white text-xs rounded-md font-medium"
                        >
                          {shadowMutation.isPending ? "Replaying..." : "Replay 300 Historical Cases"}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Top Metrics Banner */}
                        <div className="grid grid-cols-4 gap-3">
                          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-purple-900">
                              {shadowReport.agreementRate}%
                            </div>
                            <div className="text-[11px] text-purple-700 font-medium">
                              Baseline Agreement ({shadowReport.agreedCases}/300)
                            </div>
                          </div>
                          <div className={`p-3 rounded-lg border text-center ${shadowReport.unsafeDisagreements.length === 0 ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-300"}`}>
                            <div className={`text-xl font-bold ${shadowReport.unsafeDisagreements.length === 0 ? "text-emerald-800" : "text-rose-800"}`}>
                              {shadowReport.unsafeDisagreements.length}
                            </div>
                            <div className={`text-[11px] font-medium ${shadowReport.unsafeDisagreements.length === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              Under-Escalations (Blocking)
                            </div>
                          </div>
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                            <div className="text-xl font-bold text-amber-800">
                              {shadowReport.taxonomyBreakdown.OVER_ESCALATION}
                            </div>
                            <div className="text-[11px] text-amber-600 font-medium">
                              Over-Escalations (Safe)
                            </div>
                          </div>
                          <div className={`p-3 rounded-lg border text-center ${shadowReport.gateStatus === "PASS" ? "bg-emerald-50 border-emerald-300" : "bg-rose-50 border-rose-300"}`}>
                            <div className={`text-xs font-bold uppercase mt-1 ${shadowReport.gateStatus === "PASS" ? "text-emerald-800" : "text-rose-800"}`}>
                              {shadowReport.gateStatus === "PASS" ? "Gate: PASS" : "Gate: BLOCKED"}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {shadowReport.gateStatus === "PASS" ? "Zero under-escalations" : "Unsafe draft detected"}
                            </div>
                          </div>
                        </div>

                        {/* Candidate vs Current Comparison */}
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold text-slate-700">Candidate vs. Current Spec:</span>{" "}
                            Agreement Delta:{" "}
                            <strong className={shadowReport.comparison.agreementDelta >= 0 ? "text-emerald-700" : "text-rose-700"}>
                              {shadowReport.comparison.agreementDelta >= 0 ? `+${shadowReport.comparison.agreementDelta}%` : `${shadowReport.comparison.agreementDelta}%`}
                            </strong>{" "}
                            (Candidate: {shadowReport.comparison.candidateAgreementRate}%, Current: {shadowReport.comparison.currentAgreementRate}%)
                          </div>
                          <button
                            onClick={handleRunShadow}
                            disabled={shadowMutation.isPending}
                            className="px-2.5 py-1 bg-slate-800 text-white rounded text-[11px]"
                          >
                            Re-run 300 Cases
                          </button>
                        </div>

                        {/* Unsafe Disagreements Alert (if any) */}
                        {shadowReport.unsafeDisagreements.length > 0 && (
                          <div className="border border-rose-300 bg-rose-50/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                              <ShieldAlert size={16} />
                              Unsafe Under-Escalations ({shadowReport.unsafeDisagreements.length}) — Blocking Candidate Spec
                            </div>
                            <div className="divide-y divide-rose-200 text-xs">
                              {shadowReport.unsafeDisagreements.map((u) => (
                                <div key={u.caseId} className="py-2 space-y-1">
                                  <div className="flex justify-between font-mono text-[11px]">
                                    <strong>{u.caseId} ({u.patientName})</strong>
                                    <span className="text-rose-700">Candidate: {u.candidateRoute} vs. Baseline: {u.baselineRoute}</span>
                                  </div>
                                  <p className="text-slate-600 text-[11px] italic">"{u.noteSnippet}"</p>
                                  <p className="text-slate-700 text-[10px]"><strong>Baseline Rationale:</strong> {u.rationale}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Disagreements List */}
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700 flex justify-between">
                            <span>All Disagreements ({shadowReport.disagreedCases})</span>
                            <span className="text-[11px] text-slate-500 font-normal">Candidate Route vs Baseline Reviewer Label</span>
                          </div>
                          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
                            {shadowReport.allDisagreements.length === 0 ? (
                              <div className="p-4 text-center text-emerald-700 font-medium">
                                ✓ Perfect 100% agreement with historical baseline labels.
                              </div>
                            ) : (
                              shadowReport.allDisagreements.map((d) => (
                                <div key={d.caseId} className="p-2.5 hover:bg-slate-50 flex items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-medium text-slate-800">{d.caseId}</span>
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                        d.taxonomy === "UNDER_ESCALATION" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                                      }`}>
                                        {d.taxonomy}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 italic">"{d.noteSnippet}"</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="text-[10px] font-mono text-slate-700">
                                      {d.candidateRoute}
                                    </div>
                                    <div className="text-[9px] text-slate-400">
                                      Baseline: {d.baselineRoute}
                                    </div>
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

                {/* TAB: Activation Ladder */}
                {activeTab === "ladder" && (
                  <ActivationLadderView
                    proposalId={currentProposal.id}
                    spec={currentProposal.proposedSpec}
                    onLadderUpdated={refetchProposals}
                  />
                )}

                {/* TAB: Evidence Pack */}
                {activeTab === "evidence" && (
                  <EvidencePackView
                    spec={currentProposal.proposedSpec}
                    traces={currentProposal.traces}
                  />
                )}

                {/* TAB: Replay & Bulk Diff */}
                {activeTab === "replay" && (
                  <ReplayView
                    currentSpec={currentProposal.proposedSpec}
                  />
                )}

                {/* TAB: Drift & Canary Dashboard */}
                {activeTab === "drift" && (
                  <DriftDashboardView
                    currentSpec={currentProposal.proposedSpec}
                    proposalId={currentProposal.id}
                  />
                )}

                {/* TAB: Cascade Routing & Dataset Export */}
                {activeTab === "cascade" && (
                  <ModelTierComparisonView />
                )}

                {/* TAB: Edit Spec JSON */}
                {activeTab === "edit" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Workflow Specification JSON (Declarative Rules & Templates):</span>
                      <button
                        onClick={handleSaveEdit}
                        className="px-3 py-1 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700"
                      >
                        Apply Edits & Re-Validate
                      </button>
                    </div>
                    <textarea
                      value={editedSpecJson}
                      onChange={(e) => setEditedSpecJson(e.target.value)}
                      className="w-full h-96 font-mono text-xs p-3 bg-slate-900 text-slate-100 rounded-lg border border-slate-700"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom Human Review & Action Bar */}
          {currentProposal && (
            <div className="p-3 bg-slate-50 border-t border-slate-200 rounded-b-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-teal-600" />
                  Human Review & Acceptance Step:
                </span>
                <span className="text-[11px] text-slate-400">
                  Simulated state only · Hash-chained audit event recorded
                </span>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Reviewer notes (optional)..."
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  className="flex-1 text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                />

                <button
                  onClick={handleAccept}
                  disabled={!currentProposal.validation.valid || decideMutation.isPending}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-40 transition-colors"
                >
                  Accept Spec Proposal
                </button>

                <button
                  onClick={handleReject}
                  disabled={decideMutation.isPending}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs disabled:opacity-40 transition-colors"
                >
                  Reject Proposal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

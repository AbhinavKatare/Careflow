import type { WorkflowSpec, RouteDecision } from "../../shared/domain/types";
import { defaultWorkflowSpec, evaluatePolicy } from "../../shared/policy";
import { appendChainedAuditEvent } from "../audit-chain";
import { getSqlite } from "../db";
import {
  generateSyntheticHistoricalCases,
  SYNTHETIC_BASELINE_DISCLAIMER,
} from "./historical-dataset";
import type {
  HistoricalCase,
  ShadowComparisonMetrics,
  ShadowDisagreement,
  ShadowDisagreementTaxonomy,
  ShadowRunReport,
} from "./types";

export interface RunShadowOptions {
  currentSpec?: WorkflowSpec;
  historicalCases?: HistoricalCase[];
  seed?: number;
  db?: any;
}

/**
 * Replays a synthetic 300-case historical dataset through a candidate WorkflowSpec.
 * PERMANENT AGENT RULES:
 * - Simulation only: Zero deliverables produced, zero messages or EHR writes.
 * - Under-escalation is strictly blocking: trips gate to FAIL_BLOCKED_BY_UNDER_ESCALATION.
 * - Computed metrics only: dynamically derived from the 300 evaluations.
 * - Stored in SQLite with hash-chained audit event.
 */
export function runShadowEvaluation(
  candidateSpec: WorkflowSpec,
  options: RunShadowOptions = {}
): ShadowRunReport {
  const currentSpec = options.currentSpec ?? defaultWorkflowSpec;
  const cases = options.historicalCases ?? generateSyntheticHistoricalCases(options.seed ?? 1337);
  const totalCases = cases.length;
  const runId = `shd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  let candidateAgreedCount = 0;
  let currentAgreedCount = 0;
  let candidateUnderEscalations = 0;
  let currentUnderEscalations = 0;
  let candidateOverEscalations = 0;
  let currentOverEscalations = 0;

  const taxonomyBreakdown: Record<ShadowDisagreementTaxonomy, number> = {
    UNDER_ESCALATION: 0,
    OVER_ESCALATION: 0,
    INPUT_ERROR_MISMATCH: 0,
    DRAFT_QUALITY: 0,
  };

  const unsafeDisagreements: ShadowDisagreement[] = [];
  const allDisagreements: ShadowDisagreement[] = [];

  for (const c of cases) {
    const rawInput = c.rawInput as Record<string, unknown>;
    const baselineRoute = c.baselineLabel.baselineRoute;

    // Evaluate against candidate spec
    const candidateEval = evaluatePolicy(rawInput, candidateSpec);
    const candidateRoute = candidateEval.route as RouteDecision;

    // Evaluate against current spec
    const currentEval = evaluatePolicy(rawInput, currentSpec);
    const currentRoute = currentEval.route as RouteDecision;

    // Track candidate agreement
    const candidateAgrees = candidateRoute === baselineRoute;
    if (candidateAgrees) {
      candidateAgreedCount++;
    }

    // Track current spec agreement
    const currentAgrees = currentRoute === baselineRoute;
    if (currentAgrees) {
      currentAgreedCount++;
    }

    // Check candidate under-escalation (Candidate drafted where baseline escalated)
    const isCandidateUnderEscalation =
      candidateRoute === "DRAFT_FOR_REVIEW" &&
      (baselineRoute === "HUMAN_REVIEW_REQUIRED" || baselineRoute === "INPUT_ERROR");

    if (isCandidateUnderEscalation) {
      candidateUnderEscalations++;
    }

    // Check current under-escalation
    if (
      currentRoute === "DRAFT_FOR_REVIEW" &&
      (baselineRoute === "HUMAN_REVIEW_REQUIRED" || baselineRoute === "INPUT_ERROR")
    ) {
      currentUnderEscalations++;
    }

    // Check over-escalation
    if (candidateRoute === "HUMAN_REVIEW_REQUIRED" && baselineRoute === "DRAFT_FOR_REVIEW") {
      candidateOverEscalations++;
    }
    if (currentRoute === "HUMAN_REVIEW_REQUIRED" && baselineRoute === "DRAFT_FOR_REVIEW") {
      currentOverEscalations++;
    }

    // Record disagreements if candidate route diverges from baseline
    if (!candidateAgrees) {
      let taxonomy: ShadowDisagreementTaxonomy;
      let unsafe = false;

      if (isCandidateUnderEscalation) {
        taxonomy = "UNDER_ESCALATION";
        unsafe = true;
        taxonomyBreakdown.UNDER_ESCALATION++;
      } else if (candidateRoute === "HUMAN_REVIEW_REQUIRED" && baselineRoute === "DRAFT_FOR_REVIEW") {
        taxonomy = "OVER_ESCALATION";
        taxonomyBreakdown.OVER_ESCALATION++;
      } else if (candidateRoute === "INPUT_ERROR" || baselineRoute === "INPUT_ERROR") {
        taxonomy = "INPUT_ERROR_MISMATCH";
        taxonomyBreakdown.INPUT_ERROR_MISMATCH++;
      } else {
        taxonomy = "DRAFT_QUALITY";
        taxonomyBreakdown.DRAFT_QUALITY++;
      }

      const noteText = typeof c.rawInput.note === "string" ? c.rawInput.note : "";
      const snippet = noteText.trim().length > 0 ? noteText.slice(0, 80) : `Status: ${c.rawInput.weekStatus || "N/A"}`;

      const disagreement: ShadowDisagreement = {
        caseId: c.caseId,
        patientName: c.patientName,
        noteSnippet: snippet,
        baselineRoute,
        candidateRoute,
        currentRoute,
        taxonomy,
        unsafe,
        rationale: c.baselineLabel.rationale,
        firedRules: candidateEval.firedRules.map((r) => r.id),
      };

      allDisagreements.push(disagreement);
      if (unsafe) {
        unsafeDisagreements.push(disagreement);
      }
    }
  }

  const candidateAgreementRate = Number(((candidateAgreedCount / totalCases) * 100).toFixed(1));
  const currentAgreementRate = Number(((currentAgreedCount / totalCases) * 100).toFixed(1));
  const agreementDelta = Number((candidateAgreementRate - currentAgreementRate).toFixed(1));

  const comparison: ShadowComparisonMetrics = {
    candidateAgreementRate,
    currentAgreementRate,
    agreementDelta,
    candidateUnderEscalations,
    currentUnderEscalations,
    candidateOverEscalations,
    currentOverEscalations,
  };

  // Gate check: Any under-escalation trips the safety gate to FAIL
  let gateStatus: "PASS" | "FAIL_BLOCKED_BY_UNDER_ESCALATION" = "PASS";
  let gateFailureReason: string | undefined;

  if (unsafeDisagreements.length > 0) {
    gateStatus = "FAIL_BLOCKED_BY_UNDER_ESCALATION";
    gateFailureReason = `SAFETY GATE TRIPPED: Candidate spec produced ${unsafeDisagreements.length} under-escalation(s) where human review was required by baseline. Cannot go live.`;
  }

  const report: ShadowRunReport = {
    id: runId,
    candidateSpecId: (candidateSpec as any).spec_id || candidateSpec.spec_version,
    candidateSpecVersion: candidateSpec.spec_version,
    currentSpecId: (currentSpec as any).spec_id || currentSpec.spec_version,
    currentSpecVersion: currentSpec.spec_version,
    totalCases,
    agreedCases: candidateAgreedCount,
    disagreedCases: totalCases - candidateAgreedCount,
    agreementRate: candidateAgreementRate,
    taxonomyBreakdown,
    unsafeDisagreements,
    allDisagreements,
    comparison,
    gateStatus,
    gateFailureReason,
    disclaimer: SYNTHETIC_BASELINE_DISCLAIMER,
    executedAt: now,
  };

  // Persist audit trail
  try {
    const sqlite = options.db || getSqlite();
    appendChainedAuditEvent(sqlite, {
      entityType: "WorkflowSpec",
      entityId: report.candidateSpecId,
      actor: "SYSTEM",
      action: `Shadow run ${gateStatus === "PASS" ? "pass" : "blocked"} · simulated`,
      detail: `Replayed ${totalCases} synthetic historical cases through candidate spec. Agreement: ${candidateAgreementRate}% (Current: ${currentAgreementRate}%). Under-escalations: ${unsafeDisagreements.length}. Gate: ${gateStatus}. Simulated, nothing sent externally.`,
      at: now,
      metadata: {
        candidateAgreementRate,
        unsafeDisagreementsCount: unsafeDisagreements.length,
        gateStatus,
      },
    });
  } catch {
    // Ignore in pure test environments
  }

  return report;
}


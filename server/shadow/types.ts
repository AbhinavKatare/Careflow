import type { RouteDecision } from "../../shared/domain/types";

export type ShadowDisagreementTaxonomy =
  | "UNDER_ESCALATION" // Candidate drafted where baseline escalated (CRITICAL / BLOCKING)
  | "OVER_ESCALATION"  // Candidate escalated where baseline drafted (conservative, safe)
  | "INPUT_ERROR_MISMATCH" // Candidate vs baseline difference on input boundary / formatting
  | "DRAFT_QUALITY";   // Draft content or template divergence

export interface HistoricalCase {
  caseId: string;
  patientId: string;
  patientName: string;
  program: string;
  submittedAt: string;
  rawInput: {
    patientId: string;
    patientName: string;
    weekStatus?: string;
    recoveryProgress?: string;
    routineSchedule?: string;
    followUp?: "yes" | "no";
    staffContact?: "yes" | "no";
    coordinatorQuestions?: "yes" | "no";
    note?: string;
    [key: string]: unknown;
  };
  baselineLabel: {
    reviewerId: string;
    baselineRoute: RouteDecision;
    baselineDraft?: string;
    rationale: string;
    category: string;
  };
}

export interface ShadowDisagreement {
  caseId: string;
  patientName: string;
  noteSnippet: string;
  baselineRoute: RouteDecision;
  candidateRoute: RouteDecision;
  currentRoute: RouteDecision;
  taxonomy: ShadowDisagreementTaxonomy;
  unsafe: boolean;
  rationale: string;
  firedRules: string[];
}

export interface ShadowComparisonMetrics {
  candidateAgreementRate: number;
  currentAgreementRate: number;
  agreementDelta: number; // candidate - current
  candidateUnderEscalations: number;
  currentUnderEscalations: number;
  candidateOverEscalations: number;
  currentOverEscalations: number;
}

export interface ShadowRunReport {
  id: string;
  candidateSpecId: string;
  candidateSpecVersion: string;
  currentSpecId: string;
  currentSpecVersion: string;
  totalCases: number; // 300
  agreedCases: number;
  disagreedCases: number;
  agreementRate: number;
  taxonomyBreakdown: Record<ShadowDisagreementTaxonomy, number>;
  unsafeDisagreements: ShadowDisagreement[];
  allDisagreements: ShadowDisagreement[];
  comparison: ShadowComparisonMetrics;
  gateStatus: "PASS" | "FAIL_BLOCKED_BY_UNDER_ESCALATION";
  gateFailureReason?: string;
  disclaimer: string;
  executedAt: string;
}


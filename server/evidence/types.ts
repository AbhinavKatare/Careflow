/**
 * Evidence Pack Type Definitions.
 * Comprehensive audit artifact containing all safety, verification, and traceability records for a WorkflowSpec.
 * PERMANENT RULE: Pure deterministic TypeScript; zero external side effects.
 */

import type { WorkflowSpec } from "../../shared/domain/types";
import type { SOPTrace } from "../compiler/types";

export interface EvidencePackData {
  spec: WorkflowSpec;
  contentHash: string;
  sopTraceability: SOPTrace[];
  evaluationResults: {
    totalCases: number;
    passedCases: number;
    criticalMisses: number;
    routeAccuracy: number;
    reviewRequiredRecall: number;
    routineSpecificity: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    safetyGate: "PASS" | "FAIL";
  };
  coverageReport: {
    totalRules: number;
    exercisedRulesCount: number;
    ruleCoveragePercent: number;
    unexercisedRules: string[];
  };
  mutationReport: {
    totalMutants: number;
    killedMutants: number;
    survivingMutants: number;
    mutationScore: number;
    severityLoweringSurvivingCount: number;
    gateStatus: "PASS" | "FAIL";
  };
  shadowReport: {
    totalCases: number;
    agreementRate: number;
    unsafeDisagreementsCount: number;
    taxonomyBreakdown: Record<string, number>;
    gateStatus: "PASS" | "FAIL_BLOCKED_BY_UNDER_ESCALATION";
  };
  knownLimitations: string[];
  plainLanguageSummary: string;
  auditChainVerification: {
    valid: boolean;
    totalEvents: number;
    lastEventHash?: string;
  };
  generatedAt: string;
}

export interface EvidencePack extends EvidencePackData {
  packContentHash: string;
}

export interface EvidencePackExport {
  pack: EvidencePack;
  json: string;
  markdown: string;
  packContentHash: string;
  specHash: string;
  generatedAt: string;
}

export interface EvidencePackVerificationResult {
  valid: boolean;
  packContentHashMatch: boolean;
  specHashMatch: boolean;
  auditChainValid: boolean;
  errors: string[];
}

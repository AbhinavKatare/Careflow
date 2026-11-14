import type { WorkflowSpec } from "../../shared/domain/types";

/**
 * Line-level traceability record connecting an SOP sentence to a compiled rule.
 */
export interface SOPTrace {
  ruleId: string;
  sopSentenceNumber: number;
  sopSentenceText: string;
  section: string;
  rationale: string;
}

/**
 * Individual check result from the deterministic WorkflowSpec validator.
 */
export interface ValidatorCheck {
  name: string;
  category: "schema" | "syntax" | "safety_rules" | "concerning_route" | "limits";
  passed: boolean;
  detail: string;
}

/**
 * Complete deterministic validation result for a proposed WorkflowSpec.
 */
export interface ProposalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: ValidatorCheck[];
  validatedAt: string;
}

/**
 * A non-binding WorkflowSpec compilation proposal proposed by LLM / adapter.
 * PERMANENT RULE: A proposal never becomes active by itself; human acceptance is required.
 */
export interface CompilationProposal {
  id: string;
  sopName: string;
  sopMarkdown: string;
  proposedSpec: WorkflowSpec;
  traces: SOPTrace[];
  validation: ProposalValidationResult;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "EDITED";
  reviewerNotes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Single synthetic generated evaluation fixture with provenance and independently computed route.
 * PERMANENT RULE: No outcome-encoding flags inside rawInput.
 */
export interface GeneratedFixture {
  id: string;
  rawInput: {
    patientId: string;
    patientName?: string;
    weekStatus?: string;
    recoveryProgress?: string;
    routineSchedule?: string;
    followUp?: "yes" | "no";
    staffContact?: "yes" | "no";
    coordinatorQuestions?: "yes" | "no";
    note?: string;
    additionalNotes?: string;
    adherenceNote?: string;
    [key: string]: unknown;
  };
  provenance: {
    ruleId: string;
    templateKey: string;
    description: string;
  };
  expected_route: "DRAFT_FOR_REVIEW" | "HUMAN_REVIEW_REQUIRED" | "INPUT_ERROR";
  tags: string[];
  rationale: string;
}

/**
 * Rule and branch coverage report for a generated fixture suite.
 */
export interface CoverageReport {
  totalRules: number;
  coveredRuleIds: string[];
  uncoveredRuleIds: string[];
  coveragePercentage: number;
  categoryBreakdown: {
    positiveCases: number;
    boundaryCases: number;
    negationVariants: number;
    normalizationAttacks: number;
    contradictionPairs: number;
    promptInjections: number;
  };
  ruleBreakdown: {
    ruleId: string;
    description: string;
    route: "DRAFT_FOR_REVIEW" | "HUMAN_REVIEW_REQUIRED" | "INPUT_ERROR";
    fixtureCount: number;
    exercised: boolean;
  }[];
}

/**
 * Reproducible generated fixture suite output.
 */
export interface GeneratedFixtureSuite {
  specVersion: string;
  seed: number;
  generatedAt: string;
  fixtureCount: number;
  fixtures: GeneratedFixture[];
  coverage: CoverageReport;
  contentHash: string;
}


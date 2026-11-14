import type { WorkflowSpec } from "../../shared/domain/types";
import type { PolicyEvaluationOptions } from "../../shared/policy";

export type MutationOperator =
  | "DELETE_RULE"
  | "FLIP_ROUTE"
  | "WIDEN_THRESHOLD"
  | "NARROW_THRESHOLD"
  | "DROP_NORMALIZATION"
  | "REORDER_RULES"
  | "WEAKEN_INSTRUCTION_TEXT";

export interface Mutant {
  id: string;
  operator: MutationOperator;
  description: string;
  diff: string;
  targetRuleId?: string;
  lowersSeverity: boolean;
  mutatedSpec: WorkflowSpec;
  evaluatorConfig?: PolicyEvaluationOptions;
}

export interface MutantResult {
  mutant: Mutant;
  killed: boolean;
  killerFixtureId?: string;
  killerFixtureSnippet?: string;
  baselineRoute?: string;
  mutantRoute?: string;
  survivedReason?: string;
}

export interface MutationSuiteReport {
  id: string;
  specId: string;
  specVersion: string;
  totalMutants: number;
  killedMutants: number;
  survivingMutants: number;
  mutationScore: number; // percentage (0 - 100)
  threshold: number; // configured threshold (e.g. 80)
  scorePassed: boolean;
  severityLoweringSurvivingCount: number;
  gateStatus: "PASS" | "FAIL";
  gateFailureReason?: string;
  survivingMutantsList: MutantResult[];
  categoryBreakdown: Record<
    MutationOperator,
    { total: number; killed: number; survived: number }
  >;
  executedAt: string;
}

export interface MutationGateConfig {
  minimumScoreThreshold?: number; // default 80%
  blockOnSeverityLoweringMutant?: boolean; // default true
}


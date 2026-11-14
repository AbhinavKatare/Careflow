/**
 * Pure Declarative Policy Engine Types.
 *
 * PERMANENT RULES:
 * - Deterministic TypeScript evaluation only.
 * - Zero LLM imports.
 * - Zero eval() or dynamic code execution.
 * - All rules are illustrative demo logic, not clinical criteria.
 */

export type PolicyRoute = "DRAFT_FOR_REVIEW" | "HUMAN_REVIEW_REQUIRED" | "INPUT_ERROR";

export interface MissingFieldCondition {
  missing_field: string;
}

export interface FieldEqualsCondition {
  field_equals: {
    field: string;
    value: string | boolean | number;
    ignore_case?: boolean;
  };
}

export interface LengthLimitCondition {
  length_limit: {
    field: string;
    max: number;
  };
}

export interface PhraseMatchCondition {
  phrase_match: {
    field: string;
    phrases: string[];
    match_mode?: "any" | "all";
  };
}

export interface KeywordMatchCondition {
  keyword_match: {
    field: string;
    keywords: string[];
    match_mode?: "any" | "all";
  };
}

export interface RegexMatchCondition {
  regex_match: {
    field: string;
    pattern: string;
    flags?: string;
  };
}

export interface ContradictionCondition {
  contradiction: {
    structured_field: string;
    structured_matches: string[];
    text_field: string;
    text_keywords: string[];
  };
}

export interface InstructionLikeTextCondition {
  instruction_like_text: {
    field: string;
  };
}

export interface AnyCondition {
  any: PolicyCondition[];
}

export interface AllCondition {
  all: PolicyCondition[];
}

export interface NotCondition {
  not: PolicyCondition;
}

export type PolicyCondition =
  | MissingFieldCondition
  | FieldEqualsCondition
  | LengthLimitCondition
  | PhraseMatchCondition
  | KeywordMatchCondition
  | RegexMatchCondition
  | ContradictionCondition
  | InstructionLikeTextCondition
  | AnyCondition
  | AllCondition
  | NotCondition
  | Record<string, unknown>
  | string;

export interface PolicyRule {
  id: string;
  description: string;
  route: PolicyRoute;
  reason_code: string;
  condition: PolicyCondition;
}

export interface PolicyRuleSet {
  version: string;
  disclaimer: string;
  rules: PolicyRule[];
}

export interface FiredRuleInfo {
  id: string;
  description: string;
  route: PolicyRoute;
  reason_code: string;
}

export interface PolicyEvaluationResult {
  route: PolicyRoute;
  firedRules: FiredRuleInfo[];
  inputsUsed: Record<string, unknown>;
  version: string;
  finalRoute: PolicyRoute;
  primaryReason: string;
  ruleVersion: string;
  latencyMs: number;
}

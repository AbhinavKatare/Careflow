/**
 * Pure Declarative Policy Engine.
 *
 * PERMANENT RULES:
 * - Pure TypeScript module taking ONLY (submission, spec).
 * - Zero LLM imports.
 * - Zero dynamic eval() or new Function().
 * - Zero Node/React imports.
 * - Safe text normalization against zero-width chars and homoglyphs.
 * - Most-restrictive route wins (INPUT_ERROR > HUMAN_REVIEW_REQUIRED > DRAFT_FOR_REVIEW).
 * - Unknown or ambiguous inputs strictly default to HUMAN_REVIEW_REQUIRED.
 * - Instruction-like text can never lower a route severity.
 * - All rules are illustrative demo logic, not clinical criteria.
 */

import type { WorkflowSpec } from "../domain/types";
import { defaultWorkflowSpec } from "./default-spec";
import type {
  ContradictionCondition,
  FieldEqualsCondition,
  FiredRuleInfo,
  InstructionLikeTextCondition,
  KeywordMatchCondition,
  LengthLimitCondition,
  MissingFieldCondition,
  PhraseMatchCondition,
  PolicyEvaluationResult,
  PolicyRoute,
  PolicyRule,
  PolicyRuleSet,
  RegexMatchCondition,
} from "./types";

export const ROUTE_PRECEDENCE: Record<PolicyRoute, number> = {
  INPUT_ERROR: 3,
  HUMAN_REVIEW_REQUIRED: 2,
  DRAFT_FOR_REVIEW: 1,
};

export interface NormalizationOptions {
  disableZeroWidthStripping?: boolean;
  disableHomoglyphs?: boolean;
  caseSensitive?: boolean;
}

export interface PolicyEvaluationOptions extends NormalizationOptions {
  disableInstructionDetector?: boolean;
}

const homoglyphs: Record<string, string> = {
  // Cyrillic lowercase
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  к: "k",
  м: "m",
  н: "n",
  в: "v",
  ы: "y",
  // Cyrillic uppercase
  А: "a",
  В: "b",
  Е: "e",
  К: "k",
  М: "m",
  Н: "h",
  О: "o",
  Р: "p",
  С: "c",
  Т: "t",
  У: "y",
  Х: "x",
  // Greek lowercase & uppercase
  ο: "o",
  α: "a",
  ρ: "p",
  ν: "v",
  ι: "i",
  κ: "k",
  τ: "t",
  Ο: "o",
  Α: "a",
  Ρ: "p",
  Ν: "v",
  Ι: "i",
  Κ: "k",
  Τ: "t",
};

/**
 * Normalizes text for robust deterministic policy matching:
 * 1. Strips zero-width & invisible evasion characters (\u200B-\u200F, \uFEFF, \u00AD, \u2060).
 * 2. Maps fullwidth ASCII (\uFF01-\uFF5E) to standard ASCII.
 * 3. Maps Cyrillic and Greek homoglyphs to Latin equivalents.
 * 4. Lowercases and collapses multiple whitespaces into a single space.
 */
export function normalizeText(text: string, options?: NormalizationOptions): string {
  if (!text) return "";
  let s = text;

  // 1. Strip zero-width and invisible characters
  if (!options?.disableZeroWidthStripping) {
    s = s.replace(/[\u200B-\u200F\uFEFF\u00AD\u2060]/g, "");
  }

  // 2. Map fullwidth Latin/ASCII to standard ASCII
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );

  // 3. Map Cyrillic and Greek homoglyphs to Latin equivalents
  if (!options?.disableHomoglyphs) {
    s = s.replace(/[\u0400-\u04FF\u0370-\u03FF]/g, (ch) => homoglyphs[ch] ?? ch);
  }

  // 4. Lowercase and collapse multiple whitespace
  if (!options?.caseSensitive) {
    s = s.toLowerCase();
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Escapes characters with special meaning in RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolves a field from a submission, checking standard aliases and structured answers.
 */
export function getSubmissionField(submission: Record<string, unknown>, field: string): unknown {
  if (field in submission && submission[field] !== undefined) {
    return submission[field];
  }
  if (field === "note" || field === "rawText") {
    return submission.note ?? submission.rawText;
  }
  if (field === "weekStatus" || field === "statusSelection") {
    return submission.weekStatus ?? submission.statusSelection;
  }
  if (field === "followUp" || field === "followUpRequested") {
    if (submission.followUp !== undefined) return submission.followUp;
    if (submission.followUpRequested === true) return "yes";
    if (submission.followUpRequested === false) return "no";
  }
  if (submission.structuredAnswers && typeof submission.structuredAnswers === "object") {
    const answers = submission.structuredAnswers as Record<string, unknown>;
    if (field in answers) {
      return answers[field];
    }
  }
  return undefined;
}

function evaluateMissingField(
  cond: MissingFieldCondition,
  submission: Record<string, unknown>
): boolean {
  const val = getSubmissionField(submission, cond.missing_field);
  if (val === undefined || val === null) {
    return true;
  }
  if (typeof val === "string") {
    return val.trim().length === 0;
  }
  return false;
}

function evaluateFieldEquals(
  cond: FieldEqualsCondition,
  submission: Record<string, unknown>
): boolean {
  const val = getSubmissionField(submission, cond.field_equals.field);
  if (val === undefined || val === null) {
    return false;
  }
  const expected = cond.field_equals.value;
  const ignoreCase = cond.field_equals.ignore_case ?? true;

  if (ignoreCase && typeof val === "string" && typeof expected === "string") {
    return normalizeText(val) === normalizeText(expected);
  }
  return val === expected;
}

function evaluateLengthLimit(
  cond: LengthLimitCondition,
  submission: Record<string, unknown>
): boolean {
  const val = getSubmissionField(submission, cond.length_limit.field);
  if (typeof val !== "string") {
    return false;
  }
  return val.length > cond.length_limit.max;
}

function evaluatePhraseMatch(
  cond: PhraseMatchCondition | KeywordMatchCondition,
  submission: Record<string, unknown>,
  options?: PolicyEvaluationOptions
): boolean {
  const targetField = "phrase_match" in cond ? cond.phrase_match.field : cond.keyword_match.field;
  const rawPhrases = "phrase_match" in cond ? cond.phrase_match.phrases : cond.keyword_match.keywords;
  const matchMode = "phrase_match" in cond ? cond.phrase_match.match_mode : cond.keyword_match.match_mode;

  const rawVal = getSubmissionField(submission, targetField);
  if (typeof rawVal !== "string" || rawVal.trim().length === 0) {
    return false;
  }

  const normalizedText = normalizeText(rawVal, options);
  const normalizedPhrases = rawPhrases.map((p) => normalizeText(p, options)).filter(Boolean);

  const checkPhrase = (phrase: string): boolean => {
    // 1. Direct normalized substring
    if (normalizedText.includes(phrase)) {
      return true;
    }
    // 2. Multi-word phrase regex to catch word-boundary / whitespace variations (e.g. "chestpain")
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      const pattern = words.map(escapeRegex).join("[\\s\\W_]*");
      try {
        const re = new RegExp(pattern, options?.caseSensitive ? "" : "i");
        if (re.test(normalizedText)) {
          return true;
        }
      } catch {
        // Fallback
      }
    }
    return false;
  };

  if (matchMode === "all") {
    return normalizedPhrases.every(checkPhrase);
  }
  return normalizedPhrases.some(checkPhrase);
}

function evaluateRegexMatch(
  cond: RegexMatchCondition,
  submission: Record<string, unknown>,
  options?: PolicyEvaluationOptions
): boolean {
  const rawVal = getSubmissionField(submission, cond.regex_match.field);
  if (typeof rawVal !== "string") {
    return false;
  }
  const normalizedText = normalizeText(rawVal, options);
  try {
    const flags = options?.caseSensitive
      ? (cond.regex_match.flags ?? "i").replace(/i/g, "")
      : (cond.regex_match.flags ?? "i");
    const re = new RegExp(cond.regex_match.pattern, flags);
    return re.test(normalizedText) || re.test(rawVal);
  } catch {
    return false;
  }
}

function evaluateContradiction(
  cond: ContradictionCondition,
  submission: Record<string, unknown>,
  options?: PolicyEvaluationOptions
): boolean {
  const structuredVal = getSubmissionField(submission, cond.contradiction.structured_field);
  const textVal = getSubmissionField(submission, cond.contradiction.text_field);

  if (typeof structuredVal !== "string" || typeof textVal !== "string") {
    return false;
  }

  const structNorm = normalizeText(structuredVal, options);
  const textNorm = normalizeText(textVal, options);

  const structMatches = cond.contradiction.structured_matches.map((s) => normalizeText(s, options));
  const textKeywords = cond.contradiction.text_keywords.map((k) => normalizeText(k, options));

  const structuredMatchesCondition = structMatches.some((m) => structNorm.includes(m));
  const textContainsContradiction = textKeywords.some((k) => textNorm.includes(k));

  return structuredMatchesCondition && textContainsContradiction;
}

const INSTRUCTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|safety|system)\s+(instructions|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above|the)\s+(instructions|rules|system)/i,
  /you\s+are\s+now\s+(a|an)?/i,
  /new\s+role\s*:/i,
  /system\s+prompt/i,
  /system\s+override/i,
  /override\s+(the\s+)?(rules|policy|system|guardrails|safety)/i,
  /jailbreak/i,
  /dan\s+mode/i,
  /developer\s+mode/i,
  /admin\s+mode/i,
  /<script[\s>]/i,
  /javascript\s*:/i,
  /drop\s+table/i,
  /select\s+.*\s+from/i,
  /do\s+not\s+follow/i,
  /bypass\s+(the\s+)?(safety|filter|rules|policy)/i,
  /\[system\]/i,
  /\[instruction\]/i,
  /role-play\s+as/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+an?\s+unrestricted/i,
  /forget\s+(all\s+)?everything/i,
];

function evaluateInstructionLikeText(
  cond: InstructionLikeTextCondition,
  submission: Record<string, unknown>,
  options?: PolicyEvaluationOptions
): boolean {
  if (options?.disableInstructionDetector) {
    return false;
  }
  const rawVal = getSubmissionField(submission, cond.instruction_like_text.field);
  if (typeof rawVal !== "string" || rawVal.trim().length === 0) {
    return false;
  }
  const normalizedText = normalizeText(rawVal, options);
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(normalizedText) || pattern.test(rawVal));
}

/**
 * Safe deterministic condition evaluator.
 * Absolutely zero eval() or dynamic code execution.
 */
export function evaluateCondition(
  cond: unknown,
  submission: Record<string, unknown>,
  options?: PolicyEvaluationOptions
): boolean {
  if (!cond) return false;

  if (typeof cond === "string") {
    const trimmed = cond.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        return evaluateCondition(parsed, submission, options);
      } catch {
        return false;
      }
    }
    const eqMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*==\s*['"](.*)['"]$/);
    if (eqMatch) {
      const [, field, expected] = eqMatch;
      const val = getSubmissionField(submission, field);
      return typeof val === "string" && normalizeText(val, options) === normalizeText(expected, options);
    }
    return false;
  }

  if (typeof cond !== "object") return false;
  const c = cond as Record<string, unknown>;

  if ("missing_field" in c) {
    return evaluateMissingField(c as unknown as MissingFieldCondition, submission);
  }
  if ("field_equals" in c) {
    return evaluateFieldEquals(c as unknown as FieldEqualsCondition, submission);
  }
  if ("length_limit" in c) {
    return evaluateLengthLimit(c as unknown as LengthLimitCondition, submission);
  }
  if ("phrase_match" in c || "keyword_match" in c) {
    return evaluatePhraseMatch(c as unknown as PhraseMatchCondition, submission, options);
  }
  if ("regex_match" in c) {
    return evaluateRegexMatch(c as unknown as RegexMatchCondition, submission, options);
  }
  if ("contradiction" in c) {
    return evaluateContradiction(c as unknown as ContradictionCondition, submission, options);
  }
  if ("instruction_like_text" in c) {
    return evaluateInstructionLikeText(c as unknown as InstructionLikeTextCondition, submission, options);
  }
  if ("any" in c && Array.isArray(c.any)) {
    return c.any.some((sub) => evaluateCondition(sub, submission, options));
  }
  if ("all" in c && Array.isArray(c.all)) {
    return c.all.every((sub) => evaluateCondition(sub, submission, options));
  }
  if ("not" in c) {
    return !evaluateCondition(c.not, submission, options);
  }

  return false;
}

/**
 * Evaluates a submission against a WorkflowSpec or PolicyRuleSet.
 * Pure module taking ONLY (submission, spec).
 */
export function evaluatePolicy(
  submission: Record<string, unknown>,
  spec: WorkflowSpec | PolicyRuleSet = defaultWorkflowSpec,
  options?: PolicyEvaluationOptions
): PolicyEvaluationResult {
  const startTime = performance.now();

  const inputsUsed: Record<string, unknown> = {
    patientId: getSubmissionField(submission, "patientId") ?? null,
    patientName: getSubmissionField(submission, "patientName") ?? null,
    weekStatus: getSubmissionField(submission, "weekStatus") ?? null,
    followUp: getSubmissionField(submission, "followUp") ?? null,
    note: getSubmissionField(submission, "note") ?? null,
  };

  const firedRules: FiredRuleInfo[] = [];

  // Determine whether spec is a WorkflowSpec or legacy PolicyRuleSet
  const isWorkflowSpec = "rule_list" in spec;
  const rules: PolicyRule[] = isWorkflowSpec
    ? (spec.rule_list as unknown as PolicyRule[])
    : (spec as PolicyRuleSet).rules;

  const version = isWorkflowSpec
    ? (spec as WorkflowSpec).spec_version || (spec as WorkflowSpec).content_hash
    : (spec as PolicyRuleSet).version;

  for (const rule of rules) {
    if (evaluateCondition(rule.condition, submission, options)) {
      firedRules.push({
        id: rule.id,
        description: rule.description,
        route: rule.route,
        reason_code: rule.reason_code,
      });
    }
  }

  let finalRoute: PolicyRoute;
  let primaryReason: string;

  if (firedRules.length === 0) {
    // Fail-safe default: unknown or ambiguous inputs strictly default to HUMAN_REVIEW_REQUIRED
    finalRoute = "HUMAN_REVIEW_REQUIRED";
    primaryReason = "DEFAULT_AMBIGUOUS_INPUT_REQUIRES_HUMAN_REVIEW";
    firedRules.push({
      id: "DEFAULT_AMBIGUOUS_INPUT",
      description: "Unknown or ambiguous input defaults to human review (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED",
      reason_code: primaryReason,
    });
  } else {
    // Sort fired rules by precedence (highest severity / most restrictive first)
    const sorted = [...firedRules].sort(
      (a, b) => ROUTE_PRECEDENCE[b.route] - ROUTE_PRECEDENCE[a.route]
    );
    const winningRule = sorted[0];
    finalRoute = winningRule.route;
    primaryReason = winningRule.reason_code;
  }

  const endTime = performance.now();
  const latencyMs = Number((endTime - startTime).toFixed(4));

  return {
    route: finalRoute,
    firedRules,
    inputsUsed,
    version,
    finalRoute,
    primaryReason,
    ruleVersion: version,
    latencyMs,
  };
}

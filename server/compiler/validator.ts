import { WorkflowSpecSchema, type WorkflowSpec } from "../../shared/domain/types";
import { computeWorkflowSpecHash } from "../../shared/domain/workflow-spec";
import type { ProposalValidationResult, ValidatorCheck } from "./types";

/**
 * Concerning keywords that must NEVER be routed to automated draft preparation.
 * Routing any of these to DRAFT_FOR_REVIEW constitutes a critical safety gate violation.
 */
const CONCERNING_KEYWORDS = [
  "chest pain",
  "shortness of breath",
  "emergency",
  "urgent",
  "critical",
  "severe",
  "bleeding",
  "allergic reaction",
  "difficulty breathing",
  "fainting",
  "suicide",
  "harm",
  "worsening",
  "infection",
  "fever",
  "extreme pain",
  "antibiotics",
  "prescribe",
  "prescription",
  "diagnose",
  "diagnosis",
  "ignore previous instructions",
  "system prompt",
  "prompt injection",
];

/**
 * Patterns and constructs considered unsafe in declarative rules.
 */
const UNSAFE_CONSTRUCT_PATTERNS = [
  /eval\s*\(/i,
  /Function\s*\(/i,
  /process\./i,
  /<script/i,
  /require\s*\(/i,
  /import\s*\(/i,
  /__proto__/i,
  /constructor/i,
];

/**
 * Recursively extracts all string values and phrases from a rule condition tree.
 */
function extractConditionPhrases(condition: unknown): string[] {
  if (!condition || typeof condition !== "object") {
    return [];
  }

  const phrases: string[] = [];
  const rec = condition as Record<string, unknown>;

  if (Array.isArray(rec.phrases)) {
    phrases.push(...rec.phrases.filter((p): p is string => typeof p === "string"));
  }
  if (typeof rec.value === "string") {
    phrases.push(rec.value);
  }
  if (Array.isArray(rec.structured_matches)) {
    phrases.push(...rec.structured_matches.filter((p): p is string => typeof p === "string"));
  }
  if (Array.isArray(rec.text_keywords)) {
    phrases.push(...rec.text_keywords.filter((p): p is string => typeof p === "string"));
  }
  if (Array.isArray(rec.all)) {
    for (const child of rec.all) {
      phrases.push(...extractConditionPhrases(child));
    }
  }
  if (Array.isArray(rec.any)) {
    for (const child of rec.any) {
      phrases.push(...extractConditionPhrases(child));
    }
  }
  if (rec.not) {
    phrases.push(...extractConditionPhrases(rec.not));
  }
  if (rec.field_equals && typeof rec.field_equals === "object") {
    phrases.push(...extractConditionPhrases(rec.field_equals));
  }
  if (rec.phrase_match && typeof rec.phrase_match === "object") {
    phrases.push(...extractConditionPhrases(rec.phrase_match));
  }
  if (rec.contradiction && typeof rec.contradiction === "object") {
    phrases.push(...extractConditionPhrases(rec.contradiction));
  }
  if (rec.length_limit && typeof rec.length_limit === "object") {
    phrases.push(...extractConditionPhrases(rec.length_limit));
  }

  return phrases;
}

/**
 * Deterministically validates a proposed WorkflowSpec against schema, syntax, safety, and guardrail requirements.
 * PERMANENT RULE: Deterministic TypeScript verification — never delegates safety to LLMs.
 */
export function validateWorkflowSpecProposal(rawSpec: unknown): ProposalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: ValidatorCheck[] = [];

  // ==========================================
  // CHECK 1: Schema & Zod Conformance
  // ==========================================
  const parsed = WorkflowSpecSchema.safeParse(rawSpec);
  let spec: WorkflowSpec;
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    errors.push(`WorkflowSpec schema validation failed: ${formatted}`);
    checks.push({
      name: "schema_conformance",
      category: "schema",
      passed: false,
      detail: `Schema violations: ${formatted}`,
    });

    // Construct a fallback spec object so subsequent checks can inspect rules, limits, and unsafe constructs
    const raw = (rawSpec || {}) as Record<string, unknown>;
    spec = {
      spec_version: String(raw.spec_version || "unknown"),
      parent_version: (raw.parent_version as string | null) || null,
      content_hash: String(raw.content_hash || ""),
      questionnaire_fields: Array.isArray(raw.questionnaire_fields) ? raw.questionnaire_fields : [],
      rule_list: Array.isArray(raw.rule_list) ? raw.rule_list : [],
      draft_templates: Array.isArray(raw.draft_templates) ? raw.draft_templates : [],
      limits: (raw.limits as any) || { max_note_length: -1, max_daily_submissions: -1, timeout_ms: -1 },
      reviewer_roles: Array.isArray(raw.reviewer_roles) ? raw.reviewer_roles : [],
    };
  } else {
    spec = parsed.data;
    checks.push({
      name: "schema_conformance",
      category: "schema",
      passed: true,
      detail: `Valid WorkflowSpec v${spec.spec_version} with ${spec.rule_list.length} rules, ${spec.questionnaire_fields.length} fields.`,
    });
  }

  // ==========================================
  // CHECK 2: Content Hash Stability
  // ==========================================
  const expectedHash = computeWorkflowSpecHash(spec);
  if (spec.content_hash !== expectedHash) {
    errors.push(
      `Content hash mismatch: specified "${spec.content_hash}" does not match canonical hash "${expectedHash}".`
    );
    checks.push({
      name: "content_hash_integrity",
      category: "schema",
      passed: false,
      detail: `Expected ${expectedHash}, got ${spec.content_hash}`,
    });
  } else {
    checks.push({
      name: "content_hash_integrity",
      category: "schema",
      passed: true,
      detail: `Canonical content hash verified: ${expectedHash.slice(0, 18)}...`,
    });
  }

  // ==========================================
  // CHECK 3: Rule Syntax & Structure
  // ==========================================
  let syntaxPassed = true;
  for (const rule of spec.rule_list) {
    if (!rule.id || !rule.id.startsWith("RULE_")) {
      errors.push(`Rule "${rule.id}" must follow naming convention starting with RULE_.`);
      syntaxPassed = false;
    }
    if (!rule.reason_code || rule.reason_code.trim().length === 0) {
      errors.push(`Rule "${rule.id}" is missing required reason_code.`);
      syntaxPassed = false;
    }
    if (!rule.condition || typeof rule.condition !== "object") {
      errors.push(`Rule "${rule.id}" condition must be a non-empty object.`);
      syntaxPassed = false;
    }
  }

  checks.push({
    name: "rule_syntax",
    category: "syntax",
    passed: syntaxPassed,
    detail: syntaxPassed
      ? `All ${spec.rule_list.length} rules exhibit valid condition syntax and reason codes.`
      : "Rule syntax or reason code errors identified.",
  });

  // ==========================================
  // CHECK 4: No Unsafe Constructs
  // ==========================================
  let unsafeFound = false;
  const specJson = JSON.stringify(spec);
  for (const pattern of UNSAFE_CONSTRUCT_PATTERNS) {
    if (pattern.test(specJson)) {
      errors.push(`Prohibited unsafe construct detected matching pattern: ${pattern.toString()}`);
      unsafeFound = true;
    }
  }

  checks.push({
    name: "no_unsafe_constructs",
    category: "safety_rules",
    passed: !unsafeFound,
    detail: !unsafeFound
      ? "Zero unsafe code execution patterns, eval, or script injection constructs found."
      : "Unsafe construct detected in specification.",
  });

  // ==========================================
  // CHECK 5: No Rule Routing Concerning Text to DRAFT_FOR_REVIEW
  // ==========================================
  let concerningDraftViolation = false;
  const draftRules = spec.rule_list.filter((r) => r.route === "DRAFT_FOR_REVIEW");

  if (draftRules.length === 0) {
    warnings.push("No DRAFT_FOR_REVIEW rule present; all check-ins will require human review.");
  }

  for (const draftRule of draftRules) {
    const phrases = extractConditionPhrases(draftRule.condition);
    for (const phrase of phrases) {
      const lower = phrase.toLowerCase();
      for (const concern of CONCERNING_KEYWORDS) {
        if (lower.includes(concern)) {
          errors.push(
            `CRITICAL SAFETY VIOLATION: Rule "${draftRule.id}" routes concerning text "${phrase}" to DRAFT_FOR_REVIEW. Concerning text must route to HUMAN_REVIEW_REQUIRED.`
          );
          concerningDraftViolation = true;
        }
      }
    }

    // A draft rule should also check that free text is missing or strictly verified
    const condStr = JSON.stringify(draftRule.condition);
    if (!condStr.includes("missing_field")) {
      warnings.push(
        `Draft rule "${draftRule.id}" should verify that free-text note is missing or empty.`
      );
    }
  }

  checks.push({
    name: "no_concerning_text_to_draft",
    category: "concerning_route",
    passed: !concerningDraftViolation,
    detail: !concerningDraftViolation
      ? "Verified no rule routes emergency, distress, or clinical keywords to DRAFT_FOR_REVIEW."
      : "Safety gate tripped: concerning phrase routed to automated draft.",
  });

  // ==========================================
  // CHECK 6: Required Safety Rules Present
  // ==========================================
  const allConditionsStr = JSON.stringify(spec.rule_list.map((r) => ({ id: r.id, cond: r.condition, route: r.route })));
  
  // 6a. Untrusted free-text rule
  const hasUntrustedTextRule = spec.rule_list.some(
    (r) =>
      r.route === "HUMAN_REVIEW_REQUIRED" &&
      (r.id.toLowerCase().includes("untrusted") ||
        r.reason_code.toLowerCase().includes("untrusted") ||
        (JSON.stringify(r.condition).includes("note") && JSON.stringify(r.condition).includes("not")))
  );

  // 6b. Uncertainty rule
  const hasUncertaintyRule = spec.rule_list.some(
    (r) =>
      r.route === "HUMAN_REVIEW_REQUIRED" &&
      (allConditionsStr.includes("not sure") ||
        allConditionsStr.includes("unsure") ||
        r.id.toLowerCase().includes("uncertain") ||
        r.reason_code.toLowerCase().includes("uncertain"))
  );

  // 6c. Contradiction rule
  const hasContradictionRule = spec.rule_list.some(
    (r) =>
      r.route === "HUMAN_REVIEW_REQUIRED" &&
      (r.id.toLowerCase().includes("contradiction") ||
        r.reason_code.toLowerCase().includes("contradiction") ||
        JSON.stringify(r.condition).includes("contradiction"))
  );

  // 6d. Input limits rules (missing field & length limit)
  const hasLengthLimit = spec.rule_list.some(
    (r) => r.route === "INPUT_ERROR" && JSON.stringify(r.condition).includes("length_limit")
  );
  const hasMissingField = spec.rule_list.some(
    (r) => r.route === "INPUT_ERROR" && JSON.stringify(r.condition).includes("missing_field")
  );
  const hasInputLimits = hasLengthLimit && hasMissingField;

  const missingSafetyRules: string[] = [];
  if (!hasUntrustedTextRule) missingSafetyRules.push("untrusted-text (free-text must route to staff)");
  if (!hasUncertaintyRule) missingSafetyRules.push("uncertainty (ambiguous responses must route to staff)");
  if (!hasContradictionRule) missingSafetyRules.push("contradiction (status vs note mismatch detection)");
  if (!hasInputLimits) {
    if (!hasLengthLimit) missingSafetyRules.push("input-limits: length_limit");
    if (!hasMissingField) missingSafetyRules.push("input-limits: missing_field");
  }

  if (missingSafetyRules.length > 0) {
    errors.push(
      `Required safety rules missing from specification: ${missingSafetyRules.join(", ")}.`
    );
  }

  checks.push({
    name: "required_safety_rules",
    category: "safety_rules",
    passed: missingSafetyRules.length === 0,
    detail:
      missingSafetyRules.length === 0
        ? "All 4 required safety rule categories present (untrusted-text, uncertainty, contradiction, input-limits)."
        : `Missing required safety rules: ${missingSafetyRules.join(", ")}.`,
  });

  // ==========================================
  // CHECK 7: Limits Specification Conformance
  // ==========================================
  const limitsPassed =
    spec.limits.max_note_length > 0 &&
    spec.limits.max_daily_submissions > 0 &&
    spec.limits.timeout_ms >= 1000 &&
    spec.limits.timeout_ms <= 30000;

  if (!limitsPassed) {
    errors.push(
      "Specification limits invalid: max_note_length and max_daily_submissions must be positive, timeout_ms must be between 1000 and 30000 ms."
    );
  }

  checks.push({
    name: "limits_specification",
    category: "limits",
    passed: limitsPassed,
    detail: limitsPassed
      ? `Operational limits: max_note=${spec.limits.max_note_length} chars, timeout=${spec.limits.timeout_ms}ms, max_daily=${spec.limits.max_daily_submissions}.`
      : "Limits spec contains invalid or non-positive values.",
  });

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    checks,
    validatedAt: new Date().toISOString(),
  };
}

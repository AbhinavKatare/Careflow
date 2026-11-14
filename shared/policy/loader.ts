import { parse as parseYaml } from "yaml";
import type { PolicyRoute, PolicyRule, PolicyRuleSet } from "./types";

const VALID_ROUTES: Set<PolicyRoute> = new Set([
  "DRAFT_FOR_REVIEW",
  "HUMAN_REVIEW_REQUIRED",
  "INPUT_ERROR",
]);

const REQUIRED_DISCLAIMER_LABEL = "illustrative demo logic, not clinical criteria.";

export const EMBEDDED_V1_YAML = `version: "v1"
disclaimer: "illustrative demo logic, not clinical criteria."

rules:
  - id: "RULE_INPUT_MISSING_REQUIRED"
    description: "Check for missing required patient ID or week status field (illustrative demo logic, not clinical criteria.)"
    route: "INPUT_ERROR"
    reason_code: "REQUIRED_FIELD_MISSING"
    condition:
      any:
        - missing_field: "patientId"
        - missing_field: "weekStatus"

  - id: "RULE_INPUT_NOTE_LENGTH"
    description: "Reject free-text note exceeding maximum length threshold of 500 characters (illustrative demo logic, not clinical criteria.)"
    route: "INPUT_ERROR"
    reason_code: "NOTE_EXCEEDS_LENGTH_LIMIT"
    condition:
      length_limit:
        field: "note"
        max: 500

  - id: "RULE_CONTROLLED_URGENT_LANGUAGE"
    description: "Detect synthetic urgent red-flag marker phrases tagged under abstract CONTROLLED_URGENT_LANGUAGE (illustrative demo logic, not clinical criteria.)"
    route: "HUMAN_REVIEW_REQUIRED"
    reason_code: "CONTROLLED_URGENT_LANGUAGE"
    condition:
      keyword_match:
        field: "note"
        keywords:
          - "chest pain"
          - "shortness of breath"
          - "emergency"
          - "urgent"
          - "critical"
          - "severe"
          - "extreme difficulty"

  - id: "RULE_CONTRADICTION_DETECTED"
    description: "Flag direct conflict between structured on-track status and unstructured text reporting distress (illustrative demo logic, not clinical criteria.)"
    route: "HUMAN_REVIEW_REQUIRED"
    reason_code: "STATUS_TEXT_CONTRADICTION"
    condition:
      contradiction:
        structured_field: "weekStatus"
        structured_matches:
          - "on track"
        text_field: "note"
        text_keywords:
          - "extreme difficulty"
          - "cannot take any"
          - "completely failing"
          - "falling apart"

  - id: "RULE_EXPLICIT_FOLLOWUP_REQUEST"
    description: "Route explicit care-team follow-up requests to human staff (illustrative demo logic, not clinical criteria.)"
    route: "HUMAN_REVIEW_REQUIRED"
    reason_code: "EXPLICIT_FOLLOWUP_REQUESTED"
    condition:
      any:
        - field_equals:
            field: "followUp"
            value: "yes"
        - keyword_match:
            field: "weekStatus"
            keywords:
              - "question"

  - id: "RULE_UNCERTAINTY_EXPRESSED"
    description: "Route uncertain or ambiguous participant responses to clinical staff (illustrative demo logic, not clinical criteria.)"
    route: "HUMAN_REVIEW_REQUIRED"
    reason_code: "UNCERTAINTY_FLAGGED"
    condition:
      keyword_match:
        field: "weekStatus"
        keywords:
          - "not sure"
          - "unsure"

  - id: "RULE_UNTRUSTED_FREE_TEXT"
    description: "Enforce policy that any untrusted free-text note requires human review (illustrative demo logic, not clinical criteria.)"
    route: "HUMAN_REVIEW_REQUIRED"
    reason_code: "UNTRUSTED_FREE_TEXT_PRESENT"
    condition:
      not:
        missing_field: "note"

  - id: "RULE_ROUTINE_ON_TRACK"
    description: "Allow automated draft preparation for verified routine on-track check-ins without follow-up or free-text (illustrative demo logic, not clinical criteria.)"
    route: "DRAFT_FOR_REVIEW"
    reason_code: "ROUTINE_STRUCTURED_ON_TRACK"
    condition:
      all:
        - keyword_match:
            field: "weekStatus"
            keywords:
              - "on track"
        - field_equals:
            field: "followUp"
            value: "no"
        - missing_field: "note"
`;

export function validateRuleSet(ruleSet: PolicyRuleSet): void {
  if (!ruleSet.version) {
    throw new Error("Policy rule set missing required 'version'");
  }
  if (!Array.isArray(ruleSet.rules) || ruleSet.rules.length === 0) {
    throw new Error("Policy rule set must contain at least one rule");
  }

  let hasControlledUrgentTag = false;

  for (const rule of ruleSet.rules) {
    if (!rule.id) {
      throw new Error("Policy rule missing required 'id'");
    }
    if (!rule.description) {
      throw new Error(`Policy rule '${rule.id}' missing required 'description'`);
    }
    const descLower = rule.description.toLowerCase();
    if (!descLower.includes(REQUIRED_DISCLAIMER_LABEL.toLowerCase())) {
      throw new Error(
        `Policy rule '${rule.id}' must include label '${REQUIRED_DISCLAIMER_LABEL}'`
      );
    }
    if (!VALID_ROUTES.has(rule.route)) {
      throw new Error(
        `Policy rule '${rule.id}' has invalid route '${rule.route}'. Allowed: ${Array.from(VALID_ROUTES).join(", ")}`
      );
    }
    if (!rule.reason_code) {
      throw new Error(`Policy rule '${rule.id}' missing required 'reason_code'`);
    }
    if (!rule.condition || typeof rule.condition !== "object") {
      throw new Error(`Policy rule '${rule.id}' missing valid 'condition' object`);
    }
    if (rule.reason_code === "CONTROLLED_URGENT_LANGUAGE") {
      hasControlledUrgentTag = true;
    }
  }

  if (!hasControlledUrgentTag) {
    throw new Error(
      "Policy rule set must include abstract controlled tag 'CONTROLLED_URGENT_LANGUAGE'"
    );
  }
}

export function parsePolicyRuleSetYaml(yamlContent: string): PolicyRuleSet {
  const parsed = parseYaml(yamlContent) as {
    version?: string;
    disclaimer?: string;
    rules?: PolicyRule[];
  };

  const ruleSet: PolicyRuleSet = {
    version: parsed.version || "unknown",
    disclaimer: parsed.disclaimer || REQUIRED_DISCLAIMER_LABEL,
    rules: parsed.rules || [],
  };

  validateRuleSet(ruleSet);
  return ruleSet;
}

export function loadDefaultPolicyRuleSet(): PolicyRuleSet {
  return parsePolicyRuleSetYaml(EMBEDDED_V1_YAML);
}

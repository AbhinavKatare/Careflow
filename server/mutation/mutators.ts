import type { WorkflowSpec, RuleSpec } from "../../shared/domain/types";
import { computeWorkflowSpecHash } from "../../shared/domain/workflow-spec";
import type { Mutant } from "./types";

/**
 * Creates a clone of a WorkflowSpec with recalculated canonical content_hash.
 */
function cloneSpec(spec: WorkflowSpec, overrides: Partial<WorkflowSpec>): WorkflowSpec {
  const base = {
    ...spec,
    ...overrides,
  };
  return {
    ...base,
    content_hash: computeWorkflowSpecHash(base as any),
  };
}

/**
 * Generates comprehensive deterministic mutants of a WorkflowSpec.
 * PERMANENT RULE: Illustrative simulation logic only; zero external side effects.
 */
export function generateMutants(spec: WorkflowSpec): Mutant[] {
  const mutants: Mutant[] = [];
  let mutantSeq = 1;

  function nextId(prefix: string): string {
    const id = `MUT-${prefix}-${String(mutantSeq).padStart(3, "0")}`;
    mutantSeq++;
    return id;
  }

  // ==========================================
  // OPERATOR 1: Delete Rule
  // ==========================================
  spec.rule_list.forEach((rule, idx) => {
    const mutatedRules = spec.rule_list.filter((_, i) => i !== idx);
    const lowersSeverity = rule.route !== "DRAFT_FOR_REVIEW";
    const mutated = cloneSpec(spec, { rule_list: mutatedRules });

    mutants.push({
      id: nextId("DEL"),
      operator: "DELETE_RULE",
      description: `Delete rule "${rule.id}" (${rule.route}).`,
      diff: `- [${rule.route}] ${rule.id}: "${rule.description}"`,
      targetRuleId: rule.id,
      lowersSeverity,
      mutatedSpec: mutated,
    });
  });

  // ==========================================
  // OPERATOR 2: Flip Route
  // ==========================================
  spec.rule_list.forEach((rule, idx) => {
    if (rule.route === "HUMAN_REVIEW_REQUIRED") {
      // Flip to DRAFT_FOR_REVIEW (CRITICAL: Lowers severity to automated draft!)
      const toDraftRules: RuleSpec[] = spec.rule_list.map((r, i) =>
        i === idx ? { ...r, route: "DRAFT_FOR_REVIEW" as const } : r
      );
      mutants.push({
        id: nextId("FLP"),
        operator: "FLIP_ROUTE",
        description: `Flip rule "${rule.id}" from HUMAN_REVIEW_REQUIRED to DRAFT_FOR_REVIEW.`,
        diff: `~ ${rule.id}: route changed from HUMAN_REVIEW_REQUIRED to DRAFT_FOR_REVIEW`,
        targetRuleId: rule.id,
        lowersSeverity: true,
        mutatedSpec: cloneSpec(spec, { rule_list: toDraftRules }),
      });

      // Flip to INPUT_ERROR
      const toInputErrRules: RuleSpec[] = spec.rule_list.map((r, i) =>
        i === idx ? { ...r, route: "INPUT_ERROR" as const } : r
      );
      mutants.push({
        id: nextId("FLP"),
        operator: "FLIP_ROUTE",
        description: `Flip rule "${rule.id}" from HUMAN_REVIEW_REQUIRED to INPUT_ERROR.`,
        diff: `~ ${rule.id}: route changed from HUMAN_REVIEW_REQUIRED to INPUT_ERROR`,
        targetRuleId: rule.id,
        lowersSeverity: false,
        mutatedSpec: cloneSpec(spec, { rule_list: toInputErrRules }),
      });
    } else if (rule.route === "INPUT_ERROR") {
      // Flip to HUMAN_REVIEW_REQUIRED (Lowers severity by failing to reject corrupted/oversized input)
      const toHumanRules: RuleSpec[] = spec.rule_list.map((r, i) =>
        i === idx ? { ...r, route: "HUMAN_REVIEW_REQUIRED" as const } : r
      );
      mutants.push({
        id: nextId("FLP"),
        operator: "FLIP_ROUTE",
        description: `Flip rule "${rule.id}" from INPUT_ERROR to HUMAN_REVIEW_REQUIRED.`,
        diff: `~ ${rule.id}: route changed from INPUT_ERROR to HUMAN_REVIEW_REQUIRED`,
        targetRuleId: rule.id,
        lowersSeverity: true,
        mutatedSpec: cloneSpec(spec, { rule_list: toHumanRules }),
      });

      // Flip to DRAFT_FOR_REVIEW (Extreme severity drop)
      const toDraftRules: RuleSpec[] = spec.rule_list.map((r, i) =>
        i === idx ? { ...r, route: "DRAFT_FOR_REVIEW" as const } : r
      );
      mutants.push({
        id: nextId("FLP"),
        operator: "FLIP_ROUTE",
        description: `Flip rule "${rule.id}" from INPUT_ERROR to DRAFT_FOR_REVIEW.`,
        diff: `~ ${rule.id}: route changed from INPUT_ERROR to DRAFT_FOR_REVIEW`,
        targetRuleId: rule.id,
        lowersSeverity: true,
        mutatedSpec: cloneSpec(spec, { rule_list: toDraftRules }),
      });
    } else if (rule.route === "DRAFT_FOR_REVIEW") {
      // Flip to HUMAN_REVIEW_REQUIRED (Escalates routine path to human review)
      const toHumanRules: RuleSpec[] = spec.rule_list.map((r, i) =>
        i === idx ? { ...r, route: "HUMAN_REVIEW_REQUIRED" as const } : r
      );
      mutants.push({
        id: nextId("FLP"),
        operator: "FLIP_ROUTE",
        description: `Flip rule "${rule.id}" from DRAFT_FOR_REVIEW to HUMAN_REVIEW_REQUIRED.`,
        diff: `~ ${rule.id}: route changed from DRAFT_FOR_REVIEW to HUMAN_REVIEW_REQUIRED`,
        targetRuleId: rule.id,
        lowersSeverity: false,
        mutatedSpec: cloneSpec(spec, { rule_list: toHumanRules }),
      });
    }
  });

  // ==========================================
  // OPERATOR 3: Widen Threshold
  // ==========================================
  const currentMaxLen = spec.limits.max_note_length;
  const widenedLen = currentMaxLen + 100;
  mutants.push({
    id: nextId("WID"),
    operator: "WIDEN_THRESHOLD",
    description: `Widen maximum note length limit from ${currentMaxLen} to ${widenedLen} characters.`,
    diff: `~ limits.max_note_length: ${currentMaxLen} -> ${widenedLen}`,
    lowersSeverity: true, // Allows oversized text through without error
    mutatedSpec: cloneSpec(spec, {
      limits: { ...spec.limits, max_note_length: widenedLen },
      rule_list: spec.rule_list.map((r) => {
        if (r.condition && typeof r.condition === "object" && "length_limit" in (r.condition as any)) {
          return {
            ...r,
            condition: {
              length_limit: {
                field: (r.condition as any).length_limit.field,
                max: widenedLen,
              },
            },
          };
        }
        return r;
      }),
    }),
  });

  // ==========================================
  // OPERATOR 4: Narrow Threshold
  // ==========================================
  const narrowedLen = Math.max(100, Math.floor(currentMaxLen * 0.6));
  mutants.push({
    id: nextId("NAR"),
    operator: "NARROW_THRESHOLD",
    description: `Narrow maximum note length limit from ${currentMaxLen} to ${narrowedLen} characters.`,
    diff: `~ limits.max_note_length: ${currentMaxLen} -> ${narrowedLen}`,
    lowersSeverity: false,
    mutatedSpec: cloneSpec(spec, {
      limits: { ...spec.limits, max_note_length: narrowedLen },
      rule_list: spec.rule_list.map((r) => {
        if (r.condition && typeof r.condition === "object" && "length_limit" in (r.condition as any)) {
          return {
            ...r,
            condition: {
              length_limit: {
                field: (r.condition as any).length_limit.field,
                max: narrowedLen,
              },
            },
          };
        }
        return r;
      }),
    }),
  });

  // ==========================================
  // OPERATOR 5: Drop Normalization Step
  // ==========================================
  mutants.push({
    id: nextId("NRM"),
    operator: "DROP_NORMALIZATION",
    description: "Drop zero-width & invisible character stripping during text normalization.",
    diff: "- normalizeText: strip zero-width characters [\\u200B-\\u200F\\uFEFF\\u00AD\\u2060] disabled",
    lowersSeverity: true, // Evasion attacks with zero-width characters bypass detection
    mutatedSpec: spec,
    evaluatorConfig: { disableZeroWidthStripping: true },
  });

  mutants.push({
    id: nextId("NRM"),
    operator: "DROP_NORMALIZATION",
    description: "Drop Cyrillic and Greek homoglyph substitution mapping.",
    diff: "- normalizeText: homoglyph mapping (Cyrillic/Greek to Latin ASCII) disabled",
    lowersSeverity: true, // Homoglyph evasion strings bypass keyword detection
    mutatedSpec: spec,
    evaluatorConfig: { disableHomoglyphs: true },
  });

  mutants.push({
    id: nextId("NRM"),
    operator: "DROP_NORMALIZATION",
    description: "Enforce case-sensitive evaluation (drop lowercase folding).",
    diff: "- normalizeText: lowercase folding disabled (strict case sensitive matching)",
    lowersSeverity: true, // Uppercase distress keywords fail lowercase-only matches
    mutatedSpec: spec,
    evaluatorConfig: { caseSensitive: true },
  });

  // ==========================================
  // OPERATOR 6: Reorder Rules
  // ==========================================
  mutants.push({
    id: nextId("ORD"),
    operator: "REORDER_RULES",
    description: "Reverse entire rule order in the specification rule list.",
    diff: "~ rule_list order reversed completely (testing precedence stability)",
    lowersSeverity: false,
    mutatedSpec: cloneSpec(spec, {
      rule_list: spec.rule_list.slice().reverse(),
    }),
  });

  // Put DRAFT_FOR_REVIEW rule at the very top (index 0)
  const draftRuleIdx = spec.rule_list.findIndex((r) => r.route === "DRAFT_FOR_REVIEW");
  if (draftRuleIdx > 0) {
    const draftFirstRules = [
      spec.rule_list[draftRuleIdx],
      ...spec.rule_list.filter((_, i) => i !== draftRuleIdx),
    ];
    mutants.push({
      id: nextId("ORD"),
      operator: "REORDER_RULES",
      description: "Move DRAFT_FOR_REVIEW routine rule to the top of the evaluation list.",
      diff: `~ rule_list: moved "${spec.rule_list[draftRuleIdx].id}" to index 0`,
      lowersSeverity: false,
      mutatedSpec: cloneSpec(spec, { rule_list: draftFirstRules }),
    });
  }

  // ==========================================
  // OPERATOR 7: Weaken Instruction-Like-Text Handling
  // ==========================================
  mutants.push({
    id: nextId("INS"),
    operator: "WEAKEN_INSTRUCTION_TEXT",
    description: "Disable instruction-like text detector and prompt-injection pattern scanner.",
    diff: "- evaluateInstructionLikeText: prompt injection pattern scanning bypassed",
    lowersSeverity: true, // Prompt injections slip through without detection
    mutatedSpec: spec,
    evaluatorConfig: { disableInstructionDetector: true },
  });

  const instructionRule = spec.rule_list.find(
    (r) =>
      r.condition &&
      typeof r.condition === "object" &&
      "instruction_like_text" in (r.condition as any)
  );
  if (instructionRule) {
    const withoutInstruction = spec.rule_list.filter((r) => r.id !== instructionRule.id);
    mutants.push({
      id: nextId("INS"),
      operator: "WEAKEN_INSTRUCTION_TEXT",
      description: `Remove instruction-like text guardrail rule "${instructionRule.id}".`,
      diff: `- [${instructionRule.route}] ${instructionRule.id}: deleted instruction-like-text guardrail`,
      targetRuleId: instructionRule.id,
      lowersSeverity: true,
      mutatedSpec: cloneSpec(spec, { rule_list: withoutInstruction }),
    });
  }

  return mutants;
}


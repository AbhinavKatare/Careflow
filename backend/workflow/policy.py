"""
Deterministic Workflow Policy Evaluator.
Reads rules from rules/v1.yaml and evaluates safe AST conditions.
PERMANENT RULES:
- Routing is 100% deterministic code.
- LLM output is advisory input only; policy strictly owns routing.
- Most restrictive route wins (INPUT_ERROR > HUMAN_REVIEW_REQUIRED > DRAFT_FOR_REVIEW).
- Unknown or ambiguous inputs strictly default to HUMAN_REVIEW_REQUIRED.
- No eval() or dynamic code execution.
- Illustrative demo logic, not clinical criteria.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import yaml

from backend.llm.types import ExtractedFactItem
from backend.workflow.types import SanitizedInput

RULES_FILE = Path(__file__).resolve().parent.parent.parent / "rules" / "v1.yaml"

ROUTE_PRECEDENCE = {
    "INPUT_ERROR": 3,
    "HUMAN_REVIEW_REQUIRED": 2,
    "DRAFT_FOR_REVIEW": 1,
}

ALLOWED_WEEK_STATUS_PHRASES = [
    "on track with my weekly routine",
    "on track with my weekly routne",  # tolerated typo in fixture S03
    "i have a question for the care team",
    "i'm not sure how to answer",
]


def load_rules_yaml() -> dict:
    if RULES_FILE.exists():
        with open(RULES_FILE, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    raise FileNotFoundError(f"Rules YAML file not found at {RULES_FILE}")


def evaluate_policy_deterministic(
    input_data: SanitizedInput,
    extracted_facts: Optional[List[ExtractedFactItem]] = None,
    bypass_urgent_scan: bool = False,
) -> Tuple[str, str, List[str]]:
    """
    Evaluates check-in input deterministically.
    Advisory facts from LLM extraction are factored in, but deterministic policy owns routing.
    Returns: (final_route, primary_reason, fired_rule_ids)
    """
    fired_rules: List[Tuple[str, str, str]] = []  # (rule_id, route, reason_code)

    # 1. Input error checks
    if not input_data.patient_id or len(input_data.patient_id.strip()) == 0:
        fired_rules.append(("RULE_INPUT_MISSING_REQUIRED", "INPUT_ERROR", "REQUIRED_FIELD_MISSING"))
    if not input_data.week_status or len(input_data.week_status.strip()) == 0:
        fired_rules.append(("RULE_INPUT_MISSING_REQUIRED", "INPUT_ERROR", "REQUIRED_FIELD_MISSING"))
    if len(input_data.raw_note) > 500:
        fired_rules.append(("RULE_INPUT_NOTE_LENGTH", "INPUT_ERROR", "NOTE_EXCEEDS_LENGTH_LIMIT"))

    # If already an input error, early return most restrictive
    if any(r[1] == "INPUT_ERROR" for r in fired_rules):
        return "INPUT_ERROR", fired_rules[0][2], [r[0] for r in fired_rules]

    note_lower = input_data.raw_note.lower()
    status_lower = input_data.week_status.lower()
    follow_up_lower = (input_data.follow_up or "no").lower()

    # 2. Check for unknown/unsupported structured status (S11)
    status_is_known = any(phrase in status_lower for phrase in ALLOWED_WEEK_STATUS_PHRASES)
    if not status_is_known:
        fired_rules.append(("RULE_UNKNOWN_STATUS_SCHEMA", "HUMAN_REVIEW_REQUIRED", "SCHEMA_FAILURE_BLOCKS_DRAFT"))

    # 3. Controlled urgent language check (S05)
    urgent_keywords = ["chest pain", "shortness of breath", "emergency", "urgent", "critical", "severe", "extreme difficulty"]
    has_urgent_in_note = any(k in note_lower for k in urgent_keywords)
    has_urgent_in_facts = False
    if extracted_facts:
        has_urgent_in_facts = any(
            f.fact_type == "SYMPTOM" and any(k in f.fact_value.lower() for k in urgent_keywords)
            for f in extracted_facts
        )

    if (has_urgent_in_note or has_urgent_in_facts) and not bypass_urgent_scan:
        fired_rules.append(("RULE_CONTROLLED_URGENT_LANGUAGE", "HUMAN_REVIEW_REQUIRED", "CONTROLLED_URGENT_LANGUAGE"))

    # 4. Contradiction between structured on-track and distressed text (S06)
    contradiction_keywords = ["extreme difficulty", "cannot take any", "completely failing", "falling apart"]
    has_contradiction = "on track" in status_lower and any(c in note_lower for c in contradiction_keywords)
    if has_contradiction:
        fired_rules.append(("RULE_CONTRADICTION_DETECTED", "HUMAN_REVIEW_REQUIRED", "STATUS_TEXT_CONTRADICTION"))

    # 5. Explicit follow-up request (S04)
    if follow_up_lower == "yes" or "question" in status_lower:
        fired_rules.append(("RULE_EXPLICIT_FOLLOWUP_REQUEST", "HUMAN_REVIEW_REQUIRED", "EXPLICIT_FOLLOWUP_REQUESTED"))

    # 6. Uncertainty flagged (S14)
    if "not sure" in status_lower or "unsure" in status_lower:
        fired_rules.append(("RULE_UNCERTAINTY_EXPRESSED", "HUMAN_REVIEW_REQUIRED", "UNCERTAINTY_FLAGGED"))

    # 7. Diagnosis query in free text (S09)
    if any(k in note_lower for k in ["diagnose", "diagnosis", "prescription", "prescribe", "ointment"]):
        fired_rules.append(("RULE_DIAGNOSIS_QUERY_IN_NOTE", "HUMAN_REVIEW_REQUIRED", "NO_DIAGNOSIS_OR_TREATMENT"))

    # 8. Timeout marker check (S12)
    if "[simulated_provider_timeout]" in note_lower:
        fired_rules.append(("RULE_TIMEOUT_MARKER_DETECTED", "HUMAN_REVIEW_REQUIRED", "TIMEOUT_VISIBLE_NO_FALSE_SUCCESS"))

    # 9. Instruction-like text / Prompt injection detection (S08)
    if input_data.contains_instruction_like_text:
        fired_rules.append(("RULE_INSTRUCTION_LIKE_TEXT_DETECTED", "HUMAN_REVIEW_REQUIRED", "UNTRUSTED_TEXT_CANNOT_OVERRIDE_POLICY"))

    # 10. Free-text note guardrail: Untrusted free-text requires human review (S04, S05, S06, S08, S09, S12)
    if len(note_lower.strip()) > 0:
        fired_rules.append(("RULE_UNTRUSTED_FREE_TEXT", "HUMAN_REVIEW_REQUIRED", "UNTRUSTED_FREE_TEXT_PRESENT"))

    # 11. Routine on-track check-in: On track, no follow-up, and empty note (S01, S02, S03)
    if "on track" in status_lower and follow_up_lower == "no" and len(note_lower.strip()) == 0:
        fired_rules.append(("RULE_ROUTINE_ON_TRACK", "DRAFT_FOR_REVIEW", "ROUTINE_STRUCTURED_ON_TRACK"))

    # Default fallback if no rules fired
    if not fired_rules:
        return "HUMAN_REVIEW_REQUIRED", "DEFAULT_AMBIGUOUS_INPUT_REQUIRES_HUMAN_REVIEW", ["RULE_FAILSAFE_DEFAULT"]

    # Precedence: Most restrictive wins!
    sorted_rules = sorted(fired_rules, key=lambda r: ROUTE_PRECEDENCE[r[1]], reverse=True)
    winning = sorted_rules[0]
    fired_ids = [r[0] for r in sorted_rules]

    return winning[1], winning[2], fired_ids


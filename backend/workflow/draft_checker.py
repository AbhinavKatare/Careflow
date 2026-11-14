"""
Deterministic Draft Safety Checker.
PERMANENT RULES:
- Fails drafts that contain diagnosis language.
- Fails drafts with treatment/medication recommendations.
- Fails drafts claiming outbound actions occurred (no outbound actions exist).
- Fails drafts containing ungrounded facts not present in source or context.
- Illustrative demo logic, not clinical criteria.
"""

import re
from typing import List, Optional
from backend.workflow.types import DraftPolicyCheckResult

# 1. Diagnosis language markers
DIAGNOSIS_TERMS = [
    "diagnos",
    "you have pneumonia",
    "hypertension",
    "myocardial",
    "cardiac arrest",
    "suffering from",
    "condition is diagnosed as",
    "pathology",
]

# 2. Treatment / medication recommendation markers
TREATMENT_TERMS = [
    "prescribe",
    "prescription",
    "dosage",
    "increase dose",
    "decrease dose",
    "take 500",
    "antibiotic",
    "steroid ointment",
    "stop taking",
    "start taking",
    "medication change",
    "take aspirin",
    "take tylenol",
    "ibuprofen",
]

# 3. Claims that outbound actions occurred (strictly forbidden in simulation)
ACTION_CLAIMS = [
    "sent an email",
    "sent an sms",
    "sent a text",
    "sent you an email",
    "dispatched",
    "notified the doctor",
    "notified your physician",
    "updated your ehr",
    "updated your electronic health record",
    "ordered lab",
    "scheduled an appointment",
    "dispatched emergency",
]


def check_draft_policy(
    draft_text: Optional[str],
    source_note: Optional[str] = "",
    context: Optional[dict] = None,
) -> DraftPolicyCheckResult:
    """
    Deterministic safety check for candidate drafts.
    Fails any draft that violates zero-outbound action rules or generates clinical claims.
    """
    if not draft_text or len(draft_text.strip()) == 0:
        return DraftPolicyCheckResult(passed=True)

    draft_lower = draft_text.lower()
    source_lower = (source_note or "").lower()

    # 1. Check for diagnosis language
    for term in DIAGNOSIS_TERMS:
        if term in draft_lower:
            return DraftPolicyCheckResult(
                passed=False,
                violation_code="FORBIDDEN_DIAGNOSIS_LANGUAGE",
                violation_detail=f"Draft contains forbidden diagnosis terminology: '{term}'. (Illustrative demo logic, not clinical criteria.)",
            )

    # 2. Check for treatment/medication recommendations
    for term in TREATMENT_TERMS:
        if term in draft_lower:
            return DraftPolicyCheckResult(
                passed=False,
                violation_code="FORBIDDEN_TREATMENT_RECOMMENDATION",
                violation_detail=f"Draft contains forbidden medication/treatment advice: '{term}'. (Illustrative demo logic, not clinical criteria.)",
            )

    # 3. Check for false claims that an external action occurred
    for term in ACTION_CLAIMS:
        if term in draft_lower:
            return DraftPolicyCheckResult(
                passed=False,
                violation_code="FORBIDDEN_EXTERNAL_ACTION_CLAIM",
                violation_detail=f"Draft falsely claims external action occurred: '{term}'. All actions in this portfolio demo are simulated only.",
            )

    # 4. Check for ungrounded facts (e.g. dosages or medication numbers not in source)
    draft_dosages = re.findall(r"\b\d+\s*(?:mg|ml|mcg|tablets?|pills?)\b", draft_lower)
    for dosage in draft_dosages:
        if dosage not in source_lower:
            return DraftPolicyCheckResult(
                passed=False,
                violation_code="UNGROUNDED_CLINICAL_FACT",
                violation_detail=f"Draft mentions ungrounded dosage '{dosage}' not found in patient input.",
            )

    return DraftPolicyCheckResult(passed=True)


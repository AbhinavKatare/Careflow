"""
Type definitions for the deterministic check-in workflow pipeline.
Plain data structures and typed results with zero agent framework dependencies.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field
from backend.models.enums import CaseStatus


class CheckInInput(BaseModel):
    """Raw check-in submission data."""
    model_config = ConfigDict(extra="ignore")

    patient_id: Optional[str] = None
    patient_name: str = "Demo Patient 001"
    program_name: str = "Weekly check-in"
    week_status: Optional[str] = None
    follow_up: Optional[str] = "no"
    note: Optional[str] = ""
    idempotency_key: Optional[str] = None
    bypass_urgent_scan: bool = False


@dataclass
class ValidatedInput:
    """Output of validate step."""
    is_valid: bool
    patient_id: str
    patient_name: str
    program_name: str
    week_status: str
    follow_up: str
    note: str
    idempotency_key: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class SanitizedInput:
    """Output of sanitize step with pre-LLM safety, instruction detection, and reversible redaction."""
    patient_id: str
    patient_name: str
    program_name: str
    week_status: str
    follow_up: str
    raw_note: str
    sanitized_note: str
    redacted_note: str
    contains_instruction_like_text: bool
    token_map: Dict[str, str] = field(default_factory=dict)
    idempotency_key: Optional[str] = None


@dataclass
class DraftPolicyCheckResult:
    """Result of deterministic draft policy compliance inspection."""
    passed: bool
    violation_code: Optional[str] = None
    violation_detail: Optional[str] = None


@dataclass
class PipelineResult:
    """Complete execution record of the typed check-in pipeline."""
    success: bool
    route: str  # DRAFT_FOR_REVIEW, HUMAN_REVIEW_REQUIRED, INPUT_ERROR
    case_status: CaseStatus  # DRAFT_READY, NEEDS_REVIEW, PROCESSING_FAILED
    primary_reason: str
    fired_rules: List[str] = field(default_factory=list)
    extracted_facts: List[Dict[str, Any]] = field(default_factory=list)
    draft_message: Optional[str] = None
    redacted_preview: Optional[str] = None
    contains_instruction_like_text: bool = False
    token_map: Dict[str, str] = field(default_factory=dict)
    review_case_id: Optional[int] = None
    check_in_id: Optional[int] = None
    agent_run_id: Optional[int] = None
    step_durations_ms: Dict[str, float] = field(default_factory=dict)
    total_latency_ms: float = 0.0
    failure_reason: Optional[str] = None


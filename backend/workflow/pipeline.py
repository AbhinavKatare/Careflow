"""
Explicit Typed Check-in Pipeline.
Plain functions, no agent framework.
Sequence: validate -> sanitize -> extract -> policy evaluate -> draft -> draft policy check -> persist -> audit.

PERMANENT RULES:
- Any step failure yields PROCESSING_FAILED with a visible reason, never a success-looking state.
- LLM extraction is advisory input to policy; policy strictly owns the route.
- The draft checker is deterministic and fails drafts with diagnosis, treatment, or action claims.
- Record per-step duration on AgentRun.
- Zero outbound actions.
"""

import time
import json
import hashlib
import datetime
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from backend.models.enums import (
    ActorType,
    AgentRunStatus,
    AgentRunType,
    CaseStatus,
)
from backend.models.models import (
    AgentRun,
    AuditEvent,
    CheckIn,
    Clinic,
    DemoPatient,
    DraftMessage,
    ExtractedFact,
    Program,
    ReviewCase,
    SubmittedText,
)
from backend.llm.adapter import LLMAdapter
from backend.llm.factory import get_llm_adapter
from backend.llm.types import DraftOutput, ExtractionOutput
from backend.safety import (
    de_redact,
    detect_instruction_like_text,
    redact_identifiers,
    sanitize_encoding_and_limits,
)
from backend.workflow.draft_checker import check_draft_policy
from backend.workflow.policy import evaluate_policy_deterministic
from backend.workflow.types import (
    CheckInInput,
    DraftPolicyCheckResult,
    PipelineResult,
    SanitizedInput,
    ValidatedInput,
)

RULE_VERSION = "rules v1.0"
WORKFLOW_VERSION = "workflow 0.1.0"


# ------------------------------------------------------------------------------
# STEP 1: VALIDATE
# ------------------------------------------------------------------------------
def step_validate(input_data: CheckInInput) -> ValidatedInput:
    """Validates presence of required fields and bounded input size."""
    if not input_data.patient_id or len(input_data.patient_id.strip()) == 0:
        return ValidatedInput(
            is_valid=False,
            patient_id="",
            patient_name=input_data.patient_name,
            program_name=input_data.program_name,
            week_status=input_data.week_status or "",
            follow_up=input_data.follow_up or "no",
            note=input_data.note or "",
            error_message="Missing required field: patient_id",
        )

    if not input_data.week_status or len(input_data.week_status.strip()) == 0:
        return ValidatedInput(
            is_valid=False,
            patient_id=input_data.patient_id,
            patient_name=input_data.patient_name,
            program_name=input_data.program_name,
            week_status="",
            follow_up=input_data.follow_up or "no",
            note=input_data.note or "",
            error_message="Missing required field: week_status",
        )

    note = input_data.note or ""
    # Pre-LLM safety: Size and encoding limit enforcement
    is_safe, cleaned_note, error_msg = sanitize_encoding_and_limits(note, max_chars=500, max_bytes=2048)
    if not is_safe:
        return ValidatedInput(
            is_valid=False,
            patient_id=input_data.patient_id,
            patient_name=input_data.patient_name,
            program_name=input_data.program_name,
            week_status=input_data.week_status,
            follow_up=input_data.follow_up or "no",
            note=note,
            error_message=error_msg,
        )

    return ValidatedInput(
        is_valid=True,
        patient_id=input_data.patient_id.strip(),
        patient_name=input_data.patient_name.strip(),
        program_name=input_data.program_name.strip(),
        week_status=input_data.week_status.strip(),
        follow_up=(input_data.follow_up or "no").strip(),
        note=cleaned_note,
        idempotency_key=input_data.idempotency_key,
    )


# ------------------------------------------------------------------------------
# STEP 2: SANITIZE & PRE-LLM REDACTION
# ------------------------------------------------------------------------------
def step_sanitize(validated: ValidatedInput) -> SanitizedInput:
    """
    Sanitizes input, detects prompt-injection patterns, and applies reversible redaction.
    Replaces synthetic names, phone numbers, emails, and dates with placeholders before model invocation.
    """
    sanitized_note = validated.note.strip()

    # 1. Prompt-injection pattern detection
    contains_instruction_like_text, _ = detect_instruction_like_text(sanitized_note)

    # 2. Reversible redaction before any model call
    known_names = [validated.patient_name, "Demo Patient"]
    redacted_note, token_map = redact_identifiers(sanitized_note, known_names=known_names)

    return SanitizedInput(
        patient_id=validated.patient_id,
        patient_name=validated.patient_name,
        program_name=validated.program_name,
        week_status=validated.week_status,
        follow_up=validated.follow_up,
        raw_note=validated.note,
        sanitized_note=sanitized_note,
        redacted_note=redacted_note,
        contains_instruction_like_text=contains_instruction_like_text,
        token_map=token_map,
        idempotency_key=validated.idempotency_key,
    )


# ------------------------------------------------------------------------------
# STEP 3: EXTRACT (LLM or mock advisory extraction)
# ------------------------------------------------------------------------------
def step_extract(
    sanitized: SanitizedInput,
    adapter: LLMAdapter,
    timeout: float = 2.0,
) -> Tuple[Optional[ExtractionOutput], Optional[Dict[str, Any]]]:
    """
    Extracts clinical facts if free text is present.
    CRITICAL: Passed redacted text only so NO unredacted synthetic identifier appears in model request!
    Advisory input to policy; does not make routing decisions.
    """
    if not sanitized.redacted_note:
        return None, None

    response = adapter.generate_extraction(
        patient_text=sanitized.redacted_note,
        prompt_version="extract_v1",
        timeout=timeout,
    )

    metadata_dict = response.metadata.model_dump() if response.metadata else None
    return response.data, metadata_dict


# ------------------------------------------------------------------------------
# STEP 4: POLICY EVALUATE
# ------------------------------------------------------------------------------
def step_policy_evaluate(
    sanitized: SanitizedInput,
    extracted: Optional[ExtractionOutput],
    bypass_urgent_scan: bool = False,
) -> Tuple[str, str, List[str]]:
    """
    Deterministic policy evaluator. Policy strictly owns the route.
    Returns: (final_route, primary_reason, fired_rule_ids)
    """
    extracted_facts_list = extracted.facts if extracted else None
    return evaluate_policy_deterministic(
        input_data=sanitized,
        extracted_facts=extracted_facts_list,
        bypass_urgent_scan=bypass_urgent_scan,
    )


# ------------------------------------------------------------------------------
# STEP 5: DRAFT (only if route is DRAFT_FOR_REVIEW)
# ------------------------------------------------------------------------------
def step_draft(
    sanitized: SanitizedInput,
    route: str,
    adapter: LLMAdapter,
    timeout: float = 2.0,
) -> Tuple[Optional[DraftOutput], Optional[Dict[str, Any]]]:
    """
    Generates neutral acknowledgment draft ONLY when routed to DRAFT_FOR_REVIEW.
    CRITICAL: The model receives redacted text and placeholders; no raw identifier is passed.
    """
    if route != "DRAFT_FOR_REVIEW":
        return None, None

    # Redact patient name for model call
    redacted_patient_name = "[PATIENT_NAME_1]"
    sanitized.token_map[redacted_patient_name] = sanitized.patient_name

    response = adapter.generate_draft(
        patient_text=sanitized.redacted_note,
        patient_name=redacted_patient_name,
        program_name=sanitized.program_name,
        prompt_version="draft_v1",
        timeout=timeout,
    )

    if response.data:
        # Reversibly restore patient name server-side
        restored_msg = de_redact(response.data.draft_message, sanitized.token_map)
        response.data.draft_message = restored_msg

    metadata_dict = response.metadata.model_dump() if response.metadata else None
    return response.data, metadata_dict


# ------------------------------------------------------------------------------
# STEP 6: DRAFT POLICY CHECK
# ------------------------------------------------------------------------------
def step_draft_policy_check(
    draft: Optional[DraftOutput],
    source_note: str,
) -> DraftPolicyCheckResult:
    """
    Deterministic safety check.
    Fails drafts containing diagnosis language, treatment advice, action claims, or ungrounded facts.
    """
    if not draft:
        return DraftPolicyCheckResult(passed=True)

    return check_draft_policy(
        draft_text=draft.draft_message,
        source_note=source_note,
    )


# ------------------------------------------------------------------------------
# STEP 7: PERSIST
# ------------------------------------------------------------------------------
def step_persist(
    session: Session,
    sanitized: SanitizedInput,
    route: str,
    case_status: CaseStatus,
    routing_reason: str,
    extracted: Optional[ExtractionOutput],
    draft: Optional[DraftOutput],
    adapter_model: str,
    step_durations: Dict[str, float],
    total_latency_ms: float,
    error_message: Optional[str] = None,
) -> Tuple[CheckIn, ReviewCase, AgentRun, Optional[DraftMessage]]:
    """Persists check-in, immutable submitted text, review case, agent run, and draft."""
    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Resolve DemoPatient
    patient = (
        session.query(DemoPatient)
        .filter_by(patient_id=sanitized.patient_id)
        .first()
    )
    if not patient:
        clinic = session.query(Clinic).first()
        if not clinic:
            clinic = Clinic(code="METRO", name="Demo Metro Clinic")
            session.add(clinic)
            session.flush()

        program = session.query(Program).filter_by(name=sanitized.program_name).first()
        if not program:
            program = Program(
                clinic_id=clinic.id,
                code="PROG-1",
                name=sanitized.program_name or "Weekly check-in",
                description="Routine check-in program",
            )
            session.add(program)
            session.flush()

        patient = DemoPatient(
            clinic_id=clinic.id,
            program_id=program.id,
            patient_id=sanitized.patient_id or "DEMO-001",
            full_name=sanitized.patient_name,
            initials="DP",
            created_at=now,
        )
        session.add(patient)
        session.flush()

    # 2. Resolve Program
    program = session.query(Program).filter_by(name=sanitized.program_name).first()
    if not program:
        program = session.query(Program).first()

    # 3. Create CheckIn
    check_in = CheckIn(
        patient_id=patient.id,
        program_id=program.id if program else 1,
        status_selection=sanitized.week_status,
        follow_up_requested=(sanitized.follow_up.lower() == "yes"),
        submitted_at=now,
    )
    session.add(check_in)
    session.flush()

    # 4. Immutable SubmittedText
    content_hash = hashlib.sha256(sanitized.raw_note.encode("utf-8")).hexdigest()
    submitted_text = SubmittedText(
        check_in_id=check_in.id,
        raw_note=sanitized.raw_note,
        content_hash=content_hash,
        created_at=now,
    )
    session.add(submitted_text)
    session.flush()

    # 5. AgentRun tracking with step durations
    agent_run = AgentRun(
        run_type=AgentRunType.EXTRACTION if extracted else AgentRunType.TRIAGE_POLICY,
        model_name=adapter_model,
        rule_version=RULE_VERSION,
        workflow_version=WORKFLOW_VERSION,
        latency_ms=total_latency_ms,
        status=AgentRunStatus.SUCCESS if case_status != CaseStatus.PROCESSING_FAILED else AgentRunStatus.FAILED,
        error_message=error_message,
        step_durations_json=json.dumps(step_durations),
        started_at=now - datetime.timedelta(milliseconds=total_latency_ms),
        completed_at=now,
    )
    session.add(agent_run)
    session.flush()

    # 6. ExtractedFacts with source span references
    if extracted and extracted.facts:
        for f in extracted.facts:
            fact = ExtractedFact(
                check_in_id=check_in.id,
                agent_run_id=agent_run.id,
                fact_type=f.fact_type,
                fact_value=f.fact_value,
                source_span_start=f.source_span_start,
                source_span_end=f.source_span_end,
                source_span_text=f.source_span_text,
                confidence=f.confidence,
                created_at=now,
            )
            session.add(fact)
        session.flush()

    # 7. ReviewCase
    priority = "CRITICAL" if "URGENT" in routing_reason or "SAFETY" in routing_reason else "STANDARD"
    review_case = ReviewCase(
        check_in_id=check_in.id,
        patient_id=patient.id,
        status=case_status,
        priority=priority,
        routing_reason=routing_reason,
        rule_version=RULE_VERSION,
        workflow_version=WORKFLOW_VERSION,
        redacted_preview=sanitized.redacted_note,
        contains_instruction_like_text=sanitized.contains_instruction_like_text,
        token_map_json=json.dumps(sanitized.token_map) if sanitized.token_map else None,
        created_at=now,
        updated_at=now,
    )
    session.add(review_case)
    session.flush()

    # 8. DraftMessage if generated
    draft_msg_entity: Optional[DraftMessage] = None
    if draft and case_status == CaseStatus.DRAFT_READY:
        draft_msg_entity = DraftMessage(
            review_case_id=review_case.id,
            recipient_patient_id=patient.id,
            agent_run_id=agent_run.id,
            draft_text=draft.draft_message,
            is_edited_by_human=False,
            model_name=adapter_model,
            rule_version=RULE_VERSION,
            workflow_version=WORKFLOW_VERSION,
            created_at=now,
        )
        session.add(draft_msg_entity)
        session.flush()

    return check_in, review_case, agent_run, draft_msg_entity


# ------------------------------------------------------------------------------
# STEP 8: AUDIT (Append-only, never duplicates free text)
# ------------------------------------------------------------------------------
def step_audit(
    session: Session,
    check_in_id: int,
    case_status: CaseStatus,
    route: str,
    routing_reason: str,
) -> AuditEvent:
    """Appends audit event. Free text is NEVER copied into audit events."""
    audit = AuditEvent.create_event(
        entity_type="CheckIn",
        entity_id=str(check_in_id),
        actor_type=ActorType.WORKFLOW,
        actor_id="careflow-pipeline",
        action=f"ROUTE_TO_{case_status.value}",
        metadata={
            "route": route,
            "status": case_status.value,
            "reason": routing_reason,
            "external_sent": False,
        },
    )
    session.add(audit)
    session.flush()
    return audit


# ------------------------------------------------------------------------------
# COMPLETE WORKFLOW ORCHESTRATOR
# ------------------------------------------------------------------------------
def run_checkin_pipeline(
    input_data: CheckInInput,
    session: Session,
    adapter: Optional[LLMAdapter] = None,
) -> PipelineResult:
    """
    Executes the explicit typed pipeline:
    validate -> sanitize -> extract -> policy evaluate -> draft -> draft policy check -> persist -> audit.

    Guarantees:
    - Any step failure yields PROCESSING_FAILED with a visible reason.
    - Policy strictly owns the route.
    - Records per-step duration.
    - Zero outbound effects.
    """
    start_total = time.perf_counter()
    step_durations: Dict[str, float] = {}
    llm_adapter = adapter or get_llm_adapter()

    # Step 1: Validate
    t0 = time.perf_counter()
    validated = step_validate(input_data)
    step_durations["validate"] = round((time.perf_counter() - t0) * 1000, 3)

    if not validated.is_valid:
        # Input validation failed -> fail fast to PROCESSING_FAILED with visible reason
        total_ms = round((time.perf_counter() - start_total) * 1000, 3)
        sanitized_fallback = SanitizedInput(
            patient_id=input_data.patient_id or "UNKNOWN",
            patient_name=input_data.patient_name,
            program_name=input_data.program_name,
            week_status=input_data.week_status or "",
            follow_up=input_data.follow_up or "no",
            raw_note=input_data.note or "",
            sanitized_note=(input_data.note or "").strip(),
            redacted_note=(input_data.note or "").strip(),
            contains_instruction_like_text=False,
            token_map={},
            idempotency_key=input_data.idempotency_key,
        )

        _, review_case, agent_run, _ = step_persist(
            session=session,
            sanitized=sanitized_fallback,
            route="INPUT_ERROR",
            case_status=CaseStatus.PROCESSING_FAILED,
            routing_reason=f"INPUT_VALIDATION_FAILURE: {validated.error_message}",
            extracted=None,
            draft=None,
            adapter_model=llm_adapter.model_id,
            step_durations=step_durations,
            total_latency_ms=total_ms,
            error_message=validated.error_message,
        )

        step_audit(
            session=session,
            check_in_id=review_case.check_in_id,
            case_status=CaseStatus.PROCESSING_FAILED,
            route="INPUT_ERROR",
            routing_reason=f"INPUT_VALIDATION_FAILURE: {validated.error_message}",
        )

        return PipelineResult(
            success=False,
            route="INPUT_ERROR",
            case_status=CaseStatus.PROCESSING_FAILED,
            primary_reason=validated.error_message or "INPUT_VALIDATION_FAILURE",
            fired_rules=["RULE_INPUT_VALIDATION_FAILED"],
            review_case_id=review_case.id,
            agent_run_id=agent_run.id,
            step_durations_ms=step_durations,
            total_latency_ms=total_ms,
            failure_reason=validated.error_message,
        )

    # Step 2: Sanitize
    t0 = time.perf_counter()
    sanitized = step_sanitize(validated)
    step_durations["sanitize"] = round((time.perf_counter() - t0) * 1000, 3)

    # Step 3: Extract (Advisory LLM fact extraction)
    t0 = time.perf_counter()
    extracted_data: Optional[ExtractionOutput] = None
    try:
        extracted_data, _ = step_extract(sanitized, llm_adapter)
    except Exception as err:
        # LLM extraction failure must yield PROCESSING_FAILED with visible reason
        total_ms = round((time.perf_counter() - start_total) * 1000, 3)
        step_durations["extract"] = round((time.perf_counter() - t0) * 1000, 3)

        _, review_case, agent_run, _ = step_persist(
            session=session,
            sanitized=sanitized,
            route="EXTRACTION_FAILURE",
            case_status=CaseStatus.PROCESSING_FAILED,
            routing_reason=f"FACT_EXTRACTION_FAILURE: {err}",
            extracted=None,
            draft=None,
            adapter_model=llm_adapter.model_id,
            step_durations=step_durations,
            total_latency_ms=total_ms,
            error_message=str(err),
        )

        step_audit(
            session=session,
            check_in_id=review_case.check_in_id,
            case_status=CaseStatus.PROCESSING_FAILED,
            route="EXTRACTION_FAILURE",
            routing_reason=f"FACT_EXTRACTION_FAILURE: {err}",
        )

        return PipelineResult(
            success=False,
            route="EXTRACTION_FAILURE",
            case_status=CaseStatus.PROCESSING_FAILED,
            primary_reason=str(err),
            review_case_id=review_case.id,
            agent_run_id=agent_run.id,
            step_durations_ms=step_durations,
            total_latency_ms=total_ms,
            failure_reason=f"Extraction failure: {err}",
        )
    step_durations["extract"] = round((time.perf_counter() - t0) * 1000, 3)

    # Step 4: Policy Evaluate (Policy owns the route)
    t0 = time.perf_counter()
    route, reason, fired_rules = step_policy_evaluate(
        sanitized=sanitized,
        extracted=extracted_data,
        bypass_urgent_scan=input_data.bypass_urgent_scan,
    )
    step_durations["policy_evaluate"] = round((time.perf_counter() - t0) * 1000, 3)

    # Determine initial case status from policy route
    if route == "INPUT_ERROR":
        case_status = CaseStatus.PROCESSING_FAILED
    elif route == "HUMAN_REVIEW_REQUIRED":
        case_status = CaseStatus.NEEDS_REVIEW
    elif route == "DRAFT_FOR_REVIEW":
        case_status = CaseStatus.DRAFT_READY
    else:
        case_status = CaseStatus.NEEDS_REVIEW

    # Step 5: Draft (Only if route is DRAFT_FOR_REVIEW)
    t0 = time.perf_counter()
    draft_data: Optional[DraftOutput] = None
    if route == "DRAFT_FOR_REVIEW":
        try:
            draft_data, _ = step_draft(sanitized, route, llm_adapter)
        except Exception as err:
            total_ms = round((time.perf_counter() - start_total) * 1000, 3)
            step_durations["draft"] = round((time.perf_counter() - t0) * 1000, 3)

            _, review_case, agent_run, _ = step_persist(
                session=session,
                sanitized=sanitized,
                route=route,
                case_status=CaseStatus.PROCESSING_FAILED,
                routing_reason=f"DRAFT_SYNTHESIS_FAILURE: {err}",
                extracted=extracted_data,
                draft=None,
                adapter_model=llm_adapter.model_id,
                step_durations=step_durations,
                total_latency_ms=total_ms,
                error_message=str(err),
            )

            step_audit(
                session=session,
                check_in_id=review_case.check_in_id,
                case_status=CaseStatus.PROCESSING_FAILED,
                route=route,
                routing_reason=f"DRAFT_SYNTHESIS_FAILURE: {err}",
            )

            return PipelineResult(
                success=False,
                route=route,
                case_status=CaseStatus.PROCESSING_FAILED,
                primary_reason=str(err),
                fired_rules=fired_rules,
                review_case_id=review_case.id,
                agent_run_id=agent_run.id,
                step_durations_ms=step_durations,
                total_latency_ms=total_ms,
                failure_reason=f"Draft failure: {err}",
            )
    step_durations["draft"] = round((time.perf_counter() - t0) * 1000, 3)

    # Step 6: Draft Policy Check
    t0 = time.perf_counter()
    if draft_data:
        draft_check = step_draft_policy_check(draft_data, sanitized.raw_note)
        if not draft_check.passed:
            # Deterministic draft check failed -> fail to PROCESSING_FAILED with visible reason
            case_status = CaseStatus.PROCESSING_FAILED
            reason = f"DRAFT_POLICY_VIOLATION: {draft_check.violation_detail}"
    step_durations["draft_policy_check"] = round((time.perf_counter() - t0) * 1000, 3)

    # Step 7: Persist
    t0 = time.perf_counter()
    total_ms = round((time.perf_counter() - start_total) * 1000, 3)
    check_in, review_case, agent_run, draft_entity = step_persist(
        session=session,
        sanitized=sanitized,
        route=route,
        case_status=case_status,
        routing_reason=reason,
        extracted=extracted_data,
        draft=draft_data,
        adapter_model=llm_adapter.model_id,
        step_durations=step_durations,
        total_latency_ms=total_ms,
    )
    step_durations["persist"] = round((time.perf_counter() - t0) * 1000, 3)

    # Step 8: Audit
    t0 = time.perf_counter()
    step_audit(
        session=session,
        check_in_id=check_in.id,
        case_status=case_status,
        route=route,
        routing_reason=reason,
    )
    step_durations["audit"] = round((time.perf_counter() - t0) * 1000, 3)

    # Update agent_run with the complete step durations breakdown
    agent_run.step_durations_json = json.dumps(step_durations)
    session.flush()

    final_total_ms = round((time.perf_counter() - start_total) * 1000, 3)

    extracted_facts_json = (
        [f.model_dump() for f in extracted_data.facts] if extracted_data else []
    )

    return PipelineResult(
        success=(case_status != CaseStatus.PROCESSING_FAILED),
        route=route,
        case_status=case_status,
        primary_reason=reason,
        fired_rules=fired_rules,
        extracted_facts=extracted_facts_json,
        draft_message=draft_data.draft_message if draft_data else None,
        redacted_preview=sanitized.redacted_note,
        contains_instruction_like_text=sanitized.contains_instruction_like_text,
        token_map=sanitized.token_map,
        review_case_id=review_case.id,
        check_in_id=check_in.id,
        agent_run_id=agent_run.id,
        step_durations_ms=step_durations,
        total_latency_ms=final_total_ms,
        failure_reason=reason if case_status == CaseStatus.PROCESSING_FAILED else None,
    )

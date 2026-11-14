import pytest
from backend.models.enums import CaseStatus, InvalidStateTransitionError, validate_transition
from backend.models.models import ReviewCase


def test_legal_state_transitions():
    case = ReviewCase(
        check_in_id=1,
        patient_id=1,
        status=CaseStatus.RECEIVED,
        priority="STANDARD",
        routing_reason="Initial ingestion",
        rule_version="rules v1.2-demo",
        workflow_version="workflow 0.1.0",
    )
    assert case.status == CaseStatus.RECEIVED

    # RECEIVED -> PROCESSING
    case.transition_to(CaseStatus.PROCESSING)
    assert case.status == CaseStatus.PROCESSING

    # PROCESSING -> DRAFT_READY
    case.transition_to(CaseStatus.DRAFT_READY)
    assert case.status == CaseStatus.DRAFT_READY

    # DRAFT_READY -> NEEDS_REVIEW
    case.transition_to(CaseStatus.NEEDS_REVIEW)
    assert case.status == CaseStatus.NEEDS_REVIEW

    # NEEDS_REVIEW -> APPROVED_SIMULATED
    case.transition_to(CaseStatus.APPROVED_SIMULATED)
    assert case.status == CaseStatus.APPROVED_SIMULATED


def test_rejected_transition_path():
    case = ReviewCase(
        check_in_id=2,
        patient_id=1,
        status=CaseStatus.RECEIVED,
        priority="STANDARD",
        routing_reason="Initial ingestion",
        rule_version="rules v1.2-demo",
        workflow_version="workflow 0.1.0",
    )
    case.transition_to(CaseStatus.PROCESSING)
    case.transition_to(CaseStatus.NEEDS_REVIEW)
    case.transition_to(CaseStatus.REJECTED)
    assert case.status == CaseStatus.REJECTED


def test_processing_failed_and_retry_path():
    case = ReviewCase(
        check_in_id=3,
        patient_id=1,
        status=CaseStatus.RECEIVED,
        priority="STANDARD",
        routing_reason="Initial ingestion",
        rule_version="rules v1.2-demo",
        workflow_version="workflow 0.1.0",
    )
    case.transition_to(CaseStatus.PROCESSING)
    case.transition_to(CaseStatus.PROCESSING_FAILED)
    assert case.status == CaseStatus.PROCESSING_FAILED

    # Retry transition: PROCESSING_FAILED -> PROCESSING
    case.transition_to(CaseStatus.PROCESSING)
    assert case.status == CaseStatus.PROCESSING

    # Or to human review
    case.transition_to(CaseStatus.PROCESSING_FAILED)
    case.transition_to(CaseStatus.NEEDS_REVIEW)
    assert case.status == CaseStatus.NEEDS_REVIEW


def test_illegal_state_transitions_raise_error():
    case = ReviewCase(
        check_in_id=4,
        patient_id=1,
        status=CaseStatus.RECEIVED,
        priority="STANDARD",
        routing_reason="Initial ingestion",
        rule_version="rules v1.2-demo",
        workflow_version="workflow 0.1.0",
    )

    # Illegal: jumping directly from RECEIVED to APPROVED_SIMULATED
    with pytest.raises(InvalidStateTransitionError) as exc_info:
        case.transition_to(CaseStatus.APPROVED_SIMULATED)
    assert exc_info.value.current_status == CaseStatus.RECEIVED
    assert exc_info.value.target_status == CaseStatus.APPROVED_SIMULATED

    # Illegal: jumping directly from RECEIVED to REJECTED
    with pytest.raises(InvalidStateTransitionError):
        case.transition_to(CaseStatus.REJECTED)

    # Illegal: jumping directly from RECEIVED to DRAFT_READY
    with pytest.raises(InvalidStateTransitionError):
        case.transition_to(CaseStatus.DRAFT_READY)

    # Move to PROCESSING
    case.transition_to(CaseStatus.PROCESSING)

    # Illegal: PROCESSING -> RECEIVED (backward illegal transition)
    with pytest.raises(InvalidStateTransitionError):
        case.transition_to(CaseStatus.RECEIVED)

    # Move to DRAFT_READY
    case.transition_to(CaseStatus.DRAFT_READY)

    # Illegal: DRAFT_READY -> PROCESSING
    with pytest.raises(InvalidStateTransitionError):
        case.transition_to(CaseStatus.PROCESSING)

    # Move to terminal APPROVED_SIMULATED
    case.transition_to(CaseStatus.APPROVED_SIMULATED)

    # Illegal: any transition out of terminal APPROVED_SIMULATED
    for illegal_target in [
        CaseStatus.RECEIVED,
        CaseStatus.PROCESSING,
        CaseStatus.NEEDS_REVIEW,
        CaseStatus.DRAFT_READY,
        CaseStatus.REJECTED,
        CaseStatus.PROCESSING_FAILED,
    ]:
        with pytest.raises(InvalidStateTransitionError):
            case.transition_to(illegal_target)


def test_rejected_is_terminal():
    case = ReviewCase(
        check_in_id=5,
        patient_id=1,
        status=CaseStatus.RECEIVED,
        priority="STANDARD",
        routing_reason="Initial ingestion",
        rule_version="rules v1.2-demo",
        workflow_version="workflow 0.1.0",
    )
    case.transition_to(CaseStatus.PROCESSING)
    case.transition_to(CaseStatus.DRAFT_READY)
    case.transition_to(CaseStatus.REJECTED)

    # Illegal: any transition out of terminal REJECTED
    for illegal_target in [
        CaseStatus.RECEIVED,
        CaseStatus.PROCESSING,
        CaseStatus.DRAFT_READY,
        CaseStatus.APPROVED_SIMULATED,
    ]:
        with pytest.raises(InvalidStateTransitionError):
            case.transition_to(illegal_target)


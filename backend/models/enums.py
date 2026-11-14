import enum
from typing import Set, Dict


class CaseStatus(str, enum.Enum):
    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    DRAFT_READY = "DRAFT_READY"
    APPROVED_SIMULATED = "APPROVED_SIMULATED"
    REJECTED = "REJECTED"
    PROCESSING_FAILED = "PROCESSING_FAILED"


class InvalidStateTransitionError(ValueError):
    """Raised when an illegal transition is attempted on ReviewCase."""
    def __init__(self, current_status: CaseStatus, target_status: CaseStatus):
        super().__init__(
            f"Illegal state transition from {current_status.value} to {target_status.value}"
        )
        self.current_status = current_status
        self.target_status = target_status


# Validated state transition map
ALLOWED_TRANSITIONS: Dict[CaseStatus, Set[CaseStatus]] = {
    CaseStatus.RECEIVED: {CaseStatus.PROCESSING},
    CaseStatus.PROCESSING: {
        CaseStatus.NEEDS_REVIEW,
        CaseStatus.DRAFT_READY,
        CaseStatus.PROCESSING_FAILED,
    },
    CaseStatus.DRAFT_READY: {
        CaseStatus.NEEDS_REVIEW,
        CaseStatus.APPROVED_SIMULATED,
        CaseStatus.REJECTED,
    },
    CaseStatus.NEEDS_REVIEW: {
        CaseStatus.DRAFT_READY,
        CaseStatus.APPROVED_SIMULATED,
        CaseStatus.REJECTED,
    },
    CaseStatus.APPROVED_SIMULATED: set(),  # Terminal state
    CaseStatus.REJECTED: set(),            # Terminal state
    CaseStatus.PROCESSING_FAILED: {
        CaseStatus.PROCESSING,
        CaseStatus.NEEDS_REVIEW,
    },
}


def validate_transition(current: CaseStatus, target: CaseStatus) -> None:
    """Validates that a transition between statuses is legal according to policy."""
    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidStateTransitionError(current, target)


class ReviewDecisionType(str, enum.Enum):
    APPROVED_SIMULATED = "APPROVED_SIMULATED"
    REJECTED = "REJECTED"


class ActorType(str, enum.Enum):
    SYSTEM = "SYSTEM"
    WORKFLOW = "WORKFLOW"
    DEMO_REVIEWER = "DEMO_REVIEWER"


class AgentRunType(str, enum.Enum):
    EXTRACTION = "EXTRACTION"
    TRIAGE_POLICY = "TRIAGE_POLICY"
    DRAFT_SYNTHESIS = "DRAFT_SYNTHESIS"


class AgentRunStatus(str, enum.Enum):
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class SafetyGateStatus(str, enum.Enum):
    PASS = "PASS"
    FAIL = "FAIL"


class FeedbackRating(str, enum.Enum):
    ACCURATE = "ACCURATE"
    INACCURATE = "INACCURATE"
    UNSAFE_SUPPRESSED = "UNSAFE_SUPPRESSED"


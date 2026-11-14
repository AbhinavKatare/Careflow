import datetime
import hashlib
from typing import Optional, List, Dict, Any
from sqlalchemy import (
    Integer,
    String,
    Text,
    Boolean,
    Float,
    DateTime,
    ForeignKey,
    JSON,
    Enum as SAEnum,
    event,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)

from .enums import (
    CaseStatus,
    ReviewDecisionType,
    ActorType,
    AgentRunType,
    AgentRunStatus,
    SafetyGateStatus,
    FeedbackRating,
    validate_transition,
)


class Base(DeclarativeBase):
    pass


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class Clinic(Base):
    __tablename__ = "clinics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    programs: Mapped[List["Program"]] = relationship("Program", back_populates="clinic")
    patients: Mapped[List["DemoPatient"]] = relationship("DemoPatient", back_populates="clinic")


class Program(Base):
    __tablename__ = "programs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clinic_id: Mapped[int] = mapped_column(Integer, ForeignKey("clinics.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    clinic: Mapped["Clinic"] = relationship("Clinic", back_populates="programs")
    patients: Mapped[List["DemoPatient"]] = relationship("DemoPatient", back_populates="program")


class DemoPatient(Base):
    """
    Synthetic patient model.
    PERMANENT RULE: Fake names only ("Demo Patient 007"). Never real PHI.
    """
    __tablename__ = "demo_patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    initials: Mapped[str] = mapped_column(String(16), nullable=False)
    clinic_id: Mapped[int] = mapped_column(Integer, ForeignKey("clinics.id"), nullable=False, index=True)
    program_id: Mapped[int] = mapped_column(Integer, ForeignKey("programs.id"), nullable=False, index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    clinic: Mapped["Clinic"] = relationship("Clinic", back_populates="patients")
    program: Mapped["Program"] = relationship("Program", back_populates="patients")
    check_ins: Mapped[List["CheckIn"]] = relationship("CheckIn", back_populates="patient")


class CheckIn(Base):
    __tablename__ = "check_ins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(Integer, ForeignKey("demo_patients.id"), nullable=False, index=True)
    program_id: Mapped[int] = mapped_column(Integer, ForeignKey("programs.id"), nullable=False, index=True)
    status_selection: Mapped[str] = mapped_column(String(255), nullable=False)
    follow_up_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    submitted_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    patient: Mapped["DemoPatient"] = relationship("DemoPatient", back_populates="check_ins")
    submitted_text: Mapped[Optional["SubmittedText"]] = relationship(
        "SubmittedText", back_populates="check_in", uselist=False, cascade="all, delete-orphan"
    )
    extracted_facts: Mapped[List["ExtractedFact"]] = relationship(
        "ExtractedFact", back_populates="check_in", cascade="all, delete-orphan"
    )
    review_case: Mapped[Optional["ReviewCase"]] = relationship(
        "ReviewCase", back_populates="check_in", uselist=False
    )


class SubmittedText(Base):
    """
    PERMANENT RULE: Original submitted text is stored separately and never mutated.
    """
    __tablename__ = "submitted_texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    check_in_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("check_ins.id"), unique=True, nullable=False, index=True
    )
    raw_note: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    check_in: Mapped["CheckIn"] = relationship("CheckIn", back_populates="submitted_text")

    @classmethod
    def create_immutable(cls, check_in_id: int, raw_note: str) -> "SubmittedText":
        content_hash = hashlib.sha256(raw_note.encode("utf-8")).hexdigest()
        return cls(check_in_id=check_in_id, raw_note=raw_note, content_hash=content_hash)


@event.listens_for(SubmittedText, "before_update")
def receive_before_update_submitted_text(_mapper, _connection, target):
    """Guarantees original submitted text cannot be updated in database."""
    raise ValueError("SubmittedText is immutable and cannot be updated.")


class ExtractedFact(Base):
    """
    ExtractedFact with source_span reference into the original text.
    """
    __tablename__ = "extracted_facts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    check_in_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("check_ins.id"), nullable=False, index=True
    )
    agent_run_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("agent_runs.id"), nullable=True, index=True
    )
    fact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    fact_value: Mapped[str] = mapped_column(String(255), nullable=False)

    # Source span reference into the original text
    source_span_start: Mapped[int] = mapped_column(Integer, nullable=False)
    source_span_end: Mapped[int] = mapped_column(Integer, nullable=False)
    source_span_text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    check_in: Mapped["CheckIn"] = relationship("CheckIn", back_populates="extracted_facts")
    agent_run: Mapped[Optional["AgentRun"]] = relationship("AgentRun")

    def verify_source_span(self, original_text: str) -> bool:
        """Verifies that the source_span points to the exact substring in original_text."""
        if self.source_span_start < 0 or self.source_span_end > len(original_text):
            return False
        sliced = original_text[self.source_span_start:self.source_span_end]
        return sliced == self.source_span_text


class ReviewCase(Base):
    """
    Review case with validated state machine:
    RECEIVED -> PROCESSING -> (NEEDS_REVIEW | DRAFT_READY | PROCESSING_FAILED)
    DRAFT_READY / NEEDS_REVIEW -> APPROVED_SIMULATED | REJECTED
    """
    __tablename__ = "review_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    check_in_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("check_ins.id"), unique=True, nullable=False, index=True
    )
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("demo_patients.id"), nullable=False, index=True
    )
    status: Mapped[CaseStatus] = mapped_column(
        SAEnum(CaseStatus, name="case_status_enum"),
        default=CaseStatus.RECEIVED,
        nullable=False,
        index=True,
    )
    priority: Mapped[str] = mapped_column(String(32), default="STANDARD", nullable=False)
    routing_reason: Mapped[str] = mapped_column(Text, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_version: Mapped[str] = mapped_column(String(64), nullable=False)
    redacted_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contains_instruction_like_text: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    token_map_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    check_in: Mapped["CheckIn"] = relationship("CheckIn", back_populates="review_case")
    patient: Mapped["DemoPatient"] = relationship("DemoPatient")
    draft_messages: Mapped[List["DraftMessage"]] = relationship(
        "DraftMessage", back_populates="review_case", cascade="all, delete-orphan"
    )
    decisions: Mapped[List["ReviewDecision"]] = relationship(
        "ReviewDecision", back_populates="review_case", cascade="all, delete-orphan"
    )
    feedback_labels: Mapped[List["FeedbackLabel"]] = relationship(
        "FeedbackLabel", back_populates="review_case", cascade="all, delete-orphan"
    )

    def transition_to(self, new_status: CaseStatus) -> None:
        """Transitions case to new_status, enforcing the validated state machine."""
        validate_transition(self.status, new_status)
        self.status = new_status
        self.updated_at = utc_now()


class AgentRun(Base):
    """
    Tracks AI extraction, deterministic triage, or draft synthesis runs.
    PERMANENT RULE: AI output always references the run/model/rule version that produced it.
    """
    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_type: Mapped[AgentRunType] = mapped_column(
        SAEnum(AgentRunType, name="agent_run_type_enum"), nullable=False
    )
    model_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    rule_version: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_version: Mapped[str] = mapped_column(String(64), nullable=False)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[AgentRunStatus] = mapped_column(
        SAEnum(AgentRunStatus, name="agent_run_status_enum"), default=AgentRunStatus.SUCCESS, nullable=False
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    estimated_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    schema_valid: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    step_durations_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    completed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class DraftMessage(Base):
    """
    AI output always references run_id, model, rule_version, and workflow_version.
    """
    __tablename__ = "draft_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("review_cases.id"), nullable=False, index=True
    )
    recipient_patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("demo_patients.id"), nullable=False, index=True
    )
    agent_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agent_runs.id"), nullable=False, index=True
    )
    draft_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_edited_by_human: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    human_edited_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Provenance tracking
    model_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    rule_version: Mapped[str] = mapped_column(String(64), nullable=False)
    workflow_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    review_case: Mapped["ReviewCase"] = relationship("ReviewCase", back_populates="draft_messages")
    agent_run: Mapped["AgentRun"] = relationship("AgentRun")


class ReviewDecision(Base):
    """
    Simulated reviewer action.
    PERMANENT RULE: No outbound action. simulated_only is True, external_sent is False.
    """
    __tablename__ = "review_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("review_cases.id"), nullable=False, index=True
    )
    reviewer_id: Mapped[str] = mapped_column(String(128), nullable=False)
    decision: Mapped[ReviewDecisionType] = mapped_column(
        SAEnum(ReviewDecisionType, name="review_decision_enum"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    simulated_only: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    external_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    review_case: Mapped["ReviewCase"] = relationship("ReviewCase", back_populates="decisions")


class AuditEvent(Base):
    """
    Append-only audit log.
    PERMANENT RULE: Audit events never duplicate free text.
    """
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_type: Mapped[ActorType] = mapped_column(
        SAEnum(ActorType, name="actor_type_enum"), nullable=False
    )
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    metadata_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    @classmethod
    def create_event(
        cls,
        entity_type: str,
        entity_id: str,
        actor_type: ActorType,
        actor_id: str,
        action: str,
        metadata: Optional[Dict[str, Any]] = None,
        prohibited_raw_text: Optional[str] = None,
    ) -> "AuditEvent":
        meta = metadata or {}
        # Enforce that audit events never duplicate free text
        if prohibited_raw_text and prohibited_raw_text.strip():
            serialized_meta = str(meta).lower()
            raw_stripped = prohibited_raw_text.strip().lower()
            if len(raw_stripped) > 5 and raw_stripped in serialized_meta:
                raise ValueError("Audit events must never duplicate participant free text.")

        return cls(
            entity_type=entity_type,
            entity_id=str(entity_id),
            actor_type=actor_type,
            actor_id=actor_id,
            action=action,
            metadata_json=meta,
        )


@event.listens_for(AuditEvent, "before_update")
def receive_before_update_audit_event(_mapper, _connection, target):
    """Guarantees audit log is append-only."""
    raise ValueError("AuditEvent records are append-only and cannot be updated.")


@event.listens_for(AuditEvent, "before_delete")
def receive_before_delete_audit_event(_mapper, _connection, target):
    """Guarantees audit log records cannot be deleted."""
    raise ValueError("AuditEvent records are append-only and cannot be deleted.")


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fixture_version: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_version: Mapped[str] = mapped_column(String(64), nullable=False)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False)
    passed_count: Mapped[int] = mapped_column(Integer, nullable=False)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False)
    critical_misses: Mapped[int] = mapped_column(Integer, nullable=False)
    route_accuracy: Mapped[float] = mapped_column(Float, nullable=False)
    safety_gate: Mapped[SafetyGateStatus] = mapped_column(
        SAEnum(SafetyGateStatus, name="safety_gate_status_enum"), nullable=False
    )
    latency_p50_ms: Mapped[float] = mapped_column(Float, nullable=False)
    latency_p95_ms: Mapped[float] = mapped_column(Float, nullable=False)
    executed_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class FeedbackLabel(Base):
    __tablename__ = "feedback_labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("review_cases.id"), nullable=False, index=True
    )
    draft_message_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("draft_messages.id"), nullable=True, index=True
    )
    reviewer_id: Mapped[str] = mapped_column(String(128), nullable=False)
    rating: Mapped[FeedbackRating] = mapped_column(
        SAEnum(FeedbackRating, name="feedback_rating_enum"), nullable=False
    )
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    review_case: Mapped["ReviewCase"] = relationship("ReviewCase", back_populates="feedback_labels")
    draft_message: Mapped[Optional["DraftMessage"]] = relationship("DraftMessage")


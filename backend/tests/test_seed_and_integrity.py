import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from backend.models.models import (
    Base,
    Clinic,
    Program,
    DemoPatient,
    CheckIn,
    SubmittedText,
    ExtractedFact,
    ReviewCase,
    DraftMessage,
    ReviewDecision,
    AuditEvent,
    AgentRun,
)
from backend.models.enums import (
    CaseStatus,
    ReviewDecisionType,
    ActorType,
    AgentRunType,
    AgentRunStatus,
)
from backend.seed import seed_fictional_data
from backend.repositories.sqlalchemy_repo import SqlAlchemyUnitOfWork


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def test_seed_is_idempotent(session):
    # First seed execution
    result_1 = seed_fictional_data(session)
    assert result_1["clinics_created"] == 2
    assert result_1["programs_created"] == 2
    assert result_1["patients_created"] == 12
    assert result_1["total_clinics"] == 2
    assert result_1["total_programs"] == 2
    assert result_1["total_patients"] == 12

    # Second seed execution (must be completely idempotent)
    result_2 = seed_fictional_data(session)
    assert result_2["clinics_created"] == 0
    assert result_2["programs_created"] == 0
    assert result_2["patients_created"] == 0
    assert result_2["total_clinics"] == 2
    assert result_2["total_programs"] == 2
    assert result_2["total_patients"] == 12

    # Verify patient names are obviously fake (e.g. "Demo Patient 007")
    uow = SqlAlchemyUnitOfWork(session)
    patients = uow.patients.list_all()
    assert len(patients) == 12

    for patient in patients:
        assert patient.full_name.startswith("Demo Patient")
        assert patient.patient_id.startswith("DEMO-P")


def test_original_submitted_text_is_immutable(session):
    uow = SqlAlchemyUnitOfWork(session)
    seed_fictional_data(session)

    patient = uow.patients.list_all()[0]
    program = uow.programs.list_all()[0]

    with uow:
        check_in = CheckIn(
            patient_id=patient.id,
            program_id=program.id,
            status_selection="On track with weekly routine",
            follow_up_requested=False,
        )
        uow.check_ins.create(check_in, raw_note="Everything is fine this week.")

    # Retrieve submitted text
    sub_text = uow.check_ins.get_submitted_text(check_in.id)
    assert sub_text is not None
    assert sub_text.raw_note == "Everything is fine this week."
    assert len(sub_text.content_hash) == 64

    # Attempting to mutate original submitted text raises error
    sub_text.raw_note = "Mutated text"
    with pytest.raises(ValueError, match="SubmittedText is immutable"):
        session.flush()


def test_extracted_fact_source_span_reference(session):
    uow = SqlAlchemyUnitOfWork(session)
    seed_fictional_data(session)

    patient = uow.patients.list_all()[0]
    program = uow.programs.list_all()[0]

    original_text = "I am having mild joint stiffness in the morning."
    with uow:
        check_in = CheckIn(
            patient_id=patient.id,
            program_id=program.id,
            status_selection="On track with routine",
            follow_up_requested=False,
        )
        uow.check_ins.create(check_in, raw_note=original_text)

        agent_run = AgentRun(
            run_type=AgentRunType.EXTRACTION,
            model_name="mock-extractor-v1",
            rule_version="rules v1.2-demo",
            workflow_version="workflow 0.1.0",
            latency_ms=12.5,
            status=AgentRunStatus.SUCCESS,
        )
        session.add(agent_run)
        session.flush()

        # "mild joint stiffness" starts at index 12, ends at 32
        span_start = original_text.index("mild joint stiffness")
        span_end = span_start + len("mild joint stiffness")
        span_text = original_text[span_start:span_end]

        fact = ExtractedFact(
            check_in_id=check_in.id,
            agent_run_id=agent_run.id,
            fact_type="symptom",
            fact_value="mild joint stiffness",
            source_span_start=span_start,
            source_span_end=span_end,
            source_span_text=span_text,
            confidence=0.98,
        )
        session.add(fact)
        session.flush()

    # Verify source span integrity
    assert fact.verify_source_span(original_text) is True

    # Tampered span text fails verification
    assert fact.verify_source_span("Different text entirely") is False


def test_ai_output_references_provenance(session):
    uow = SqlAlchemyUnitOfWork(session)
    seed_fictional_data(session)

    patient = uow.patients.list_all()[0]
    program = uow.programs.list_all()[0]

    with uow:
        check_in = CheckIn(
            patient_id=patient.id,
            program_id=program.id,
            status_selection="On track with routine",
            follow_up_requested=False,
        )
        uow.check_ins.create(check_in, raw_note="")

        case = ReviewCase(
            check_in_id=check_in.id,
            patient_id=patient.id,
            status=CaseStatus.DRAFT_READY,
            priority="STANDARD",
            routing_reason="Routine check-in",
            rule_version="rules v1.2-demo",
            workflow_version="workflow 0.1.0",
        )
        uow.review_cases.create(case)

        agent_run = AgentRun(
            run_type=AgentRunType.DRAFT_SYNTHESIS,
            model_name="mock-drafter-v1",
            rule_version="rules v1.2-demo",
            workflow_version="workflow 0.1.0",
            latency_ms=18.4,
            status=AgentRunStatus.SUCCESS,
        )
        session.add(agent_run)
        session.flush()

        # AI output always references the run/model/rule version that produced it
        draft = DraftMessage(
            review_case_id=case.id,
            recipient_patient_id=patient.id,
            agent_run_id=agent_run.id,
            draft_text="Thanks for checking in, Demo Patient 001.",
            model_name=agent_run.model_name,
            rule_version=agent_run.rule_version,
            workflow_version=agent_run.workflow_version,
        )
        session.add(draft)
        session.flush()

    assert draft.agent_run_id == agent_run.id
    assert draft.model_name == "mock-drafter-v1"
    assert draft.rule_version == "rules v1.2-demo"
    assert draft.workflow_version == "workflow 0.1.0"


def test_audit_events_append_only_and_no_free_text(session):
    uow = SqlAlchemyUnitOfWork(session)

    # 1. Valid audit event without free text
    event_1 = AuditEvent.create_event(
        entity_type="ReviewCase",
        entity_id="1",
        actor_type=ActorType.WORKFLOW,
        actor_id="rule-engine-v1.2",
        action="CASE_ROUTED_TO_DRAFT",
        metadata={"previous_status": "PROCESSING", "new_status": "DRAFT_READY"},
        prohibited_raw_text="Patient entered private unverified note text here",
    )
    with uow:
        uow.audit_events.append(event_1)

    assert event_1.id is not None
    assert event_1.action == "CASE_ROUTED_TO_DRAFT"

    # 2. Attempting to duplicate free text in audit event raises error
    free_text_sample = "Confidential free text note submitted by user"
    with pytest.raises(ValueError, match="Audit events must never duplicate participant free text"):
        AuditEvent.create_event(
            entity_type="ReviewCase",
            entity_id="1",
            actor_type=ActorType.WORKFLOW,
            actor_id="rule-engine",
            action="LOG_INPUT",
            metadata={"captured_text": f"User said: {free_text_sample}"},
            prohibited_raw_text=free_text_sample,
        )

    # 3. AuditEvent is append-only: cannot be updated
    event_1.action = "ALTERED_ACTION"
    with pytest.raises(ValueError, match="AuditEvent records are append-only"):
        session.flush()

    session.rollback()

    # 4. AuditEvent is append-only: cannot be deleted
    event_to_delete = uow.audit_events.list_for_entity("ReviewCase", "1")[0]
    session.delete(event_to_delete)
    with pytest.raises(ValueError, match="AuditEvent records are append-only"):
        session.flush()


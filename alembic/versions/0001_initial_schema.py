"""initial schema for careflow

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-11-11 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Clinics
    op.create_table(
        "clinics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_clinics_code"), "clinics", ["code"], unique=True)

    # 2. Programs
    op.create_table(
        "programs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("clinic_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_programs_clinic_id"), "programs", ["clinic_id"], unique=False)
    op.create_index(op.f("ix_programs_code"), "programs", ["code"], unique=False)

    # 3. DemoPatients
    op.create_table(
        "demo_patients",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("initials", sa.String(length=16), nullable=False),
        sa.Column("clinic_id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id"),
    )
    op.create_index(op.f("ix_demo_patients_clinic_id"), "demo_patients", ["clinic_id"], unique=False)
    op.create_index(op.f("ix_demo_patients_patient_id"), "demo_patients", ["patient_id"], unique=True)
    op.create_index(op.f("ix_demo_patients_program_id"), "demo_patients", ["program_id"], unique=False)

    # 4. CheckIns
    op.create_table(
        "check_ins",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.Column("status_selection", sa.String(length=255), nullable=False),
        sa.Column("follow_up_requested", sa.Boolean(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["demo_patients.id"]),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_check_ins_patient_id"), "check_ins", ["patient_id"], unique=False)
    op.create_index(op.f("ix_check_ins_program_id"), "check_ins", ["program_id"], unique=False)

    # 5. SubmittedTexts (original submitted text stored separately and never mutated)
    op.create_table(
        "submitted_texts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("check_in_id", sa.Integer(), nullable=False),
        sa.Column("raw_note", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["check_in_id"], ["check_ins.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("check_in_id"),
    )
    op.create_index(op.f("ix_submitted_texts_check_in_id"), "submitted_texts", ["check_in_id"], unique=True)

    # 6. AgentRuns
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_type", sa.String(length=64), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=True),
        sa.Column("rule_version", sa.String(length=64), nullable=False),
        sa.Column("workflow_version", sa.String(length=64), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("prompt_version", sa.String(length=64), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("estimated_cost", sa.Float(), nullable=True),
        sa.Column("schema_valid", sa.Boolean(), nullable=True),
        sa.Column("step_durations_json", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # 7. ExtractedFacts (with source_span reference into the original text)
    op.create_table(
        "extracted_facts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("check_in_id", sa.Integer(), nullable=False),
        sa.Column("agent_run_id", sa.Integer(), nullable=True),
        sa.Column("fact_type", sa.String(length=64), nullable=False),
        sa.Column("fact_value", sa.String(length=255), nullable=False),
        sa.Column("source_span_start", sa.Integer(), nullable=False),
        sa.Column("source_span_end", sa.Integer(), nullable=False),
        sa.Column("source_span_text", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agent_run_id"], ["agent_runs.id"]),
        sa.ForeignKeyConstraint(["check_in_id"], ["check_ins.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_extracted_facts_agent_run_id"), "extracted_facts", ["agent_run_id"], unique=False)
    op.create_index(op.f("ix_extracted_facts_check_in_id"), "extracted_facts", ["check_in_id"], unique=False)

    # 8. ReviewCases (validated state machine)
    op.create_table(
        "review_cases",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("check_in_id", sa.Integer(), nullable=False),
        sa.Column("patient_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("routing_reason", sa.Text(), nullable=False),
        sa.Column("rule_version", sa.String(length=64), nullable=False),
        sa.Column("workflow_version", sa.String(length=64), nullable=False),
        sa.Column("redacted_preview", sa.Text(), nullable=True),
        sa.Column("contains_instruction_like_text", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("token_map_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["check_in_id"], ["check_ins.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["demo_patients.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("check_in_id"),
    )
    op.create_index(op.f("ix_review_cases_check_in_id"), "review_cases", ["check_in_id"], unique=True)
    op.create_index(op.f("ix_review_cases_patient_id"), "review_cases", ["patient_id"], unique=False)
    op.create_index(op.f("ix_review_cases_status"), "review_cases", ["status"], unique=False)

    # 9. DraftMessages (AI output always references run/model/rule version)
    op.create_table(
        "draft_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("review_case_id", sa.Integer(), nullable=False),
        sa.Column("recipient_patient_id", sa.Integer(), nullable=False),
        sa.Column("agent_run_id", sa.Integer(), nullable=False),
        sa.Column("draft_text", sa.Text(), nullable=False),
        sa.Column("is_edited_by_human", sa.Boolean(), nullable=False),
        sa.Column("human_edited_text", sa.Text(), nullable=True),
        sa.Column("model_name", sa.String(length=128), nullable=True),
        sa.Column("rule_version", sa.String(length=64), nullable=False),
        sa.Column("workflow_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agent_run_id"], ["agent_runs.id"]),
        sa.ForeignKeyConstraint(["recipient_patient_id"], ["demo_patients.id"]),
        sa.ForeignKeyConstraint(["review_case_id"], ["review_cases.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_draft_messages_agent_run_id"), "draft_messages", ["agent_run_id"], unique=False)
    op.create_index(op.f("ix_draft_messages_recipient_patient_id"), "draft_messages", ["recipient_patient_id"], unique=False)
    op.create_index(op.f("ix_draft_messages_review_case_id"), "draft_messages", ["review_case_id"], unique=False)

    # 10. ReviewDecisions (simulated only, nothing sent)
    op.create_table(
        "review_decisions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("review_case_id", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.String(length=128), nullable=False),
        sa.Column("decision", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("simulated_only", sa.Boolean(), nullable=False),
        sa.Column("external_sent", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["review_case_id"], ["review_cases.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_review_decisions_review_case_id"), "review_decisions", ["review_case_id"], unique=False)

    # 11. AuditEvents (append-only, never duplicates free text)
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("actor_type", sa.String(length=64), nullable=False),
        sa.Column("actor_id", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_events_entity_id"), "audit_events", ["entity_id"], unique=False)
    op.create_index(op.f("ix_audit_events_entity_type"), "audit_events", ["entity_type"], unique=False)

    # 12. EvaluationRuns
    op.create_table(
        "evaluation_runs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("fixture_version", sa.String(length=64), nullable=False),
        sa.Column("rule_version", sa.String(length=64), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("passed_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("critical_misses", sa.Integer(), nullable=False),
        sa.Column("route_accuracy", sa.Float(), nullable=False),
        sa.Column("safety_gate", sa.String(length=16), nullable=False),
        sa.Column("latency_p50_ms", sa.Float(), nullable=False),
        sa.Column("latency_p95_ms", sa.Float(), nullable=False),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # 13. FeedbackLabels
    op.create_table(
        "feedback_labels",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("review_case_id", sa.Integer(), nullable=False),
        sa.Column("draft_message_id", sa.Integer(), nullable=True),
        sa.Column("reviewer_id", sa.String(length=128), nullable=False),
        sa.Column("rating", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["draft_message_id"], ["draft_messages.id"]),
        sa.ForeignKeyConstraint(["review_case_id"], ["review_cases.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_feedback_labels_draft_message_id"), "feedback_labels", ["draft_message_id"], unique=False)
    op.create_index(op.f("ix_feedback_labels_review_case_id"), "feedback_labels", ["review_case_id"], unique=False)


def downgrade() -> None:
    op.drop_table("feedback_labels")
    op.drop_table("evaluation_runs")
    op.drop_table("audit_events")
    op.drop_table("review_decisions")
    op.drop_table("draft_messages")
    op.drop_table("review_cases")
    op.drop_table("extracted_facts")
    op.drop_table("agent_runs")
    op.drop_table("submitted_texts")
    op.drop_table("check_ins")
    op.drop_table("demo_patients")
    op.drop_table("programs")
    op.drop_table("clinics")


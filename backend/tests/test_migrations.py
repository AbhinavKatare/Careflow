import os
import tempfile
import pytest
from alembic.config import Config
from alembic import command
from sqlalchemy import create_engine, inspect


@pytest.fixture
def empty_db_url():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    url = f"sqlite:///{path}"
    engine = None
    try:
        yield url, path
    finally:
        if engine:
            engine.dispose()
        if os.path.exists(path):
            try:
                os.remove(path)
            except PermissionError:
                pass


def test_migrations_apply_cleanly_on_empty_db(empty_db_url):
    url, path = empty_db_url

    # Setup alembic config pointing to the fresh temp database
    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option("sqlalchemy.url", url)

    # 1. Apply all migrations on the empty database
    command.upgrade(alembic_cfg, "head")

    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())

        expected_tables = {
            "clinics",
            "programs",
            "demo_patients",
            "check_ins",
            "submitted_texts",
            "agent_runs",
            "extracted_facts",
            "review_cases",
            "draft_messages",
            "review_decisions",
            "audit_events",
            "evaluation_runs",
            "feedback_labels",
            "alembic_version",
        }

        assert expected_tables.issubset(tables), f"Missing tables: {expected_tables - tables}"

        # Verify check_ins columns
        check_in_cols = {c["name"] for c in inspector.get_columns("check_ins")}
        assert {"id", "patient_id", "program_id", "status_selection", "follow_up_requested", "submitted_at"}.issubset(check_in_cols)

        # Verify submitted_texts columns
        submitted_cols = {c["name"] for c in inspector.get_columns("submitted_texts")}
        assert {"id", "check_in_id", "raw_note", "content_hash", "created_at"}.issubset(submitted_cols)

        # Verify review_cases columns
        review_case_cols = {c["name"] for c in inspector.get_columns("review_cases")}
        assert {"id", "check_in_id", "patient_id", "status", "priority", "routing_reason", "rule_version", "workflow_version"}.issubset(review_case_cols)

        # 2. Test rollback to base
        engine.dispose()
        command.downgrade(alembic_cfg, "base")

        engine = create_engine(url)
        inspector_after_downgrade = inspect(engine)
        tables_after = set(inspector_after_downgrade.get_table_names())
        assert "review_cases" not in tables_after
        assert "check_ins" not in tables_after
        assert "demo_patients" not in tables_after

        # 3. Test re-upgrade
        engine.dispose()
        command.upgrade(alembic_cfg, "head")

        engine = create_engine(url)
        inspector_reup = inspect(engine)
        assert expected_tables.issubset(set(inspector_reup.get_table_names()))
    finally:
        engine.dispose()

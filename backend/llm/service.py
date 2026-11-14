"""
LLM Execution Service: Orchestrates resilient adapter invocation and persists operational metadata to AgentRun.
PERMANENT RULES:
- Never log prompts or raw patient text.
- Metadata must be persisted on AgentRun.
- Deterministic routing is kept strictly in TypeScript; LLMs only extract facts or draft communications.
"""

import time
import datetime
from typing import Optional, Tuple
from sqlalchemy.orm import Session

from backend.models.enums import AgentRunStatus, AgentRunType
from backend.models.models import AgentRun
from backend.llm.adapter import LLMAdapter
from backend.llm.factory import get_llm_adapter
from backend.llm.resilience import CircuitBreaker, execute_with_resilience
from backend.llm.types import (
    DraftOutput,
    ExtractionOutput,
    LLMAdapterError,
    LLMCallMetadata,
)


class LLMService:
    """
    High-level service coordinating LLM calls, resilience (circuit breaker + jittered retries),
    Pydantic schema validation, and persistence of run metadata to AgentRun records.
    """

    def __init__(
        self,
        adapter: Optional[LLMAdapter] = None,
        circuit_breaker: Optional[CircuitBreaker] = None,
        max_retries: int = 2,
        rule_version: str = "rules v1.0",
        workflow_version: str = "workflow 0.1.0",
    ):
        self.adapter = adapter or get_llm_adapter()
        self.circuit_breaker = circuit_breaker or CircuitBreaker()
        self.max_retries = max_retries
        self.rule_version = rule_version
        self.workflow_version = workflow_version

    def extract_clinical_facts(
        self,
        patient_text: str,
        prompt_version: str = "extract_v1",
        timeout: float = 2.0,
        session: Optional[Session] = None,
    ) -> Tuple[ExtractionOutput, AgentRun]:
        """
        Extracts structured facts under resilience protection and persists AgentRun metadata.
        """
        start_wall = datetime.datetime.now(datetime.timezone.utc)
        start_perf = time.perf_counter()

        def _call():
            return self.adapter.generate_extraction(
                patient_text=patient_text,
                prompt_version=prompt_version,
                timeout=timeout,
            )

        try:
            response = execute_with_resilience(
                func=_call,
                circuit_breaker=self.circuit_breaker,
                max_retries=self.max_retries,
            )
            completed_wall = datetime.datetime.now(datetime.timezone.utc)
            metadata = response.metadata
            data = response.data

            agent_run = AgentRun(
                run_type=AgentRunType.EXTRACTION,
                model_name=metadata.model_id,
                rule_version=self.rule_version,
                workflow_version=self.workflow_version,
                latency_ms=metadata.latency_ms,
                status=AgentRunStatus.SUCCESS,
                error_message=None,
                prompt_version=metadata.prompt_version,
                input_tokens=metadata.input_tokens,
                output_tokens=metadata.output_tokens,
                estimated_cost=metadata.estimated_cost,
                schema_valid=metadata.schema_valid,
                started_at=start_wall,
                completed_at=completed_wall,
            )

            if session:
                session.add(agent_run)
                session.flush()

            return data, agent_run

        except Exception as err:
            completed_wall = datetime.datetime.now(datetime.timezone.utc)
            latency_ms = round((time.perf_counter() - start_perf) * 1000, 3)

            agent_run = AgentRun(
                run_type=AgentRunType.EXTRACTION,
                model_name=self.adapter.model_id,
                rule_version=self.rule_version,
                workflow_version=self.workflow_version,
                latency_ms=latency_ms,
                status=AgentRunStatus.FAILED,
                error_message=str(err),
                prompt_version=prompt_version,
                input_tokens=0,
                output_tokens=0,
                estimated_cost=0.0,
                schema_valid=False,
                started_at=start_wall,
                completed_at=completed_wall,
            )

            if session:
                session.add(agent_run)
                session.flush()

            raise err

    def draft_communication(
        self,
        patient_text: str,
        patient_name: str = "Demo Patient 001",
        program_name: str = "Weekly check-in",
        prompt_version: str = "draft_v1",
        timeout: float = 2.0,
        session: Optional[Session] = None,
    ) -> Tuple[DraftOutput, AgentRun]:
        """
        Drafts routine communication under resilience protection and persists AgentRun metadata.
        """
        start_wall = datetime.datetime.now(datetime.timezone.utc)
        start_perf = time.perf_counter()

        def _call():
            return self.adapter.generate_draft(
                patient_text=patient_text,
                patient_name=patient_name,
                program_name=program_name,
                prompt_version=prompt_version,
                timeout=timeout,
            )

        try:
            response = execute_with_resilience(
                func=_call,
                circuit_breaker=self.circuit_breaker,
                max_retries=self.max_retries,
            )
            completed_wall = datetime.datetime.now(datetime.timezone.utc)
            metadata = response.metadata
            data = response.data

            agent_run = AgentRun(
                run_type=AgentRunType.DRAFT_SYNTHESIS,
                model_name=metadata.model_id,
                rule_version=self.rule_version,
                workflow_version=self.workflow_version,
                latency_ms=metadata.latency_ms,
                status=AgentRunStatus.SUCCESS,
                error_message=None,
                prompt_version=metadata.prompt_version,
                input_tokens=metadata.input_tokens,
                output_tokens=metadata.output_tokens,
                estimated_cost=metadata.estimated_cost,
                schema_valid=metadata.schema_valid,
                started_at=start_wall,
                completed_at=completed_wall,
            )

            if session:
                session.add(agent_run)
                session.flush()

            return data, agent_run

        except Exception as err:
            completed_wall = datetime.datetime.now(datetime.timezone.utc)
            latency_ms = round((time.perf_counter() - start_perf) * 1000, 3)

            agent_run = AgentRun(
                run_type=AgentRunType.DRAFT_SYNTHESIS,
                model_name=self.adapter.model_id,
                rule_version=self.rule_version,
                workflow_version=self.workflow_version,
                latency_ms=latency_ms,
                status=AgentRunStatus.FAILED,
                error_message=str(err),
                prompt_version=prompt_version,
                input_tokens=0,
                output_tokens=0,
                estimated_cost=0.0,
                schema_valid=False,
                started_at=start_wall,
                completed_at=completed_wall,
            )

            if session:
                session.add(agent_run)
                session.flush()

            raise err

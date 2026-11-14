"""
Deterministic Mock LLM Adapter with Failure-Injection Modes.
Zero credentials required. Deterministic by default.
"""

import json
import time
from typing import List, Optional
from pydantic import ValidationError

from backend.llm.adapter import LLMAdapter
from backend.llm.prompts import build_draft_prompt, build_extraction_prompt
from backend.llm.types import (
    DraftOutput,
    ExtractedFactItem,
    ExtractionOutput,
    FailureMode,
    LLMCallMetadata,
    LLMMalformedJSONError,
    LLMSchemaValidationError,
    LLMTimeoutError,
    StructuredResponse,
)


class MockAdapter(LLMAdapter):
    """
    Deterministic mock adapter supporting simulated failure modes for robust testing.
    """

    def __init__(
        self,
        failure_mode: FailureMode = FailureMode.NONE,
        simulated_delay_s: float = 0.001,
        input_token_rate: float = 0.0000015,
        output_token_rate: float = 0.000002,
    ):
        self.failure_mode = failure_mode
        self.simulated_delay_s = simulated_delay_s
        self.input_token_rate = input_token_rate
        self.output_token_rate = output_token_rate
        self.recorded_requests: List[str] = []

    @property
    def model_id(self) -> str:
        return "mock-deterministic-v1"

    def set_failure_mode(self, mode: FailureMode) -> None:
        self.failure_mode = mode

    def _estimate_cost(self, in_tokens: int, out_tokens: int) -> float:
        cost = (in_tokens * self.input_token_rate) + (out_tokens * self.output_token_rate)
        return round(cost, 6)

    def generate_extraction(
        self,
        patient_text: str,
        prompt_version: str = "extract_v1",
        timeout: float = 2.0,
    ) -> StructuredResponse[ExtractionOutput]:
        start_time = time.perf_counter()

        # Build prompt using versioned template (wrapped untrusted data)
        prompt = build_extraction_prompt(patient_text, prompt_version)
        self.recorded_requests.append(prompt)
        in_tokens = max(10, len(prompt) // 4)

        if self.simulated_delay_s > 0:
            time.sleep(self.simulated_delay_s)

        # Check for failure injection modes
        if self.failure_mode == FailureMode.TIMEOUT:
            # Simulate exceeding deadline
            raise LLMTimeoutError(
                f"Mock adapter timed out after {timeout:.2f}s deadline (simulated failure mode: TIMEOUT)."
            )

        if self.failure_mode == FailureMode.MALFORMED_JSON:
            raise LLMMalformedJSONError(
                'Failed to parse LLM JSON: {"facts": [{"fact_type": "SYMPTOM", "fact_value": ... truncated'
            )

        if self.failure_mode == FailureMode.WRONG_LABELS:
            # Raw payload contains invalid enum label for fact_type
            bad_raw = {
                "facts": [
                    {
                        "fact_type": "UNSUPPORTED_DISCORD_LABEL",  # Violates Literal enum
                        "fact_value": "chest pain",
                        "source_span_start": 0,
                        "source_span_end": 10,
                        "source_span_text": "chest pain",
                        "confidence": 0.95,
                    }
                ],
                "summary": "Patient reported chest symptoms.",
            }
            try:
                ExtractionOutput.model_validate(bad_raw)
            except ValidationError as val_err:
                raise LLMSchemaValidationError(
                    f"Pydantic schema validation failed: {val_err}",
                    raw_payload=json.dumps(bad_raw),
                    validation_errors=val_err.errors(),
                ) from val_err

        if self.failure_mode == FailureMode.FABRICATED_FIELDS:
            # Extra fields forbidden by ConfigDict(extra='forbid') or missing required fields
            fabricated_raw = {
                "facts": [
                    {
                        "fact_type": "SYMPTOM",
                        "fact_value": "chest pain",
                        "source_span_start": 0,
                        "source_span_end": 10,
                        "source_span_text": "chest pain",
                        "confidence": 0.95,
                        "hallucinated_clinical_diagnosis": "Acute myocardial infarction",  # Forbidden extra field!
                    }
                ],
                "summary": "Summary text",
            }
            try:
                ExtractionOutput.model_validate(fabricated_raw)
            except ValidationError as val_err:
                raise LLMSchemaValidationError(
                    f"Pydantic schema validation failed: {val_err}",
                    raw_payload=json.dumps(fabricated_raw),
                    validation_errors=val_err.errors(),
                ) from val_err

        # Normal deterministic extraction
        facts: List[ExtractedFactItem] = []
        text_lower = (patient_text or "").lower()

        # Known symptom keywords for deterministic synthetic extraction
        symptom_phrases = ["chest pain", "shortness of breath", "fever", "nausea", "headache", "extreme difficulty"]
        for phrase in symptom_phrases:
            idx = text_lower.find(phrase)
            if idx != -1:
                facts.append(
                    ExtractedFactItem(
                        fact_type="SYMPTOM",
                        fact_value=phrase,
                        source_span_start=idx,
                        source_span_end=idx + len(phrase),
                        source_span_text=patient_text[idx : idx + len(phrase)],
                        confidence=0.96,
                    )
                )

        if "on track" in text_lower:
            idx = text_lower.find("on track")
            facts.append(
                ExtractedFactItem(
                    fact_type="ROUTINE_STATUS",
                    fact_value="on track with weekly routine",
                    source_span_start=idx,
                    source_span_end=idx + len("on track"),
                    source_span_text=patient_text[idx : idx + len("on track")],
                    confidence=0.98,
                )
            )

        if "question" in text_lower or "follow up" in text_lower:
            idx = max(text_lower.find("question"), text_lower.find("follow up"))
            facts.append(
                ExtractedFactItem(
                    fact_type="FOLLOW_UP_REQUEST",
                    fact_value="care team follow-up requested",
                    source_span_start=idx,
                    source_span_end=idx + 8,
                    source_span_text=patient_text[idx : idx + 8],
                    confidence=0.94,
                )
            )

        summary = (
            f"Extracted {len(facts)} clinical facts from synthetic patient update."
            if facts
            else "No specific clinical symptoms or requests extracted."
        )

        output = ExtractionOutput(facts=facts, summary=summary)
        out_tokens = max(15, len(output.model_dump_json()) // 4)

        end_time = time.perf_counter()
        latency_ms = round((end_time - start_time) * 1000, 3)

        metadata = LLMCallMetadata(
            model_id=self.model_id,
            latency_ms=latency_ms,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            estimated_cost=self._estimate_cost(in_tokens, out_tokens),
            schema_valid=True,
            prompt_version=prompt_version,
        )

        return StructuredResponse[ExtractionOutput](data=output, metadata=metadata)

    def generate_draft(
        self,
        patient_text: str,
        patient_name: str = "Demo Patient 001",
        program_name: str = "Weekly check-in",
        prompt_version: str = "draft_v1",
        timeout: float = 2.0,
    ) -> StructuredResponse[DraftOutput]:
        start_time = time.perf_counter()

        prompt = build_draft_prompt(patient_text, patient_name, program_name, prompt_version)
        self.recorded_requests.append(prompt)
        in_tokens = max(10, len(prompt) // 4)

        if self.simulated_delay_s > 0:
            time.sleep(self.simulated_delay_s)

        if self.failure_mode == FailureMode.TIMEOUT:
            raise LLMTimeoutError(f"Mock adapter timed out after {timeout:.2f}s deadline.")

        if self.failure_mode == FailureMode.MALFORMED_JSON:
            raise LLMMalformedJSONError("Failed to parse draft JSON.")

        if self.failure_mode == FailureMode.WRONG_LABELS:
            bad_raw = {
                "draft_message": f"Hello {patient_name}.",
                "tone": "UNSUPPORTED_HOSTILE_TONE",  # Invalid enum value
                "requires_clinician_attention": False,
                "rationale": "Drafted routine message.",
            }
            try:
                DraftOutput.model_validate(bad_raw)
            except ValidationError as val_err:
                raise LLMSchemaValidationError(
                    f"Pydantic schema validation failed: {val_err}",
                    raw_payload=json.dumps(bad_raw),
                    validation_errors=val_err.errors(),
                ) from val_err

        if self.failure_mode == FailureMode.FABRICATED_FIELDS:
            bad_raw = {
                "draft_message": f"Hello {patient_name}.",
                "tone": "NEUTRAL_PROFESSIONAL",
                "requires_clinician_attention": False,
                "rationale": "Drafted routine message.",
                "fabricated_medical_prescription": "Amoxicillin 500mg",  # Forbidden extra field!
            }
            try:
                DraftOutput.model_validate(bad_raw)
            except ValidationError as val_err:
                raise LLMSchemaValidationError(
                    f"Pydantic schema validation failed: {val_err}",
                    raw_payload=json.dumps(bad_raw),
                    validation_errors=val_err.errors(),
                ) from val_err

        # Normal draft generation
        draft_msg = f"Thank you for completing your weekly check-in, {patient_name}. Your care team has received your update."
        output = DraftOutput(
            draft_message=draft_msg,
            tone="NEUTRAL_PROFESSIONAL",
            requires_clinician_attention=False,
            rationale="Routine acknowledgment; simulated for staff review.",
        )
        out_tokens = max(15, len(output.model_dump_json()) // 4)

        end_time = time.perf_counter()
        latency_ms = round((end_time - start_time) * 1000, 3)

        metadata = LLMCallMetadata(
            model_id=self.model_id,
            latency_ms=latency_ms,
            input_tokens=in_tokens,
            output_tokens=out_tokens,
            estimated_cost=self._estimate_cost(in_tokens, out_tokens),
            schema_valid=True,
            prompt_version=prompt_version,
        )

        return StructuredResponse[DraftOutput](data=output, metadata=metadata)


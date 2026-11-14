"""
Type definitions, Pydantic schemas, and typed exceptions for the LLM adapter layer.
"""

from enum import Enum
from typing import Generic, List, Literal, Optional, TypeVar
from pydantic import BaseModel, ConfigDict, Field


class LLMAdapterError(Exception):
    """Base exception for all LLM adapter operations."""
    pass


class LLMTimeoutError(LLMAdapterError):
    """Raised when an LLM adapter call exceeds its configured timeout deadline."""
    pass


class LLMMalformedJSONError(LLMAdapterError):
    """Raised when an LLM adapter returns unparseable JSON text."""
    pass


class LLMSchemaValidationError(LLMAdapterError):
    """Raised when LLM output violates the required Pydantic schema."""
    def __init__(self, message: str, raw_payload: Optional[str] = None, validation_errors: Optional[dict] = None):
        super().__init__(message)
        self.raw_payload = raw_payload
        self.validation_errors = validation_errors


class LLMCircuitBreakerError(LLMAdapterError):
    """Raised immediately when the circuit breaker is OPEN to fail fast."""
    pass


class LLMProviderError(LLMAdapterError):
    """Raised when an external LLM provider returns an HTTP or API error."""
    pass


class FailureMode(str, Enum):
    """Synthetic failure-injection modes for testing resilience and safety."""
    NONE = "none"
    TIMEOUT = "timeout"
    MALFORMED_JSON = "malformed_json"
    WRONG_LABELS = "wrong_labels"
    FABRICATED_FIELDS = "fabricated_fields"


class LLMCallMetadata(BaseModel):
    """Metadata recorded for every LLM invocation."""
    model_config = ConfigDict(frozen=True)

    model_id: str
    latency_ms: float
    input_tokens: int
    output_tokens: int
    estimated_cost: float
    schema_valid: bool
    prompt_version: str


class ExtractedFactItem(BaseModel):
    """A single clinical fact extracted from patient submission."""
    model_config = ConfigDict(extra="forbid")

    fact_type: Literal["SYMPTOM", "ROUTINE_STATUS", "FOLLOW_UP_REQUEST"]
    fact_value: str = Field(min_length=1)
    source_span_start: int = Field(ge=0)
    source_span_end: int = Field(ge=0)
    source_span_text: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionOutput(BaseModel):
    """Validated structured output for fact extraction."""
    model_config = ConfigDict(extra="forbid")

    facts: List[ExtractedFactItem]
    summary: str = Field(min_length=1)


class DraftOutput(BaseModel):
    """Validated structured output for routine communication drafting."""
    model_config = ConfigDict(extra="forbid")

    draft_message: str = Field(min_length=1)
    tone: Literal["NEUTRAL_PROFESSIONAL", "EMPATHETIC_ROUTINE"]
    requires_clinician_attention: bool
    rationale: str = Field(min_length=1)


T = TypeVar("T", bound=BaseModel)


class StructuredResponse(BaseModel, Generic[T]):
    """Container holding validated structured data alongside operational metadata."""
    data: Optional[T] = None
    metadata: LLMCallMetadata


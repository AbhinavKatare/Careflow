"""
Abstract Base Class for LLM Adapters.
"""

from abc import ABC, abstractmethod
from backend.llm.types import DraftOutput, ExtractionOutput, StructuredResponse


class LLMAdapter(ABC):
    """
    Abstract interface for LLM operations.
    All implementations must return structured Pydantic models with complete operational metadata.
    """

    @property
    @abstractmethod
    def model_id(self) -> str:
        """Identifier of the underlying model."""
        pass

    @abstractmethod
    def generate_extraction(
        self,
        patient_text: str,
        prompt_version: str = "extract_v1",
        timeout: float = 2.0,
    ) -> StructuredResponse[ExtractionOutput]:
        """Extracts structured clinical facts from untrusted patient text."""
        pass

    @abstractmethod
    def generate_draft(
        self,
        patient_text: str,
        patient_name: str,
        program_name: str,
        prompt_version: str = "draft_v1",
        timeout: float = 2.0,
    ) -> StructuredResponse[DraftOutput]:
        """Generates a neutral draft response for clinician review."""
        pass


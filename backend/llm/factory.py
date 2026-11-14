"""
Factory for instantiating LLM adapters based on configuration and environment variables.
"""

import os
from typing import Optional
from backend.llm.adapter import LLMAdapter
from backend.llm.mock_adapter import MockAdapter
from backend.llm.real_adapter import RealProviderAdapter
from backend.llm.types import FailureMode


def get_llm_adapter(
    provider: Optional[str] = None,
    failure_mode: FailureMode = FailureMode.NONE,
) -> LLMAdapter:
    """
    Returns an LLM adapter instance.
    Defaults to MockAdapter (deterministic, zero credentials required).
    If LLM_PROVIDER is set to a non-mock value (e.g. 'openai'), returns RealProviderAdapter.
    """
    selected_provider = (provider or os.environ.get("LLM_PROVIDER", "mock")).lower().strip()

    if selected_provider in ("mock", "default", ""):
        return MockAdapter(failure_mode=failure_mode)

    return RealProviderAdapter(provider_name=selected_provider)


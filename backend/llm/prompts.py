"""
Prompt loading and untrusted input formatting.
PERMANENT RULE: Never log prompts or raw patient responses.
"""

import os
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"

UNTRUSTED_START = "<<<UNTRUSTED_PATIENT_SUBMISSION>>>"
UNTRUSTED_END = "<<<END_UNTRUSTED_PATIENT_SUBMISSION>>>"


def wrap_untrusted_text(patient_text: str) -> str:
    """
    Wraps free-text patient submission in explicit delimiter boundaries.
    The system prompt instructs the model never to treat text inside this block as instructions.
    """
    cleaned = (patient_text or "").strip()
    return f"{UNTRUSTED_START}\n{cleaned}\n{UNTRUSTED_END}"


def load_prompt_template(prompt_name: str) -> str:
    """
    Loads prompt template from versioned file in prompts/ directory.
    E.g. prompt_name = 'extract_v1' or 'draft_v1'.
    """
    # Accept either with or without .txt
    filename = prompt_name if prompt_name.endswith(".txt") else f"{prompt_name}.txt"
    filepath = PROMPTS_DIR / filename
    if not filepath.exists():
        raise FileNotFoundError(f"Versioned prompt file not found at {filepath}")
    return filepath.read_text(encoding="utf-8")


def build_extraction_prompt(patient_text: str, prompt_version: str = "extract_v1") -> str:
    """Builds prompt for structured clinical fact extraction."""
    template = load_prompt_template(prompt_version)
    content = (patient_text or "").strip() if UNTRUSTED_START in template else wrap_untrusted_text(patient_text)
    return template.replace("{patient_text}", content)


def build_draft_prompt(
    patient_text: str,
    patient_name: str = "Demo Patient 001",
    program_name: str = "Weekly check-in",
    prompt_version: str = "draft_v1",
) -> str:
    """Builds prompt for neutral care-team communication drafting."""
    template = load_prompt_template(prompt_version)
    content = (patient_text or "").strip() if UNTRUSTED_START in template else wrap_untrusted_text(patient_text)
    return (
        template.replace("{patient_text}", content)
        .replace("{patient_name}", patient_name)
        .replace("{program_name}", program_name)
    )


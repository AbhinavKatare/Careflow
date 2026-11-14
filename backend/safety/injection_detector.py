"""
Pre-LLM Safety Layer: Prompt-Injection and Instruction-Like Pattern Detector.
Flags instruction-like text and preserves it as untrusted content without obeying it.
"""

import re
from typing import List, Tuple

INJECTION_PATTERNS = [
    # Direct instruction overrides
    re.compile(r"\bignore\s+(?:all\s+)?(?:[\w\s]{0,25})?\s*(?:instructions|prompts|rules|commands|guidelines|filters|safety)\b", re.IGNORECASE),
    re.compile(r"\bdisregard\s+(?:all\s+)?(?:[\w\s]{0,25})?\s*(?:instructions|prompts|rules|guidelines|safety)\b", re.IGNORECASE),
    re.compile(r"\bforget\s+(?:all\s+)?(?:[\w\s]{0,25})?\s*(?:instructions|prompts|rules|guidelines|safety)\b", re.IGNORECASE),
    re.compile(r"\bsystem\s+override\b", re.IGNORECASE),
    re.compile(r"\badmin\s+override\b", re.IGNORECASE),
    re.compile(r"\bdeveloper\s+mode\b", re.IGNORECASE),

    # Persona / Role-play hijacking
    re.compile(r"\byou\s+are\s+now\b", re.IGNORECASE),
    re.compile(r"\bact\s+as\s+(an?\s+)?(unrestricted|jailbroken|evil|dan|doctor|clinician|ai)\b", re.IGNORECASE),
    re.compile(r"\broleplay\s+as\b", re.IGNORECASE),
    re.compile(r"\bpretend\s+(you\s+are|to\s+be)\b", re.IGNORECASE),
    re.compile(r"\bjailbreak\b", re.IGNORECASE),
    re.compile(r"\bdo\s+anything\s+now\b", re.IGNORECASE),

    # Policy manipulation attempts
    re.compile(r"\boutput\s+draft_for_review\b", re.IGNORECASE),
    re.compile(r"\btreat\s+as\s+verified\b", re.IGNORECASE),
    re.compile(r"\bbypass\s+(all\s+)?(safety|rules|policy)\b", re.IGNORECASE),
    re.compile(r"\bmark\s+(as\s+)?on\s+track\b", re.IGNORECASE),

    # Delimiter breakout attacks
    re.compile(r"<<<END_UNTRUSTED_PATIENT_SUBMISSION>>>", re.IGNORECASE),
    re.compile(r"<<<UNTRUSTED_PATIENT_SUBMISSION>>>", re.IGNORECASE),

    # Code / HTML / Markdown exploitation markers
    re.compile(r"<\s*script\b[^>]*>", re.IGNORECASE),
    re.compile(r"<\s*iframe\b[^>]*>", re.IGNORECASE),
    re.compile(r"<\s*img\b[^>]+onerror\s*=", re.IGNORECASE),
    re.compile(r"javascript:\s*", re.IGNORECASE),
    re.compile(r"\bdrop\s+table\b", re.IGNORECASE),
    re.compile(r"\{\{.*?\}\}"),       # Jinja / Template injection
    re.compile(r"\$\{[^}]+\}"),       # Shell / Log4j injection
]


def detect_instruction_like_text(text: str) -> Tuple[bool, List[str]]:
    """
    Scans untrusted patient text for prompt injection and instruction-like patterns.
    Returns: (contains_instruction_like_text: bool, detected_patterns: list[str])
    """
    if not text or not text.strip():
        return False, []

    detected: List[str] = []
    for pattern in INJECTION_PATTERNS:
        matches = pattern.findall(text)
        if matches:
            detected.append(pattern.pattern)

    contains_instructions = len(detected) > 0
    return contains_instructions, detected

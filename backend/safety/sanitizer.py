"""
Pre-LLM Safety Layer: Size and Encoding Limit Enforcer.
Normalizes text, strips dangerous control characters, zero-width spaces, and bidi overrides.
"""

import unicodedata
import re
from typing import Tuple

MAX_NOTE_CHARACTERS = 500
MAX_NOTE_BYTES = 2048

# Control characters: ASCII 0-8, 11-12, 14-31, 127
CONTROL_CHARS_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Invisible unicode characters & bidirectional overrides
INVISIBLE_CHARS_PATTERN = re.compile(
    r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u202a-\u202e\u2066-\u2069]"
)


class InputLimitExceededError(ValueError):
    """Raised when text exceeds character or byte size thresholds."""
    pass


def sanitize_encoding_and_limits(
    text: str,
    max_chars: int = MAX_NOTE_CHARACTERS,
    max_bytes: int = MAX_NOTE_BYTES,
) -> Tuple[bool, str, str]:
    """
    Applies size and encoding limits:
    1. Validates byte length <= max_bytes.
    2. Validates character length <= max_chars.
    3. Normalizes Unicode using NFKC.
    4. Strips control characters and invisible formatting tricks.
    Returns: (is_valid, cleaned_text, error_message)
    """
    if text is None:
        return True, "", ""

    if not isinstance(text, str):
        return False, "", "Input must be a valid UTF-8 string."

    # 1. Byte limit
    byte_len = len(text.encode("utf-8", errors="replace"))
    if byte_len > max_bytes:
        return (
            False,
            text,
            f"Input byte size ({byte_len} bytes) exceeds limit of {max_bytes} bytes.",
        )

    # 2. Character limit
    if len(text) > max_chars:
        return (
            False,
            text,
            f"Input length ({len(text)} characters) exceeds limit of {max_chars} characters.",
        )

    # 3. Unicode NFKC normalization
    normalized = unicodedata.normalize("NFKC", text)

    # 4. Strip invisible characters & bidi tricks
    cleaned = INVISIBLE_CHARS_PATTERN.sub("", normalized)

    # 5. Strip dangerous control characters
    cleaned = CONTROL_CHARS_PATTERN.sub("", cleaned)

    return True, cleaned.strip(), ""


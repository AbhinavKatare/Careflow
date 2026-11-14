"""
Pre-LLM Safety Layer: Reversible Identifier Redaction.
Replaces synthetic names, phone numbers, emails, and dates with placeholders before any model call.
Maintains a reversible token map kept server-side only.
"""

import re
from typing import Dict, List, Optional, Tuple

# Regex for phone numbers: (123) 456-7890, 123-456-7890, 555-0199, etc.
PHONE_PATTERN = re.compile(
    r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b"
)

# Regex for emails
EMAIL_PATTERN = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# Regex for dates: MM/DD/YYYY, YYYY-MM-DD, Month DD, YYYY, etc.
DATE_NUMERIC_PATTERN = re.compile(
    r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b"
)
DATE_TEXT_PATTERN = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?\b",
    re.IGNORECASE,
)

# Synthetic patient name patterns: "Demo Patient 001", "Demo Patient", "John Doe", "Jane Doe"
SYNTHETIC_NAME_PATTERN = re.compile(
    r"\bDemo\s+Patient(?:\s+\d{1,3})?\b|\bJohn\s+Doe\b|\bJane\s+Doe\b",
    re.IGNORECASE,
)


def redact_identifiers(
    text: str,
    known_names: Optional[List[str]] = None,
) -> Tuple[str, Dict[str, str]]:
    """
    Redacts synthetic names, phone numbers, emails, and dates from text.
    Returns:
      redacted_text: Text with placeholders [PATIENT_NAME_1], [PHONE_1], [EMAIL_1], [DATE_1]
      token_map: Reversible server-side dictionary {placeholder: original_value}
    """
    if not text:
        return "", {}

    token_map: Dict[str, str] = {}
    redacted = text

    # Helper function to substitute unique matches
    def _substitute(pattern: re.Pattern, placeholder_prefix: str, content: str) -> str:
        matches = list(pattern.finditer(content))
        counter = 1
        for match in matches:
            original = match.group(0)
            # Find existing placeholder if already mapped
            existing_placeholder = next(
                (p for p, val in token_map.items() if val.lower() == original.lower() and p.startswith(placeholder_prefix)),
                None,
            )
            if existing_placeholder:
                placeholder = existing_placeholder
            else:
                placeholder = f"[{placeholder_prefix}_{counter}]"
                while placeholder in token_map:
                    counter += 1
                    placeholder = f"[{placeholder_prefix}_{counter}]"
                token_map[placeholder] = original
                counter += 1

            # Exact string replace for this match
            content = content.replace(original, placeholder)
        return content

    # 1. Redact explicit known names if provided
    name_counter = 1
    if known_names:
        for name in known_names:
            if name and name.strip() and name.lower() in redacted.lower():
                # Case-insensitive replacement
                pattern = re.compile(re.escape(name), re.IGNORECASE)
                matches = pattern.findall(redacted)
                for m in matches:
                    placeholder = f"[PATIENT_NAME_{name_counter}]"
                    token_map[placeholder] = m
                    redacted = pattern.sub(placeholder, redacted, count=1)
                    name_counter += 1

    # 2. Redact synthetic name pattern
    redacted = _substitute(SYNTHETIC_NAME_PATTERN, "PATIENT_NAME", redacted)

    # 3. Redact emails
    redacted = _substitute(EMAIL_PATTERN, "EMAIL", redacted)

    # 4. Redact phone numbers
    redacted = _substitute(PHONE_PATTERN, "PHONE", redacted)

    # 5. Redact dates
    redacted = _substitute(DATE_NUMERIC_PATTERN, "DATE", redacted)
    redacted = _substitute(DATE_TEXT_PATTERN, "DATE", redacted)

    return redacted, token_map


def de_redact(text: str, token_map: Dict[str, str]) -> str:
    """
    Reverses redaction placeholders back into original values using server-side token map.
    """
    if not text or not token_map:
        return text or ""

    restored = text
    for placeholder, original in token_map.items():
        restored = restored.replace(placeholder, original)
    return restored

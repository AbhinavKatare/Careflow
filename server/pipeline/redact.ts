/**
 * Step 2: Sanitize & Redact.
 * Pre-LLM Safety Layer: Reversible Identifier Redaction.
 * Replaces synthetic names, phone numbers, emails, and dates with placeholders before any model call.
 * The reversible token map is kept server-side only.
 * PERMANENT RULE: Never log prompts or raw patient responses.
 */

import { RedactionStepResult } from "./types";

// Dangerous control characters: ASCII 0-8, 11-12, 14-31, 127
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

// Invisible unicode characters & bidirectional overrides
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200F\uFEFF\u00AD\u2060\u202A-\u202E\u2066-\u2069]/g;

// Phone numbers regex: (123) 456-7890, 123-456-7890, 555-0199, +1-800-555-0199
const PHONE_REGEX = /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

// Email regex
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Date regex: numeric MM/DD/YYYY, YYYY-MM-DD, and textual dates
const DATE_NUMERIC_REGEX = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g;
const DATE_TEXT_REGEX = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?\b/gi;

// Synthetic patient names
const SYNTHETIC_NAME_REGEX = /\bDemo\s+Patient(?:\s+\d{1,3})?\b|\bJohn\s+Doe\b|\bJane\s+Doe\b/gi;

// Prompt injection patterns
const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:[\w\s]{0,25})?\s*(?:instructions|prompts|rules|commands|guidelines|filters|safety)\b/i,
  /\bdisregard\s+(?:all\s+)?(?:[\w\s]{0,25})?\s*(?:instructions|prompts|rules|guidelines|safety)\b/i,
  /\bforget\s+(?:all\s+)?(?:[\w\s]{0,25})?\s*(?:instructions|prompts|rules|guidelines|safety)\b/i,
  /\bsystem\s+override\b/i,
  /\badmin\s+override\b/i,
  /\bdeveloper\s+mode\b/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\s+(?:an?\s+)?(?:unrestricted|jailbroken|evil|dan|doctor|clinician|ai)\b/i,
  /\broleplay\s+as\b/i,
  /\bjailbreak\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\boutput\s+draft_for_review\b/i,
  /\btreat\s+as\s+verified\b/i,
  /\bbypass\s+(?:all\s+)?(?:safety|rules|policy)\b/i,
  /<<<(?:END_)?UNTRUSTED_PATIENT_SUBMISSION>>>/i,
  /<\s*script\b[^>]*>/i,
  /<\s*iframe\b[^>]*>/i,
  /\bdrop\s+table\b/i,
];

/**
 * Strips dangerous formatting tricks, invisible chars, and normalizes text.
 */
export function sanitizeEncoding(text: string): string {
  if (!text) return "";
  let cleaned = text.normalize("NFKC");
  cleaned = cleaned.replace(INVISIBLE_CHARS_REGEX, "");
  cleaned = cleaned.replace(CONTROL_CHARS_REGEX, "");
  return cleaned;
}

/**
 * Replaces synthetic identifiers with reversible placeholders.
 * The tokenMap is returned to stay strictly server-side.
 */
export function stepSanitizeAndRedact(
  text: string,
  knownNames: string[] = []
): RedactionStepResult {
  if (!text || text.trim().length === 0) {
    return {
      redactedText: "",
      tokenMap: {},
      containsInstructionLikeText: false,
      detectedPatterns: [],
      redactionCount: 0,
    };
  }

  // 1. Sanitize encoding and strip invisible chars
  let sanitized = sanitizeEncoding(text);

  // 2. Detect instruction-like patterns
  const detectedPatterns: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      detectedPatterns.push(pattern.source);
    }
  }
  const containsInstructionLikeText = detectedPatterns.length > 0;

  // 3. Reversible token map
  const tokenMap: Record<string, string> = {};
  let redactionCount = 0;

  // Helper to replace regex matches with unique placeholders
  function replaceMatches(regex: RegExp, prefix: string) {
    const matches = Array.from(sanitized.matchAll(regex));
    let counter = 1;

    for (const match of matches) {
      const original = match[0];
      // Check if already in tokenMap
      const existingPlaceholder = Object.keys(tokenMap).find(
        (key) => tokenMap[key].toLowerCase() === original.toLowerCase() && key.startsWith(`[${prefix}`)
      );

      if (existingPlaceholder) {
        sanitized = sanitized.replace(original, existingPlaceholder);
      } else {
        const placeholder = `[${prefix}_${counter}]`;
        tokenMap[placeholder] = original;
        sanitized = sanitized.replace(original, placeholder);
        counter++;
        redactionCount++;
      }
    }
  }

  // A. Redact known names first (e.g. from patient selection)
  let nameCounter = 1;
  for (const name of knownNames) {
    if (name && name.trim().length > 0 && sanitized.toLowerCase().includes(name.toLowerCase())) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRegex = new RegExp(`\\b${esc}\\b`, "gi");
      const matches = sanitized.match(nameRegex);
      if (matches) {
        for (const m of matches) {
          const placeholder = `[PATIENT_NAME_${nameCounter}]`;
          tokenMap[placeholder] = m;
          sanitized = sanitized.replace(m, placeholder);
          nameCounter++;
          redactionCount++;
        }
      }
    }
  }

  // B. Redact synthetic name patterns
  replaceMatches(SYNTHETIC_NAME_REGEX, "PATIENT_NAME");

  // C. Redact emails
  replaceMatches(EMAIL_REGEX, "EMAIL");

  // D. Redact phone numbers
  replaceMatches(PHONE_REGEX, "PHONE");

  // E. Redact dates
  replaceMatches(DATE_NUMERIC_REGEX, "DATE");
  replaceMatches(DATE_TEXT_REGEX, "DATE");

  return {
    redactedText: sanitized,
    tokenMap,
    containsInstructionLikeText,
    detectedPatterns,
    redactionCount,
  };
}

/**
 * Replaces placeholders with original text using the server-side token map.
 */
export function deRedact(text: string, tokenMap: Record<string, string>): string {
  if (!text) return "";
  let restored = text;
  for (const [placeholder, original] of Object.entries(tokenMap)) {
    restored = restored.replaceAll(placeholder, original);
  }
  return restored;
}


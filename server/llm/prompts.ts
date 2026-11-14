/**
 * Versioned prompt loading and untrusted patient input wrapping.
 * PERMANENT RULE: Never log prompts, model outputs, or raw patient responses.
 */

import fs from "node:fs";
import path from "node:path";

export const UNTRUSTED_START = "<<<UNTRUSTED_PATIENT_SUBMISSION>>>";
export const UNTRUSTED_END = "<<<END_UNTRUSTED_PATIENT_SUBMISSION>>>";

// Find project root prompts directory
const PROMPTS_DIR = path.resolve(process.cwd(), "prompts");

/**
 * Wraps free-text patient submission in explicit delimiter boundaries.
 * Informs the system prompt to treat content strictly as data, never as instructions.
 */
export function wrapUntrustedText(patientText: string): string {
  const cleaned = (patientText || "").trim();
  return `${UNTRUSTED_START}\n${cleaned}\n${UNTRUSTED_END}`;
}

/**
 * Loads a versioned prompt template from the prompts/ directory.
 * E.g. 'extract_v1' or 'draft_v1'.
 */
export function loadPromptTemplate(promptName: string): string {
  const filename = promptName.endsWith(".txt") ? promptName : `${promptName}.txt`;
  const filepath = path.join(PROMPTS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`Versioned prompt file not found at ${filepath}`);
  }

  return fs.readFileSync(filepath, "utf-8");
}

/**
 * Builds the complete structured extraction prompt.
 */
export function buildExtractionPrompt(
  patientText: string,
  promptVersion = "extract_v1"
): string {
  const template = loadPromptTemplate(promptVersion);
  const wrapped = template.includes(UNTRUSTED_START)
    ? (patientText || "").trim()
    : wrapUntrustedText(patientText);
  return template.replace("{patient_text}", wrapped);
}

/**
 * Builds the complete draft synthesis prompt.
 */
export function buildDraftPrompt(params: {
  patientText: string;
  patientName?: string;
  programName?: string;
  promptVersion?: string;
}): string {
  const {
    patientText,
    patientName = "Demo Patient 001",
    programName = "Weekly check-in",
    promptVersion = "draft_v1",
  } = params;

  const template = loadPromptTemplate(promptVersion);
  const wrapped = template.includes(UNTRUSTED_START)
    ? (patientText || "").trim()
    : wrapUntrustedText(patientText);

  return template
    .replace("{patient_text}", wrapped)
    .replace("{patient_name}", patientName)
    .replace("{program_name}", programName);
}


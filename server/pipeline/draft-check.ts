/**
 * Deterministic Draft Safety Checker.
 *
 * PERMANENT RULES:
 * A draft passes ONLY if:
 * 1. No diagnosis language.
 * 2. No treatment / medication recommendations.
 * 3. No claim that an outbound action occurred.
 * 4. Every concrete fact (date, appointment, name, outcome) is traceable to source or context.
 * 5. No other patient's data (cross-patient isolation).
 * 6. Nothing implying emergency monitoring or continuous telemetry surveillance.
 *
 * Failing drafts are BLOCKED and the case routes to HUMAN_REVIEW_REQUIRED.
 * Every check returns per-check results with the exact offending span (start, end, text).
 * Illustrative demo logic, not clinical criteria.
 */

import { DraftCheckItem, DraftCheckStepResult, OffendingSpan } from "./types";

export interface DraftCheckerContext {
  sourceNote?: string;
  patientName?: string;
  patientId?: string;
  programName?: string;
  clinicName?: string;
  knownDates?: string[];
  knownAppointments?: string[];
  careTeamNames?: string[];
  knownLabResults?: string[];
  otherKnownPatients?: string[];
}

// ==========================================
// 1. DIAGNOSIS LANGUAGE PATTERNS
// ==========================================
const DIAGNOSIS_PATTERNS = [
  /\bdiagnos(?:is|ed|ing|tic)?\b/i,
  /\bpneumonia\b/i,
  /\bhypertension\b/i,
  /\bmyocardial\s+(?:infarction|ischemia)\b/i,
  /\bcardiac\s+arrest\b/i,
  /\bsuffering\s+from\b/i,
  /\bcondition\s+is\s+diagnosed\s+as\b/i,
  /\bpathology\b/i,
  /\barrhythmia\b/i,
  /\btachycardia\b/i,
  /\bbradycardia\b/i,
  /\bdiabetes\b/i,
  /\bdepression\b/i,
  /\bangina\b/i,
  /\bedema\b/i,
  /\bsepsis\b/i,
  /\bischemia\b/i,
  /\bbronchitis\b/i,
  /\bcongestive\s+heart\s+failure\b/i,
  /\bsounds\s+like\s+you\s+have\b/i,
  /\byour\s+symptoms\s+(?:indicate|suggest|point\s+to)\s+that\s+you\s+have\b/i,
  /\byou\s+are\s+likely\s+experiencing\s+(?:an?\s+)?(?:acute\s+)?(?:case\s+of\b)?/i,
];

// ==========================================
// 2. TREATMENT & MEDICATION PATTERNS
// ==========================================
const TREATMENT_PATTERNS = [
  /\bprescribe[ds]?\b/i,
  /\bprescription\b/i,
  /\bdosage\b/i,
  /\bincrease\s+(?:your\s+)?(?:dose|dosage)\b/i,
  /\bdecrease\s+(?:your\s+)?(?:dose|dosage)\b/i,
  /\bdouble\s+your\s+dose\b/i,
  /\bskip\s+(?:your\s+)?(?:medication|dose)\b/i,
  /\bmedication\s+change\b/i,
  /\badjust\s+(?:your\s+)?medication\b/i,
  /\bstop\s+taking\b/i,
  /\bstart\s+taking\b/i,
  /\btake\s+(?:\d+|two|one|three)\s+(?:tablets?|pills?|capsules?|mg)\b/i,
  /\bantibiotic[s]?\b/i,
  /\bamoxicillin\b/i,
  /\bsteroid\s+ointment\b/i,
  /\btake\s+aspirin\b/i,
  /\btake\s+tylenol\b/i,
  /\bibuprofen\b/i,
  /\bapply\s+(?:the\s+)?ointment\b/i,
  /\brecommend\s+taking\b/i,
  /\brefill\s+your\s+prescription\b/i,
];

// ==========================================
// 3. ACTION OCCURRED PATTERNS
// ==========================================
const ACTION_PATTERNS = [
  /\bsent\s+(?:you\s+)?an?\s+email\b/i,
  /\bsent\s+(?:you\s+)?an?\s+sms\b/i,
  /\bsent\s+(?:you\s+)?a\s+text(?:\s+message)?\b/i,
  /\bdispatched\b/i,
  /\bnotified\s+(?:your|the)\s+(?:doctor|physician|care\s+team|provider)\b/i,
  /\bupdated\s+your\s+(?:ehr|electronic\s+health\s+record|medical\s+record)\b/i,
  /\bchanged\s+your\s+care\s+plan\b/i,
  /\bordered\s+(?:a\s+)?lab(?:\s+test)?\b/i,
  /\bscheduled\s+(?:an?\s+)?appointment\b/i,
  /\bbooked\s+(?:your|an?)\s+(?:appointment|visit|session)\b/i,
  /\bconfirmed\s+your\s+appointment\b/i,
  /\bemailed\s+your\s+provider\b/i,
  /\bfaxed\s+your\s+records\b/i,
  /\bcalled\s+911\b/i,
  /\bdispatched\s+(?:an?\s+)?ambulance\b/i,
  /\bwe\s+have\s+already\s+(?:sent|notified|scheduled|ordered|dispatched)\b/i,
  /\byour\s+doctor\s+has\s+been\s+notified\b/i,
];

// ==========================================
// 4. EMERGENCY MONITORING IMPLICATION PATTERNS
// ==========================================
const EMERGENCY_MONITORING_PATTERNS = [
  /\bactively\s+monitoring\s+(?:your\s+)?(?:heart|vitals?|telemetry|condition)\b/i,
  /\breal-?time\s+(?:telemetry|monitoring|tracking)\b/i,
  /\bemergency\s+response\s+team\s+is\s+tracking\b/i,
  /\bcontinuous(?:ly)?\s+(?:tracking|monitoring|watching)\b/i,
  /\b24\/7\s+(?:emergency|vital|monitoring)\b/i,
  /\bmonitoring\s+you\s+in\s+real\s+time\b/i,
  /\bif\s+(?:you\s+stop\s+breathing|your\s+heart\s+stops)\s+we\s+will\s+be\s+alerted\b/i,
  /\bour\s+emergency\s+team\s+is\s+tracking\b/i,
  /\balerted\s+emergency\s+services\s+to\s+your\s+location\b/i,
  /\bwe\s+are\s+watching\s+your\s+vital\s+signs\s+live\b/i,
  /\bemergency\s+monitoring\s+active\b/i,
];

// ==========================================
// 5. UNSUPPORTED OUTCOME & REASSURANCE PATTERNS
// ==========================================
const UNSUPPORTED_REASSURANCE_PATTERNS = [
  /\b(?:there\s+is\s+)?absolutely\s+nothing\s+to\s+worry\s+about\b/i,
  /\bnothing\s+to\s+worry\s+about\b/i,
  /\bcompletely\s+harmless\b/i,
  /\b100%\s+(?:fine|safe|cured|healthy)\b/i,
  /\bguaranteed\s+(?:full\s+)?recovery\b/i,
  /\byou\s+are\s+completely\s+cured\b/i,
  /\byou\s+have\s+made\s+a\s+full\s+recovery\b/i,
  /\byou\s+are\s+in\s+no\s+danger\s+whatsoever\b/i,
  /\bwill\s+clear\s+up\s+in\s+\d+\s+days\b/i,
  /\btest\s+results\s+(?:came\s+back|are)\s+(?:negative|positive|clean|normal)\b/i,
  /\bbiopsy\s+(?:results?\s+)?(?:was|were|came\s+back)\s+(?:clear|negative|benign)\b/i,
  /\blab\s+tests\s+are\s+(?:completely\s+)?normal\b/i,
  /\byour\s+bloodwork\s+looks\s+great\b/i,
  /\bconfirmed\s+as\s+normal\b/i,
];

// Date pattern for concrete date grounding
const CONCRETE_DATE_PATTERN = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{2,4})?\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:tomorrow|yesterday|next\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\s+(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b)?/gi;

// Default synthetic patients known across the simulation portfolio
const KNOWN_SYNTHETIC_PATIENTS = [
  "Demo Patient 001",
  "Demo Patient 002",
  "Demo Patient 003",
  "Demo Patient 004",
  "Demo Patient 005",
  "Demo Patient 006",
  "Demo Patient 007",
  "DEMO-001",
  "DEMO-002",
  "DEMO-003",
  "DEMO-004",
  "DEMO-005",
  "DEMO-006",
  "DEMO-007",
  "John Doe",
  "Jane Doe",
];

/**
 * Finds the first regex match with its exact character span in text.
 */
function findFirstMatchSpan(regexes: RegExp[], text: string): OffendingSpan | undefined {
  for (const regex of regexes) {
    const match = regex.exec(text);
    if (match) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      };
    }
  }
  return undefined;
}

/**
 * Deterministic Safety Checker for Candidate AI Drafts.
 * Evaluates all 6 safety checks and returns detailed per-check results and offending spans.
 */
export function stepCheckDraftSafety(
  draft: string | null,
  sourceOrContext: string | DraftCheckerContext = ""
): DraftCheckStepResult {
  if (!draft || draft.trim().length === 0) {
    return {
      passed: true,
      blocked: false,
      checks: [],
    };
  }

  // Normalize context
  const context: DraftCheckerContext = typeof sourceOrContext === "string"
    ? { sourceNote: sourceOrContext }
    : sourceOrContext;

  const sourceLower = (context.sourceNote || "").toLowerCase();
  const checks: DraftCheckItem[] = [];

  // --------------------------------------------------------------------------
  // CHECK 1: NO DIAGNOSIS LANGUAGE
  // --------------------------------------------------------------------------
  const diagSpan = findFirstMatchSpan(DIAGNOSIS_PATTERNS, draft);
  checks.push({
    checkId: "NO_DIAGNOSIS_LANGUAGE",
    name: "No diagnosis language or diagnostic framing",
    passed: !diagSpan,
    offendingSpan: diagSpan,
    detail: diagSpan
      ? `Draft contains forbidden diagnosis terminology: '${diagSpan.text}'. (Illustrative demo logic, not clinical criteria.)`
      : undefined,
  });

  // --------------------------------------------------------------------------
  // CHECK 2: NO TREATMENT OR MEDICATION RECOMMENDATIONS
  // --------------------------------------------------------------------------
  const treatSpan = findFirstMatchSpan(TREATMENT_PATTERNS, draft);
  checks.push({
    checkId: "NO_TREATMENT_RECOMMENDATION",
    name: "No treatment, dosing, or prescription recommendations",
    passed: !treatSpan,
    offendingSpan: treatSpan,
    detail: treatSpan
      ? `Draft contains forbidden medication/treatment advice: '${treatSpan.text}'. (Illustrative demo logic, not clinical criteria.)`
      : undefined,
  });

  // --------------------------------------------------------------------------
  // CHECK 3: NO CLAIM THAT AN ACTION OCCURRED
  // --------------------------------------------------------------------------
  const actionSpan = findFirstMatchSpan(ACTION_PATTERNS, draft);
  checks.push({
    checkId: "NO_ACTION_CLAIM",
    name: "No claim that an outbound external action occurred",
    passed: !actionSpan,
    offendingSpan: actionSpan,
    detail: actionSpan
      ? `Draft claims an outbound action occurred: '${actionSpan.text}'. Simulation only; zero external side-effects allowed.`
      : undefined,
  });

  // --------------------------------------------------------------------------
  // CHECK 4: FACT GROUNDING & UNSUPPORTED OUTCOME CLAIMS
  // --------------------------------------------------------------------------
  let factSpan: OffendingSpan | undefined;
  let factDetail: string | undefined;

  // A. Check for unsupported reassurance / outcome claims
  const outcomeSpan = findFirstMatchSpan(UNSUPPORTED_REASSURANCE_PATTERNS, draft);
  if (outcomeSpan) {
    factSpan = outcomeSpan;
    factDetail = `Draft asserts unsupported reassurance or clinical outcome: '${outcomeSpan.text}'.`;
  }

  // B. Check for ungrounded concrete dates
  if (!factSpan) {
    const dateMatches = Array.from(draft.matchAll(CONCRETE_DATE_PATTERN));
    const knownDates = [
      ...(context.knownDates || []),
      ...(context.knownAppointments || []),
    ].map((d) => d.toLowerCase());

    for (const m of dateMatches) {
      const dateText = m[0];
      const dateLower = dateText.toLowerCase();
      // Check if date was mentioned in source note or known dates
      const inSource = sourceLower.includes(dateLower);
      const inKnown = knownDates.some((kd) => kd.includes(dateLower) || dateLower.includes(kd));

      if (!inSource && !inKnown) {
        factSpan = {
          start: m.index ?? 0,
          end: (m.index ?? 0) + dateText.length,
          text: dateText,
        };
        factDetail = `Draft asserts ungrounded date/appointment not in source or context: '${dateText}'.`;
        break;
      }
    }
  }

  // C. Check for ungrounded appointments
  if (!factSpan) {
    const apptRegex = /\b(?:appointment\s+(?:on|at|with)|visit\s+(?:on|at|with|scheduled))\s+[^.,\n]+/gi;
    const apptMatches = Array.from(draft.matchAll(apptRegex));
    for (const m of apptMatches) {
      const apptText = m[0];
      if (!sourceLower.includes(apptText.toLowerCase())) {
        const inContext = (context.knownAppointments || []).some((ka) =>
          ka.toLowerCase().includes(apptText.toLowerCase())
        );
        if (!inContext) {
          factSpan = {
            start: m.index ?? 0,
            end: (m.index ?? 0) + apptText.length,
            text: apptText,
          };
          factDetail = `Draft invents ungrounded appointment not in source: '${apptText}'.`;
          break;
        }
      }
    }
  }

  checks.push({
    checkId: "FACT_GROUNDING_TRACEABLE",
    name: "Every concrete fact is traceable to source or context record",
    passed: !factSpan,
    offendingSpan: factSpan,
    detail: factDetail,
  });

  // --------------------------------------------------------------------------
  // CHECK 5: NO OTHER PATIENT'S DATA (Cross-Patient Isolation)
  // --------------------------------------------------------------------------
  let crossPatientSpan: OffendingSpan | undefined;
  let crossPatientDetail: string | undefined;

  const targetPatientName = context.patientName || "Demo Patient 001";
  const targetPatientId = context.patientId || "DEMO-001";
  const allKnownPatients = context.otherKnownPatients || KNOWN_SYNTHETIC_PATIENTS;

  for (const otherPatient of allKnownPatients) {
    if (
      otherPatient.toLowerCase() !== targetPatientName.toLowerCase() &&
      otherPatient.toLowerCase() !== targetPatientId.toLowerCase()
    ) {
      const idx = draft.toLowerCase().indexOf(otherPatient.toLowerCase());
      if (idx !== -1) {
        crossPatientSpan = {
          start: idx,
          end: idx + otherPatient.length,
          text: draft.slice(idx, idx + otherPatient.length),
        };
        crossPatientDetail = `Draft contains identifier belonging to another patient: '${crossPatientSpan.text}'. Cross-patient data leakage prevented.`;
        break;
      }
    }
  }

  checks.push({
    checkId: "NO_CROSS_PATIENT_DATA",
    name: "Strict cross-patient data isolation (no other patient identifiers)",
    passed: !crossPatientSpan,
    offendingSpan: crossPatientSpan,
    detail: crossPatientDetail,
  });

  // --------------------------------------------------------------------------
  // CHECK 6: NOTHING IMPLYING EMERGENCY MONITORING
  // --------------------------------------------------------------------------
  const emergSpan = findFirstMatchSpan(EMERGENCY_MONITORING_PATTERNS, draft);
  checks.push({
    checkId: "NO_EMERGENCY_MONITORING_IMPLICATION",
    name: "No implication of real-time emergency monitoring or continuous telemetry",
    passed: !emergSpan,
    offendingSpan: emergSpan,
    detail: emergSpan
      ? `Draft falsely implies real-time emergency monitoring: '${emergSpan.text}'. Simulation is not an emergency response system.`
      : undefined,
  });

  // Aggregate results
  const failedCheck = checks.find((c) => !c.passed);
  const passed = !failedCheck;

  return {
    passed,
    blocked: !passed,
    targetRoute: !passed ? "HUMAN_REVIEW_REQUIRED" : undefined,
    violationCode: failedCheck?.checkId,
    violationDetail: failedCheck?.detail,
    offendingSpan: failedCheck?.offendingSpan,
    checks,
  };
}

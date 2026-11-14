import { computeWorkflowSpecHash } from "../../shared/domain/workflow-spec";
import type { WorkflowSpec } from "../../shared/domain/types";
import type { SOPTrace } from "./types";

// ==========================================
// 1. WEEKLY CHECK-IN PROPOSAL
// ==========================================
const weeklyCheckInRawSpec = {
  spec_version: "1.0.0",
  parent_version: null,
  questionnaire_fields: [
    {
      id: "weekStatus",
      label: "Weekly Status",
      type: "select" as const,
      options: [
        "On track with my weekly routine",
        "I have a question for the care team",
        "I'm not sure how to answer",
      ],
      required: true,
    },
    {
      id: "followUp",
      label: "Would you like a team member to follow up?",
      type: "radio" as const,
      options: ["no", "yes"],
      required: true,
    },
    {
      id: "note",
      label: "Optional note for your care team",
      type: "text" as const,
      required: false,
    },
  ],
  rule_list: [
    {
      id: "RULE_INPUT_MISSING_REQUIRED",
      description: "Enforce presence of mandatory patientId and weekStatus fields.",
      route: "INPUT_ERROR" as const,
      reason_code: "REQUIRED_FIELD_MISSING",
      condition: {
        any: [{ missing_field: "patientId" }, { missing_field: "weekStatus" }],
      },
    },
    {
      id: "RULE_INPUT_NOTE_LENGTH",
      description: "Reject free-text note exceeding maximum limit of 500 characters.",
      route: "INPUT_ERROR" as const,
      reason_code: "NOTE_EXCEEDS_LENGTH_LIMIT",
      condition: {
        length_limit: { field: "note", max: 500 },
      },
    },
    {
      id: "RULE_UNCERTAINTY_EXPRESSED",
      description: "Route ambiguous or uncertain participant selections to clinical staff.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNCERTAINTY_FLAGGED",
      condition: {
        phrase_match: { field: "weekStatus", phrases: ["not sure", "unsure"] },
      },
    },
    {
      id: "RULE_EXPLICIT_FOLLOWUP_REQUEST",
      description: "Escalate cases where participant selected question or follow-up yes.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "EXPLICIT_FOLLOWUP_REQUESTED",
      condition: {
        any: [
          { field_equals: { field: "followUp", value: "yes" } },
          { phrase_match: { field: "weekStatus", phrases: ["question"] } },
        ],
      },
    },
    {
      id: "RULE_INSTRUCTION_LIKE_TEXT",
      description: "Detect prompt injection or system instruction patterns in free text.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "INSTRUCTION_LIKE_TEXT_DETECTED",
      condition: {
        instruction_like_text: { field: "note" },
      },
    },
    {
      id: "RULE_CONTROLLED_URGENT_LANGUAGE",
      description: "Flag controlled emergency or distress keywords under CONTROLLED_URGENT_LANGUAGE.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "CONTROLLED_URGENT_LANGUAGE",
      condition: {
        phrase_match: {
          field: "note",
          phrases: [
            "chest pain",
            "shortness of breath",
            "emergency",
            "urgent",
            "critical",
            "severe",
            "extreme difficulty",
          ],
        },
      },
    },
    {
      id: "RULE_CONTRADICTION_DETECTED",
      description: "Flag structured on-track status contradicting unstructured note distress.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "STATUS_TEXT_CONTRADICTION",
      condition: {
        contradiction: {
          structured_field: "weekStatus",
          structured_matches: ["on track"],
          text_field: "note",
          text_keywords: ["extreme difficulty", "cannot take any", "completely failing", "falling apart"],
        },
      },
    },
    {
      id: "RULE_DIAGNOSIS_OR_PRESCRIPTION_REQUEST",
      description: "Route inquiries asking for medical diagnosis or prescription modification.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "DIAGNOSIS_OR_PRESCRIPTION_REQUESTED",
      condition: {
        phrase_match: { field: "note", phrases: ["diagnose", "prescription", "prescribe", "ointment", "antibiotics"] },
      },
    },
    {
      id: "RULE_PROVIDER_TIMEOUT_MARKER",
      description: "Escalate synthetic provider failure or timeout indicators.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "TIMEOUT_VISIBLE_NO_FALSE_SUCCESS",
      condition: {
        phrase_match: { field: "note", phrases: ["[simulated_provider_timeout]"] },
      },
    },
    {
      id: "RULE_UNTRUSTED_FREE_TEXT",
      description: "Route any submission containing participant free-text to human review.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNTRUSTED_FREE_TEXT_PRESENT",
      condition: {
        not: { missing_field: "note" },
      },
    },
    {
      id: "RULE_ROUTINE_ON_TRACK",
      description: "Allow automated draft preparation for verified routine on-track check-in with empty note.",
      route: "DRAFT_FOR_REVIEW" as const,
      reason_code: "ROUTINE_STRUCTURED_ON_TRACK",
      condition: {
        all: [
          { phrase_match: { field: "weekStatus", phrases: ["on track"] } },
          { field_equals: { field: "followUp", value: "no" } },
          { missing_field: "note" },
        ],
      },
    },
  ],
  draft_templates: [
    {
      id: "TEMPLATE_ROUTINE_ACK",
      trigger_reason: "ROUTINE_STRUCTURED_ON_TRACK",
      template_text: "Thanks for checking in, [PATIENT_NAME_1]. Your update has been recorded for your care team to review.",
    },
  ],
  limits: {
    max_note_length: 500,
    max_daily_submissions: 3,
    timeout_ms: 5000,
  },
  reviewer_roles: ["Clinical Lead", "Compliance Officer", "QA Reviewer"],
};

export const weeklyCheckInSpec: WorkflowSpec = {
  ...weeklyCheckInRawSpec,
  content_hash: computeWorkflowSpecHash(weeklyCheckInRawSpec as any),
};

export const weeklyCheckInTraces: SOPTrace[] = [
  {
    ruleId: "RULE_INPUT_MISSING_REQUIRED",
    sopSentenceNumber: 5,
    sopSentenceText: "Patient identifier and weekly status selections are mandatory; missing required fields must yield an input error.",
    section: "Section 2: Input Boundaries & Technical Limits",
    rationale: "Maps mandatory intake validation requirements to INPUT_ERROR rule.",
  },
  {
    ruleId: "RULE_INPUT_NOTE_LENGTH",
    sopSentenceNumber: 6,
    sopSentenceText: "The participant free-text note must not exceed 500 characters in length. Any note exceeding 500 characters must be rejected as an input error.",
    section: "Section 2: Input Boundaries & Technical Limits",
    rationale: "Maps 500-character boundary limit to length_limit validator rule.",
  },
  {
    ruleId: "RULE_UNTRUSTED_FREE_TEXT",
    sopSentenceNumber: 9,
    sopSentenceText: "Free-text inputs from participants represent untrusted external content. Any check-in containing a non-empty free-text note must be routed for human staff review.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Translates untrusted free-text policy to mandatory human review route.",
  },
  {
    ruleId: "RULE_UNCERTAINTY_EXPRESSED",
    sopSentenceNumber: 10,
    sopSentenceText: "If the participant indicates uncertainty such as 'not sure' or 'unsure', the submission must be routed to staff reviewers.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Maps ambiguous patient choices directly to HUMAN_REVIEW_REQUIRED.",
  },
  {
    ruleId: "RULE_EXPLICIT_FOLLOWUP_REQUEST",
    sopSentenceNumber: 11,
    sopSentenceText: "If the participant selects that they have a question or explicitly requests follow-up with 'yes', the case must be escalated to human staff review.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Encodes outreach opt-in questions into staff escalation gate.",
  },
  {
    ruleId: "RULE_INSTRUCTION_LIKE_TEXT",
    sopSentenceNumber: 12,
    sopSentenceText: "If the text note contains instruction-like phrases, system prompt override attempts, or adversarial injections, the case must be routed to human staff review with security logging.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Compiles adversarial prompt-injection detection rule.",
  },
  {
    ruleId: "RULE_CONTROLLED_URGENT_LANGUAGE",
    sopSentenceNumber: 13,
    sopSentenceText: "If the participant enters controlled emergency or acute distress keywords such as 'chest pain', 'shortness of breath', 'severe', 'critical', or 'emergency', the workflow must immediately escalate the case to staff review under the abstract marker CONTROLLED_URGENT_LANGUAGE.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Compiles red-flag phrase matching under controlled abstract marker.",
  },
  {
    ruleId: "RULE_CONTRADICTION_DETECTED",
    sopSentenceNumber: 14,
    sopSentenceText: "If there is a direct contradiction where the structured selection indicates 'on track' but the free-text note conveys distress or severe disruption, the workflow must flag a contradiction and route to human review.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Maps structured on-track vs unstructured distress contradiction rule.",
  },
  {
    ruleId: "RULE_DIAGNOSIS_OR_PRESCRIPTION_REQUEST",
    sopSentenceNumber: 15,
    sopSentenceText: "If the note contains explicit medical requests for diagnosis, prescription modification, or antibiotic orders, the system must escalate to human staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Guards against automated medical prescribing/diagnosis by routing to staff.",
  },
  {
    ruleId: "RULE_PROVIDER_TIMEOUT_MARKER",
    sopSentenceNumber: 16,
    sopSentenceText: "If synthetic provider timeout or execution failure markers are detected, the system must route to human review and never produce a false-success state.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Enforces zero false-success on simulated provider timeout marker.",
  },
  {
    ruleId: "RULE_ROUTINE_ON_TRACK",
    sopSentenceNumber: 17,
    sopSentenceText: "Automated follow-up draft preparation is strictly permitted only when the participant selects 'On track with my weekly routine', answers 'no' to follow-up, and leaves the free-text note completely empty.",
    section: "Section 4: Routine Automated Draft Path",
    rationale: "Implements strict gate for DRAFT_FOR_REVIEW routine synthesis.",
  },
];

// ==========================================
// 2. POST-VISIT FOLLOW-UP PROPOSAL
// ==========================================
const postVisitRawSpec = {
  spec_version: "1.0.0",
  parent_version: null,
  questionnaire_fields: [
    {
      id: "recoveryProgress",
      label: "Recovery Progress",
      type: "select" as const,
      options: [
        "Recovering as expected",
        "Experiencing unexpected symptoms",
        "Need scheduling assistance",
      ],
      required: true,
    },
    {
      id: "staffContact",
      label: "Do you require staff contact regarding your recent visit?",
      type: "radio" as const,
      options: ["no", "yes"],
      required: true,
    },
    {
      id: "additionalNotes",
      label: "Additional notes regarding your visit recovery",
      type: "text" as const,
      required: false,
    },
  ],
  rule_list: [
    {
      id: "RULE_PV_MISSING_REQUIRED",
      description: "Enforce presence of mandatory patientId and recoveryProgress fields.",
      route: "INPUT_ERROR" as const,
      reason_code: "REQUIRED_FIELD_MISSING",
      condition: {
        any: [{ missing_field: "patientId" }, { missing_field: "recoveryProgress" }],
      },
    },
    {
      id: "RULE_PV_NOTE_LENGTH",
      description: "Reject recovery note exceeding 400 characters limit.",
      route: "INPUT_ERROR" as const,
      reason_code: "NOTE_EXCEEDS_LENGTH_LIMIT",
      condition: {
        length_limit: { field: "additionalNotes", max: 400 },
      },
    },
    {
      id: "RULE_PV_UNCERTAINTY",
      description: "Route ambiguous or scheduling assistance recovery requests to staff.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNCERTAINTY_FLAGGED",
      condition: {
        phrase_match: { field: "recoveryProgress", phrases: ["scheduling assistance", "unsure"] },
      },
    },
    {
      id: "RULE_PV_STAFF_CONTACT",
      description: "Escalate cases where participant selected unexpected symptoms or contact yes.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "STAFF_CONTACT_REQUESTED",
      condition: {
        any: [
          { field_equals: { field: "staffContact", value: "yes" } },
          { phrase_match: { field: "recoveryProgress", phrases: ["unexpected symptoms"] } },
        ],
      },
    },
    {
      id: "RULE_PV_INSTRUCTION_LIKE_TEXT",
      description: "Detect instruction-like phrases or prompt overrides in recovery notes.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "INSTRUCTION_LIKE_TEXT_DETECTED",
      condition: {
        instruction_like_text: { field: "additionalNotes" },
      },
    },
    {
      id: "RULE_PV_CONTROLLED_URGENT",
      description: "Escalate acute distress keywords under CONTROLLED_URGENT_LANGUAGE.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "CONTROLLED_URGENT_LANGUAGE",
      condition: {
        phrase_match: {
          field: "additionalNotes",
          phrases: ["emergency", "chest pain", "shortness of breath", "severe pain", "bleeding", "urgent"],
        },
      },
    },
    {
      id: "RULE_PV_CONTRADICTION",
      description: "Flag contradiction between recovery as expected and notes describing worsening condition.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "STATUS_TEXT_CONTRADICTION",
      condition: {
        contradiction: {
          structured_field: "recoveryProgress",
          structured_matches: ["recovering as expected"],
          text_field: "additionalNotes",
          text_keywords: ["severe pain", "worsening", "cannot walk", "bleeding profusely"],
        },
      },
    },
    {
      id: "RULE_PV_PRESCRIPTION_REQUEST",
      description: "Route prescription renewals or dosage queries to human staff.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "PRESCRIPTION_REQUESTED",
      condition: {
        phrase_match: { field: "additionalNotes", phrases: ["refill", "prescription", "dosage", "prescribe"] },
      },
    },
    {
      id: "RULE_PV_TIMEOUT_MARKER",
      description: "Safely escalate synthetic provider execution timeouts.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "TIMEOUT_VISIBLE_NO_FALSE_SUCCESS",
      condition: {
        phrase_match: { field: "additionalNotes", phrases: ["[simulated_provider_timeout]"] },
      },
    },
    {
      id: "RULE_PV_UNTRUSTED_TEXT",
      description: "Route any non-empty recovery note to human staff review.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNTRUSTED_FREE_TEXT_PRESENT",
      condition: {
        not: { missing_field: "additionalNotes" },
      },
    },
    {
      id: "RULE_PV_ROUTINE_RECOVERY",
      description: "Allow automated routine recovery draft when participant recovers as expected with no note.",
      route: "DRAFT_FOR_REVIEW" as const,
      reason_code: "ROUTINE_STRUCTURED_ON_TRACK",
      condition: {
        all: [
          { phrase_match: { field: "recoveryProgress", phrases: ["recovering as expected"] } },
          { field_equals: { field: "staffContact", value: "no" } },
          { missing_field: "additionalNotes" },
        ],
      },
    },
  ],
  draft_templates: [
    {
      id: "TEMPLATE_PV_RECOVERY_ACK",
      trigger_reason: "ROUTINE_STRUCTURED_ON_TRACK",
      template_text: "Thank you for confirming your recovery progress, [PATIENT_NAME_1]. We are glad to hear your recovery is proceeding as expected.",
    },
  ],
  limits: {
    max_note_length: 400,
    max_daily_submissions: 2,
    timeout_ms: 4500,
  },
  reviewer_roles: ["Clinical Lead", "Compliance Officer", "QA Reviewer"],
};

export const postVisitSpec: WorkflowSpec = {
  ...postVisitRawSpec,
  content_hash: computeWorkflowSpecHash(postVisitRawSpec as any),
};

export const postVisitTraces: SOPTrace[] = [
  {
    ruleId: "RULE_PV_MISSING_REQUIRED",
    sopSentenceNumber: 5,
    sopSentenceText: "Patient identifier and recovery progress selection are strictly mandatory; missing values must be rejected as input errors.",
    section: "Section 2: Input Boundaries & Technical Limits",
    rationale: "Maps mandatory intake validation requirements to INPUT_ERROR rule.",
  },
  {
    ruleId: "RULE_PV_NOTE_LENGTH",
    sopSentenceNumber: 6,
    sopSentenceText: "The participant recovery note must be bounded by a maximum limit of 400 characters. Notes exceeding 400 characters must trigger an input error.",
    section: "Section 2: Input Boundaries & Technical Limits",
    rationale: "Maps 400-character boundary limit to length_limit validator rule.",
  },
  {
    ruleId: "RULE_PV_UNTRUSTED_TEXT",
    sopSentenceNumber: 9,
    sopSentenceText: "Participant free-text input is inherently untrusted. Any response containing non-empty text notes must be routed for human staff triage.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Enforces untrusted free-text routing to staff review.",
  },
  {
    ruleId: "RULE_PV_UNCERTAINTY",
    sopSentenceNumber: 10,
    sopSentenceText: "If the recovery selection expresses uncertainty or requests assistance, such as 'Need scheduling assistance' or 'unsure', the workflow must route the case to staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Routes uncertain recovery progress choices to staff.",
  },
  {
    ruleId: "RULE_PV_STAFF_CONTACT",
    sopSentenceNumber: 11,
    sopSentenceText: "If the participant answers 'yes' to requiring staff contact, or selects 'unexpected symptoms', the workflow must route directly to clinical staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Escalates unexpected symptoms and explicit outreach requests.",
  },
  {
    ruleId: "RULE_PV_INSTRUCTION_LIKE_TEXT",
    sopSentenceNumber: 12,
    sopSentenceText: "If the text input contains adversarial prompt injection keywords, jailbreak markers, or system commands, the case must be escalated to human staff review with security tags.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Guards against adversarial injection attacks in recovery notes.",
  },
  {
    ruleId: "RULE_PV_CONTROLLED_URGENT",
    sopSentenceNumber: 13,
    sopSentenceText: "If the note contains acute distress markers such as 'emergency', 'chest pain', 'shortness of breath', 'severe pain', 'bleeding', or 'urgent', the case must immediately trigger staff escalation under CONTROLLED_URGENT_LANGUAGE.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Maps acute distress markers to CONTROLLED_URGENT_LANGUAGE route.",
  },
  {
    ruleId: "RULE_PV_CONTRADICTION",
    sopSentenceNumber: 14,
    sopSentenceText: "If a contradiction occurs where the structured selection claims 'recovering as expected' but the unstructured note describes worsening condition or severe pain, the workflow must escalate to human staff as a status contradiction.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Implements contradiction detection between recovery progress and text.",
  },
  {
    ruleId: "RULE_PV_PRESCRIPTION_REQUEST",
    sopSentenceNumber: 15,
    sopSentenceText: "If the note requests prescription renewal, dosage adjustments, or formal diagnosis, the workflow must flag the request and route to staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Routes medication change or refill queries to staff.",
  },
  {
    ruleId: "RULE_PV_TIMEOUT_MARKER",
    sopSentenceNumber: 16,
    sopSentenceText: "If synthetic infrastructure error flags or timeout markers appear, the workflow must halt draft generation and route to staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Guarantees failure visibility without false success.",
  },
  {
    ruleId: "RULE_PV_ROUTINE_RECOVERY",
    sopSentenceNumber: 17,
    sopSentenceText: "Automated draft synthesis is permitted only if the participant selects 'Recovering as expected', indicates 'no' to staff contact, and provides no free-text note.",
    section: "Section 4: Routine Automated Draft Path",
    rationale: "Authorizes routine automated draft path for recovery confirmation.",
  },
];

// ==========================================
// 3. MEDICATION ADHERENCE PROPOSAL
// ==========================================
const medicationAdherenceRawSpec = {
  spec_version: "1.0.0",
  parent_version: null,
  questionnaire_fields: [
    {
      id: "routineSchedule",
      label: "Routine Schedule",
      type: "select" as const,
      options: [
        "Taken consistently as planned",
        "Missed one or more scheduled doses",
        "Unsure about schedule timing",
      ],
      required: true,
    },
    {
      id: "coordinatorQuestions",
      label: "Do you have questions for your care coordinator?",
      type: "radio" as const,
      options: ["no", "yes"],
      required: true,
    },
    {
      id: "adherenceNote",
      label: "Optional notes for the care team",
      type: "text" as const,
      required: false,
    },
  ],
  rule_list: [
    {
      id: "RULE_MA_MISSING_REQUIRED",
      description: "Enforce presence of mandatory patientId and routineSchedule fields.",
      route: "INPUT_ERROR" as const,
      reason_code: "REQUIRED_FIELD_MISSING",
      condition: {
        any: [{ missing_field: "patientId" }, { missing_field: "routineSchedule" }],
      },
    },
    {
      id: "RULE_MA_NOTE_LENGTH",
      description: "Reject adherence note exceeding 350 characters limit.",
      route: "INPUT_ERROR" as const,
      reason_code: "NOTE_EXCEEDS_LENGTH_LIMIT",
      condition: {
        length_limit: { field: "adherenceNote", max: 350 },
      },
    },
    {
      id: "RULE_MA_UNCERTAINTY",
      description: "Route ambiguous or timing uncertainty responses to staff.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNCERTAINTY_FLAGGED",
      condition: {
        phrase_match: { field: "routineSchedule", phrases: ["unsure", "confused"] },
      },
    },
    {
      id: "RULE_MA_MISSED_OR_QUESTIONS",
      description: "Escalate cases where participant missed doses or requested coordinator outreach.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "MISSED_DOSES_OR_QUESTIONS",
      condition: {
        any: [
          { field_equals: { field: "coordinatorQuestions", value: "yes" } },
          { phrase_match: { field: "routineSchedule", phrases: ["missed"] } },
        ],
      },
    },
    {
      id: "RULE_MA_INSTRUCTION_LIKE_TEXT",
      description: "Detect prompt injection or instruction-like text in adherence notes.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "INSTRUCTION_LIKE_TEXT_DETECTED",
      condition: {
        instruction_like_text: { field: "adherenceNote" },
      },
    },
    {
      id: "RULE_MA_CONTROLLED_URGENT",
      description: "Escalate adverse event or acute distress keywords under CONTROLLED_URGENT_LANGUAGE.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "CONTROLLED_URGENT_LANGUAGE",
      condition: {
        phrase_match: {
          field: "adherenceNote",
          phrases: ["allergic reaction", "severe rash", "difficulty breathing", "chest pain", "emergency"],
        },
      },
    },
    {
      id: "RULE_MA_CONTRADICTION",
      description: "Flag contradiction between consistent adherence selection and text describing missed doses.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "STATUS_TEXT_CONTRADICTION",
      condition: {
        contradiction: {
          structured_field: "routineSchedule",
          structured_matches: ["taken consistently"],
          text_field: "adherenceNote",
          text_keywords: ["forgot", "missed several", "stopped taking", "ran out"],
        },
      },
    },
    {
      id: "RULE_MA_MEDICATION_CHANGE_REQUEST",
      description: "Route medication changes, renewals, or dosage advice inquiries to staff.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "MEDICATION_CHANGE_REQUESTED",
      condition: {
        phrase_match: { field: "adherenceNote", phrases: ["change medication", "increase dose", "side effect", "advice"] },
      },
    },
    {
      id: "RULE_MA_TIMEOUT_MARKER",
      description: "Safely escalate synthetic provider execution timeouts.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "TIMEOUT_VISIBLE_NO_FALSE_SUCCESS",
      condition: {
        phrase_match: { field: "adherenceNote", phrases: ["[simulated_provider_timeout]"] },
      },
    },
    {
      id: "RULE_MA_UNTRUSTED_TEXT",
      description: "Route any non-empty adherence note to human staff review.",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNTRUSTED_FREE_TEXT_PRESENT",
      condition: {
        not: { missing_field: "adherenceNote" },
      },
    },
    {
      id: "RULE_MA_ROUTINE_CONSISTENT",
      description: "Allow automated routine adherence acknowledgment when adherence is consistent with no note.",
      route: "DRAFT_FOR_REVIEW" as const,
      reason_code: "ROUTINE_STRUCTURED_ON_TRACK",
      condition: {
        all: [
          { phrase_match: { field: "routineSchedule", phrases: ["taken consistently"] } },
          { field_equals: { field: "coordinatorQuestions", value: "no" } },
          { missing_field: "adherenceNote" },
        ],
      },
    },
  ],
  draft_templates: [
    {
      id: "TEMPLATE_MA_ADHERENCE_ACK",
      trigger_reason: "ROUTINE_STRUCTURED_ON_TRACK",
      template_text: "Thank you for confirming your routine adherence, [PATIENT_NAME_1]. Your log has been recorded for your care team.",
    },
  ],
  limits: {
    max_note_length: 350,
    max_daily_submissions: 2,
    timeout_ms: 4000,
  },
  reviewer_roles: ["Clinical Lead", "Compliance Officer", "QA Reviewer"],
};

export const medicationAdherenceSpec: WorkflowSpec = {
  ...medicationAdherenceRawSpec,
  content_hash: computeWorkflowSpecHash(medicationAdherenceRawSpec as any),
};

export const medicationAdherenceTraces: SOPTrace[] = [
  {
    ruleId: "RULE_MA_MISSING_REQUIRED",
    sopSentenceNumber: 5,
    sopSentenceText: "Patient identifier and routine schedule selection are mandatory; omission of required values results in an input error.",
    section: "Section 2: Input Boundaries & Technical Limits",
    rationale: "Maps mandatory intake validation requirements to INPUT_ERROR rule.",
  },
  {
    ruleId: "RULE_MA_NOTE_LENGTH",
    sopSentenceNumber: 6,
    sopSentenceText: "The participant adherence note is restricted to a maximum length of 350 characters. Submissions exceeding 350 characters must be rejected as an input error.",
    section: "Section 2: Input Boundaries & Technical Limits",
    rationale: "Maps 350-character limit to length_limit validator rule.",
  },
  {
    ruleId: "RULE_MA_UNTRUSTED_TEXT",
    sopSentenceNumber: 9,
    sopSentenceText: "Participant free-text input is untrusted external data. Every submission containing non-empty text in the note field must be routed to human staff review.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Enforces untrusted free-text routing to staff review.",
  },
  {
    ruleId: "RULE_MA_UNCERTAINTY",
    sopSentenceNumber: 10,
    sopSentenceText: "Ambiguous or uncertain schedule responses such as 'Unsure about schedule timing' or 'confused' must trigger mandatory staff review.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Routes uncertain timing choices directly to staff.",
  },
  {
    ruleId: "RULE_MA_MISSED_OR_QUESTIONS",
    sopSentenceNumber: 11,
    sopSentenceText: "If the participant indicates missed doses or selects 'yes' to questions for the care team, the case must be escalated to a human coordinator.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Escalates missed doses and coordinator outreach requests.",
  },
  {
    ruleId: "RULE_MA_INSTRUCTION_LIKE_TEXT",
    sopSentenceNumber: 12,
    sopSentenceText: "Adversarial prompt injections, command phrases, or delimiter tampering in the note must be caught and routed to human review with security notice.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Guards against adversarial injection attacks in adherence notes.",
  },
  {
    ruleId: "RULE_MA_CONTROLLED_URGENT",
    sopSentenceNumber: 13,
    sopSentenceText: "Any mention of adverse event phrases or acute distress keywords such as 'allergic reaction', 'severe rash', 'difficulty breathing', 'chest pain', or 'emergency' must immediately trigger human staff review under CONTROLLED_URGENT_LANGUAGE.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Maps adverse reaction and distress keywords to CONTROLLED_URGENT_LANGUAGE route.",
  },
  {
    ruleId: "RULE_MA_CONTRADICTION",
    sopSentenceNumber: 14,
    sopSentenceText: "If a contradiction is detected between a structured 'taken consistently' response and free text describing missed doses or side effects, the workflow must route the case to staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Implements contradiction detection between consistent report and note text.",
  },
  {
    ruleId: "RULE_MA_MEDICATION_CHANGE_REQUEST",
    sopSentenceNumber: 15,
    sopSentenceText: "If the note requests change in medication, renewal authorization, or clinical dosage counsel, the workflow must escalate to human staff.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Routes pharmacotherapy questions or modification requests to staff.",
  },
  {
    ruleId: "RULE_MA_TIMEOUT_MARKER",
    sopSentenceNumber: 16,
    sopSentenceText: "Synthetic provider failures or timeouts must route to human review and never produce an automated success draft.",
    section: "Section 3: Safety Guardrails & Human Escalation Rules",
    rationale: "Guarantees failure visibility without false success.",
  },
  {
    ruleId: "RULE_MA_ROUTINE_CONSISTENT",
    sopSentenceNumber: 17,
    sopSentenceText: "Automated routine draft preparation is allowed solely when the participant selects 'Taken consistently as planned', selects 'no' to questions, and submits an empty note.",
    section: "Section 4: Routine Automated Draft Path",
    rationale: "Authorizes routine automated draft path for adherence confirmation.",
  },
];

// ==========================================
// 4. DELIBERATELY UNSAFE SPEC PROPOSAL (For Validator Testing)
// ==========================================
export const unsafeProposalSpecRaw = {
  spec_version: "1.0.0-unsafe",
  parent_version: null,
  questionnaire_fields: [
    {
      id: "weekStatus",
      label: "Status",
      type: "text" as const,
      required: true,
    },
  ],
  rule_list: [
    // VIOLATION 1: Routes concerning distress text ("chest pain", "emergency") to DRAFT_FOR_REVIEW!
    {
      id: "RULE_UNSAFE_ROUTING_DISTRESS_TO_DRAFT",
      description: "Deliberately unsafe rule routing acute distress to draft.",
      route: "DRAFT_FOR_REVIEW" as const,
      reason_code: "UNSAFE_DRAFT_DISTRESS",
      condition: {
        phrase_match: {
          field: "note",
          phrases: ["chest pain", "emergency", "shortness of breath"],
        },
      },
    },
    // VIOLATION 2: Unsafe code construct (eval attempt)
    {
      id: "RULE_UNSAFE_CONSTRUCT",
      description: "Dangerous construct eval(process.env).",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "DANGEROUS_CONSTRUCT",
      condition: {
        phrase_match: { field: "note", phrases: ["eval(malicious)"] },
      },
    },
    // VIOLATION 3: Missing required safety rules (untrusted-text, contradiction, uncertainty, limits)
  ],
  draft_templates: [
    {
      id: "TEMPLATE_UNSAFE",
      trigger_reason: "UNSAFE_DRAFT_DISTRESS",
      template_text: "You reported chest pain, we will draft this automatically.",
    },
  ],
  limits: {
    max_note_length: -50, // Negative limit
    max_daily_submissions: 0,
    timeout_ms: 50, // Too small
  },
  reviewer_roles: ["staff"],
};

export const unsafeProposalSpec: WorkflowSpec = {
  ...unsafeProposalSpecRaw,
  content_hash: computeWorkflowSpecHash(unsafeProposalSpecRaw as any),
};


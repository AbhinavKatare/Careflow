import type { WorkflowSpec } from "../domain/types";
import { computeWorkflowSpecHash } from "../domain/workflow-spec";

const rawSpecWithoutHash = {
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
      description: "Check for missing required patient ID or week status field (illustrative demo logic, not clinical criteria.)",
      route: "INPUT_ERROR" as const,
      reason_code: "REQUIRED_FIELD_MISSING",
      condition: {
        any: [
          { missing_field: "patientId" },
          { missing_field: "weekStatus" },
        ],
      },
    },
    {
      id: "RULE_INPUT_NOTE_LENGTH",
      description: "Reject free-text note exceeding maximum length threshold of 500 characters (illustrative demo logic, not clinical criteria.)",
      route: "INPUT_ERROR" as const,
      reason_code: "NOTE_EXCEEDS_LENGTH_LIMIT",
      condition: {
        length_limit: {
          field: "note",
          max: 500,
        },
      },
    },
    {
      id: "RULE_INSTRUCTION_LIKE_TEXT",
      description: "Detect adversarial prompt-injection or instruction-like text in free text (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "INSTRUCTION_LIKE_TEXT_DETECTED",
      condition: {
        instruction_like_text: {
          field: "note",
        },
      },
    },
    {
      id: "RULE_CONTROLLED_URGENT_LANGUAGE",
      description: "Detect synthetic urgent red-flag marker phrases tagged under abstract CONTROLLED_URGENT_LANGUAGE (illustrative demo logic, not clinical criteria.)",
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
      description: "Flag direct conflict between structured on-track status and unstructured text reporting distress (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "STATUS_TEXT_CONTRADICTION",
      condition: {
        contradiction: {
          structured_field: "weekStatus",
          structured_matches: ["on track"],
          text_field: "note",
          text_keywords: [
            "extreme difficulty",
            "cannot take any",
            "completely failing",
            "falling apart",
          ],
        },
      },
    },
    {
      id: "RULE_EXPLICIT_FOLLOWUP_REQUEST",
      description: "Route explicit care-team follow-up requests to human staff (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "EXPLICIT_FOLLOWUP_REQUESTED",
      condition: {
        any: [
          {
            field_equals: {
              field: "followUp",
              value: "yes",
            },
          },
          {
            phrase_match: {
              field: "weekStatus",
              phrases: ["question"],
            },
          },
        ],
      },
    },
    {
      id: "RULE_UNCERTAINTY_EXPRESSED",
      description: "Route uncertain or ambiguous participant responses to clinical staff (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNCERTAINTY_FLAGGED",
      condition: {
        phrase_match: {
          field: "weekStatus",
          phrases: ["not sure", "unsure"],
        },
      },
    },
    {
      id: "RULE_DIAGNOSIS_OR_PRESCRIPTION_REQUEST",
      description: "Detect free-text inquiries requesting medical diagnosis or prescription modifications (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "DIAGNOSIS_OR_PRESCRIPTION_REQUESTED",
      condition: {
        phrase_match: {
          field: "note",
          phrases: ["diagnose", "prescription", "prescribe", "ointment", "antibiotics"],
        },
      },
    },
    {
      id: "RULE_PROVIDER_TIMEOUT_MARKER",
      description: "Safely escalate synthetic upstream provider timeout indicators (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "TIMEOUT_VISIBLE_NO_FALSE_SUCCESS",
      condition: {
        phrase_match: {
          field: "note",
          phrases: ["[simulated_provider_timeout]"],
        },
      },
    },
    {
      id: "RULE_UNTRUSTED_FREE_TEXT",
      description: "Enforce policy that any untrusted free-text note requires human review (illustrative demo logic, not clinical criteria.)",
      route: "HUMAN_REVIEW_REQUIRED" as const,
      reason_code: "UNTRUSTED_FREE_TEXT_PRESENT",
      condition: {
        not: {
          missing_field: "note",
        },
      },
    },
    {
      id: "RULE_ROUTINE_ON_TRACK",
      description: "Allow automated draft preparation for verified routine on-track check-ins without follow-up or free-text (illustrative demo logic, not clinical criteria.)",
      route: "DRAFT_FOR_REVIEW" as const,
      reason_code: "ROUTINE_STRUCTURED_ON_TRACK",
      condition: {
        all: [
          {
            phrase_match: {
              field: "weekStatus",
              phrases: ["on track"],
            },
          },
          {
            field_equals: {
              field: "followUp",
              value: "no",
            },
          },
          {
            missing_field: "note",
          },
        ],
      },
    },
  ],
  draft_templates: [
    {
      id: "tpl_routine_on_track",
      trigger_reason: "ROUTINE_STRUCTURED_ON_TRACK",
      template_text: "Thank you for completing your weekly check-in. Our team is glad to hear you are staying on track with your routine.",
    },
  ],
  limits: {
    max_note_length: 500,
    max_daily_submissions: 3,
    timeout_ms: 5000,
  },
  reviewer_roles: ["DEMO_REVIEWER", "CLINICAL_SUPERVISOR"],
};

export const defaultWorkflowSpec: WorkflowSpec = {
  ...rawSpecWithoutHash,
  content_hash: computeWorkflowSpecHash(rawSpecWithoutHash),
};


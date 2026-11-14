import type { FeedbackLabel } from "./types";

const ago = (hours: number) =>
  new Date(Date.now() - hours * 3600 * 1000).toISOString();

/**
 * 40 Seeded Synthetic Reviewer Actions.
 *
 * PERMANENT AGENT RULES:
 * - Synthetic Data Only: Demo Patient 001 - 040, fake IDs, fake notes.
 * - Zero Outbound Effects: Simulated state only.
 * - Raw inputs & computed metrics: No outcome-encoding flags.
 * - Covers all 4 action types:
 *     16 draft_accepted_unchanged
 *     12 draft_edited
 *     8  rejected (across all 5 taxonomy reason codes)
 *     4  route_override
 *   Total = 40 actions.
 */
export const seedFeedbackLabels: FeedbackLabel[] = [
  // ========================================================
  // COHORT 1: prompt_version: "draft_v1", rule_version: "rules_v1.0" (Items 1-20)
  // ========================================================

  // 1. Accepted unchanged
  {
    id: "fb-001",
    caseId: "CHK-1001",
    patientId: "DEMO-001",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(160),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thanks for checking in, [PATIENT_NAME_1]. Your update has been recorded for your care team to review." }],
    originalDraft: "Thanks for checking in, [PATIENT_NAME_1]. Your update has been recorded for your care team to review.",
    finalDraft: "Thanks for checking in, [PATIENT_NAME_1]. Your update has been recorded for your care team to review.",
    inputRedacted: "Routine weekly update. Everything is on track with my daily walking schedule.",
    extraction: [
      { id: "fx-1", category: "Routine Adherence", value: "On track with walking routine", confidence: 0.99 },
    ],
    draft: "Thanks for checking in, [PATIENT_NAME_1]. Your update has been recorded for your care team to review.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 2. Accepted unchanged
  {
    id: "fb-002",
    caseId: "CHK-1002",
    patientId: "DEMO-002",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(156),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thank you for confirming your routine adherence. Our team has received your update." }],
    originalDraft: "Thank you for confirming your routine adherence. Our team has received your update.",
    finalDraft: "Thank you for confirming your routine adherence. Our team has received your update.",
    inputRedacted: "Weekly check-in submitted with no requested follow-up.",
    extraction: [
      { id: "fx-2", category: "Outreach Need", value: "None requested", confidence: 1.0 },
    ],
    draft: "Thank you for confirming your routine adherence. Our team has received your update.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 3. Accepted unchanged
  {
    id: "fb-003",
    caseId: "CHK-1003",
    patientId: "DEMO-003",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(152),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "We have noted your check-in. Continue your program routine as planned." }],
    originalDraft: "We have noted your check-in. Continue your program routine as planned.",
    finalDraft: "We have noted your check-in. Continue your program routine as planned.",
    inputRedacted: "Hydration goals met this week, no concerns.",
    extraction: [
      { id: "fx-3", category: "Habit Tracking", value: "Hydration goal met", confidence: 0.96 },
    ],
    draft: "We have noted your check-in. Continue your program routine as planned.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 4. Accepted unchanged
  {
    id: "fb-004",
    caseId: "CHK-1004",
    patientId: "DEMO-004",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(148),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thanks for checking in, [PATIENT_NAME_1]. Your response is logged." }],
    originalDraft: "Thanks for checking in, [PATIENT_NAME_1]. Your response is logged.",
    finalDraft: "Thanks for checking in, [PATIENT_NAME_1]. Your response is logged.",
    inputRedacted: "All set for this week.",
    extraction: [
      { id: "fx-4", category: "General Status", value: "Normal routine", confidence: 0.97 },
    ],
    draft: "Thanks for checking in, [PATIENT_NAME_1]. Your response is logged.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 5. Accepted unchanged
  {
    id: "fb-005",
    caseId: "CHK-1005",
    patientId: "DEMO-005",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(144),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Your check-in has been filed. Next check-in opens next Monday." }],
    originalDraft: "Your check-in has been filed. Next check-in opens next Monday.",
    finalDraft: "Your check-in has been filed. Next check-in opens next Monday.",
    inputRedacted: "Routine complete.",
    extraction: [
      { id: "fx-5", category: "Routine Adherence", value: "Complete", confidence: 1.0 },
    ],
    draft: "Your check-in has been filed. Next check-in opens next Monday.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 6. Accepted unchanged
  {
    id: "fb-006",
    caseId: "CHK-1006",
    patientId: "DEMO-006",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(140),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thanks for checking in. The care team will follow up if any items need review." }],
    originalDraft: "Thanks for checking in. The care team will follow up if any items need review.",
    finalDraft: "Thanks for checking in. The care team will follow up if any items need review.",
    inputRedacted: "Routine status good, sleep schedule stabilized.",
    extraction: [
      { id: "fx-6", category: "Wellness Note", value: "Sleep routine stable", confidence: 0.93 },
    ],
    draft: "Thanks for checking in. The care team will follow up if any items need review.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 7. Draft Edited (tone softening)
  {
    id: "fb-007",
    caseId: "CHK-1007",
    patientId: "DEMO-007",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(136),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 24,
    diff: [
      { type: "unchanged", text: "Thanks for checking in. " },
      { type: "removed", text: "You must continue logging daily." },
      { type: "added", text: "Please let us know if you need any adjustments to your routine." },
    ],
    originalDraft: "Thanks for checking in. You must continue logging daily.",
    finalDraft: "Thanks for checking in. Please let us know if you need any adjustments to your routine.",
    inputRedacted: "Continuing routine as instructed.",
    extraction: [
      { id: "fx-7", category: "Adherence", value: "Logged daily", confidence: 0.95 },
    ],
    draft: "Thanks for checking in. Please let us know if you need any adjustments to your routine.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 24,
      simulated: true,
    },
  },

  // 8. Draft Edited (added contact info)
  {
    id: "fb-008",
    caseId: "CHK-1008",
    patientId: "DEMO-008",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(132),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 31,
    diff: [
      { type: "unchanged", text: "Your check-in is recorded. " },
      { type: "added", text: "Our desk is reachable weekdays 9am-5pm for routine questions." },
    ],
    originalDraft: "Your check-in is recorded. ",
    finalDraft: "Your check-in is recorded. Our desk is reachable weekdays 9am-5pm for routine questions.",
    inputRedacted: "Check-in completed for the week.",
    extraction: [
      { id: "fx-8", category: "Routine", value: "Completed", confidence: 0.98 },
    ],
    draft: "Your check-in is recorded. Our desk is reachable weekdays 9am-5pm for routine questions.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 31,
      simulated: true,
    },
  },

  // 9. Draft Edited (removed prescriptive wording)
  {
    id: "fb-009",
    caseId: "CHK-1009",
    patientId: "DEMO-009",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(128),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 19,
    diff: [
      { type: "unchanged", text: "Thanks for your update. " },
      { type: "removed", text: "We suggest doubling water." },
      { type: "added", text: "Keep following your hydration plan." },
    ],
    originalDraft: "Thanks for your update. We suggest doubling water.",
    finalDraft: "Thanks for your update. Keep following your hydration plan.",
    inputRedacted: "Trying to drink more water this week.",
    extraction: [
      { id: "fx-9", category: "Habit", value: "Water intake tracking", confidence: 0.91 },
    ],
    draft: "Thanks for your update. Keep following your hydration plan.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 19,
      simulated: true,
    },
  },

  // 10. Draft Edited (concise phrasing)
  {
    id: "fb-010",
    caseId: "CHK-1010",
    patientId: "DEMO-010",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(124),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 16,
    diff: [
      { type: "unchanged", text: "Thank you for the submission. " },
      { type: "removed", text: "Everything appears completely fine." },
      { type: "added", text: "Your log has been filed." },
    ],
    originalDraft: "Thank you for the submission. Everything appears completely fine.",
    finalDraft: "Thank you for the submission. Your log has been filed.",
    inputRedacted: "Routine week, walking program progressing well.",
    extraction: [
      { id: "fx-10", category: "Exercise", value: "Walking program on schedule", confidence: 0.97 },
    ],
    draft: "Thank you for the submission. Your log has been filed.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 16,
      simulated: true,
    },
  },

  // 11. Draft Edited (clarified timeline)
  {
    id: "fb-011",
    caseId: "CHK-1011",
    patientId: "DEMO-011",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(120),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 22,
    diff: [
      { type: "unchanged", text: "Check-in received. " },
      { type: "removed", text: "We will contact you soon." },
      { type: "added", text: "Staff review scheduled within 2 business days." },
    ],
    originalDraft: "Check-in received. We will contact you soon.",
    finalDraft: "Check-in received. Staff review scheduled within 2 business days.",
    inputRedacted: "Checking in as scheduled.",
    extraction: [
      { id: "fx-11", category: "Routine Check-In", value: "On schedule", confidence: 0.99 },
    ],
    draft: "Check-in received. Staff review scheduled within 2 business days.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 22,
      simulated: true,
    },
  },

  // 12. Draft Edited (warmer greeting)
  {
    id: "fb-012",
    caseId: "CHK-1012",
    patientId: "DEMO-012",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(116),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    editDistance: 12,
    diff: [
      { type: "removed", text: "Notice: " },
      { type: "added", text: "Hello, " },
      { type: "unchanged", text: "your weekly check-in has been recorded successfully." },
    ],
    originalDraft: "Notice: your weekly check-in has been recorded successfully.",
    finalDraft: "Hello, your weekly check-in has been recorded successfully.",
    inputRedacted: "Doing fine this week, no issues.",
    extraction: [
      { id: "fx-12", category: "Status", value: "No issues", confidence: 0.96 },
    ],
    draft: "Hello, your weekly check-in has been recorded successfully.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 12,
      simulated: true,
    },
  },

  // 13. Rejected: inaccurate
  {
    id: "fb-013",
    caseId: "CHK-1013",
    patientId: "DEMO-013",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(112),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    rejectionReason: "inaccurate",
    rejectionNotes: "Draft claimed participant completed 7 days of logs when note mentioned only 3 days.",
    inputRedacted: "Logged my routine for 3 days this week.",
    extraction: [
      { id: "fx-13", category: "Activity", value: "3 days logged", confidence: 0.88 },
    ],
    draft: "Great job completing your full 7-day routine log this week!",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "inaccurate",
      rejectionNotes: "Draft claimed participant completed 7 days of logs when note mentioned only 3 days.",
      simulated: true,
    },
  },

  // 14. Rejected: tone
  {
    id: "fb-014",
    caseId: "CHK-1014",
    patientId: "DEMO-014",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(108),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    rejectionReason: "tone",
    rejectionNotes: "Draft sounded reprimanding regarding missed stretch session.",
    inputRedacted: "Missed stretching yesterday due to late commute.",
    extraction: [
      { id: "fx-14", category: "Adherence", value: "Missed one stretch session", confidence: 0.92 },
    ],
    draft: "You failed to complete your required stretch session yesterday. You must rectify this.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "tone",
      rejectionNotes: "Draft sounded reprimanding regarding missed stretch session.",
      simulated: true,
    },
  },

  // 15. Rejected: unsupported_claim
  {
    id: "fb-015",
    caseId: "CHK-1015",
    patientId: "DEMO-015",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(104),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    rejectionReason: "unsupported_claim",
    rejectionNotes: "Draft mentioned lab results which were never part of this check-in.",
    inputRedacted: "Doing well, no major change.",
    extraction: [
      { id: "fx-15", category: "Status", value: "Stable", confidence: 0.95 },
    ],
    draft: "Your recent blood panel shows improvements across your metrics.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "unsupported_claim",
      rejectionNotes: "Draft mentioned lab results which were never part of this check-in.",
      simulated: true,
    },
  },

  // 16. Rejected: should_have_been_escalated
  {
    id: "fb-016",
    caseId: "CHK-1016",
    patientId: "DEMO-016",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(100),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    rejectionReason: "should_have_been_escalated",
    rejectionNotes: "Participant mentioned controlled urgent tag keyword; draft should not have been synthesized.",
    inputRedacted: "Feeling intense tightness during walk [CONTROLLED_URGENT_LANGUAGE].",
    extraction: [
      { id: "fx-16", category: "Safety", value: "Tightness reported", confidence: 0.99 },
    ],
    draft: "Take it easy and keep monitoring your symptoms.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "should_have_been_escalated",
      rejectionNotes: "Participant mentioned controlled urgent tag keyword; draft should not have been synthesized.",
      simulated: true,
    },
  },

  // 17. Rejected: other
  {
    id: "fb-017",
    caseId: "CHK-1017",
    patientId: "DEMO-017",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(96),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    rejectionReason: "other",
    rejectionNotes: "Participant already called the clinic directly; response draft is redundant.",
    inputRedacted: "Called office this morning, also submitting weekly log.",
    extraction: [
      { id: "fx-17", category: "Outreach", value: "Phone call initiated", confidence: 0.94 },
    ],
    draft: "Thanks for checking in, we will be in touch shortly.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "other",
      rejectionNotes: "Participant already called the clinic directly; response draft is redundant.",
      simulated: true,
    },
  },

  // 18. Route Override (from DRAFT_FOR_REVIEW to HUMAN_REVIEW_REQUIRED)
  {
    id: "fb-018",
    caseId: "CHK-1018",
    patientId: "DEMO-018",
    action: "route_override",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(92),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    routeOverride: {
      originalRoute: "DRAFT_FOR_REVIEW",
      suggestedRoute: "HUMAN_REVIEW_REQUIRED",
      reason: "Note contained complex scheduling inquiry that requires administrative coordination.",
    },
    inputRedacted: "Need to reschedule my upcoming appointment for next month.",
    extraction: [
      { id: "fx-18", category: "Scheduling", value: "Reschedule request", confidence: 0.92 },
    ],
    draft: "Thanks for checking in. We received your note.",
    reviewerOutcome: {
      action: "route_override",
      status: "needs_review",
      routeOverride: {
        originalRoute: "DRAFT_FOR_REVIEW",
        suggestedRoute: "HUMAN_REVIEW_REQUIRED",
        reason: "Note contained complex scheduling inquiry that requires administrative coordination.",
      },
      simulated: true,
    },
  },

  // 19. Route Override (from HUMAN_REVIEW_REQUIRED to DRAFT_FOR_REVIEW)
  {
    id: "fb-019",
    caseId: "CHK-1019",
    patientId: "DEMO-019",
    action: "route_override",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(88),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    routeOverride: {
      originalRoute: "HUMAN_REVIEW_REQUIRED",
      suggestedRoute: "DRAFT_FOR_REVIEW",
      reason: "Free text was only a polite greeting 'thank you team' with no escalation need.",
    },
    inputRedacted: "Thank you to the whole team for checking in on me!",
    extraction: [
      { id: "fx-19", category: "Social Greeting", value: "Thank you note", confidence: 0.98 },
    ],
    draft: null,
    reviewerOutcome: {
      action: "route_override",
      status: "draft_ready",
      routeOverride: {
        originalRoute: "HUMAN_REVIEW_REQUIRED",
        suggestedRoute: "DRAFT_FOR_REVIEW",
        reason: "Free text was only a polite greeting 'thank you team' with no escalation need.",
      },
      simulated: true,
    },
  },

  // 20. Rejected: inaccurate
  {
    id: "fb-020",
    caseId: "CHK-1020",
    patientId: "DEMO-020",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(84),
    promptVersion: "draft_v1",
    ruleVersion: "rules_v1.0",
    rejectionReason: "inaccurate",
    rejectionNotes: "Model hallucinated a medication name not mentioned anywhere in synthetic record.",
    inputRedacted: "Finished my daily walks on Tuesday and Thursday.",
    extraction: [
      { id: "fx-20", category: "Routine", value: "Walks logged", confidence: 0.95 },
    ],
    draft: "Good job taking your Lisinopril medication as instructed.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "inaccurate",
      rejectionNotes: "Model hallucinated a medication name not mentioned anywhere in synthetic record.",
      simulated: true,
    },
  },

  // ========================================================
  // COHORT 2: prompt_version: "draft_v2", rule_version: "rules_v1.1" (Items 21-40)
  // Higher acceptance rate, lower mean edit distance, improved grounding.
  // ========================================================

  // 21. Accepted unchanged
  {
    id: "fb-021",
    caseId: "CHK-1021",
    patientId: "DEMO-021",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(80),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thank you for checking in, [PATIENT_NAME_1]. Your update has been safely logged." }],
    originalDraft: "Thank you for checking in, [PATIENT_NAME_1]. Your update has been safely logged.",
    finalDraft: "Thank you for checking in, [PATIENT_NAME_1]. Your update has been safely logged.",
    inputRedacted: "Doing great this week, hit my exercise targets.",
    extraction: [
      { id: "fx-21", category: "Adherence", value: "Exercise targets met", confidence: 0.99 },
    ],
    draft: "Thank you for checking in, [PATIENT_NAME_1]. Your update has been safely logged.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 22. Accepted unchanged
  {
    id: "fb-022",
    caseId: "CHK-1022",
    patientId: "DEMO-022",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(76),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Your weekly routine submission is received. We look forward to your next check-in." }],
    originalDraft: "Your weekly routine submission is received. We look forward to your next check-in.",
    finalDraft: "Your weekly routine submission is received. We look forward to your next check-in.",
    inputRedacted: "Routine complete, everything as usual.",
    extraction: [
      { id: "fx-22", category: "Routine", value: "Complete as usual", confidence: 1.0 },
    ],
    draft: "Your weekly routine submission is received. We look forward to your next check-in.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 23. Accepted unchanged
  {
    id: "fb-023",
    caseId: "CHK-1023",
    patientId: "DEMO-023",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(72),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thanks for checking in. No further action is required from you at this time." }],
    originalDraft: "Thanks for checking in. No further action is required from you at this time.",
    finalDraft: "Thanks for checking in. No further action is required from you at this time.",
    inputRedacted: "Weekly check-in logged on time.",
    extraction: [
      { id: "fx-23", category: "Submission Status", value: "On time", confidence: 0.99 },
    ],
    draft: "Thanks for checking in. No further action is required from you at this time.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 24. Accepted unchanged
  {
    id: "fb-024",
    caseId: "CHK-1024",
    patientId: "DEMO-024",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(68),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "We have received your weekly follow-up update. Have a wonderful week." }],
    originalDraft: "We have received your weekly follow-up update. Have a wonderful week.",
    finalDraft: "We have received your weekly follow-up update. Have a wonderful week.",
    inputRedacted: "Feeling good, on schedule.",
    extraction: [
      { id: "fx-24", category: "Routine Status", value: "Good, on schedule", confidence: 0.98 },
    ],
    draft: "We have received your weekly follow-up update. Have a wonderful week.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 25. Accepted unchanged
  {
    id: "fb-025",
    caseId: "CHK-1025",
    patientId: "DEMO-025",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(64),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Your check-in has been filed for the care team's weekly review." }],
    originalDraft: "Your check-in has been filed for the care team's weekly review.",
    finalDraft: "Your check-in has been filed for the care team's weekly review.",
    inputRedacted: "Routine on track.",
    extraction: [
      { id: "fx-25", category: "Routine", value: "On track", confidence: 1.0 },
    ],
    draft: "Your check-in has been filed for the care team's weekly review.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 26. Accepted unchanged
  {
    id: "fb-026",
    caseId: "CHK-1026",
    patientId: "DEMO-026",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(60),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thank you for confirming your routine adherence for this cycle." }],
    originalDraft: "Thank you for confirming your routine adherence for this cycle.",
    finalDraft: "Thank you for confirming your routine adherence for this cycle.",
    inputRedacted: "Checking in on time, adherence steady.",
    extraction: [
      { id: "fx-26", category: "Adherence", value: "Steady adherence", confidence: 0.97 },
    ],
    draft: "Thank you for confirming your routine adherence for this cycle.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 27. Accepted unchanged
  {
    id: "fb-027",
    caseId: "CHK-1027",
    patientId: "DEMO-027",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(56),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Your routine update has been archived. Reach out if anything arises." }],
    originalDraft: "Your routine update has been archived. Reach out if anything arises.",
    finalDraft: "Your routine update has been archived. Reach out if anything arises.",
    inputRedacted: "All set, routine maintained.",
    extraction: [
      { id: "fx-27", category: "Routine", value: "Maintained", confidence: 0.99 },
    ],
    draft: "Your routine update has been archived. Reach out if anything arises.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 28. Accepted unchanged
  {
    id: "fb-028",
    caseId: "CHK-1028",
    patientId: "DEMO-028",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(52),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Update logged. We appreciate you staying on track with your routine." }],
    originalDraft: "Update logged. We appreciate you staying on track with your routine.",
    finalDraft: "Update logged. We appreciate you staying on track with your routine.",
    inputRedacted: "Weekly check-in logged.",
    extraction: [
      { id: "fx-28", category: "Routine", value: "Logged", confidence: 1.0 },
    ],
    draft: "Update logged. We appreciate you staying on track with your routine.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 29. Accepted unchanged
  {
    id: "fb-029",
    caseId: "CHK-1029",
    patientId: "DEMO-029",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(48),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Check-in received for [PATIENT_NAME_1]. Care team notified." }],
    originalDraft: "Check-in received for [PATIENT_NAME_1]. Care team notified.",
    finalDraft: "Check-in received for [PATIENT_NAME_1]. Care team notified.",
    inputRedacted: "Routine on track, no team questions.",
    extraction: [
      { id: "fx-29", category: "Outreach", value: "No questions", confidence: 0.99 },
    ],
    draft: "Check-in received for [PATIENT_NAME_1]. Care team notified.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 30. Accepted unchanged
  {
    id: "fb-030",
    caseId: "CHK-1030",
    patientId: "DEMO-030",
    action: "draft_accepted_unchanged",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(44),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 0,
    diff: [{ type: "unchanged", text: "Thanks for checking in on schedule. Have a great rest of your week." }],
    originalDraft: "Thanks for checking in on schedule. Have a great rest of your week.",
    finalDraft: "Thanks for checking in on schedule. Have a great rest of your week.",
    inputRedacted: "Everything on track this week.",
    extraction: [
      { id: "fx-30", category: "Routine", value: "On track", confidence: 0.98 },
    ],
    draft: "Thanks for checking in on schedule. Have a great rest of your week.",
    reviewerOutcome: {
      action: "draft_accepted_unchanged",
      status: "approved",
      editDistance: 0,
      simulated: true,
    },
  },

  // 31. Draft Edited (minor tweak)
  {
    id: "fb-031",
    caseId: "CHK-1031",
    patientId: "DEMO-031",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(40),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 8,
    diff: [
      { type: "unchanged", text: "Thank you for checking in. " },
      { type: "removed", text: "Have a nice day." },
      { type: "added", text: "Have a restful weekend." },
    ],
    originalDraft: "Thank you for checking in. Have a nice day.",
    finalDraft: "Thank you for checking in. Have a restful weekend.",
    inputRedacted: "Finished routine on Friday.",
    extraction: [
      { id: "fx-31", category: "Routine", value: "Finished Friday", confidence: 0.96 },
    ],
    draft: "Thank you for checking in. Have a restful weekend.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 8,
      simulated: true,
    },
  },

  // 32. Draft Edited (small clarification)
  {
    id: "fb-032",
    caseId: "CHK-1032",
    patientId: "DEMO-032",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(36),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 11,
    diff: [
      { type: "unchanged", text: "Your check-in has been logged. " },
      { type: "added", text: "Clinic is closed Monday." },
    ],
    originalDraft: "Your check-in has been logged. ",
    finalDraft: "Your check-in has been logged. Clinic is closed Monday.",
    inputRedacted: "Adherence is good this week.",
    extraction: [
      { id: "fx-32", category: "Adherence", value: "Good", confidence: 0.98 },
    ],
    draft: "Your check-in has been logged. Clinic is closed Monday.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 11,
      simulated: true,
    },
  },

  // 33. Draft Edited (customized acknowledgment)
  {
    id: "fb-033",
    caseId: "CHK-1033",
    patientId: "DEMO-033",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(32),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 9,
    diff: [
      { type: "unchanged", text: "Thanks for checking in. " },
      { type: "removed", text: "Keep going." },
      { type: "added", text: "Keep up the consistent habits." },
    ],
    originalDraft: "Thanks for checking in. Keep going.",
    finalDraft: "Thanks for checking in. Keep up the consistent habits.",
    inputRedacted: "Daily routine kept consistent.",
    extraction: [
      { id: "fx-33", category: "Habit", value: "Consistent daily routine", confidence: 0.99 },
    ],
    draft: "Thanks for checking in. Keep up the consistent habits.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 9,
      simulated: true,
    },
  },

  // 34. Draft Edited (shortened closing)
  {
    id: "fb-034",
    caseId: "CHK-1034",
    patientId: "DEMO-034",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(28),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 14,
    diff: [
      { type: "unchanged", text: "We have registered your update. " },
      { type: "removed", text: "Please do not hesitate to contact our staff at any time if you feel you need anything." },
      { type: "added", text: "Contact our staff if any questions arise." },
    ],
    originalDraft: "We have registered your update. Please do not hesitate to contact our staff at any time if you feel you need anything.",
    finalDraft: "We have registered your update. Contact our staff if any questions arise.",
    inputRedacted: "Check-in complete, feeling fine.",
    extraction: [
      { id: "fx-34", category: "Routine", value: "Complete, feeling fine", confidence: 0.95 },
    ],
    draft: "We have registered your update. Contact our staff if any questions arise.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 14,
      simulated: true,
    },
  },

  // 35. Draft Edited (softened sign-off)
  {
    id: "fb-035",
    caseId: "CHK-1035",
    patientId: "DEMO-035",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(24),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 7,
    diff: [
      { type: "unchanged", text: "Thanks for checking in. " },
      { type: "removed", text: "Regards." },
      { type: "added", text: "Warm regards." },
    ],
    originalDraft: "Thanks for checking in. Regards.",
    finalDraft: "Thanks for checking in. Warm regards.",
    inputRedacted: "All set this week.",
    extraction: [
      { id: "fx-35", category: "Routine", value: "All set", confidence: 0.99 },
    ],
    draft: "Thanks for checking in. Warm regards.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 7,
      simulated: true,
    },
  },

  // 36. Draft Edited (added clinic hours)
  {
    id: "fb-036",
    caseId: "CHK-1036",
    patientId: "DEMO-036",
    action: "draft_edited",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(20),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    editDistance: 12,
    diff: [
      { type: "unchanged", text: "Your check-in is logged. " },
      { type: "added", text: "Support is open 8am-4pm." },
    ],
    originalDraft: "Your check-in is logged. ",
    finalDraft: "Your check-in is logged. Support is open 8am-4pm.",
    inputRedacted: "Routine maintained.",
    extraction: [
      { id: "fx-36", category: "Routine", value: "Maintained", confidence: 0.98 },
    ],
    draft: "Your check-in is logged. Support is open 8am-4pm.",
    reviewerOutcome: {
      action: "draft_edited",
      status: "approved",
      editDistance: 12,
      simulated: true,
    },
  },

  // 37. Rejected: tone
  {
    id: "fb-037",
    caseId: "CHK-1037",
    patientId: "DEMO-037",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(16),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    rejectionReason: "tone",
    rejectionNotes: "Draft opened with overly clinical diagnostic-sounding summary.",
    inputRedacted: "Slight fatigue after yesterday's session.",
    extraction: [
      { id: "fx-37", category: "Symptom Mention", value: "Fatigue after session", confidence: 0.92 },
    ],
    draft: "We have reviewed your reported post-exertional fatigue pathology.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "tone",
      rejectionNotes: "Draft opened with overly clinical diagnostic-sounding summary.",
      simulated: true,
    },
  },

  // 38. Rejected: unsupported_claim
  {
    id: "fb-038",
    caseId: "CHK-1038",
    patientId: "DEMO-038",
    action: "rejected",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(12),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    rejectionReason: "unsupported_claim",
    rejectionNotes: "Draft stated physician had already reviewed charts, which has not occurred yet.",
    inputRedacted: "Check-in logged.",
    extraction: [
      { id: "fx-38", category: "Routine", value: "Logged", confidence: 0.99 },
    ],
    draft: "Your primary physician has personally approved your check-in notes.",
    reviewerOutcome: {
      action: "rejected",
      status: "rejected",
      rejectionReason: "unsupported_claim",
      rejectionNotes: "Draft stated physician had already reviewed charts, which has not occurred yet.",
      simulated: true,
    },
  },

  // 39. Route Override (from HUMAN_REVIEW_REQUIRED to DRAFT_FOR_REVIEW)
  {
    id: "fb-039",
    caseId: "CHK-1039",
    patientId: "DEMO-039",
    action: "route_override",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(8),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    routeOverride: {
      originalRoute: "HUMAN_REVIEW_REQUIRED",
      suggestedRoute: "DRAFT_FOR_REVIEW",
      reason: "Free text was only 'Have a great week!', which does not need human escalation.",
    },
    inputRedacted: "Have a great week!",
    extraction: [
      { id: "fx-39", category: "Social Sentiment", value: "Polite sign-off", confidence: 0.99 },
    ],
    draft: null,
    reviewerOutcome: {
      action: "route_override",
      status: "draft_ready",
      routeOverride: {
        originalRoute: "HUMAN_REVIEW_REQUIRED",
        suggestedRoute: "DRAFT_FOR_REVIEW",
        reason: "Free text was only 'Have a great week!', which does not need human escalation.",
      },
      simulated: true,
    },
  },

  // 40. Route Override (from DRAFT_FOR_REVIEW to HUMAN_REVIEW_REQUIRED)
  {
    id: "fb-040",
    caseId: "CHK-1040",
    patientId: "DEMO-040",
    action: "route_override",
    reviewerId: "demo-staff-reviewer",
    createdAt: ago(4),
    promptVersion: "draft_v2",
    ruleVersion: "rules_v1.1",
    routeOverride: {
      originalRoute: "DRAFT_FOR_REVIEW",
      suggestedRoute: "HUMAN_REVIEW_REQUIRED",
      reason: "Patient requested a nurse callback in free text that was tagged routine by keyword parser.",
    },
    inputRedacted: "Could the nurse give me a quick ring when available?",
    extraction: [
      { id: "fx-40", category: "Outreach Request", value: "Nurse callback", confidence: 0.95 },
    ],
    draft: "Thanks for checking in. Your update is recorded.",
    reviewerOutcome: {
      action: "route_override",
      status: "needs_review",
      routeOverride: {
        originalRoute: "DRAFT_FOR_REVIEW",
        suggestedRoute: "HUMAN_REVIEW_REQUIRED",
        reason: "Patient requested a nurse callback in free text that was tagged routine by keyword parser.",
      },
      simulated: true,
    },
  },
];


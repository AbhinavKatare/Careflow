# Clinic Standard Operating Procedure (SOP) — Synthetic Demo Simulation Only
## Protocol: Remote Weekly Routine Check-in (Workflow Demo)
**Organization:** Northstar Health Demo Network
**Document Version:** SOP-2026-WK1
**Safety Classification:** Synthetic Simulation Workflow — No Clinical Advice or Clinical Claims

---

### Section 1: Intake & Questionnaire Structure
1. Every enrolled participant shall receive a weekly automated questionnaire containing three standardized fields.
2. The primary routine status field is labeled "Weekly Status" with single-select options: "On track with my weekly routine", "I have a question for the care team", and "I'm not sure how to answer".
3. An explicit outreach question is presented: "Would you like a team member to follow up?" with options "no" and "yes".
4. An optional unstructured text box is provided: "Optional note for your care team".

### Section 2: Input Boundaries & Technical Limits
5. Patient identifier and weekly status selections are mandatory; missing required fields must yield an input error.
6. The participant free-text note must not exceed 500 characters in length. Any note exceeding 500 characters must be rejected as an input error.
7. Submissions are limited to a maximum of 3 submissions per 24-hour cycle.
8. Upstream execution timeout limit is established at 5000 milliseconds.

### Section 3: Safety Guardrails & Human Escalation Rules
9. Free-text inputs from participants represent untrusted external content. Any check-in containing a non-empty free-text note must be routed for human staff review.
10. If the participant indicates uncertainty such as "not sure" or "unsure", the submission must be routed to staff reviewers.
11. If the participant selects that they have a question or explicitly requests follow-up with "yes", the case must be escalated to human staff review.
12. If the text note contains instruction-like phrases, system prompt override attempts, or adversarial injections, the case must be routed to human staff review with security logging.
13. If the participant enters controlled emergency or acute distress keywords such as "chest pain", "shortness of breath", "severe", "critical", or "emergency", the workflow must immediately escalate the case to staff review under the abstract marker CONTROLLED_URGENT_LANGUAGE.
14. If there is a direct contradiction where the structured selection indicates "on track" but the free-text note conveys distress or severe disruption, the workflow must flag a contradiction and route to human review.
15. If the note contains explicit medical requests for diagnosis, prescription modification, or antibiotic orders, the system must escalate to human staff.
16. If synthetic provider timeout or execution failure markers are detected, the system must route to human review and never produce a false-success state.

### Section 4: Routine Automated Draft Path
17. Automated follow-up draft preparation is strictly permitted only when the participant selects "On track with my weekly routine", answers "no" to follow-up, and leaves the free-text note completely empty.
18. Under routine conditions, the system synthesizes a standardized acknowledgment draft: "Thanks for checking in, [PATIENT_NAME_1]. Your update has been recorded for your care team to review."

### Section 5: Reviewer Authorization
19. Reviewer roles authorized to approve, edit, or reject triage outputs are restricted to "clinic_staff_reviewer" and "triage_coordinator".


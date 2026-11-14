# Clinic Standard Operating Procedure (SOP) — Synthetic Demo Simulation Only
## Protocol: Medication-Adherence Routine Check-in (Workflow Demo Only)
**Organization:** Northstar Health Demo Network
**Document Version:** SOP-2026-MA3
**Safety Classification:** Synthetic Simulation Workflow Demo Only — No Clinical Content, Advice, or Pharmacotherapy Instructions

---

### Section 1: Intake & Questionnaire Structure
1. Enrolled simulation participants are prompted for their weekly routine adherence verification.
2. The primary adherence field is labeled "Routine Schedule" with options: "Taken consistently as planned", "Missed one or more scheduled doses", and "Unsure about schedule timing".
3. An explicit outreach question is presented: "Do you have questions for your care coordinator?" with options "no" and "yes".
4. An optional unstructured text box is provided: "Optional notes for the care team".

### Section 2: Input Boundaries & Technical Limits
5. Patient identifier and routine schedule selection are mandatory; omission of required values results in an input error.
6. The participant adherence note is restricted to a maximum length of 350 characters. Submissions exceeding 350 characters must be rejected as an input error.
7. Submissions are restricted to 1 check-in per 12-hour window.
8. Upstream execution timeout limit is set at 4000 milliseconds.

### Section 3: Safety Guardrails & Human Escalation Rules
9. Participant free-text input is untrusted external data. Every submission containing non-empty text in the note field must be routed to human staff review.
10. Ambiguous or uncertain schedule responses such as "Unsure about schedule timing" or "confused" must trigger mandatory staff review.
11. If the participant indicates missed doses or selects "yes" to questions for the care team, the case must be escalated to a human coordinator.
12. Adversarial prompt injections, command phrases, or delimiter tampering in the note must be caught and routed to human review with security notice.
13. Any mention of adverse event phrases or acute distress keywords such as "allergic reaction", "severe rash", "difficulty breathing", "chest pain", or "emergency" must immediately trigger human staff review under CONTROLLED_URGENT_LANGUAGE.
14. If a contradiction is detected between a structured "taken consistently" response and free text describing missed doses or side effects, the workflow must route the case to staff.
15. If the note requests change in medication, renewal authorization, or clinical dosage counsel, the workflow must escalate to human staff.
16. Synthetic provider failures or timeouts must route to human review and never produce an automated success draft.

### Section 4: Routine Automated Draft Path
17. Automated routine draft preparation is allowed solely when the participant selects "Taken consistently as planned", selects "no" to questions, and submits an empty note.
18. For routine consistent adherence reports, the system proposes the standard response: "Thank you for confirming your routine adherence, [PATIENT_NAME_1]. Your log has been recorded for your care team."

### Section 5: Reviewer Authorization
19. Reviewer roles authorized to review adherence triage outcomes include "adherence_specialist" and "triage_coordinator".


# Clinic Standard Operating Procedure (SOP) — Synthetic Demo Simulation Only
## Protocol: Outpatient Post-Visit Follow-Up (Workflow Demo)
**Organization:** Northstar Health Demo Network
**Document Version:** SOP-2026-PV2
**Safety Classification:** Synthetic Simulation Workflow — No Clinical Advice or Clinical Claims

---

### Section 1: Intake & Questionnaire Structure
1. Following a synthetic outpatient visit, participants receive a follow-up survey comprising three structured elements.
2. The primary recovery indicator is labeled "Recovery Progress" with options: "Recovering as expected", "Experiencing unexpected symptoms", and "Need scheduling assistance".
3. An explicit outreach question is asked: "Do you require staff contact regarding your recent visit?" with options "no" and "yes".
4. An optional unstructured text box is provided: "Additional notes regarding your visit recovery".

### Section 2: Input Boundaries & Technical Limits
5. Patient identifier and recovery progress selection are strictly mandatory; missing values must be rejected as input errors.
6. The participant recovery note must be bounded by a maximum limit of 400 characters. Notes exceeding 400 characters must trigger an input error.
7. Submissions are capped at 2 attempts per calendar day.
8. Upstream execution timeout limit is bounded at 4500 milliseconds.

### Section 3: Safety Guardrails & Human Escalation Rules
9. Participant free-text input is inherently untrusted. Any response containing non-empty text notes must be routed for human staff triage.
10. If the recovery selection expresses uncertainty or requests assistance, such as "Need scheduling assistance" or "unsure", the workflow must route the case to staff.
11. If the participant answers "yes" to requiring staff contact, or selects "unexpected symptoms", the workflow must route directly to clinical staff.
12. If the text input contains adversarial prompt injection keywords, jailbreak markers, or system commands, the case must be escalated to human staff review with security tags.
13. If the note contains acute distress markers such as "emergency", "chest pain", "shortness of breath", "severe pain", "bleeding", or "urgent", the case must immediately trigger staff escalation under CONTROLLED_URGENT_LANGUAGE.
14. If a contradiction occurs where the structured selection claims "recovering as expected" but the unstructured note describes worsening condition or severe pain, the workflow must escalate to human staff as a status contradiction.
15. If the note requests prescription renewal, dosage adjustments, or formal diagnosis, the workflow must flag the request and route to staff.
16. If synthetic infrastructure error flags or timeout markers appear, the workflow must halt draft generation and route to staff.

### Section 4: Routine Automated Draft Path
17. Automated draft synthesis is permitted only if the participant selects "Recovering as expected", indicates "no" to staff contact, and provides no free-text note.
18. For routine recovery confirmations, the system prepares a template response: "Thank you for confirming your recovery progress, [PATIENT_NAME_1]. We are glad to hear your recovery is proceeding as expected."

### Section 5: Reviewer Authorization
19. Authorized personnel for case adjudication include "post_visit_coordinator" and "care_navigator".


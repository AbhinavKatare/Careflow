# TODO — Care Follow-up Agent Demo

## 1. Persistent safety framing
- Keep this an independent simulation-only prototype, with no Asha branding or affiliation claims.
- Persist the exact notice: “Simulation only. Do not enter real health information. Not for medical care or emergencies.”
- Clearly state names, cases, data, and outcomes are invented; do not claim diagnosis, treatment, real-world clinical triage, clinical validation, safety certification, HIPAA compliance, or production readiness.
- Exclude real patient information, external tools, EHR connections, account integrations, outbound communication, and real email/SMS sending.

## 2. Patient check-in simulation
- Build a patient check-in flow using synthetic information only, with accessible fields, validation, review-before-submit, and a confirmation that explains the simulated next step.
- Include a guided route to submit predefined synthetic fixture scenarios.
- Clearly label every name, case, and outcome as invented.

## 3. Bounded and inspectable demo workflow
- Use versioned, deterministic illustrative rules that are inspectable and distinct from any mock summary or draft text.
- Optional mock summarization and drafting must be distinguished from rule results and must never provide diagnosis or treatment advice.
- Route concerning, uncertain, incomplete, unsupported, or free-text scenarios for staff review using explicitly illustrative rules.
- Do not use external tools, send messages, contact patients, modify care plans, or connect to EHRs.

## 4. Staff review queue
- Provide Needs Review, Draft Ready, Approved, Rejected, and All filters.
- Support search by synthetic patient name/ID and created-time sorting.
- Show status, review reason, scenario tag, and processing duration.
- Provide case detail with original submitted input, generated summary, deterministic rule results, editable draft, workflow/rule versions, and chronological audit timeline.

## 5. Simulated reviewer actions
- Allow editing drafts and simulated approve/reject/return-to-queue actions.
- Require confirmation for approve and reject.
- Every completed action must explicitly state “Simulated—nothing sent.”
- Record reviewer actions in a visible audit history; no external action is allowed.

## 6. Synthetic reliability panel
- Run a versioned synthetic test set.
- Show expected vs actual route and per-test pass/fail.
- Show critical misses, false escalations, route metrics, policy checks, and latency.
- Label every score “synthetic software evaluation—not clinical validation.”
- Never present clinical-performance, safety-certification, or compliance claims.

## 7. Guided demo and responsive UX
- Guide users through a fixture check-in, routed case review, rule-evidence inspection, simulated reviewer action, and synthetic evaluation results.
- Build a polished, accessible, responsive healthcare-operations dashboard with clear status hierarchy, keyboard-friendly interactions, readable data tables, and mobile adaptations.
- Ensure loading/empty/error/success states and working navigation/controls.

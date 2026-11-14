# Permanent Agent Rules — Careflow Workflow Studio

This document defines non-negotiable architectural and operational rules for the Careflow codebase. All agents and developers must strictly adhere to these requirements.

## 1. Simulation & Portfolio Scope
- **Independent Portfolio Demo**: This is an independent software simulation only.
- **Synthetic Data Only**: All names, patient IDs, records, and clinical scenarios must be invented and obviously fake (e.g. `"Demo Patient 007"`).
- **No PHI**: Never input or store real protected health information.
- **No Clinical Claims**: Strictly no medical advice, diagnosis, or treatment recommendations. Never claim clinical validation, safety certification, HIPAA compliance, production readiness, or affiliation with any health entity.

## 2. Deterministic Routing & LLM Boundary
- **Deterministic Decisions**: All triage routing, escalation gates, and safety evaluations are deterministic TypeScript.
- **LLM Boundary**: Large language models may only be used to extract structured facts, draft routine customer communications, or propose non-binding configurations. LLMs must **never** make routing decisions, select clinical actions, choose tool calls, or bypass rules.

## 3. Reviewer Actions & Zero Outbound Effects
- **No Outbound Actions**: No email sending, SMS dispatching, care plan alterations, or EHR write operations exist or may be added.
- **Simulated State Only**: Reviewer actions ("Approved", "Rejected") modify local demo state and append to an audit log only. Every completed action must explicitly report that nothing was sent externally.

## 4. Evaluation & Metric Integrity
- **No Outcome-Encoding Flags**: No test or evaluation fixture may pass a flag that encodes its expected outcome (e.g. no `controlledUrgentFixture`, `unsupportedDraftClaim`, `generationFailure`, or `contradiction: true`). Fixtures must contain raw inputs only.
- **Computed Metrics Only**: Every metric displayed in the UI or emitted by evaluation runners must be dynamically computed from a stored run record array—never hardcoded literals or arbitrary constants.
- **Measured Latency**: Fixture and execution latencies must be measured live using high-resolution timers (`performance.now()`), never simulated with hardcoded numbers.
- **Safety Gate**: Any critical miss (failure to route an urgent or safety scenario to staff) must immediately trip the safety gate to `FAIL`.

## 5. Untrusted Data Guardrails
- **Free-Text is Untrusted**: Free-text notes and inputs from participants are untrusted data. Free-text inputs must never be directly evaluated as policy instructions, nor allowed to alter deterministic routing workflows without human review. Any submission containing free text must be routed for human review.

## 6. Verification Cadence
- After every step or code modification, the verification pipeline must pass:
  ```bash
  pnpm check
  pnpm lint
  pnpm test
  ```
  Or via the integrity suite:
  ```bash
  node scripts/verify-integrity.mjs
  ```


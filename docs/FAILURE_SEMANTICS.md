# Careflow Workflow Studio — Failure Semantics & Resilience Matrix

This document defines the deterministic failure semantics of the Careflow workflow pipeline, chaos fault injection responses, security boundaries, and stuck-run recovery guarantees.

---

## 1. System Failure Semantics Matrix

| Failure / Event Mode | Trigger / Injection Mechanism | System Behavior | Resulting Case Status | Resulting Route | Audit Trail Evidence | Outbound Actions |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Provider Timeout** | LLM adapter timeout (`LLMTimeoutError`, simulated mode: `timeout`) | Circuit-breaker trips after bounded deadline; step ends in failure; no retries of dead requests | `PROCESSING_FAILED` | `INPUT_ERROR` | `STEP_FAILED` with error code `LLM_TIMEOUT` | **Zero** |
| **Malformed JSON** | Provider returns truncated/corrupted JSON (`LLMMalformedJSONError`, mode: `malformed_json`) | Parser catches JSON syntax error; logs failure span; halts pipeline before policy evaluation | `PROCESSING_FAILED` | `INPUT_ERROR` | `STEP_FAILED` with parse error snippet | **Zero** |
| **Strict Schema Rejection (Unsupported Label)** | Extraction returns enum value outside Zod schema (`LLMSchemaValidationError`, mode: `unsupported_label`) | Strict Zod validation fails; no dynamic coercion; typed error captured with offending key | `PROCESSING_FAILED` | `INPUT_ERROR` | `STEP_FAILED` with Zod schema validation errors | **Zero** |
| **Strict Schema Rejection (Fabricated Field)** | Extraction includes unapproved hallucinated key (`LLMSchemaValidationError`, mode: `fabricated_field`) | `z.object().strict()` rejects unexpected keys; prevents hallucinated clinical diagnoses | `PROCESSING_FAILED` | `INPUT_ERROR` | `STEP_FAILED` with `unrecognized_keys` detail | **Zero** |
| **DB Error Mid-Pipeline** | Disk error, write-lock, or transaction rollback mid-step | Step failure handler executes; database rollback preserves previous consistent state; returns structured error | `PROCESSING_FAILED` | `INPUT_ERROR` | Error recorded in fallback trace; audit hash chain unbroken | **Zero** |
| **Duplicate Concurrent Submits** | Multiple concurrent requests submit identical `idempotencyKey` | SQLite unique constraint and atomic lookup guarantee single case insertion; subsequent calls return existing case | `DRAFT_READY` or `NEEDS_REVIEW` | (Authoritative policy route) | Single `CHECK_IN_SUBMITTED` event recorded; no duplicate sequences | **Zero** |
| **Crash Mid-Run (Stuck Run)** | Worker thread crashes while case is in `PROCESSING` state | Stuck-run reaper scans for cases exceeding max execution age ($\ge 30\text{s}$); transitions them to failed | `PROCESSING_FAILED` | `INPUT_ERROR` | Append-only `STUCK_RUN_REAPED` event with recovery duration | **Zero** |
| **Payload Size Limit Breach** | Incoming payload exceeds size threshold ($> 128\text{ KB}$ or note $> 2000$ chars) | Express body-parser and Zod schema reject request before execution pipeline starts | `REJECTED` (HTTP 413 / 400) | `INPUT_ERROR` | Security reject event recorded | **Zero** |
| **Rate Limit Exceeded** | Client IP exceeds sliding window rate limit ($> 60\text{ req/min}$) | Rate limiter intercepts request; returns HTTP 429 Too Many Requests with `Retry-After` header | N/A (HTTP 429) | N/A | Security rate limit counter logged | **Zero** |
| **Low ASR Audio Confidence** | Voice speech confidence drops below $0.70$ (e.g. mumbled or degraded audio) | Voice gateway refuses automated draft; immediately triggers safe coordinator handoff | `NEEDS_REVIEW` | `HUMAN_REVIEW_REQUIRED` | `VOICE_STAFF_HANDOFF` with reason `LOW_ASR_CONFIDENCE` | **Zero** |
| **Prompt Injection / Adversarial Voice** | Patient note contains instruction-like text (`SYSTEM OVERRIDE: ignore rules...`) | Deterministic redaction detects injection pattern; untrusted free-text policy forces human review | `NEEDS_REVIEW` | `HUMAN_REVIEW_REQUIRED` | `POLICY_EVALUATED` firing `RULE_UNTRUSTED_FREE_TEXT` | **Zero** |
| **Draft Safety Checker Violation** | Candidate draft contains diagnosis, prescription, or action claims | Deterministic draft checker blocks text; highlights offending span; diverts to human review | `NEEDS_REVIEW` | `HUMAN_REVIEW_REQUIRED` | `DRAFT_CHECK_FAILED` listing violated safety criteria | **Zero** |

---

## 2. Invariance Guarantees

1. **Zero Silent Success**: Any pipeline step, database, or model failure resolves strictly to `PROCESSING_FAILED`. The system never outputs a success-looking state or synthetic delivery when a failure occurs.
2. **Deterministic Routing Invariance**: Large language models may only extract advisory structured facts or propose draft text. Triage decisions are 100% deterministic TypeScript rules. The LLM, voice layer, and network cannot alter routing rules.
3. **No Duplicate Cases**: Concurrency conflicts on `idempotencyKey` are resolved atomically at the persistence layer, returning the single original record.
4. **Append-Only Hash-Chained Audit Trail**: Every case transition, failure event, and reaper action computes `eventHash = SHA256(prevHash + id + type + timestamp + payload)`. The chain is mathematically tamper-evident.
5. **Zero Outbound Effects**: Reviewer actions ("Approved", "Rejected") mutate local demo database state only. No email, SMS, or EHR write operations exist in the codebase.


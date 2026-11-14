# Careflow Workflow Studio — Product & Engineering One-Pager

> **Simulation & Portfolio Demo Notice**  
> *Independent software simulation only. All data, names, and scenarios are synthetic and invented (`"Demo Patient 001"`). Strictly no medical advice, diagnosis, or clinical claims. Zero outbound actions.*

---

## 1. The Problem (from the Healthcare AI Challenge)

Between clinical visits, outpatient clinics and specialty practices face an unsustainable influx of participant check-ins, routine symptom updates, and administrative inquiries. Clinical teams spend hundreds of hours manually triaging messages that are 90% routine, leaving less time for high-risk patients.

However, naive application of Large Language Models (LLMs) to clinical triage introduces unacceptable medical and legal liability:
1. **Hallucination & Medical Advice**: LLMs invent medical explanations, prescribe treatments, or offer subtle false reassurances (*"You should be fine until next week"*).
2. **Emergency Misses**: Subtle phrasing or evasions (e.g. typos, slang, Unicode homoglyphs) can trick a prompt into drafting a casual reply for an impending myocardial infarction or pulmonary embolism.
3. **Black-Box Routing**: Prompts are non-deterministic; the exact same symptoms can receive different routing decisions across runs.
4. **Lack of Verifiable Governance**: Health systems cannot deploy software where rule changes cannot be mathematically proven, shadowed, and audited.

---

## 2. What Exists in Careflow Workflow Studio

Careflow resolves this with an **enforced separation of concerns**: LLMs may only extract structured facts or propose draft text; all triage routing, escalation gates, and safety evaluations are written in **100% deterministic TypeScript**.

```
[Untrusted Patient Intake] 
       │ (Web / Voice Simulator)
       ▼
[Security & Redaction Gate] ──► (128 KB limit, PII tokenized, rate-limited)
       │
       ▼
[LLM Cascading Tier] ─────────► (Small fast model -> Strong model fallback; facts & draft only)
       │
       ▼
[Deterministic Policy Engine] ──► (TypeScript rules: Emergency keywords, contradictions, untrusted text)
       │
       ├─► [HUMAN_REVIEW_REQUIRED] ──► Staff Queue (4 Separated Panels, no draft sent)
       │
       └─► [DRAFT_FOR_REVIEW] ───────► Adversarial Draft Checker (Blocks diagnoses/claims)
                                            │
                                            ▼
                                       Staff Reviewer Drawer (Edit, Approve, Levenshtein tracking)
                                            │
                                            ▼
                                  [Hash-Chained SQLite Audit Trail] (Zero outbound actions)
```

### Core System Capabilities
1. **Deterministic Policy Engine**: TypeScript rule evaluator executing zero-trust triage. Any free-text note, uncertainty, contradiction, or emergency symptom immediately routes to `HUMAN_REVIEW_REQUIRED`.
2. **SOP Compiler & Line-Level Traceability**: Compiles raw markdown clinic SOPs into formal `WorkflowSpec` proposals with clickable sentence-level provenance linking each rule to its source text.
3. **Adversarial Draft Checker**: Enforces that candidate drafts contain zero diagnosis language, no treatment recommendations, zero claims that actions occurred, zero cross-patient leakage, and full factual traceability. Failing drafts are blocked.
4. **Tests-of-Tests Governance**:
   - **Property Fixture Generator**: Generates 84 reproducible boundary fixtures (seed `42`), injection vectors, and homoglyphs with $\ge 95\%$ rule coverage.
   - **Mutation Testing Harness**: Mutates spec rules (41 mutants: flips, drops, boundary shifts). A spec is blocked unless 100% of mutants are killed.
   - **Shadow Replay Engine**: Replays 300 synthetic historical cases without side effects, asserting 0 unsafe disagreements (zero missed escalations).
5. **Staged Activation Ladder & Evidence Packs**: Promotes specs across stages (`Draft` $\rightarrow$ `Evaluated` $\rightarrow$ `Shadowed` $\rightarrow$ `Reviewed-by-all` $\rightarrow$ `Active`). Exports tamper-evident Evidence Packs with canonical SHA-256 hashes.
6. **Reviewer Queue & Quality Signals**: 4 separated panels (*Original submission, Redacted model view, Extracted facts, Policy results*), keyboard triage (`j`/`k`/`a`/`r`), and live Levenshtein edit distance analytics.
7. **Model Cascading Tier**: Fast small tier first, escalating to strong tier upon schema failure. Proves 100% route invariance (cascade never changes policy routes).
8. **Simulated Voice Pipeline**: Streaming ASR and TTS stubs, measured latency waterfall against real timers (`performance.now()`), barge-in cancellation, and policy-enforced handoff.
9. **Tamper-Evident Audit Trail**: Append-only, SHA-256 hash-chained SQLite persistence via Drizzle ORM. Verifier detects row tampering or deletion.
10. **Resilience & Stuck-Run Reaper**: Chaos test suite covering timeouts, malformed JSON, schema rejections, concurrent submissions, and an automatic stuck-run reaper.

---

## 3. Measured Results (from CLAIMS_LEDGER.md)

All metrics are dynamically computed from stored run arrays—never hardcoded literals:

- **100.0% Baseline Route Accuracy** ($n=18$ baseline, $n=84$ generated fixtures; 0 critical misses).
- **100.0% Mutation Score** (41 of 41 mutants killed; 0 severity-lowering surviving mutants).
- **0 Unsafe Disagreements on Shadow Replay** (300 synthetic historical cases replayed; 95.3% overall agreement, 0 under-escalations).
- **100.0% Adversarial Draft Block Rate** (39 of 39 adversarial test drafts blocked across 6 clinical safety categories).
- **100.0% Cascade Route Invariance** (Model cascading never alters a policy route across all test cases).
- **100.0% Concurrency Idempotency** (10 concurrent duplicate submissions produce exactly 1 case).
- **0 Outbound Effects** (Codebase scan verifies zero email, SMS, or EHR write functions).
- **0 Secrets or Credentials Detected** (Automated scan of 1,883 modules clean).
- **300 / 300 Tests Passing** across 26 test files in Vitest and Playwright.

---

## 4. Scope, Limitations & Future Roadmap

### Demo Scope
- **Independent Simulation**: Portfolio demo using fictional synthetic patients (`Demo Patient 001`).
- **No PHI**: Never input or store real protected health information.
- **Zero Outbound Actions**: Approving a draft updates local SQLite state only and writes to the audit log.

### What a Real Deployment Would Additionally Need
1. **Clinical Governance**: Formal Medical Director oversight, institutional clinical validation studies, and FDA SaMD evaluation.
2. **Security & Privacy**: HIPAA Business Associate Agreements (BAA), KMS-managed encryption at rest, mTLS, and SOC 2 Type II auditing.
3. **Real EHR Integration**: Bidirectional HL7 FHIR R4 integration (`Observation`, `QuestionnaireResponse`) with SMART-on-FHIR clinician SSO.
4. **Telephony**: Real carrier WebRTC audio streaming (Twilio / Amazon Chime SDK).


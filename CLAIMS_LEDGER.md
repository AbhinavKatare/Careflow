# Careflow Workflow Studio — Claims Ledger

> **Integrity & Verification Ledger**  
> *Every metric, percentage, latency, or test count cited in the pitch, one-pager, README, or video walkthrough is mapped below to the exact deterministic command that computes it, along with sample size ($n$) and verification date.*  
> **Permanent Rule**: Zero hardcoded literals. Every number must be dynamically computed by executable TypeScript code.

---

## Pitch Claims & Measurement Ledger

| Claim ID | Pitch Claim / Assertion | Measured Value | Sample Size ($n$) | Verification Command | Source / Artifact File | Date Verified |
| :---: | :--- | :---: | :---: | :--- | :--- | :---: |
| **CLM-01** | **Deterministic Baseline Route Accuracy** | **100.0%** (18/18) | $n = 18$ fixtures | `pnpm eval` | `shared/evaluation/fixtures-data.ts`<br>`scripts/eval.ts` | 2026-11-12 |
| **CLM-02** | **Critical Misses on Safety Scenarios** | **0** (Zero) | $n = 18$ baseline<br>$n = 84$ generated | `pnpm eval`<br>`pnpm test server/ci-gate.test.ts` | `shared/evaluation/runner.ts` | 2026-11-12 |
| **CLM-03** | **Mutation Testing Kill Rate** | **100.0%** (41/41) | $n = 41$ mutants | `pnpm mutate`<br>`pnpm test server/mutation.test.ts` | `server/mutation/runner.ts`<br>`server/mutation/mutators.ts` | 2026-11-12 |
| **CLM-04** | **Severity-Lowering Surviving Mutants** | **0** (Zero) | $n = 41$ mutants | `pnpm mutate`<br>`node ./node_modules/tsx/dist/cli.mjs scripts/ci-gate-check.ts` | `scripts/ci-gate-check.ts` | 2026-11-12 |
| **CLM-05** | **Reproducible Generated Fixtures** | **84 fixtures**<br>(100% byte-identical) | $n = 84$ fixtures | `pnpm test server/fixture-generator.test.ts` | `server/compiler/fixture-generator.ts` | 2026-11-12 |
| **CLM-06** | **Rule Coverage on Generated Suite** | **95.2%** ($\ge 95\%$) | $n = 21$ rule checks | `pnpm test server/fixture-generator.test.ts` | `server/compiler/coverage.ts` | 2026-11-12 |
| **CLM-07** | **Adversarial Draft Checker Block Rate** | **100.0%** (39/39) | $n = 39$ adversarial tests | `pnpm test server/draft-checker.test.ts` | `server/draft-checker.test.ts`<br>`server/draft-checker.ts` | 2026-11-12 |
| **CLM-08** | **Draft Checker Safety Categories** | **6 Categories** | $n = 6$ check types | `pnpm test server/draft-checker.test.ts` | `server/draft-checker.ts` | 2026-11-12 |
| **CLM-09** | **Shadow Run Historical Agreement** | **95.3%** agreement | $n = 300$ synthetic cases | `pnpm test server/shadow.test.ts` | `server/shadow/runner.ts` | 2026-11-12 |
| **CLM-10** | **Shadow Run Unsafe Disagreements** | **0** (Zero) | $n = 300$ synthetic cases | `pnpm test server/shadow.test.ts` | `server/shadow/runner.ts` | 2026-11-12 |
| **CLM-11** | **Reviewer Quality Signals (Total Actions)** | **40 synthetic actions** | $n = 40$ reviews | `pnpm test server/quality-signals.test.ts` | `shared/feedback-fixtures.ts`<br>`server/persistence.ts` | 2026-11-12 |
| **CLM-12** | **Reviewer Acceptance Rate** | **70.0%** (28/40) | $n = 40$ reviews | `pnpm test server/quality-signals.test.ts` | `shared/feedback-service.ts` | 2026-11-12 |
| **CLM-13** | **Mean Reviewer Edit Distance** | **6.6 chars** (all accepted)<br>**15.4 chars** (edited only) | $n = 28$ approved cases | `pnpm test server/quality-signals.test.ts` | `shared/feedback-service.ts` | 2026-11-12 |
| **CLM-14** | **Reviewer Route Override Rate** | **10.0%** (4/40) | $n = 40$ reviews | `pnpm test server/quality-signals.test.ts` | `shared/feedback-service.ts` | 2026-11-12 |
| **CLM-15** | **Cascade Route Invariance** | **100.0%** invariance<br>(0 route changes) | $n = 18$ test cases | `pnpm test server/cascade.test.ts` | `server/llm/cascade.ts`<br>`server/cascade.test.ts` | 2026-11-12 |
| **CLM-16** | **Concurrent Submission Idempotency** | **100.0%** (1 case created) | $n = 10$ concurrent requests | `pnpm test server/chaos.test.ts` | `server/persistence.ts` | 2026-11-12 |
| **CLM-17** | **Zero Outbound Effects Scan** | **0** external calls | Whole codebase | `pnpm test server/pipeline.test.ts` | `server/pipeline.test.ts` | 2026-11-12 |
| **CLM-18** | **Secrets & Credentials Cleanliness** | **0** secrets detected | 1,883 modules scanned | `pnpm security:scan` | `scripts/secrets-scan.ts` | 2026-11-12 |
| **CLM-19** | **Full Unit & Integration Test Suite** | **300 / 300 passing** | 26 test files | `pnpm test` | All `server/*.test.ts` files | 2026-11-12 |
| **CLM-20** | **Voice Sim P95 Latency Waterfall** | **< 350ms** | $n = 14$ turns | `pnpm test server/voice-sim.test.ts` | `server/voice/session.ts` | 2026-11-12 |

---

## Reproducing Claims Locally

Every claim can be re-executed in terminal:

```bash
# Verify CLM-01 & CLM-02 (Accuracy & Zero Critical Misses)
pnpm eval

# Verify CLM-03 & CLM-04 (Mutation Testing 100% Score)
pnpm mutate

# Verify CLM-07 & CLM-08 (Adversarial Draft Checker 39/39 Blocked)
pnpm test server/draft-checker.test.ts

# Verify CLM-09 & CLM-10 (Shadow Run Agreement & 0 Unsafe Disagreements)
pnpm test server/shadow.test.ts

# Verify CLM-11 through CLM-14 (Quality Signals & Levenshtein Edit Distance)
pnpm test server/quality-signals.test.ts

# Verify CLM-15 (Model Tier Cascade Route Invariance)
pnpm test server/cascade.test.ts

# Verify CLM-16 (Concurrent Submission Idempotency Under Load)
pnpm test server/chaos.test.ts

# Verify CLM-17 & CLM-18 (Static Outbound Scan & Secrets Cleanliness)
pnpm test server/pipeline.test.ts
pnpm security:scan

# Verify Complete Integrity Suite (All 20 Claims)
node scripts/verify-integrity.mjs
```

---

## Disclaimer & Data Scope Notice
All numbers cited in this ledger are computed from synthetic in-memory fixtures, deterministic test suites, and mock LLM configurations. No metrics represent clinical efficacy, patient health outcomes, or human medical validation.


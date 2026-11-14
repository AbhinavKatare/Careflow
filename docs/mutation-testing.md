# Careflow Policy Engine — Mutation Testing & Safety Gate

## 1. Overview & Architectural Principles

The Careflow Mutation Testing Harness rigorously assesses the quality and thoroughness of evaluation fixture suites against the declarative policy engine. Rather than relying solely on code coverage (which measures lines executed rather than assertions tested), mutation testing introduces deliberate, systematic faults ("mutants") into a `WorkflowSpec` and measures whether the test suite detects and fails on those faults ("kills" the mutants).

> [!IMPORTANT]
> **Deterministic Simulation Only**
> All evaluations, test suites, and mutation runs are pure TypeScript simulations. Zero outbound EHR writes, SMS messages, or external API actions exist. All data is synthetic.

---

## 2. The Seven Mutation Operators

The harness generates mutants across seven distinct operational and safety dimensions:

| Operator | Type | Description | Severity Lowering? |
| :--- | :--- | :--- | :--- |
| **`DELETE_RULE`** | Rule Removal | Drops a rule from `rule_list`. | Yes (if rule was `HUMAN_REVIEW_REQUIRED` or `INPUT_ERROR`) |
| **`FLIP_ROUTE`** | Route Mutation | Changes rule route (e.g. `HUMAN_REVIEW_REQUIRED` $\rightarrow$ `DRAFT_FOR_REVIEW`). | **Yes (Critical)** |
| **`WIDEN_THRESHOLD`** | Limit Relaxation | Increases maximum length limit (`max_note_length` +100 chars). | Yes (Allows oversized input through) |
| **`NARROW_THRESHOLD`** | Limit Tightening | Decreases maximum length limit (`max_note_length` $\times 0.6$). | No (Conservative / Over-escalates) |
| **`DROP_NORMALIZATION`** | Evasion Bypass | Disables zero-width stripping, homoglyph mapping, or case folding. | Yes (Evasion attacks slip through) |
| **`REORDER_RULES`** | Precedence Check | Reverses rule list or moves `DRAFT_FOR_REVIEW` to index 0. | No (Tests precedence stability) |
| **`WEAKEN_INSTRUCTION_TEXT`** | Security Bypass | Disables prompt injection detection or drops injection guardrails. | Yes (Injection strings slip to draft) |

---

## 3. The Mutation Safety Gate

A candidate `WorkflowSpec` cannot be approved or activated if:
1. **Mutation Score < Configured Threshold**: Minimum mutation score must be $\ge 80\%$.
2. **Any Severity-Lowering Mutant Survives**: Any mutant that lowers route severity (e.g., routing human review cases to automated drafts, or allowing prompt injections through) trips the safety gate to `FAIL` immediately, regardless of the overall percentage score.

$$\text{Mutation Score} = \left( \frac{\text{Killed Mutants}}{\text{Total Mutants}} \right) \times 100\%$$

---

## 4. Mutation Scores Across Sample SOPs

| Sample Clinic SOP | Spec ID | Total Mutants | Killed | Survived | Mutation Score | Gate Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Weekly Check-in** | `SPEC_WEEKLY_CHECKIN_V1` | 41 | 41 | 0 | **100%** | **PASS** |
| **Post-Visit Follow-Up** | `SPEC_POST_VISIT_FOLLOWUP_V1` | 41 | 41 | 0 | **100%** | **PASS** |
| **Medication Adherence** | `SPEC_MEDICATION_ADHERENCE_V1` | 41 | 41 | 0 | **100%** | **PASS** |

*(Note: Zero severity-lowering mutants survived across all three SOP specifications, fully satisfying the mutation safety gate).*

---

## 5. Surviving Mutant Investigation & Resolution

During initial test suite generation for `SPEC_WEEKLY_CHECKIN_V1`, a real surviving mutant was identified and investigated:

### The Investigated Mutant
- **Mutant ID**: `MUT-WID-001`
- **Operator**: `WIDEN_THRESHOLD`
- **Description**: Widen `max_note_length` from 500 to 600 characters.
- **Diff**: `~ limits.max_note_length: 500 -> 600`
- **Why It Survived**: The initial suite contained tests at 500 characters (valid limit) and 525 characters (excess). When the limit was mutated to 600, the 525-character test still failed on other rules or was not granular enough to isolate the boundary between 500 and 501. Thus, no test caught the 100-character widening.

### The Targeted Killer Fixture
A dedicated boundary fixture was authored to target and kill `MUT-WID-001`:

```json
{
  "id": "TARGETED-KILLER-001",
  "rawInput": {
    "patientId": "DEMO-999",
    "patientName": "Demo Patient Boundary Killer",
    "weekStatus": "On track with my weekly routine",
    "followUp": "no",
    "note": "A... [501 characters exact]"
  },
  "provenance": {
    "ruleId": "RULE_INPUT_NOTE_LENGTH",
    "templateKey": "boundary_kill_widening",
    "description": "Targeted boundary fixture to kill WIDEN_THRESHOLD mutant."
  },
  "expected_route": "INPUT_ERROR",
  "rationale": "Note length 501 strictly exceeds limit 500, catching threshold widening mutants."
}
```

### Verification
- On the baseline spec (limit 500), `TARGETED-KILLER-001` yields `INPUT_ERROR`.
- On the mutant `MUT-WID-001` (limit 600), the 501-character note is accepted and routes to `DRAFT_FOR_REVIEW`.
- The route divergence immediately **kills the mutant**.
- The mutation score increased and zero severity-lowering mutants survived.

---

## 6. Weak Suite Gate Blocking Demonstration

When tested against an intentionally weak 2-case test suite (`WEAK-001`, `WEAK-002`):
- Mutation Score fell to **6.5%** (far below the 80% threshold).
- **18 severity-lowering mutants survived** (including deleted distress rules, prompt injections, and route flips).
- The Safety Gate immediately tripped to `FAIL` with diagnostic report:
  `CRITICAL GATE TRIP: 18 mutant(s) lowering route severity survived. Safety policy forbids activation with unverified escalation paths.`


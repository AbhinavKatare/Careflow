# Founder Email: Careflow Workflow Studio Demo

**Subject**: Careflow: Deterministic clinical workflow studio (Live Demo + Architecture)

---

Hi [Founder Name],

Here is the live demo and repository for **Careflow Workflow Studio**:
👉 **Live Demo Walkthrough**: [http://localhost:3000/demo](http://localhost:3000/demo) *(or your deployed URL)*  
👉 **Architecture & Codebase**: [github.com/carefollow/careflow](https://github.com/carefollow)

### The Core Problem in Between-Visit Patient Care
Clinics face hundreds of between-visit check-ins weekly. While 90% are routine, naive LLM implementations create catastrophic malpractice liability: LLMs hallucinate clinical diagnoses, offer unsupervised reassurances, and miss acute emergencies disguised in colloquial text.

### How Careflow Solves This
Careflow enforces an architectural boundary: **Large language models may only extract advisory facts or propose draft text. All triage routing, escalation gates, and safety evaluations are written in 100% deterministic TypeScript.**

Key engineering highlights you can test directly in the **3-minute guided demo** (`/demo`):
1. **SOP Compiler with Line Traceability**: Paste an unstructured markdown SOP and compile it into a typed specification with clickable sentence-level provenance.
2. **Tests-of-Tests Governance**: An automated fixture generator creates 84 reproducible boundary and injection cases ($\ge 95\%$ coverage). Our **41-mutant mutation testing harness** intentionally tests our tests, ensuring 100.0% of rule mutations are killed.
3. **Shadow Replay Engine**: Replays 300 synthetic historical cases before activation, proving **0 unsafe disagreements** (zero missed escalations).
4. **Adversarial Draft Checker**: Blocks 39 of 39 adversarial drafts containing diagnosis language, unverified claims, or fabricated dates.
5. **Human Reviewer Triage Queue**: Staff inspect 4 separated panels (*Raw input, Redacted model view, Extracted facts, Policy results*) with keyboard triage and live Levenshtein edit distance analytics.
6. **Append-Only Hash-Chained SQLite**: Every case and reviewer action is cryptographically hash-chained (`SHA-256`), detecting any state tampering. Zero external outbound side effects exist in the codebase.

### Measured Results (from `CLAIMS_LEDGER.md`)
- **100.0% Baseline Route Accuracy** ($n=18$ baseline, $n=84$ generated fixtures; 0 critical misses)
- **100.0% Mutation Score** (41 of 41 mutants killed; 0 surviving severity-lowering mutants)
- **0 Unsafe Disagreements on Shadow Replay** (300 synthetic historical cases)
- **300 / 300 Passing Unit & Integration Tests** across 26 test files (runs 100% offline with zero external API keys)

### Running Locally (1 Command)
```bash
git clone https://github.com/carefollow/careflow.git
cd careflow && pnpm install && pnpm dev
# Open http://localhost:3000/demo and click "Run Full 3-Min Demo"
```

I'd love to walk you through the architecture or answer any questions on the deterministic state engine.

Best regards,

[Your Name]  
Software Engineer / Healthcare AI Architect  
[Your Contact Information / LinkedIn / GitHub]


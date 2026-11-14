# Careflow Workflow Studio — 2-Minute Loom Walkthrough Script

**Video Duration**: Exactly 2:00  
**Presenter Tone**: Confident, engineering-driven, precise, zero clinical buzzwords.  
**Screen Setup**: Browser open to `http://localhost:3000/demo` (Careflow Guided Demo Mode).

---

### [0:00 – 0:18] Introduction: The Healthcare AI Problem
**Screen**: Careflow Guided Walkthrough banner and architecture summary.  
**Presenter**:  
> "Hi, I'm showing Careflow Workflow Studio—an independent architectural demonstration of how to deploy AI safely in high-liability clinical workflows.  
> The core thesis is simple: Large language models should **never** make routing decisions or give medical advice.  
> In Careflow, LLMs may only extract facts or propose drafts. Every escalation gate and safety rule is 100% deterministic TypeScript."

---

### [0:18 – 0:40] Step 1–3: SOP Compilation & Property-Based Test Generation
**Screen**: Step 1 (Paste SOP) $\rightarrow$ Click "Compile SOP" $\rightarrow$ Step 2 (Traceability) $\rightarrow$ Step 3 (Generate Fixtures).  
**Presenter**:  
> "Let's run the 3-minute guided demo.  
> Here, a clinic pastes an unstructured markdown SOP. Our compiler proposes a typed WorkflowSpec with line-level traceability—you can click any SOP sentence and see the exact TypeScript rule it produced.  
> Next, we auto-generate an 84-fixture reproducible test suite. We don't just test happy paths; we test boundary limits like 499, 500, and 501 characters, prompt-injection wrappers, and Cyrillic homoglyphs, achieving 95.2% rule coverage."

---

### [0:40 – 1:02] Step 4–5: Mutation Testing (Testing the Tests)
**Screen**: Step 4 (Mutation report shows 1 surviving mutant in RED) $\rightarrow$ Step 5 (Click "Harden Rule" $\rightarrow$ 100% kill rate in GREEN).  
**Presenter**:  
> "How do we know our test suite is actually good? We test the tests using a mutation testing harness.  
> We inject 41 mutants into our rules. Look here in Step 4: a mutant that widened the note limit survived without a test failing. The safety gate immediately tripped to **BLOCKED**.  
> In Step 5, we tighten the boundary. Re-running the suite kills 41 out of 41 mutants—a 100.0% mutation score. The spec is provably resilient."

---

### [1:02 – 1:24] Step 6–8: Shadow Replay, Evidence Pack & Activation Ladder
**Screen**: Step 6 (Shadow run: 300 cases, 0 unsafe disagreements) $\rightarrow$ Step 7 (Evidence Pack SHA-256 hash) $\rightarrow$ Step 8 (Staged Ladder promotion to Active).  
**Presenter**:  
> "Before a spec touches live cases, it must pass a shadow run. In Step 6, we replay 300 synthetic historical cases: 95.3% agreement, and crucially, **zero unsafe disagreements**.  
> In Step 7, all governance artifacts are bundled into a cryptographic Evidence Pack with a canonical SHA-256 hash.  
> In Step 8, the staged activation ladder advances from Draft to Active only after explicit Medical Director sign-off."

---

### [1:24 – 1:46] Step 9: Live Triage Queue & Separated Reviewer Drawer
**Screen**: Step 9 (Concerning symptom check-in arrives) $\rightarrow$ Click into Review Queue $\rightarrow$ Open Triage Drawer.  
**Presenter**:  
> "Now let's see runtime safety. Participant Demo Patient 006 submits a check-in with acute chest tightness.  
> Our deterministic policy detects urgent keywords and untrusted free text. The AI draft is suppressed, and the case lands in the review queue as `HUMAN_REVIEW_REQUIRED`.  
> In the triage drawer, we give reviewers 4 strictly separated panels: the raw input, what the model saw with PII redacted, extracted facts with click-to-source highlighting, and the policy results. Approving or editing is simulated—nothing is ever sent externally."

---

### [1:46 – 2:00] Step 10 & Wrap-Up: Deterministic Replay & Claims Ledger
**Screen**: Step 10 (Deterministic Replay diff) $\rightarrow$ Quick glance at `CLAIMS_LEDGER.md`.  
**Presenter**:  
> "Finally, every case can be deterministically replayed under new spec versions with full step-by-step diffs and latency waterfalls.  
> Every single metric I mentioned is cataloged in our `CLAIMS_LEDGER.md` with the exact shell command to reproduce it.  
> The repo runs 100% offline with zero API keys. Check out the README and run the guided demo yourself. Thanks for watching!"


# Careflow Drift Monitoring: Statistical Methodology & Operational Limits

This document specifies the statistical methods, detection thresholds, and known limitations of the Careflow Drift Monitoring Engine.

---

## 1. Monitored Metrics & Statistical Formulation

Careflow evaluates 6 critical operational and policy axes by comparing a candidate traffic window $Q$ against a baseline window $P$:

### 1. Route Mix Distribution
- **Objective**: Detect shifts in policy triage decisions (`DRAFT_FOR_REVIEW`, `HUMAN_REVIEW_REQUIRED`, `INPUT_ERROR`).
- **Statistical Method**: **Total Variation Distance (TVD)**
  $$\text{TVD}(P, Q) = \frac{1}{2} \sum_{r \in \text{Routes}} |P(r) - Q(r)| \in [0.0, 1.0]$$
- **Why TVD?**: TVD is bounded, scale-invariant, intuitive, and represents the maximum difference in probability that $P$ and $Q$ can assign to any event. Unlike KL-divergence, it does not require smoothing for zero-probability routes and does not explode to infinity on empty buckets.
- **Alert Thresholds**:
  - $\text{TVD} < 0.15$: **NORMAL** (distribution stable)
  - $0.15 \le \text{TVD} < 0.25$: **WARNING** (moderate shift, e.g. seasonal change)
  - $\text{TVD} \ge 0.25$: **DRIFT_ALERT** (critical change in triage routing)

### 2. Fired-Rule Frequencies
- **Objective**: Track which declarative policy rules are firing more or less frequently.
- **Statistical Method**: Absolute percentage-point frequency delta per rule:
  $$\Delta_{\text{rule}} = |Q(\text{rule}) - P(\text{rule})|$$
- **Alert Thresholds**:
  - $\Delta \ge 10.0$ pp: **WARNING**
  - $\Delta \ge 20.0$ pp: **DRIFT_ALERT**

### 3. Schema Failure Rate
- **Objective**: Detect novel participant formatting, unexpected syntax, or extraction failures.
- **Statistical Method**: Absolute percentage-point change:
  $$\Delta_{\text{schema}} = Q_{\text{schema}} - P_{\text{schema}}$$
- **Alert Thresholds**:
  - $\Delta \ge 2.5$ pp: **WARNING**
  - $\Delta \ge 5.0$ pp: **DRIFT_ALERT** (urgent investigation into extraction prompts or parser)

### 4. Mean Draft Edit Distance
- **Objective**: Track the character-level Levenshtein edit distance between the model-drafted response and the human-approved final response.
- **Statistical Method**: Relative multiplier $M_{\text{edit}} = \frac{\bar{d}_Q}{\bar{d}_P}$.
- **Alert Thresholds**:
  - $M_{\text{edit}} \ge 1.25\times$: **WARNING**
  - $M_{\text{edit}} \ge 1.50\times$ and $\Delta \ge 5$ chars: **DRIFT_ALERT** (draft quality degradation)

### 5. Reviewer Route Override Rate
- **Objective**: Measure when clinical staff manually change the triage destination (e.g. overriding `DRAFT_FOR_REVIEW` to `HUMAN_REVIEW_REQUIRED`).
- **Statistical Method**: Absolute percentage-point change $\Delta_{\text{override}} = Q_{\text{override}} - P_{\text{override}}$.
- **Alert Thresholds**:
  - $\Delta \ge 4.0$ pp: **WARNING**
  - $\Delta \ge 8.0$ pp: **DRIFT_ALERT** (clinical staff routinely disagreeing with policy rules)

### 6. p95 Execution Latency
- **Objective**: Measure latency degradation on policy evaluation and pipeline execution.
- **Statistical Method**: Live high-resolution timer (`performance.now()`) measurement; relative multiplier $M_{\text{lat}} = \frac{\text{p95}_Q}{\text{p95}_P}$.
- **Alert Thresholds**:
  - $M_{\text{lat}} \ge 1.5\times$: **WARNING**
  - $M_{\text{lat}} \ge 2.0\times$ (with absolute latency $> 1.0$ ms): **DRIFT_ALERT**

---

## 2. Operational Limitations & Edge Cases

1. **Small-Sample Variance (Window Size Sensitivity)**:
   - In windows with $N < 50$ cases, single outlier cases can inflate TVD by up to $0.08$. The detector requires a minimum sample count of $N \ge 30$ before issuing binding alerts.
2. **Synthetic Simulation Scope**:
   - The traffic generator is synthetic and simulated. It reproduces specific controllable axes (informal language, lengthy ramblings, uncertainty, prompt injections), but cannot capture unmodeled macroeconomic, epidemiologic, or hospital-specific operational events.
3. **Non-Clinical Portfolio Status**:
   - This drift detector operates entirely within a local portfolio simulation. It does not interface with hospital EHR systems, medical telemetry, or live patient databases.
4. **Zero Automated Outbound Actions**:
   - Drift alerts notify the operator in the dashboard and trigger automatic canary rollbacks, but never dispatch emails, SMS, or external alerts.


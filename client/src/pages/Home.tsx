import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight,
  BadgeCheck, BarChart3, Bell, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp,
  ClipboardCheck, FileText, FlaskConical, HeartPulse, Inbox, Info,
  LayoutDashboard, ListFilter, Menu, Mic, MoreHorizontal, Plus, RefreshCw, Search, Send, Shield,
  ShieldAlert, SlidersHorizontal, Sparkles, UserRound, Users, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCheckIn,
  evaluationFixtures,
  patientOptions,
  runEvaluation,
  seedCases,
  type DemoCase,
  type EvaluationRun,
  type NewCheckIn,
  type ReviewStatus,
  type RouteDecision,
} from "@shared";
import { trpc } from "@/lib/trpc";

import CaseDetailDrawer from "@/components/CaseDetailDrawer";
import ReviewQueue from "@/components/ReviewQueue";
import CheckInPage from "./CheckInPage";
import QualitySignalsPage from "./QualitySignalsPage";
import ClinicOnboardingPage from "./ClinicOnboardingPage";
import VoiceSimPage from "./VoiceSimPage";
import GuidedDemoPage from "./GuidedDemoPage";

type ViewKey = "overview" | "checkins" | "queue" | "signals" | "reliability" | "walkthrough" | "onboarding" | "voice";
type CheckInDraft = NewCheckIn;

const navItems: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "checkins", label: "Check-ins", icon: Inbox },
  { key: "queue", label: "Review queue", icon: ClipboardCheck },
  { key: "signals", label: "Quality signals", icon: SlidersHorizontal },
  { key: "reliability", label: "Reliability lab", icon: BarChart3 },
  { key: "onboarding", label: "Onboard clinic", icon: FileText },
  { key: "voice", label: "Voice sim", icon: Mic },
  { key: "walkthrough", label: "3-Min Guided Demo", icon: Sparkles },
];

const blankDraft: CheckInDraft = {
  patientName: patientOptions[0].name,
  patientId: patientOptions[0].id,
  initials: patientOptions[0].initials,
  program: patientOptions[0].program,
  weekStatus: "On track with my weekly routine",
  followUp: "no",
  note: "",
};

function timeAgo(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function StatusPill({ status }: { status: ReviewStatus }) {
  const labels: Record<ReviewStatus, string> = {
    needs_review: "Needs review",
    draft_ready: "Draft ready",
    approved: "Approved · simulated",
    rejected: "Rejected · simulated",
    processing_failed: "Processing failed",
  };
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{labels[status]}</span>;
}

function RoutePill({ route }: { route: RouteDecision }) {
  const labels: Record<RouteDecision, string> = {
    DRAFT_FOR_REVIEW: "Draft for review",
    HUMAN_REVIEW_REQUIRED: "Human review",
    INPUT_ERROR: "Input error",
  };
  return <span className={`route-pill route-${route.toLowerCase()}`}>{labels[route]}</span>;
}

function Avatar({ name, initials, size = "md" }: { name: string; initials: string; size?: "sm" | "md" | "lg" }) {
  const palettes = ["avatar-sage", "avatar-lilac", "avatar-amber", "avatar-blue", "avatar-rose"];
  const palette = palettes[name.charCodeAt(0) % palettes.length];
  return <span className={`avatar ${palette} avatar-${size}`} aria-label={name}>{initials}</span>;
}

function MetricCard({ label, value, sub, icon: Icon, tone = "teal", trend }: {
  label: string; value: string | number; sub: string; icon: typeof Activity; tone?: string; trend?: string;
}) {
  return <div className="metric-card">
    <div className={`metric-icon metric-${tone}`}><Icon size={18} strokeWidth={1.9} /></div>
    <div className="metric-label">{label}</div>
    <div className="metric-value-row"><strong>{value}</strong>{trend && <span className="metric-trend"><ArrowUpRight size={13} />{trend}</span>}</div>
    <div className="metric-sub">{sub}</div>
  </div>;
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="heading-action">{action}</div>}
  </div>;
}

function CaseRow({ item, onOpen, compact = false }: { item: DemoCase; onOpen: () => void; compact?: boolean }) {
  return <button type="button" className={`case-row ${compact ? "case-row-compact" : ""}`} onClick={onOpen}>
    <div className="case-person"><Avatar name={item.patientName} initials={item.initials} /><div><strong>{item.patientName}</strong><span>{item.patientId} <i>·</i> {item.program}</span></div></div>
    <div className="case-description"><strong>{item.scenarioTag}</strong><span>{item.reason}</span></div>
    <div className="case-status"><StatusPill status={item.status} /></div>
    <div className="case-time"><strong>{timeAgo(item.submittedAt)}</strong><span>{item.id}</span></div>
    <ChevronRight className="row-chevron" size={17} />
  </button>;
}

function DataNotice({ compact = false }: { compact?: boolean }) {
  return <div className={`data-notice ${compact ? "data-notice-compact" : ""}`}>
    <span className="notice-icon"><Shield size={15} /></span>
    <span><strong>Simulation only.</strong> Do not enter real health information. Not for medical care or emergencies.</span>
  </div>;
}

function CheckInModal({ onClose, onSubmit, initialMode = "routine" }: {
  onClose: () => void; onSubmit: (input: CheckInDraft) => void; initialMode?: "routine" | "review";
}) {
  const [form, setForm] = useState<CheckInDraft>(() => ({
    ...blankDraft,
    ...(initialMode === "review" ? { weekStatus: "I have a question for the care team", followUp: "yes" as const, note: "I'd like the care team to review this note." } : {}),
  }));
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [submitted, setSubmitted] = useState<DemoCase | null>(null);
  const selectedPatient = patientOptions.find((patient) => patient.id === form.patientId) ?? patientOptions[0];
  const routePreview: RouteDecision = form.note.trim() || form.followUp === "yes" || form.weekStatus !== "On track with my weekly routine" ? "HUMAN_REVIEW_REQUIRED" : "DRAFT_FOR_REVIEW";

  function updatePatient(id: string) {
    const person = patientOptions.find((patient) => patient.id === id) ?? patientOptions[0];
    setForm((current) => ({ ...current, patientName: person.name, patientId: person.id, initials: person.initials, program: person.program }));
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (!form.patientId || !form.weekStatus) {
      setError("Choose a demo participant and complete the required check-in field.");
      return;
    }
    if (form.note.length > 500) {
      setError("Keep the fictional note under 500 characters.");
      return;
    }
    setError("");
    setReviewing(true);
  }

  function confirmSubmit() {
    const created = createCheckIn(form, 10);
    onSubmit(form);
    setSubmitted(created);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal intake-modal" role="dialog" aria-modal="true" aria-labelledby="intake-title">
      <div className="modal-topline"><span className="modal-kicker"><span className="tiny-live-dot" />SYNTHETIC INTAKE</span><button className="icon-button" onClick={onClose} aria-label="Close check-in"><X size={18} /></button></div>
      {!submitted && !reviewing ? <>
        <div className="modal-title-block"><h2 id="intake-title">New check-in</h2><p>Submit a fictional weekly update to see how the demo workflow routes it.</p></div>
        <DataNotice compact />
        <form onSubmit={review} className="intake-form">
          <label className="field-label" htmlFor="demo-patient">Demo participant <span>Required</span></label>
          <select id="demo-patient" value={form.patientId} onChange={(event) => updatePatient(event.target.value)}>
            {patientOptions.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.id}</option>)}
          </select>
          <div className="selected-person"><Avatar name={selectedPatient.name} initials={selectedPatient.initials} size="sm" /><span><strong>{selectedPatient.name}</strong><small>{selectedPatient.program} · invented profile</small></span><BadgeCheck size={16} /></div>

          <fieldset className="choice-fieldset">
            <legend>How would you describe this week? <span>Required</span></legend>
            {[
              ["On track with my weekly routine", "On track", "A routine selection stays in the draft-review path."],
              ["I have a question for the care team", "I have a question", "The demo routes an explicit request to staff."],
              ["I'm not sure how to answer", "I'm not sure", "Uncertainty is routed for staff review."],
            ].map(([value, title, hint]) => <label className={`choice-card ${form.weekStatus === value ? "choice-selected" : ""}`} key={value}>
              <input type="radio" name="week-status" value={value} checked={form.weekStatus === value} onChange={() => setForm((current) => ({ ...current, weekStatus: value }))} />
              <span className="custom-radio" /><span className="choice-copy"><strong>{title}</strong><small>{hint}</small></span>
            </label>)}
          </fieldset>

          <fieldset className="choice-fieldset followup-fieldset">
            <legend>Would you like a staff member to follow up?</legend>
            <div className="segmented-control"><button type="button" className={form.followUp === "no" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, followUp: "no" }))}>No, not now</button><button type="button" className={form.followUp === "yes" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, followUp: "yes" }))}>Yes, please</button></div>
          </fieldset>

          <label className="field-label" htmlFor="demo-note">Note for the team <span>Optional · max 500 characters</span></label>
          <textarea id="demo-note" maxLength={500} rows={3} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Leave empty for the routine demo path. Any free text is sent to staff review, not interpreted by the demo." />
          <div className="textarea-caption"><span>Free text is always routed to human review in this simulation.</span><span>{form.note.length}/500</span></div>
          {error && <div className="inline-error"><AlertCircle size={15} />{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Review check-in <ArrowRight size={15} /></button></div>
        </form>
      </> : reviewing ? <div className="review-step">
        <div className="modal-title-block"><span className="eyebrow">STEP 2 OF 2 · CONFIRM DETAILS</span><h2>Review this check-in</h2><p>Check the fictional details and illustrative route before adding it to the local demo.</p></div>
        <DataNotice compact />
        <div className="review-summary-card"><div className="review-summary-person"><Avatar name={selectedPatient.name} initials={selectedPatient.initials} size="sm" /><div><strong>{selectedPatient.name}</strong><span>{selectedPatient.id} · invented profile</span></div></div><div className="review-summary-row"><span>Weekly status</span><strong>{form.weekStatus}</strong></div><div className="review-summary-row"><span>Staff follow-up</span><strong>{form.followUp === "yes" ? "Requested" : "Not requested"}</strong></div><div className="review-summary-row"><span>Note</span><strong>{form.note.trim() || "No note submitted"}</strong></div><div className="review-summary-route"><span>Illustrative route</span><RoutePill route={routePreview} /></div></div>
        <div className="success-disclaimer"><Info size={15} />This confirmation creates a synthetic case in this browser only. Nothing is sent and no external system is contacted.</div>
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setReviewing(false)}><ArrowLeft size={14} />Back to edit</button><button type="button" className="button button-primary" onClick={confirmSubmit}>Confirm and add demo case <ArrowRight size={15} /></button></div>
      </div> : <div className="submit-success">
        <div className="success-orbit"><Check size={28} /></div><span className="eyebrow">SIMULATION COMPLETE</span><h2>Check-in added to the demo</h2>
        <p>{submitted!.patientName}'s fictional check-in followed the illustrative rules and landed in the {submitted!.status === "needs_review" ? "staff review queue" : "draft review queue"}.</p>
        <DataNotice compact />
        <div className="success-route"><span>ROUTE</span><RoutePill route={submitted!.route} /></div>
        <div className="success-disclaimer"><Info size={15} />Simulated workflow only. No message was sent and no external system was contacted.</div>
        <button className="button button-primary button-wide" onClick={onClose}>Done <Check size={15} /></button>
      </div>}
    </section>
  </div>;
}

function Overview({ cases, onOpen, onNew, onView }: { cases: DemoCase[]; onOpen: (id: string) => void; onNew: () => void; onView: (view: ViewKey) => void }) {
  const needsReview = cases.filter((item) => item.status === "needs_review");
  const draftReady = cases.filter((item) => item.status === "draft_ready");
  const completed = cases.filter((item) => item.status === "approved" || item.status === "rejected");
  const chart = [34, 48, 41, 65, 58, 72, 63, 86, 74, 91, 78, 100];
  return <>
    <SectionHeading eyebrow="WEDNESDAY · DEMO WORKSPACE" title="A clearer view between visits." description="Explore how a bounded follow-up workflow can keep staff in the loop." action={<button className="button button-primary" onClick={onNew}><Plus size={16} />New check-in</button>} />
    <DataNotice />
    <div className="metric-grid">
      <MetricCard label="Needs staff review" value={needsReview.length.toString().padStart(2, "0")} sub="Synthetic cases awaiting a person" icon={Users} tone="amber" trend="2 new" />
      <MetricCard label="Drafts to review" value={draftReady.length.toString().padStart(2, "0")} sub="Unsent · reviewer action required" icon={FileText} tone="teal" />
      <MetricCard label="Simulated decisions" value={completed.length.toString().padStart(2, "0")} sub="Local demo actions only" icon={BadgeCheck} tone="blue" />
      <MetricCard label="Test scenarios" value={evaluationFixtures.length.toString()} sub="Synthetic software checks" icon={FlaskConical} tone="violet" />
    </div>
    <div className="overview-grid">
      <section className="surface activity-surface">
        <div className="surface-heading"><div><span className="eyebrow">WORKFLOW ACTIVITY</span><h2>Check-ins in the demo</h2></div><button className="icon-button subtle" aria-label="Chart information" onClick={() => toast("Illustrative weekly activity only; no real patient data.")}><CircleHelp size={17} /></button></div>
        <div className="chart-summary"><strong>126</strong><span>fictional check-ins processed <b>·</b> illustrative</span><span className="chart-period">LAST 12 WEEKS <ChevronDown size={13} /></span></div>
        <div className="activity-chart" aria-label="Illustrative check-in activity chart"><div className="chart-y-labels"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="chart-bars">{chart.map((height, index) => <div className="chart-column" key={index}><span className="chart-bar" style={{ height: `${height}%` }} title={`${height} illustrative check-ins`} /><small>{["W1", "W2", "W3", "W4"][index % 4]}</small></div>)}</div></div>
        <div className="chart-legend"><span><i className="legend-dot" />Synthetic check-ins</span><span>Illustrative data · not actual volume</span></div>
      </section>
      <section className="surface routing-surface">
        <div className="surface-heading"><div><span className="eyebrow">ROUTING SNAPSHOT</span><h2>Where cases land</h2></div><span className="snapshot-tag">DEMO DATA</span></div>
        <div className="routing-visual"><div className="donut-chart"><div className="donut-inner"><strong>{cases.length}</strong><span>cases</span></div></div><div className="route-legend"><div><span className="route-swatch swatch-human" /><span>Human review</span><strong>{needsReview.length}</strong></div><div><span className="route-swatch swatch-draft" /><span>Draft review</span><strong>{draftReady.length}</strong></div><div><span className="route-swatch swatch-done" /><span>Simulated done</span><strong>{completed.length}</strong></div></div></div>
        <div className="workflow-note"><Sparkles size={15} /><span>Deterministic rules route uncertainty and free text to staff.</span></div>
      </section>
    </div>
    <section className="surface queue-preview">
      <div className="surface-heading"><div><span className="eyebrow">RECENT CASES</span><h2>Needs your attention <span className="heading-count">{needsReview.length}</span></h2></div><button className="text-button" onClick={() => onView("queue")}>Open review queue <ArrowRight size={14} /></button></div>
      <div className="case-list case-list-preview">{[...needsReview, ...draftReady].slice(0, 4).map((item) => <CaseRow key={item.id} item={item} compact onOpen={() => onOpen(item.id)} />)}</div>
      {needsReview.length === 0 && draftReady.length === 0 && <div className="empty-state"><Check size={20} /><strong>All caught up</strong><span>No synthetic cases are waiting.</span></div>}
    </section>
    <section className="guided-strip"><div className="guided-icon"><Sparkles size={18} /></div><div><span className="eyebrow">INTERACTIVE WALKTHROUGH</span><strong>Run the 3-minute guided demo</strong><p>Paste SOP, compile, test mutations, shadow replay, activate, and review a flagged case.</p></div><button className="button button-dark" onClick={() => onView("walkthrough")}>Launch 3-Min Demo <ArrowRight size={15} /></button></section>
  </>;
}

function ReliabilityPanel({ lastRun, onRun, running, onInjectChange, injectFailure }: {
  lastRun: EvaluationRun | null; onRun: () => void; running: boolean; onInjectChange: (value: boolean) => void; injectFailure: boolean;
}) {
  const [group, setGroup] = useState("All checks");
  const results = lastRun?.results ?? [];
  const visible = group === "All checks" ? results : results.filter((item) => item.group === group);
  const metrics = lastRun?.metrics;
  return <>
    <SectionHeading eyebrow="SYNTHETIC SOFTWARE EVALUATION" title="Reliability lab" description="A fixed fixture suite checks workflow behavior, failure handling, and safety boundaries." action={<button className="button button-primary" onClick={onRun} disabled={running}>{running ? <><RefreshCw size={15} className="spin" />Running suite…</> : <><RefreshCw size={15} />Run {evaluationFixtures.length} checks</>}</button>} />
    <div className="reliability-banner"><div className="reliability-banner-icon"><FlaskConical size={17} /></div><p><strong>Synthetic software evaluation—not clinical validation.</strong> These fixed test cases measure this demo’s illustrative rules. They say nothing about real-world clinical performance or patient safety.</p><span>FIXTURE SET V1.0</span></div>
    <div className="reliability-controls"><label className="failure-toggle"><input type="checkbox" checked={injectFailure} onChange={(event) => onInjectChange(event.target.checked)} /><span className="toggle-visual" /><span><strong>Inject one synthetic critical miss</strong><small>Demonstrate how the safety gate reports a failed case.</small></span></label><div className="last-run">{lastRun ? <><span className="tiny-live-dot" />Last run {timeAgo(lastRun.createdAt)} <span className="version-dot">·</span> {lastRun.id}</> : "No evaluation run yet"}</div></div>
    {metrics && <>
      <div className={`safety-gate ${metrics.safetyGate === "PASS" ? "gate-pass" : "gate-fail"}`}><div className="gate-symbol">{metrics.safetyGate === "PASS" ? <Shield size={20} /> : <ShieldAlert size={20} />}</div><div><span className="eyebrow">DEMO SAFETY GATE</span><strong>{metrics.safetyGate === "PASS" ? "No critical misses in this run" : "Critical miss detected · review required"}</strong><p>{metrics.safetyGate === "PASS" ? "All critical synthetic scenarios matched their expected human-review route." : `${metrics.criticalMisses} critical synthetic scenario did not match its expected route. This run is marked failed.`}</p></div><span className="gate-count">{metrics.criticalMisses}<small>critical misses</small></span></div>
      <div className="eval-metric-grid">
        <MetricCard label="Route match" value={`${metrics.routeAccuracy}%`} sub={`${metrics.passed} of ${metrics.total} scenarios passed`} icon={CheckCheck} tone={metrics.routeAccuracy === 100 ? "teal" : "amber"} />
        <MetricCard label="Review recall" value={`${metrics.reviewRecall}%`} sub="Synthetic review-required cases caught" icon={ShieldAlert} tone={metrics.reviewRecall === 100 ? "blue" : "amber"} />
        <MetricCard label="False escalations" value={metrics.falseEscalations} sub="Routine fixtures routed to staff" icon={ArrowUpRight} tone="violet" />
        <MetricCard label="p95 latency" value={`${metrics.p95Latency}ms`} sub={`p50 ${metrics.p50Latency}ms · fixture workflow`} icon={Zap} tone="teal" />
      </div>
      <div className="metric-footnote"><Info size={14} />Small fixed test set (n={metrics.total}); scores are software checks only and must not be generalized to clinical outcomes.</div>
      <div className="reliability-grid">
        <section className="surface eval-table-surface"><div className="surface-heading"><div><span className="eyebrow">CASE-BY-CASE RESULTS</span><h2>Fixture run <span className="heading-count">{results.length}</span></h2></div><select className="mini-select" value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filter evaluation group"><option>All checks</option><option>Routing</option><option>Safety</option><option>Workflow</option></select></div>
          <div className="eval-table-head"><span>CASE</span><span>EXPECTED → ACTUAL</span><span>RESULT</span></div>
          <div className="eval-results">{visible.map((result) => { const pass = result.expected === result.actual; return <div className={`eval-result-row ${!pass && result.severity === "critical" ? "eval-critical-fail" : ""}`} key={result.id}><div className="eval-case-label"><span className={`eval-id ${result.severity === "critical" ? "eval-id-critical" : ""}`}>{result.id}</span><div><strong>{result.title}</strong><small>{result.group} · {result.latencyMs}ms</small></div></div><div className="expected-actual"><span>{result.expected}</span><ArrowRight size={12} /><span className={!pass ? "actual-mismatch" : ""}>{result.actual}</span></div><span className={`eval-status ${pass ? "eval-pass" : "eval-fail"}`}>{pass ? <><Check size={13} />Pass</> : <><X size={13} />Fail</>}</span></div>; })}</div>
        </section>
        <section className="surface eval-breakdown"><div className="surface-heading"><div><span className="eyebrow">TEST CATEGORIES</span><h2>Coverage snapshot</h2></div><ListFilter size={17} className="muted-icon" /></div>
          {(["Routing", "Safety", "Workflow"] as const).map((category) => { const total = results.filter((item) => item.group === category).length; const passed = results.filter((item) => item.group === category && item.expected === item.actual).length; return <div className="coverage-row" key={category}><div className="coverage-copy"><span>{category}</span><strong>{passed}/{total}</strong></div><div className="coverage-track"><span style={{ width: `${total ? (passed / total) * 100 : 0}%` }} className={passed === total ? "coverage-good" : "coverage-alert"} /></div></div>; })}
          <div className="policy-check-card"><div className="policy-check-head"><Shield size={15} /><strong>Draft policy checks</strong><span className={metrics.policyPassRate === 100 ? "policy-ok" : "policy-warn"}>{metrics.policyPassRate}%</span></div><p>Checks for unsupported claims, clinical advice, external actions, and simulated-only approval behavior.</p></div>
          <div className="run-metadata"><span>WORKFLOW <b>0.1.0</b></span><span>RULES <b>{lastRun.ruleVersion}</b></span><span>FIXTURES <b>{lastRun.fixtureVersion}</b></span></div>
        </section>
      </div>
      <div className="evaluation-footnote"><Shield size={14} />No real patient data is used. No clinical thresholds are validated by this suite. Review the fixture definitions before interpreting results.</div>
    </>}
  </>;
}

function _Walkthrough({ onNew, onView }: { onNew: (mode?: "routine" | "review") => void; onView: (view: ViewKey) => void }) {
  const steps = [
    { n: "01", title: "Submit a synthetic check-in", copy: "Pick a fictional participant and use a routine or staff-review example. See the exact answers before submitting.", icon: UserRound, action: "Try routine example", click: () => onNew("routine"), tone: "step-teal" },
    { n: "02", title: "Inspect the routing decision", copy: "Compare what was submitted with the deterministic rule result and its evidence. Free text is never interpreted by the demo.", icon: SlidersHorizontal, action: "Open review queue", click: () => onView("queue"), tone: "step-amber" },
    { n: "03", title: "Review, edit, decide", copy: "Edit an unsent draft or make a simulated approval/rejection. Every reviewer action is recorded locally.", icon: ClipboardCheck, action: "View draft-ready cases", click: () => onView("queue"), tone: "step-blue" },
    { n: "04", title: "Run the synthetic suite", copy: "Check route matching, critical misses, false escalations, policy checks, and fixture latency.", icon: BarChart3, action: "Open reliability lab", click: () => onView("reliability"), tone: "step-violet" },
  ];
  return <>
    <SectionHeading eyebrow="A 2-MINUTE PRODUCT TOUR" title="See the workflow, not just the chat." description="Follow one fictional update from intake to review, then inspect how the demo tests its own rules." />
    <DataNotice />
    <div className="walkthrough-layout"><div className="walkthrough-main"><div className="walkthrough-progress"><div><span className="eyebrow">GUIDED DEMO</span><strong>Four steps · about 2 minutes</strong></div><span className="progress-pill"><span />READY WHEN YOU ARE</span></div>{steps.map((step, index) => <div className="walkthrough-step" key={step.n}><div className={`walkthrough-step-icon ${step.tone}`}><step.icon size={18} /></div><div className="walkthrough-step-content"><div className="step-meta">STEP {step.n}</div><h3>{step.title}</h3><p>{step.copy}</p><button className="text-button" onClick={step.click}>{step.action}<ArrowRight size={14} /></button></div>{index < steps.length - 1 && <div className="walkthrough-connector" />}</div>)}</div>
      <aside className="walkthrough-aside"><div className="aside-illustration"><div className="illustration-orb orb-one" /><div className="illustration-orb orb-two" /><div className="illustration-card"><div className="illustration-card-head"><span /><span /><span /></div><div className="illustration-avatar"><HeartPulse size={22} /></div><div className="illustration-line line-long" /><div className="illustration-line" /><div className="illustration-status"><Check size={12} />Rule checked</div></div><div className="illustration-spark spark-one">✳</div><div className="illustration-spark spark-two">✳</div></div><div className="walkthrough-aside-copy"><span className="eyebrow">BUILT FOR INSPECTION</span><h3>Every output has a trail.</h3><p>See the source fields, rule version, routing reason, and reviewer action—without hidden side effects.</p><div className="aside-list"><span><Check size={14} />Synthetic fixtures only</span><span><Check size={14} />No outbound action</span><span><Check size={14} />Visible deterministic rules</span></div></div></aside></div>
    <div className="walkthrough-bottom-note"><Info size={16} /><span>This walkthrough demonstrates a software workflow. It does not provide medical care, interpret symptoms, or validate clinical safety.</span></div>
  </>;
}

export default function Home() {
  const [view, setView] = useState<ViewKey>("overview");

  // SQLite via tRPC is the source of truth (localStorage removed)
  const casesQuery = trpc.cases.list.useQuery(undefined, {
    placeholderData: seedCases,
  });
  const auditVerifyQuery = trpc.audit.verify.useQuery();
  const resetMutation = trpc.system.resetDemoData.useMutation({
    onSuccess: () => {
      casesQuery.refetch();
      auditVerifyQuery.refetch();
      setCases(seedCases);
      setRuns([]);
      setLastRun(runEvaluation(false));
      setSelectedId(null);
      toast.success("Demo data reset to fictional fixtures in SQLite");
    },
    onError: (err) => {
      toast.error(`Reset failed: ${err.message}`);
    },
  });

  const [cases, setCases] = useState<DemoCase[]>(seedCases);

  useEffect(() => {
    if (casesQuery.data && casesQuery.data.length > 0) {
      setCases(casesQuery.data);
    }
  }, [casesQuery.data]);

  const [_runs, setRuns] = useState<EvaluationRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeMode, setIntakeMode] = useState<"routine" | "review">("routine");
  const [running, setRunning] = useState(false);
  const [injectFailure, setInjectFailure] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [topSearch, setTopSearch] = useState("");
  const [lastRun, setLastRun] = useState<EvaluationRun | null>(() => runEvaluation(false));
  const selectedCase = cases.find((item) => item.id === selectedId) ?? null;
  const needsReviewCount = cases.filter((item) => item.status === "needs_review").length;

  function openIntake(mode: "routine" | "review" = "routine") { setIntakeMode(mode); setIntakeOpen(true); }
  function handleSubmit(input: CheckInDraft) {
    const created = createCheckIn(input, cases.length);
    setCases((current) => [created, ...current]);
    toast.success("Synthetic check-in added to the workflow");
  }
  function updateCase(next: DemoCase) { setCases((current) => current.map((item) => item.id === next.id ? next : item)); }
  function changeView(next: ViewKey) { setView(next); setMobileNavOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function runSuite() {
    if (running) return;
    setRunning(true);
    window.setTimeout(() => {
      const result = runEvaluation(injectFailure);
      setLastRun(result);
      setRuns((current) => [result, ...current].slice(0, 10));
      setRunning(false);
      toast[result.metrics.safetyGate === "PASS" ? "success" : "error"](result.metrics.safetyGate === "PASS" ? "Synthetic suite complete · no critical misses" : "Synthetic suite failed · critical miss detected");
    }, 720);
  }
  function resetAll() {
    if (!window.confirm("Reset all local demo data to the original fictional cases? This cannot be undone.")) return;
    resetMutation.mutate({ confirmed: true });
  }
  function searchEnter(event: FormEvent) {
    event.preventDefault();
    if (topSearch.trim()) changeView("queue");
  }

  const pageTitle = navItems.find((item) => item.key === view)?.label ?? "Overview";

  return <div className="app-shell">
    <aside className={`app-sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="brand-lockup"><div className="brand-mark"><span /><span /><span /></div><div><strong>Careflow</strong><small>WORKFLOW STUDIO</small></div><button className="icon-button sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="workspace-switch"><div className="workspace-avatar">N</div><div><strong>Northstar Clinic</strong><span>Demo workspace</span></div><ChevronDown size={15} /></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{navItems.map((item) => <button key={item.key} className={`nav-item ${view === item.key ? "nav-active" : ""}`} onClick={() => changeView(item.key)}><item.icon size={17} strokeWidth={1.9} /><span>{item.label}</span>{item.key === "queue" && needsReviewCount > 0 && <b className="nav-count">{needsReviewCount}</b>}{item.key === "reliability" && <span className="nav-live" />}</button>)}</nav>
      <div className="sidebar-section-label sidebar-section-label-lower">DEMO FIXTURES</div>
      <a href="/web" className="fixture-side-card" style={{ textDecoration: 'none' }}><div className="fixture-side-icon"><Send size={15} /></div><div><strong>Patient Check-in</strong><span>Open /web mobile flow</span></div><ArrowUpRight size={15} /></a>
      <a href="/voice-sim" className="fixture-side-card" style={{ marginTop: '6px', textDecoration: 'none' }}><div className="fixture-side-icon"><Mic size={15} /></div><div><strong>Voice Simulator</strong><span>/voice-sim waterfall</span></div><ArrowUpRight size={15} /></a>
      <div className="fixture-side-card" style={{ marginTop: '6px' }}><div className="fixture-side-icon"><FlaskConical size={15} /></div><div><strong>18 test scenarios</strong><span>Version 1.0 · synthetic</span></div><ChevronRight size={15} /></div>
      <div className="sidebar-spacer" />
      <button className="sidebar-reset" onClick={resetAll}><RefreshCw size={14} />Reset demo data</button>
      <div className="sidebar-profile"><div className="reviewer-avatar">DR</div><div><strong>Demo reviewer</strong><span>Local session</span></div><MoreHorizontal size={18} /></div>
    </aside>
    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}

    <main className="app-main">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><span className="breadcrumb-root">Careflow</span><ChevronRight size={14} /><span className="breadcrumb-current">{pageTitle}</span></div>
        <div className="topbar-right"><a href="/web" className="button button-quiet button-small" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Send size={13} /><span>Patient Check-in (/web)</span></a><form className="global-search" onSubmit={searchEnter}><Search size={15} /><input aria-label="Search demo cases" value={topSearch} onChange={(event) => setTopSearch(event.target.value)} onFocus={() => {}} placeholder="Search demo cases" /><kbd>⌘ K</kbd></form><span className="demo-workspace-pill"><span />DEMO MODE</span><button className="icon-button topbar-notification" aria-label="Notifications" onClick={() => toast("No live notifications in this demo.")}><Bell size={17} /><i /></button><div className="topbar-avatar">DR</div></div>
      </header>
      <div className="main-content">
        {view === "overview" && <Overview cases={cases} onOpen={setSelectedId} onNew={() => openIntake()} onView={changeView} />}
        {view === "checkins" && (
          <div className="space-y-4">
            <div className="bg-white border rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-1">
                  <Inbox size={13} />
                  PATIENT CHECK-IN INTAKE PORTAL (/web)
                </div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Patient Check-In Intake
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Simulated mobile web portal for fictional patients. Load test scenarios S01–S18, test boundary inputs, and submit updates to observe deterministic routing into the review queue.
                </p>
              </div>
              <button
                type="button"
                onClick={() => changeView("queue")}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-[#102c34] hover:bg-[#1a4450] rounded-lg shadow-sm flex items-center gap-1.5 transition self-start md:self-auto cursor-pointer"
              >
                <span>Open Staff Review Queue</span>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex justify-center bg-slate-50 border rounded-xl p-3 md:p-6">
              <CheckInPage
                onViewQueue={() => changeView("queue")}
                onSubmitted={(_res) => {
                  casesQuery.refetch();
                }}
                isEmbedded={true}
              />
            </div>
          </div>
        )}
        {view === "queue" && (
          <ReviewQueue
            cases={cases}
            onOpenCase={setSelectedId}
            onUpdateCase={updateCase}
            onNewCheckIn={() => openIntake()}
          />
        )}
        {view === "signals" && (
          <QualitySignalsPage onBackToQueue={() => changeView("queue")} />
        )}
        {view === "onboarding" && (
          <ClinicOnboardingPage onBackToOverview={() => changeView("overview")} />
        )}
        {view === "voice" && (
          <VoiceSimPage onBackToOverview={() => changeView("overview")} />
        )}
        {view === "reliability" && <ReliabilityPanel lastRun={lastRun} onRun={runSuite} running={running} injectFailure={injectFailure} onInjectChange={setInjectFailure} />}
        {view === "walkthrough" && <GuidedDemoPage onNavigate={(route) => changeView(route as ViewKey)} />}
        <footer className="app-footer"><span>Careflow Workflow Studio <b>·</b> Independent demo</span><span><span className="footer-dot" />All records are invented <i>·</i> No external system connected</span><button onClick={() => toast("This prototype is a simulation and is not for medical care.")}>Safety notes <ArrowUpRight size={12} /></button></footer>
      </div>
    </main>

    {selectedCase && (
      <CaseDetailDrawer
        item={selectedCase}
        onClose={() => setSelectedId(null)}
        onUpdate={updateCase}
      />
    )}
    {intakeOpen && <CheckInModal initialMode={intakeMode} onClose={() => setIntakeOpen(false)} onSubmit={handleSubmit} />}
  </div>;
}

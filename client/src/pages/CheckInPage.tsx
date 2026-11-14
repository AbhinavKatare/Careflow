import React, { useState, useId, useCallback } from "react";
import {
  Shield, AlertCircle, RefreshCw, ArrowRight, ArrowLeft,
  ClipboardList, Sparkles, Send, Check
} from "lucide-react";
import {
  evaluationFixtures,
  patientOptions,
  CheckInSubmissionSchema,
  generateIdempotencyKey,
  processCheckInSubmission,
  type CheckInSubmissionResult,
} from "@shared";

type FormState = {
  patientId: string;
  patientName: string;
  program: string;
  weekStatus: string;
  followUp: "yes" | "no";
  note: string;
  idempotencyKey: string;
};

const initialPatient = patientOptions[0];

const defaultFormState: FormState = {
  patientId: initialPatient.id,
  patientName: initialPatient.name,
  program: initialPatient.program,
  weekStatus: "On track with my weekly routine",
  followUp: "no",
  note: "",
  idempotencyKey: generateIdempotencyKey(),
};

export interface CheckInPageProps {
  onViewQueue?: () => void;
  onSubmitted?: (result: CheckInSubmissionResult) => void;
  isEmbedded?: boolean;
}

export default function CheckInPage({ onViewQueue, onSubmitted, isEmbedded: _isEmbedded }: CheckInPageProps = {}) {
  const [formData, setFormData] = useState<FormState>(defaultFormState);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [step, setStep] = useState<"form" | "review" | "confirmed">("form");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<CheckInSubmissionResult | null>(null);
  const [simulateApiFailure, setSimulateApiFailure] = useState(false);
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());

  // Unique IDs for accessibility associations
  const formId = useId();
  const patientSelectId = `${formId}-patient`;
  const scenarioSelectId = `${formId}-scenario`;
  const noteInputId = `${formId}-note`;
  const noteErrorId = `${formId}-note-error`;
  const noteHintId = `${formId}-note-hint`;
  const statusLegendId = `${formId}-status-legend`;
  const followUpLegendId = `${formId}-followup-legend`;

  // Patient change handler
  const handlePatientChange = (patientId: string) => {
    const selected = patientOptions.find((p) => p.id === patientId);
    if (selected) {
      setFormData((prev) => ({
        ...prev,
        patientId: selected.id,
        patientName: selected.name,
        program: selected.program,
      }));
      setValidationErrors((prev) => {
        const copy = { ...prev };
        delete copy.patientId;
        return copy;
      });
    }
  };

  // Scenario Loader (S01 - S18)
  const handleLoadScenario = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    if (!scenarioId) return;

    const fixture = evaluationFixtures.find((f) => f.id === scenarioId);
    if (!fixture) return;

    const raw = fixture.rawInput;
    const matchingPatient =
      patientOptions.find((p) => p.id === raw.patientId || p.name === raw.patientName) || patientOptions[0];

    // For S13 (idempotency fixture), use fixture idempotency key, else generate new
    const key = raw.idempotencyKey || generateIdempotencyKey();

    setFormData({
      patientId: raw.patientId || matchingPatient.id,
      patientName: raw.patientName || matchingPatient.name,
      program: raw.program || matchingPatient.program,
      weekStatus: raw.weekStatus || "On track with my weekly routine",
      followUp: raw.followUp === "yes" ? "yes" : "no",
      note: raw.note || "",
      idempotencyKey: key,
    });

    setValidationErrors({});
    setSubmissionError(null);
  };

  // Validate form using Zod schema
  const validateForm = (): boolean => {
    const result = CheckInSubmissionSchema.safeParse(formData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const fieldName = issue.path[0]?.toString() || "form";
        errors[fieldName] = issue.message;
      });
      setValidationErrors(errors);
      return false;
    }
    setValidationErrors({});
    return true;
  };

  const safeScrollTop = () => {
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Proceed to review
  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      setStep("review");
      safeScrollTop();
    }
  };

  // Submit check-in
  const handleSubmit = useCallback(async () => {
    // Double-submit protection
    if (isSubmitting) return;

    if (submittedKeys.has(formData.idempotencyKey) && !selectedScenarioId.startsWith("S13")) {
      setSubmissionError("This submission has already been processed with this idempotency key.");
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      // Process submission through deterministic pipeline service
      const result = await processCheckInSubmission(formData, {
        simulateFailure: simulateApiFailure,
        failureMessage: "Simulated network timeout connecting to clinic server.",
      });

      setSubmissionResult(result);
      setSubmittedKeys((prev) => new Set(prev).add(formData.idempotencyKey));
      setStep("confirmed");
      onSubmitted?.(result);
      safeScrollTop();
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "An unexpected error occurred while submitting your check-in.";
      setSubmissionError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, isSubmitting, simulateApiFailure, submittedKeys, selectedScenarioId]);

  // Reset form to start a new check-in
  const handleStartAnother = () => {
    setFormData({
      patientId: initialPatient.id,
      patientName: initialPatient.name,
      program: initialPatient.program,
      weekStatus: "On track with my weekly routine",
      followUp: "no",
      note: "",
      idempotencyKey: generateIdempotencyKey(),
    });
    setSelectedScenarioId("");
    setValidationErrors({});
    setSubmissionError(null);
    setSubmissionResult(null);
    setStep("form");
    safeScrollTop();
  };

  return (
    <div className="min-h-screen bg-[#f5f7f6] text-[#20333b] flex flex-col items-center">
      {/* Skip to main content link for keyboard navigation */}
      <a
        href="#main-checkin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:p-3 focus:bg-white focus:text-[#102c34] focus:font-semibold focus:shadow-md focus:rounded"
      >
        Skip to main content
      </a>

      {/* Top Header / Banner */}
      <header role="banner" className="w-full bg-[#102c34] text-white py-4 px-4 shadow-sm">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-[#d8f0e8] flex items-center justify-center font-bold text-[#102c34] text-sm">
              CF
            </div>
            <div>
              <span className="font-serif text-lg font-semibold tracking-tight text-white block leading-tight">
                Careflow
              </span>
              <span className="text-[10px] text-[#91a9a6] font-semibold tracking-wider uppercase block">
                Weekly Check-in Demo
              </span>
            </div>
          </div>
          {onViewQueue ? (
            <button
              type="button"
              onClick={onViewQueue}
              className="text-xs text-[#d8f0e8] hover:text-white underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-[#75c9a8] rounded px-1.5 py-1 cursor-pointer"
            >
              Open Staff Queue →
            </button>
          ) : (
            <a
              href="/"
              className="text-xs text-[#d8f0e8] hover:text-white underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-[#75c9a8] rounded px-1.5 py-1"
            >
              Staff Dashboard
            </a>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main id="main-checkin-content" role="main" className="w-full max-w-md px-4 py-6 flex-1 flex flex-col">
        {/* Simulation Disclaimer Banner */}
        <section
          aria-label="Simulation notice"
          className="mb-5 p-3.5 bg-[#eff7f3] border border-[#deeee7] rounded-lg flex items-start gap-3 text-[#2d5c4e] text-xs leading-relaxed"
        >
          <Shield className="w-5 h-5 flex-shrink-0 text-[#287d6b] mt-0.5" aria-hidden="true" />
          <p className="m-0 font-medium text-[#1a4a3e]">
            <strong>Simulation only. Do not enter real health information. Not for medical care or emergencies.</strong>
          </p>
        </section>

        {/* Scenario Loader Card */}
        <section
          aria-labelledby="scenario-loader-heading"
          className="mb-5 p-3.5 bg-white border border-[#e2e8e5] rounded-lg shadow-xs"
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-[#287d6b]" aria-hidden="true" />
            <h2 id="scenario-loader-heading" className="text-xs font-bold text-[#102c34] tracking-wide uppercase">
              Load Sample Scenario
            </h2>
          </div>
          <label htmlFor={scenarioSelectId} className="sr-only">
            Load sample scenario from fixtures S01 to S18
          </label>
          <select
            id={scenarioSelectId}
            value={selectedScenarioId}
            onChange={(e) => handleLoadScenario(e.target.value)}
            disabled={step === "confirmed" || isSubmitting}
            className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded-md px-3 py-2 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b] focus-visible:border-transparent cursor-pointer"
          >
            <option value="">Choose a synthetic scenario (S01–S18)...</option>
            {evaluationFixtures.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {`${fixture.id}: ${fixture.title}`}
              </option>
            ))}
          </select>
          {selectedScenarioId && (
            <p className="text-[11px] text-[#4d7265] mt-2 mb-0 italic">
              Loaded: {evaluationFixtures.find((f) => f.id === selectedScenarioId)?.description}
            </p>
          )}
        </section>

        {/* STEP 1: Check-in Form */}
        {step === "form" && (
          <form onSubmit={handleProceedToReview} noValidate className="space-y-5 bg-white p-5 border border-[#e2e8e5] rounded-xl shadow-xs">
            <div className="border-b border-[#eef2f0] pb-3">
              <h1 className="text-lg font-serif font-bold text-[#102c34]">
                Participant Routine Check-in
              </h1>
              <p className="text-xs text-[#527067] mt-1 mb-0">
                Please complete your routine update. Answers help your care team stay informed between visits.
              </p>
            </div>

            {/* Patient Selector */}
            <div className="space-y-1.5">
              <label htmlFor={patientSelectId} className="block text-xs font-semibold text-[#102c34]">
                Synthetic Patient <span className="text-red-700" aria-hidden="true">*</span>
              </label>
              <select
                id={patientSelectId}
                value={formData.patientId}
                onChange={(e) => handlePatientChange(e.target.value)}
                disabled={isSubmitting}
                className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded-md px-3 py-2.5 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
              >
                {patientOptions.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name} ({patient.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Program Context Card */}
            <div className="p-3 bg-[#f5f8f6] border border-[#e2eae6] rounded-md flex items-start gap-3">
              <ClipboardList className="w-4 h-4 text-[#287d6b] flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs">
                <span className="font-semibold text-[#102c34] block">
                  Program: {formData.program}
                </span>
                <span className="text-[#59746c] text-[11px] block mt-0.5">
                  Fictional participant ID: <strong className="font-mono">{formData.patientId}</strong>
                </span>
              </div>
            </div>

            {/* Structured Question 1: Weekly Routine */}
            <fieldset className="space-y-2 border-0 p-0 m-0">
              <legend id={statusLegendId} className="text-xs font-semibold text-[#102c34] mb-1 block">
                How are you tracking with your routine this week? <span className="text-red-700" aria-hidden="true">*</span>
              </legend>
              <div className="space-y-2" role="radiogroup" aria-labelledby={statusLegendId}>
                {[
                  "On track with my weekly routine",
                  "I have a question for the care team",
                  "I'm not sure how to answer",
                ].map((optionText) => {
                  const optionId = `${formId}-status-${optionText.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
                  const isSelected = formData.weekStatus === optionText;
                  return (
                    <label
                      key={optionText}
                      htmlFor={optionId}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors text-xs ${
                        isSelected
                          ? "bg-[#eff7f3] border-[#287d6b] text-[#102c34] font-medium"
                          : "bg-white border-[#d0ded7] text-[#344b44] hover:bg-[#fafcfb]"
                      }`}
                    >
                      <input
                        type="radio"
                        id={optionId}
                        name="weekStatus"
                        value={optionText}
                        checked={isSelected}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, weekStatus: e.target.value }))
                        }
                        className="w-4 h-4 text-[#287d6b] focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                      />
                      <span>{optionText}</span>
                    </label>
                  );
                })}
              </div>
              {validationErrors.weekStatus && (
                <p role="alert" className="text-xs text-red-700 font-medium mt-1">
                  {validationErrors.weekStatus}
                </p>
              )}
            </fieldset>

            {/* Structured Question 2: Follow-up preference */}
            <fieldset className="space-y-2 border-0 p-0 m-0">
              <legend id={followUpLegendId} className="text-xs font-semibold text-[#102c34] mb-1 block">
                Would you like a team member to follow up with you? <span className="text-red-700" aria-hidden="true">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={followUpLegendId}>
                {[
                  { value: "no" as const, label: "No follow-up needed" },
                  { value: "yes" as const, label: "Yes, please follow up" },
                ].map((opt) => {
                  const optId = `${formId}-followup-${opt.value}`;
                  const isSelected = formData.followUp === opt.value;
                  return (
                    <label
                      key={opt.value}
                      htmlFor={optId}
                      className={`flex items-center gap-2.5 p-3 border rounded-lg cursor-pointer transition-colors text-xs text-center justify-center ${
                        isSelected
                          ? "bg-[#eff7f3] border-[#287d6b] text-[#102c34] font-medium"
                          : "bg-white border-[#d0ded7] text-[#344b44] hover:bg-[#fafcfb]"
                      }`}
                    >
                      <input
                        type="radio"
                        id={optId}
                        name="followUp"
                        value={opt.value}
                        checked={isSelected}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, followUp: e.target.value as "yes" | "no" }))
                        }
                        className="w-4 h-4 text-[#287d6b] focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                      />
                      <span>{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Optional Free Text Note */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <label htmlFor={noteInputId} className="block text-xs font-semibold text-[#102c34]">
                  Optional Note for Care Team
                </label>
                <span
                  id={noteHintId}
                  aria-live="polite"
                  className={`text-[11px] font-mono ${
                    formData.note.length > 500 ? "text-red-700 font-bold" : "text-[#628177]"
                  }`}
                >
                  {formData.note.length} / 500 characters
                </span>
              </div>
              <textarea
                id={noteInputId}
                name="note"
                rows={3}
                value={formData.note}
                onChange={(e) => setFormData((prev) => ({ ...prev, note: e.target.value }))}
                aria-describedby={`${noteHintId} ${validationErrors.note ? noteErrorId : ""}`}
                aria-invalid={!!validationErrors.note}
                placeholder="Share any routine non-urgent updates for staff to review..."
                className="w-full text-xs bg-[#f8faf9] border border-[#d0ded7] rounded-md p-3 text-[#20333b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#287d6b]"
              />
              <p className="text-[11px] text-[#5e7d73] mt-1 mb-0">
                Notice: All free-text submissions are routed for human review. Do not include emergency symptoms.
              </p>
              {validationErrors.note && (
                <p id={noteErrorId} role="alert" className="text-xs text-red-700 font-medium mt-1">
                  {validationErrors.note}
                </p>
              )}
            </div>

            {/* Simulation Testing Toggle: Simulate API Failure */}
            <div className="pt-2 border-t border-[#eef2f0] flex items-center justify-between">
              <label
                htmlFor="simulate-api-toggle"
                className="text-[11px] text-[#5a786e] flex items-center gap-2 cursor-pointer"
              >
                <input
                  id="simulate-api-toggle"
                  type="checkbox"
                  checked={simulateApiFailure}
                  onChange={(e) => setSimulateApiFailure(e.target.checked)}
                  className="rounded border-[#c0d0c8] text-[#287d6b] focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                />
                <span>Simulate server/API failure (test error & retry states)</span>
              </label>
            </div>

            {/* Proceed to Review Button */}
            <button
              type="submit"
              className="w-full min-h-[44px] bg-[#102c34] hover:bg-[#1a4450] text-white font-medium text-xs rounded-lg py-3 px-4 flex items-center justify-center gap-2 shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#287d6b]"
            >
              <span>Continue to Review</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>
        )}

        {/* STEP 2: Review Screen */}
        {step === "review" && (
          <div className="space-y-5 bg-white p-5 border border-[#e2e8e5] rounded-xl shadow-xs">
            <div className="border-b border-[#eef2f0] pb-3">
              <h1 className="text-lg font-serif font-bold text-[#102c34]">
                Review Your Check-in
              </h1>
              <p className="text-xs text-[#527067] mt-1 mb-0">
                Please confirm your details before submitting to your care team.
              </p>
            </div>

            {/* Review Cards */}
            <dl className="space-y-3 text-xs">
              <div className="p-3 bg-[#f8faf9] border border-[#e2eae6] rounded-lg">
                <dt className="text-[11px] text-[#5e7d73] uppercase tracking-wider font-semibold">
                  Participant
                </dt>
                <dd className="mt-1 font-semibold text-[#102c34] text-sm">
                  {formData.patientName} <span className="font-mono text-xs text-[#527067]">({formData.patientId})</span>
                </dd>
                <dd className="text-xs text-[#5e7d73] mt-0.5">
                  Program: {formData.program}
                </dd>
              </div>

              <div className="p-3 bg-[#f8faf9] border border-[#e2eae6] rounded-lg">
                <dt className="text-[11px] text-[#5e7d73] uppercase tracking-wider font-semibold">
                  Routine Status
                </dt>
                <dd className="mt-1 text-[#102c34] font-medium">
                  {formData.weekStatus}
                </dd>
              </div>

              <div className="p-3 bg-[#f8faf9] border border-[#e2eae6] rounded-lg">
                <dt className="text-[11px] text-[#5e7d73] uppercase tracking-wider font-semibold">
                  Follow-up Request
                </dt>
                <dd className="mt-1 text-[#102c34] font-medium">
                  {formData.followUp === "yes" ? "Yes, please have someone follow up" : "No follow-up needed"}
                </dd>
              </div>

              <div className="p-3 bg-[#f8faf9] border border-[#e2eae6] rounded-lg">
                <dt className="text-[11px] text-[#5e7d73] uppercase tracking-wider font-semibold">
                  Care Team Note
                </dt>
                <dd className="mt-1 text-[#102c34] italic whitespace-pre-wrap">
                  {formData.note.trim() ? formData.note : "(No additional note provided)"}
                </dd>
              </div>

              <div className="p-2.5 bg-[#f5f8f6] border border-[#e2eae6] rounded-lg text-[11px] flex items-center justify-between">
                <dt className="text-[#5e7d73] font-semibold">Idempotency Key:</dt>
                <dd className="font-mono text-[#287d6b]">{formData.idempotencyKey.slice(0, 16)}...</dd>
              </div>
            </dl>

            {/* Error Banner with Retry State */}
            {submissionError && (
              <div
                role="alert"
                className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-semibold text-red-800 m-0">Submission Failed</p>
                  <p className="mt-1 mb-2 text-red-700 text-[11px]">{submissionError}</p>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-800 hover:bg-red-900 text-white rounded text-xs font-medium focus-visible:ring-2 focus-visible:ring-red-600 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? "animate-spin" : ""}`} aria-hidden="true" />
                    <span>Retry submission</span>
                  </button>
                </div>
              </div>
            )}

            {/* Review Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full min-h-[44px] bg-[#287d6b] hover:bg-[#1f6354] disabled:bg-[#85b5a8] text-white font-medium text-xs rounded-lg py-3 px-4 flex items-center justify-center gap-2 shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#287d6b] cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Submitting check-in...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" aria-hidden="true" />
                    <span>Submit Check-in</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep("form")}
                disabled={isSubmitting}
                className="w-full min-h-[44px] bg-transparent hover:bg-[#f1f5f3] text-[#344b44] font-medium text-xs rounded-lg py-2 px-4 flex items-center justify-center gap-2 border border-[#d0ded7] transition-colors focus-visible:ring-2 focus-visible:ring-[#287d6b]"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                <span>Edit responses</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Confirmation Screen */}
        {step === "confirmed" && submissionResult && (
          <div className="space-y-5 bg-white p-6 border border-[#e2e8e5] rounded-xl shadow-xs text-center">
            <div className="w-12 h-12 bg-[#eff7f3] border-2 border-[#287d6b] rounded-full mx-auto flex items-center justify-center text-[#287d6b]">
              <Check className="w-6 h-6 stroke-[3]" aria-hidden="true" />
            </div>

            <div>
              <h1 className="text-xl font-serif font-bold text-[#102c34]">
                Check-in Received
              </h1>
              <p className="text-xs text-[#527067] mt-1.5 mb-0">
                Your routine update has been recorded for your care team.
              </p>
            </div>

            {/* Submission Reference Box */}
            <div className="p-4 bg-[#f8faf9] border border-[#e2eae6] rounded-lg text-left text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[#5e7d73]">Case ID:</span>
                <span className="font-mono font-bold text-[#102c34]">{submissionResult.caseId}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#5e7d73]">Submitted:</span>
                <span className="text-[#102c34]">Just now</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#5e7d73]">Routing Outcome:</span>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    submissionResult.route === "DRAFT_FOR_REVIEW"
                      ? "bg-[#eaf5ee] text-[#287d6b]"
                      : "bg-[#fcf3e6] text-[#9c6a34]"
                  }`}
                >
                  {submissionResult.route === "DRAFT_FOR_REVIEW" ? "Draft prepared" : "Queued for staff"}
                </span>
              </div>
              {submissionResult.isDuplicate && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px]">
                  <strong>Idempotent:</strong> Duplicate key recognized. Returned existing case without re-creating.
                </div>
              )}
            </div>

            {/* Explicit Zero Outbound Action Notice */}
            <div className="p-3 bg-[#f5f8f6] border border-[#e2eae6] rounded text-[11px] text-[#4d6d62] text-left">
              <strong>Simulation only:</strong> This check-in has been stored in your local demo database. No real
              outbound messages, SMS, or emails were sent.
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleStartAnother}
                className="w-full min-h-[44px] bg-[#102c34] hover:bg-[#1a4450] text-white font-medium text-xs rounded-lg py-3 px-4 shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#287d6b] cursor-pointer"
              >
                Submit another check-in
              </button>
              {onViewQueue ? (
                <button
                  type="button"
                  onClick={onViewQueue}
                  className="w-full min-h-[44px] inline-flex items-center justify-center bg-white hover:bg-[#f1f5f3] text-[#344b44] font-medium text-xs rounded-lg py-2 px-4 border border-[#d0ded7] transition-colors focus-visible:ring-2 focus-visible:ring-[#287d6b] cursor-pointer"
                >
                  View in Staff Review Queue →
                </button>
              ) : (
                <a
                  href="/"
                  className="w-full min-h-[44px] inline-flex items-center justify-center bg-white hover:bg-[#f1f5f3] text-[#344b44] font-medium text-xs rounded-lg py-2 px-4 border border-[#d0ded7] transition-colors focus-visible:ring-2 focus-visible:ring-[#287d6b]"
                >
                  View in Staff Review Queue
                </a>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Accessible Footer */}
      <footer role="contentinfo" className="w-full py-4 text-center text-xs text-[#718c83] border-t border-[#e2eae6] mt-auto">
        <p className="m-0">Careflow Studio · Independent Portfolio Simulation · No Protected Health Information</p>
      </footer>
    </div>
  );
}

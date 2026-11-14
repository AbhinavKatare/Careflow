import { evaluationFixtures, seedCases } from "./fixtures";
import { defaultWorkflowSpec, evaluatePolicy } from "./policy";
import type {
  DemoCase,
  EvaluationFixture,
  EvaluationMetrics,
  EvaluationRun,
  RawCheckInInput,
  RouteDecision,
} from "./types";

export const RULE_VERSION = "rules v1.2-demo";
export const WORKFLOW_VERSION = "workflow 0.1.0";

/**
 * Pure deterministic policy evaluator.
 * Powered by declarative WorkflowSpec in /shared/policy.
 */
export function routeByDemoPolicy(
  input: RawCheckInInput,
  options?: { bypassUrgentScan?: boolean }
): RouteDecision {
  if (options?.bypassUrgentScan) {
    // Simulated policy defect when injecting critical miss
    return "DRAFT_FOR_REVIEW";
  }

  // Check candidate draft grounding if provided
  if (input.draftCandidate) {
    const draftLower = input.draftCandidate.toLowerCase();
    const noteLower = (input.note || "").toLowerCase();
    if (
      (draftLower.includes("dosage") ||
        draftLower.includes("increase") ||
        draftLower.includes("prescription")) &&
      !noteLower.includes("dosage")
    ) {
      return "HUMAN_REVIEW_REQUIRED";
    }
  }

  const result = evaluatePolicy(input, defaultWorkflowSpec);
  return result.route;
}

export function evaluateRawFixture(
  fixture: EvaluationFixture,
  injectCriticalMiss = false
): string {
  const { id, rawInput } = fixture;

  if (injectCriticalMiss && id === "S05") {
    // Simulated policy defect when injecting critical miss
    return "DRAFT_FOR_REVIEW";
  }

  return routeByDemoPolicy(rawInput);
}

export function getMetrics(results: EvaluationFixture[]): EvaluationMetrics {
  const total = results.length;
  const passed = results.filter((item) => item.expected === item.actual).length;
  const failed = total - passed;

  const criticalMisses = results.filter(
    (item) => item.severity === "critical" && item.expected !== item.actual
  ).length;

  const falseEscalations = results.filter(
    (item) => item.expected === "DRAFT_FOR_REVIEW" && item.actual === "HUMAN_REVIEW_REQUIRED"
  ).length;

  const routeCases = results.filter((item) =>
    ["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"].includes(item.expected)
  );
  const routeMatches = routeCases.filter((item) => item.expected === item.actual).length;

  const reviewRequired = routeCases.filter((item) => item.expected === "HUMAN_REVIEW_REQUIRED");
  const correctReview = reviewRequired.filter((item) => item.actual === "HUMAN_REVIEW_REQUIRED").length;

  const routine = routeCases.filter((item) => item.expected === "DRAFT_FOR_REVIEW");
  const correctRoutine = routine.filter((item) => item.actual === "DRAFT_FOR_REVIEW").length;

  const latencies = results
    .map((item) => item.latencyMs ?? 0)
    .sort((a, b) => a - b);
  const percentile = (p: number) => {
    if (latencies.length === 0) return 0;
    const idx = Math.min(latencies.length - 1, Math.max(0, Math.ceil(p * latencies.length) - 1));
    return latencies[idx] ?? 0;
  };

  const routeAccuracy = routeCases.length > 0 ? Math.round((routeMatches / routeCases.length) * 100) : 0;
  const reviewRecall = reviewRequired.length > 0 ? Math.round((correctReview / reviewRequired.length) * 100) : 0;
  const draftSpecificity = routine.length > 0 ? Math.round((correctRoutine / routine.length) * 100) : 0;
  const policyPassRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  let safetyGate: "PASS" | "FAIL" = "PASS";
  if (criticalMisses > 0 || failed > 0) {
    safetyGate = "FAIL";
  }

  return {
    total,
    passed,
    failed,
    criticalMisses,
    falseEscalations,
    routeAccuracy,
    reviewRecall,
    draftSpecificity,
    policyPassRate,
    p50Latency: percentile(0.5),
    p95Latency: percentile(0.95),
    safetyGate,
  };
}

export function runEvaluation(injectCriticalMiss = false): EvaluationRun {
  const results: EvaluationFixture[] = evaluationFixtures.map((fixture) => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const actual = evaluateRawFixture(fixture, injectCriticalMiss);
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    const latencyMs = Math.round(Math.max(0.01, elapsed) * 100) / 100;

    return {
      ...fixture,
      actual,
      latencyMs,
    };
  });

  return {
    id: `RUN-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    createdAt: new Date().toISOString(),
    ruleVersion: RULE_VERSION,
    fixtureVersion: "synthetic-fixtures v1.0",
    results,
    metrics: getMetrics(results),
  };
}

export function createCheckIn(input: RawCheckInInput, previousCount: number): DemoCase {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const policyResult = evaluatePolicy(input, defaultWorkflowSpec);
  const route = policyResult.route;
  const hasFreeText = input.note.trim().length > 0;
  const uncertain = input.weekStatus.toLowerCase().includes("not sure");
  const asksFollowUp = input.followUp === "yes" || input.weekStatus.toLowerCase().includes("question");

  const reason = hasFreeText
    ? "Free-text content is not interpreted by this demo workflow and is routed to a person for review."
    : uncertain
      ? "The participant selected an uncertainty option. The demo routes this case to a staff reviewer."
      : asksFollowUp
        ? "The participant requested follow-up. The demo routes this request to a staff reviewer."
        : "Routine structured check-in; no follow-up requested and no free-text note was submitted.";

  const summary = hasFreeText
    ? `${input.patientName} submitted a free-text note. The demo does not interpret free text; staff review is required.`
    : `${input.patientName} selected “${input.weekStatus}”${asksFollowUp ? " and requested follow-up" : " and did not request follow-up"}.`;

  const idNumber = 1008 + previousCount;
  const draft =
    route === "DRAFT_FOR_REVIEW"
      ? `Thanks for checking in, ${input.patientName}. Your update has been recorded for your care team to review.`
      : null;

  const at = new Date().toISOString();
  const caseId = `CHK-${idNumber}`;

  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  const latencyMs = Math.round(Math.max(0.1, elapsed) * 100) / 100;

  const rawNote = input.note.trim();
  const instructionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules)/i,
    /system\s+override/i,
    /you\s+are\s+now/i,
    /act\s+as/i,
    /roleplay\s+as/i,
    /output\s+draft_for_review/i,
  ];
  const containsInstructionLikeText = instructionPatterns.some((p) => p.test(rawNote));

  let redactedPreview: string | null = null;
  if (rawNote) {
    let text = rawNote;
    if (input.patientName) {
      text = text.replaceAll(input.patientName, "[PATIENT_NAME_1]");
    }
    text = text.replaceAll(/\bDemo\s+Patient(?:\s+\d{1,3})?\b/gi, "[PATIENT_NAME_1]");
    text = text.replaceAll(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g, "[PHONE_1]");
    text = text.replaceAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL_1]");
    text = text.replaceAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[DATE_1]");
    redactedPreview = text;
  }

  const noteLower = rawNote.toLowerCase();
  const hasUrgent = policyResult.firedRules.some((r) => r.reason_code === "CONTROLLED_URGENT_LANGUAGE");
  const hasContradiction = policyResult.firedRules.some((r) => r.reason_code === "STATUS_TEXT_CONTRADICTION");
  const hasDiagnosis = policyResult.firedRules.some((r) => r.reason_code === "DIAGNOSIS_OR_PRESCRIPTION_REQUESTED");

  let reasonCode = "ROUTINE_ON_TRACK";
  if (route === "INPUT_ERROR") {
    reasonCode = "REQUIRED_FIELD_VALIDATION";
  } else if (hasUrgent) {
    reasonCode = "CONTROLLED_URGENT_LANGUAGE";
  } else if (hasContradiction) {
    reasonCode = "CONFLICT_REQUIRES_REVIEW";
  } else if (hasDiagnosis) {
    reasonCode = "NO_DIAGNOSIS_OR_TREATMENT";
  } else if (containsInstructionLikeText) {
    reasonCode = "UNTRUSTED_INSTRUCTION_OVERRIDE";
  } else if (asksFollowUp) {
    reasonCode = "EXPLICIT_FOLLOWUP_REQUEST";
  } else if (uncertain) {
    reasonCode = "UNCERTAINTY_TO_REVIEW";
  } else if (hasFreeText) {
    reasonCode = "UNTRUSTED_FREE_TEXT";
  }

  const firedRules = policyResult.firedRules.length > 0
    ? policyResult.firedRules.map((r) => ({
        id: r.id,
        description: r.description,
        reason_code: r.reason_code,
      }))
    : [
        {
          id: `RULE_${reasonCode}`,
          description: reason,
          reason_code: reasonCode,
        },
      ];

  // Extracted facts with source span references
  const extractedFacts: import("./types").ExtractedFact[] = [
    {
      id: "fact-routine",
      category: "Routine Adherence",
      value: input.weekStatus || "Not specified",
      confidence: 1.0,
    },
    {
      id: "fact-followup",
      category: "Staff Outreach",
      value: input.followUp === "yes" ? "Follow-up requested" : "No follow-up requested",
      confidence: 1.0,
    },
  ];

  if (rawNote) {
    // Locate specific phrases or fall back to note span
    let spanFound = false;
    const keyPhrases = [
      "chest pain and shortness of breath",
      "chest pain",
      "shortness of breath",
      "extreme difficulty",
      "cannot take any medications",
      "red spots on my arm",
      "steroid ointment",
      "question for the care team",
      "question",
      "schedule",
      "follow up",
    ];

    for (const phrase of keyPhrases) {
      const idx = noteLower.indexOf(phrase);
      if (idx !== -1) {
        extractedFacts.push({
          id: `fact-${phrase.replace(/[^a-z0-9]/g, "-")}`,
          category: hasUrgent ? "Reported Symptom" : "Participant Note Excerpt",
          value: rawNote.slice(idx, idx + phrase.length),
          sourceSpan: {
            start: idx,
            end: idx + phrase.length,
            text: rawNote.slice(idx, idx + phrase.length),
          },
          confidence: 0.95,
        });
        spanFound = true;
        break;
      }
    }

    if (!spanFound) {
      extractedFacts.push({
        id: "fact-full-note",
        category: "Participant Free-Text",
        value: rawNote.length > 50 ? `${rawNote.slice(0, 50)}...` : rawNote,
        sourceSpan: {
          start: 0,
          end: rawNote.length,
          text: rawNote,
        },
        confidence: 0.9,
      });
    }
  }

  return {
    id: caseId,
    patientName: input.patientName,
    patientId: input.patientId,
    initials: input.initials,
    program: input.program,
    submittedAt: at,
    scenarioTag: hasFreeText
      ? "Free-text review"
      : uncertain
        ? "Uncertain response"
        : asksFollowUp
          ? "Staff follow-up requested"
          : "Routine · simulated",
    weekStatus: input.weekStatus,
    followUp: input.followUp,
    note: rawNote,
    route,
    status: route === "HUMAN_REVIEW_REQUIRED" ? "needs_review" : "draft_ready",
    reason,
    reasonCode,
    summary,
    originalDraft: draft,
    draft,
    ruleVersion: RULE_VERSION,
    workflowVersion: WORKFLOW_VERSION,
    latencyMs,
    redactedPreview,
    containsInstructionLikeText,
    extractedFacts,
    firedRules,
    audit: [
      {
        id: `evt-${idNumber}-submitted`,
        at,
        actor: "Workflow",
        action: "Check-in received",
        detail: "Synthetic weekly check-in submitted.",
      },
      {
        id: `evt-${idNumber}-routed`,
        at,
        actor: "Workflow",
        action: route === "HUMAN_REVIEW_REQUIRED" ? "Routed to staff" : "Draft prepared",
        detail: reason,
      },
    ],
  };
}

export function addReviewerEvent(
  item: DemoCase,
  action: string,
  detail: string,
  patch: Partial<DemoCase> = {}
): DemoCase {
  const at = new Date().toISOString();
  const evtId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    ...item,
    ...patch,
    audit: [
      ...item.audit,
      {
        id: evtId,
        at,
        actor: "Demo staff reviewer",
        action,
        detail,
      },
    ],
  };
}

export { seedCases };


export type RouteDecision =
  | "DRAFT_FOR_REVIEW"
  | "HUMAN_REVIEW_REQUIRED"
  | "INPUT_ERROR";

export type ReviewStatus =
  | "needs_review"
  | "draft_ready"
  | "approved"
  | "rejected"
  | "processing_failed";

export type AuditEvent = {
  id: string;
  at: string;
  actor: "Workflow" | "Demo staff reviewer";
  action: string;
  detail: string;
};

export type ExtractedFact = {
  id: string;
  category: string;
  value: string;
  sourceSpan?: {
    start: number;
    end: number;
    text: string;
  };
  confidence?: number;
};

export type RawCheckInInput = {
  patientName: string;
  patientId: string;
  initials: string;
  program: string;
  weekStatus: string;
  followUp: "yes" | "no";
  note: string;
  idempotencyKey?: string;
  draftCandidate?: string;
};

export type DemoCase = {
  id: string;
  patientName: string;
  patientId: string;
  initials: string;
  program: string;
  submittedAt: string;
  scenarioTag: string;
  weekStatus: string;
  followUp: "yes" | "no";
  note: string;
  route: RouteDecision;
  status: ReviewStatus;
  reason: string;
  reasonCode?: string;
  summary: string;
  originalDraft?: string | null;
  draft: string | null;
  ruleVersion: string;
  workflowVersion: string;
  latencyMs: number;
  redactedPreview?: string | null;
  containsInstructionLikeText?: boolean;
  extractedFacts?: ExtractedFact[];
  firedRules?: {
    id: string;
    description: string;
    reason_code: string;
  }[];
  audit: AuditEvent[];
};

export type NewCheckIn = RawCheckInInput;

export type EvaluationFixture = {
  id: string;
  title: string;
  description: string;
  rawInput: RawCheckInInput;
  expected: string;
  actual?: string;
  group: "Routing" | "Safety" | "Workflow";
  severity: "critical" | "standard";
  rule: string;
  latencyMs?: number;
};

export type EvaluationMetrics = {
  total: number;
  passed: number;
  failed: number;
  criticalMisses: number;
  falseEscalations: number;
  routeAccuracy: number;
  reviewRecall: number;
  draftSpecificity: number;
  policyPassRate: number;
  p50Latency: number;
  p95Latency: number;
  safetyGate: "PASS" | "FAIL";
};

export type EvaluationRun = {
  id: string;
  createdAt: string;
  ruleVersion: string;
  fixtureVersion: string;
  results: EvaluationFixture[];
  metrics: EvaluationMetrics;
};

// ==========================================
// STRUCTURED REVIEWER FEEDBACK & SIGNALS
// ==========================================

export const REJECTION_REASON_TAXONOMY = [
  "inaccurate",
  "tone",
  "unsupported_claim",
  "should_have_been_escalated",
  "other",
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_TAXONOMY)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReasonCode, string> = {
  inaccurate: "Inaccurate facts or clinical hallucination",
  tone: "Inappropriate or alarming tone",
  unsupported_claim: "Unsupported claim / not in source note",
  should_have_been_escalated: "Should have been escalated to staff",
  other: "Other reviewer reason",
};

export type FeedbackActionType =
  | "draft_accepted_unchanged"
  | "draft_edited"
  | "rejected"
  | "route_override";

export type DiffSegment = {
  type: "unchanged" | "added" | "removed";
  text: string;
};

export type FeedbackLabel = {
  id: string;
  caseId: string;
  patientId: string;
  action: FeedbackActionType;
  reviewerId: string;
  createdAt: string;
  promptVersion: string;
  ruleVersion: string;
  editDistance?: number;
  diff?: DiffSegment[] | string;
  originalDraft?: string | null;
  finalDraft?: string | null;
  rejectionReason?: RejectionReasonCode;
  rejectionNotes?: string;
  routeOverride?: {
    originalRoute: RouteDecision;
    suggestedRoute: RouteDecision;
    reason?: string;
  };
  inputRedacted: string;
  extraction?: ExtractedFact[];
  draft?: string | null;
  reviewerOutcome: {
    action: FeedbackActionType;
    status: ReviewStatus;
    editDistance?: number;
    rejectionReason?: RejectionReasonCode;
    rejectionNotes?: string;
    routeOverride?: {
      originalRoute: RouteDecision;
      suggestedRoute: RouteDecision;
      reason?: string;
    };
    simulated: true;
  };
};

export type QualitySignalsMetrics = {
  totalReviews: number;
  acceptedCount: number;
  acceptedUnchangedCount: number;
  editedCount: number;
  rejectedCount: number;
  overrideCount: number;
  acceptanceRate: number; // dynamically computed percentage
  meanEditDistanceAllAccepted: number;
  meanEditDistanceEditedOnly: number;
  overrideRate: number; // dynamically computed percentage
  rejectionReasonsBreakdown: {
    reason: RejectionReasonCode;
    label: string;
    count: number;
    percentage: number;
  }[];
  versionTrends: {
    promptVersion: string;
    ruleVersion: string;
    total: number;
    acceptedCount: number;
    acceptanceRate: number;
    meanEditDistance: number;
    overrideRate: number;
    rejectionCount: number;
    topRejectionReason: string;
  }[];
};

export type ExportedFeedbackRecord = {
  dataset_version: string;
  id: string;
  input_redacted: string;
  extraction: Array<Record<string, unknown>>;
  draft: string | null;
  reviewer_outcome: {
    action: FeedbackActionType;
    status?: string;
    edit_distance?: number;
    rejection_reason?: RejectionReasonCode;
    rejection_notes?: string;
    route_override?: {
      original_route: string;
      suggested_route: string;
      reason?: string;
    };
    simulated: true;
  };
  prompt_version: string;
  rule_version: string;
  created_at: string;
};

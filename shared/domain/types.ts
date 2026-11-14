import { z } from "zod";
import { CaseStatusEnum } from "./state-machine";

// ==========================================
// 1. DEMO PATIENT
// ==========================================
export const DemoPatientSchema = z.object({
  id: z.string().min(1),
  patientId: z.string().min(1),
  fullName: z.string().min(1),
  initials: z.string().min(1),
  clinicId: z.string().min(1),
  programId: z.string().min(1),
  createdAt: z.string().min(1),
});

export type DemoPatient = z.infer<typeof DemoPatientSchema>;

// ==========================================
// 2. CHECK-IN (Structured Answers + Immutable Raw Text)
// ==========================================
export const CheckInSchema = z.object({
  id: z.string().min(1),
  patientId: z.string().min(1),
  programId: z.string().min(1),
  statusSelection: z.string().min(1),
  followUpRequested: z.boolean(),
  submittedAt: z.string().min(1),
  rawText: z.string(), // PERMANENT RULE: Original text stored separately and never mutated
  structuredAnswers: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().optional(),
});

export type CheckIn = z.infer<typeof CheckInSchema>;

// ==========================================
// 3. WORKFLOW SPEC (Versioned, Content-Hashed JSON)
// ==========================================
export const QuestionnaireFieldSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "select", "boolean", "radio"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(true),
});

export const RuleSpecSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  condition: z.union([z.string(), z.record(z.string(), z.unknown())]),
  route: z.enum(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]),
  reason_code: z.string().min(1),
});

export type RuleSpec = z.infer<typeof RuleSpecSchema>;
export type RouteDecision = "DRAFT_FOR_REVIEW" | "HUMAN_REVIEW_REQUIRED" | "INPUT_ERROR";
export type PolicyRoute = RouteDecision;

export const DraftTemplateSpecSchema = z.object({
  id: z.string().min(1),
  trigger_reason: z.string().min(1),
  template_text: z.string().min(1),
});

export const LimitsSpecSchema = z.object({
  max_note_length: z.number().int().positive(),
  max_daily_submissions: z.number().int().positive(),
  timeout_ms: z.number().int().positive(),
});

export const WorkflowSpecSchema = z.object({
  spec_version: z.string().min(1),
  parent_version: z.string().nullable(),
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  questionnaire_fields: z.array(QuestionnaireFieldSpecSchema),
  rule_list: z.array(RuleSpecSchema),
  draft_templates: z.array(DraftTemplateSpecSchema),
  limits: LimitsSpecSchema,
  reviewer_roles: z.array(z.string().min(1)),
});

export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

// ==========================================
// 4. EXTRACTED FACT (With Source Span)
// ==========================================
export const SourceSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string(),
});

export type SourceSpan = z.infer<typeof SourceSpanSchema>;

export const ExtractedFactSchema = z.object({
  id: z.string().min(1),
  checkInId: z.string().optional(),
  category: z.string().min(1),
  value: z.string().min(1),
  sourceSpan: SourceSpanSchema,
  confidence: z.number().min(0).max(1),
});

export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

// ==========================================
// 5. ROUTING RESULT
// ==========================================
export const FiredRuleSummarySchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  reason_code: z.string().min(1),
});

export const RoutingResultSchema = z.object({
  route: z.enum(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
  firedRules: z.array(FiredRuleSummarySchema),
  inputsUsed: z.record(z.string(), z.unknown()),
  ruleVersion: z.string().min(1),
  evaluatedAt: z.string().min(1),
});

export type RoutingResult = z.infer<typeof RoutingResultSchema>;

// ==========================================
// 6. DRAFT MESSAGE
// ==========================================
export const DraftMessageSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  content: z.string().min(1),
  originalContent: z.string().min(1),
  status: z.enum(["PROPOSED", "EDITED", "APPROVED", "REJECTED"]),
  promptVersion: z.string().min(1),
  modelId: z.string().min(1),
  agentRunId: z.string().nullable().optional(),
  createdAt: z.string().min(1),
});

export type DraftMessage = z.infer<typeof DraftMessageSchema>;

// ==========================================
// 7. REVIEW CASE
// ==========================================
export const ReviewCaseSchema = z.object({
  id: z.string().min(1),
  checkInId: z.string().min(1),
  patientId: z.string().min(1),
  status: CaseStatusEnum,
  priority: z.enum(["STANDARD", "URGENT"]),
  routingReason: z.string().min(1),
  reasonCode: z.string().nullable().optional(),
  specVersion: z.string().min(1),
  specHash: z.string().nullable().optional(),
  ruleVersion: z.string().min(1),
  workflowVersion: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type ReviewCase = z.infer<typeof ReviewCaseSchema>;

// ==========================================
// 8. REVIEW DECISION
// ==========================================
export const ReviewDecisionSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  reviewerId: z.string().min(1),
  decision: z.enum(["APPROVED_SIMULATED", "REJECTED", "ROUTE_OVERRIDE"]),
  notes: z.string(),
  rejectionReasonCode: z.string().nullable().optional(),
  editDistance: z.number().int().min(0).nullable().optional(),
  simulated: z.literal(true), // PERMANENT RULE: Simulated state only, zero outbound actions
  decidedAt: z.string().min(1),
});

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

// ==========================================
// 9. AUDIT EVENT (Append-Only)
// ==========================================
export const AuditEventSchema = z.object({
  id: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  actor: z.enum(["SYSTEM", "WORKFLOW", "DEMO_REVIEWER"]),
  action: z.string().min(1),
  detail: z.string().min(1),
  at: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ==========================================
// 10. AGENT RUN
// ==========================================
export const AgentRunSchema = z.object({
  id: z.string().min(1),
  runType: z.enum(["EXTRACTION", "TRIAGE_POLICY", "DRAFT_SYNTHESIS"]),
  status: z.enum(["SUCCESS", "FAILED"]),
  modelId: z.string().min(1),
  promptVersion: z.string().min(1),
  ruleVersion: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  schemaValid: z.boolean(),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  tier: z.enum(["small", "strong"]).optional(),
  errorMessage: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

// ==========================================
// 11. EVALUATION RUN
// ==========================================
export const EvaluationRunSchema = z.object({
  id: z.string().min(1),
  specVersion: z.string().min(1),
  fixtureVersion: z.string().min(1),
  ruleVersion: z.string().min(1),
  totalCases: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  criticalMisses: z.number().int().nonnegative(),
  routeAccuracy: z.number().min(0).max(100),
  safetyGate: z.enum(["PASS", "FAIL"]),
  latencyP50Ms: z.number().nonnegative(),
  latencyP95Ms: z.number().nonnegative(),
  executedAt: z.string().min(1),
});

export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

// ==========================================
// 12. SHADOW RUN
// ==========================================
export const ShadowRunSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  baselineSpecVersion: z.string().min(1),
  candidateSpecVersion: z.string().min(1),
  baselineRoute: z.enum(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]),
  candidateRoute: z.enum(["DRAFT_FOR_REVIEW", "HUMAN_REVIEW_REQUIRED", "INPUT_ERROR"]),
  routeMatches: z.boolean(),
  baselineDraft: z.string().nullable().optional(),
  candidateDraft: z.string().nullable().optional(),
  draftSimilarity: z.number().min(0).max(1).optional(),
  candidateLatencyMs: z.number().nonnegative(),
  executedAt: z.string().min(1),
});

export type ShadowRun = z.infer<typeof ShadowRunSchema>;

// ==========================================
// 13. EVIDENCE PACK
// ==========================================
export const EvidencePackSchema = z.object({
  caseId: z.string().min(1),
  patientId: z.string().min(1),
  immutableSubmission: z.object({
    submittedAt: z.string().min(1),
    structuredAnswers: z.record(z.string(), z.unknown()),
    rawTextSha256: z.string().optional(),
  }),
  redactedContent: z.object({
    preview: z.string(),
    tokenCount: z.number().int().nonnegative(),
    containsInstructionLikeText: z.boolean(),
  }),
  extractedFacts: z.array(ExtractedFactSchema),
  policyEvaluation: RoutingResultSchema,
  draftSynthesis: DraftMessageSchema.nullable(),
  reviewerDecisions: z.array(ReviewDecisionSchema),
  auditTrail: z.array(AuditEventSchema),
  generatedAt: z.string().min(1),
});

export type EvidencePack = z.infer<typeof EvidencePackSchema>;

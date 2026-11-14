import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Users table for local demo session state.
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name"),
  email: text("email"),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Check-in submissions table with idempotency key.
 */
export const checkIns = sqliteTable("check_ins", {
  id: text("id").primaryKey(),
  patientId: text("patient_id").notNull(),
  programId: text("program_id").notNull().default("Weekly check-in"),
  statusSelection: text("status_selection").notNull(),
  followUpRequested: integer("follow_up_requested", { mode: "boolean" }).notNull().default(false),
  rawText: text("raw_text").notNull().default(""),
  structuredAnswers: text("structured_answers").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").unique(),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
});

export type CheckInRow = typeof checkIns.$inferSelect;
export type InsertCheckInRow = typeof checkIns.$inferInsert;

/**
 * Review cases table.
 */
export const reviewCases = sqliteTable("review_cases", {
  id: text("id").primaryKey(),
  checkInId: text("check_in_id").notNull(),
  patientId: text("patient_id").notNull(),
  patientName: text("patient_name").notNull().default("Demo Patient 001"),
  initials: text("initials").notNull().default("P1"),
  program: text("program").notNull().default("Weekly check-in"),
  weekStatus: text("week_status").notNull(),
  followUp: text("follow_up").notNull().default("no"),
  note: text("note").notNull().default(""),
  status: text("status").notNull(), // "needs_review" | "draft_ready" | "approved" | "rejected" | "processing_failed"
  route: text("route").notNull(),   // "DRAFT_FOR_REVIEW" | "HUMAN_REVIEW_REQUIRED" | "INPUT_ERROR"
  reason: text("reason").notNull(),
  reasonCode: text("reason_code"),
  summary: text("summary"),
  originalDraft: text("original_draft"),
  draft: text("draft"),
  priority: text("priority").notNull().default("STANDARD"),
  scenarioTag: text("scenario_tag"),
  redactedPreview: text("redacted_preview"),
  extractedFacts: text("extracted_facts"), // JSON array
  firedRules: text("fired_rules"),         // JSON array
  ruleVersion: text("rule_version").notNull().default("rules v1.2-demo"),
  workflowVersion: text("workflow_version").notNull().default("workflow 0.1.0"),
  latencyMs: real("latency_ms").notNull().default(0),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
  updatedAt: text("updated_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
});

export type ReviewCaseRow = typeof reviewCases.$inferSelect;
export type InsertReviewCaseRow = typeof reviewCases.$inferInsert;

/**
 * Draft messages table.
 */
export const draftMessages = sqliteTable("draft_messages", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  content: text("content").notNull(),
  originalContent: text("original_content").notNull(),
  status: text("status").notNull().default("PROPOSED"), // "PROPOSED" | "EDITED" | "APPROVED" | "REJECTED"
  promptVersion: text("prompt_version").notNull().default("draft_v1"),
  modelId: text("model_id").notNull().default("mock-small-v1"),
  agentRunId: text("agent_run_id"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
});

export type DraftMessageRow = typeof draftMessages.$inferSelect;
export type InsertDraftMessageRow = typeof draftMessages.$inferInsert;

/**
 * Append-only, Hash-Chained Audit Events Table.
 * Each row stores the previous event's hash and its own hash.
 * PERMANENT RULE: Never store raw patient free text in audit events.
 */
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  sequenceNumber: integer("sequence_number").notNull().unique(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  actor: text("actor").notNull(), // "WORKFLOW" | "DEMO_REVIEWER" | "SYSTEM"
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  at: text("at").notNull(),
  metadata: text("metadata"), // JSON string
});

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type InsertAuditEventRow = typeof auditEvents.$inferInsert;

/**
 * Agent runs table.
 */
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  runType: text("run_type").notNull(), // "EXTRACTION" | "TRIAGE_POLICY" | "DRAFT_SYNTHESIS"
  status: text("status").notNull(),   // "SUCCESS" | "FAILED"
  modelId: text("model_id").notNull(),
  promptVersion: text("prompt_version").notNull(),
  ruleVersion: text("rule_version").notNull(),
  latencyMs: real("latency_ms").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCost: real("estimated_cost"),
  schemaValid: integer("schema_valid", { mode: "boolean" }).notNull().default(true),
  tier: text("tier"),
  errorMessage: text("error_message"),
  metadata: text("metadata"), // JSON string
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").notNull(),
});

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type InsertAgentRunRow = typeof agentRuns.$inferInsert;

/**
 * Evaluation runs table with idempotency key.
 */
export const evaluationRuns = sqliteTable("evaluation_runs", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").unique(),
  specVersion: text("spec_version").notNull(),
  fixtureVersion: text("fixture_version").notNull(),
  ruleVersion: text("rule_version").notNull(),
  totalCases: integer("total_cases").notNull(),
  passedCases: integer("passed_cases").notNull(),
  criticalMisses: integer("critical_misses").notNull(),
  routeAccuracy: real("route_accuracy").notNull(),
  safetyGate: text("safety_gate").notNull(), // "PASS" | "FAIL"
  latencyP50Ms: real("latency_p50_ms").notNull(),
  latencyP95Ms: real("latency_p95_ms").notNull(),
  executedAt: text("executed_at").notNull(),
});

export type EvaluationRunRow = typeof evaluationRuns.$inferSelect;
export type InsertEvaluationRunRow = typeof evaluationRuns.$inferInsert;

/**
 * Shadow runs table with idempotency key.
 */
export const shadowRuns = sqliteTable("shadow_runs", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").unique(),
  caseId: text("case_id").notNull(),
  baselineSpecVersion: text("baseline_spec_version").notNull(),
  candidateSpecVersion: text("candidate_spec_version").notNull(),
  baselineRoute: text("baseline_route").notNull(),
  candidateRoute: text("candidate_route").notNull(),
  routeMatches: integer("route_matches", { mode: "boolean" }).notNull(),
  baselineDraft: text("baseline_draft"),
  candidateDraft: text("candidate_draft"),
  draftSimilarity: real("draft_similarity"),
  candidateLatencyMs: real("candidate_latency_ms").notNull(),
  executedAt: text("executed_at").notNull(),
});

export type ShadowRunRow = typeof shadowRuns.$inferSelect;
export type InsertShadowRunRow = typeof shadowRuns.$inferInsert;

/**
 * Structured Reviewer Feedback labels table.
 */
export const feedbackLabels = sqliteTable("feedback_labels", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  patientId: text("patient_id").notNull().default("DEMO-001"),
  action: text("action").notNull(), // "draft_accepted_unchanged" | "draft_edited" | "rejected" | "route_override"
  reviewerId: text("reviewer_id").notNull(),
  createdAt: text("created_at").notNull(),
  promptVersion: text("prompt_version").notNull(),
  ruleVersion: text("rule_version").notNull(),
  editDistance: integer("edit_distance"),
  diff: text("diff"),
  rejectionReason: text("rejection_reason"),
  routeOverride: text("route_override"),
  payload: text("payload"), // Full serialized FeedbackLabel JSON
});

export type FeedbackLabelRow = typeof feedbackLabels.$inferSelect;
export type InsertFeedbackLabelRow = typeof feedbackLabels.$inferInsert;

/**
 * Clinic SOP Compilation Proposals table.
 * Stores non-binding proposals with line-level traces and human decision outcomes.
 */
export const clinicProposals = sqliteTable("clinic_proposals", {
  id: text("id").primaryKey(),
  sopName: text("sop_name").notNull(),
  sopMarkdown: text("sop_markdown").notNull(),
  proposedSpec: text("proposed_spec").notNull(), // JSON serialized WorkflowSpec
  traces: text("traces").notNull(), // JSON serialized SOPTrace[]
  validation: text("validation").notNull(), // JSON serialized ProposalValidationResult
  status: text("status").notNull().default("PROPOSED"), // "PROPOSED" | "ACCEPTED" | "REJECTED" | "EDITED"
  reviewerNotes: text("reviewer_notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type ClinicProposalRow = typeof clinicProposals.$inferSelect;
export type InsertClinicProposalRow = typeof clinicProposals.$inferInsert;

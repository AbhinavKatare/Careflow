/**
 * SQLite Persistence Service using Drizzle ORM and Better-SQLite3.
 * PERMANENT RULES:
 * - SQLite is the single source of truth (no localStorage for data).
 * - Idempotency keys on check-in submit, eval, and shadow runs.
 * - AuditEvent is append-only and hash-chained.
 * - Zero outbound actions.
 */

import Database from "better-sqlite3";
import { FIXTURES_V1 } from "../shared/evaluation/fixtures-data";
import { executeEvaluation } from "../shared/evaluation/runner";
import { seedFeedbackLabels } from "../shared/feedback-fixtures";
import { computeLevenshteinDistance, computeQualitySignals } from "../shared/feedback-service";
import { computeDraftDiff } from "../shared/case-service";
import { seedCases } from "../shared/fixtures";
import { defaultWorkflowSpec } from "../shared/policy/default-spec";
import { evaluatePolicy } from "../shared/policy/evaluator";
import type {
  EvaluationRun,
  ShadowRun,
} from "../shared/domain/types";
import type {
  DemoCase,
  FeedbackLabel,
  QualitySignalsMetrics,
  RawCheckInInput,
  RejectionReasonCode,
  ReviewStatus,
  RouteDecision,
} from "../shared/types";
import type { CheckInSubmissionValues } from "../shared/checkin-schema";
import {
  appendChainedAuditEvent,
  StoredAuditEventRow,
} from "./audit-chain";
import { getSqlite } from "./db";
import { runCheckInPipeline } from "./pipeline";
import { CheckInSubmission } from "./pipeline/types";

export interface CaseFilter {
  status?: string;
  query?: string;
  sort?: "newest" | "oldest" | "latency_asc" | "latency_desc";
}

export type SubmitCheckInInput =
  | CheckInSubmissionValues
  | (RawCheckInInput & { idempotencyKey?: string });

/**
 * Converts a database row to a frontend-compatible DemoCase object.
 */
function rowToDemoCase(row: Record<string, unknown>, auditRows: StoredAuditEventRow[] = []): DemoCase {
  let extractedFacts = [];
  if (row.extracted_facts) {
    try {
      extractedFacts = JSON.parse(row.extracted_facts as string);
    } catch {
      extractedFacts = [];
    }
  }

  let firedRules = [];
  if (row.fired_rules) {
    try {
      firedRules = JSON.parse(row.fired_rules as string);
    } catch {
      firedRules = [];
    }
  }

  const auditEvents = auditRows.map((a) => ({
    id: a.id,
    at: a.at,
    actor: (a.actor === "Demo staff reviewer" ? "Demo staff reviewer" : "Workflow") as
      | "Workflow"
      | "Demo staff reviewer",
    action: a.action,
    detail: a.detail,
  }));

  return {
    id: row.id as string,
    patientName: (row.patient_name as string) || "Demo Patient 001",
    patientId: row.patient_id as string,
    initials: (row.initials as string) || "P1",
    program: (row.program as string) || "Weekly check-in",
    submittedAt: row.submitted_at as string,
    scenarioTag: (row.scenario_tag as string) || "Check-in",
    weekStatus: row.week_status as string,
    followUp: (row.follow_up === "yes" ? "yes" : "no") as "yes" | "no",
    note: (row.note as string) || "",
    route: row.route as RouteDecision,
    status: row.status as ReviewStatus,
    reason: (row.reason as string) || "",
    reasonCode: (row.reason_code as string) || undefined,
    summary: (row.summary as string) || "Check-in submitted.",
    originalDraft: (row.original_draft as string) || null,
    draft: (row.draft as string) || null,
    redactedPreview: (row.redacted_preview as string) || undefined,
    extractedFacts,
    firedRules,
    ruleVersion: (row.rule_version as string) || "rules v1.2-demo",
    workflowVersion: (row.workflow_version as string) || "workflow 0.1.0",
    latencyMs: (row.latency_ms as number) || 0,
    audit: auditEvents,
  };
}

/**
 * Submits a check-in with idempotency protection.
 * Concurrent duplicate submits return the existing case without duplicate side effects.
 */
export async function submitCheckInWithIdempotency(
  submission: SubmitCheckInInput,
  sqlite: Database.Database = getSqlite()
): Promise<{ case: DemoCase; isDuplicate: boolean }> {
  // Check idempotency first
  if (submission.idempotencyKey) {
    const existingCheckIn = sqlite
      .prepare("SELECT id FROM check_ins WHERE idempotency_key = ?")
      .get(submission.idempotencyKey) as { id: string } | undefined;

    if (existingCheckIn) {
      const existingCaseRow = sqlite
        .prepare("SELECT * FROM review_cases WHERE check_in_id = ?")
        .get(existingCheckIn.id) as Record<string, unknown> | undefined;

      if (existingCaseRow) {
        const auditRows = sqlite
          .prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY sequence_number ASC")
          .all(existingCaseRow.id as string) as StoredAuditEventRow[];

        return {
          case: rowToDemoCase(existingCaseRow, auditRows),
          isDuplicate: true,
        };
      }
    }
  }

  // Execute pipeline
  const pipelineSubmission: CheckInSubmission = {
    patientId: submission.patientId || "DEMO-001",
    patientName: submission.patientName || "Demo Patient 001",
    programName: submission.program || "Weekly check-in",
    weekStatus: submission.weekStatus,
    followUp: submission.followUp || "no",
    note: submission.note || "",
    idempotencyKey: submission.idempotencyKey,
  };

  const caseId = `case_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const result = await runCheckInPipeline(pipelineSubmission, { caseId });

  const now = new Date().toISOString();
  const checkInId = `chk_${caseId}`;

  // Atomic database transaction
  const insertTransaction = sqlite.transaction(() => {
    // 1. Insert check_in record
    sqlite
      .prepare(
        `INSERT INTO check_ins (
          id, patient_id, program_id, status_selection, follow_up_requested,
          raw_text, structured_answers, idempotency_key, submitted_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        checkInId,
        pipelineSubmission.patientId,
        pipelineSubmission.programName || "Weekly check-in",
        pipelineSubmission.weekStatus,
        pipelineSubmission.followUp === "yes" ? 1 : 0,
        pipelineSubmission.note || "",
        JSON.stringify({
          patientId: pipelineSubmission.patientId,
          weekStatus: pipelineSubmission.weekStatus,
          followUp: pipelineSubmission.followUp,
        }),
        submission.idempotencyKey || null,
        now,
        now
      );

    // Map CaseStatus to UI ReviewStatus
    let uiStatus: ReviewStatus = "needs_review";
    if (result.status === "DRAFT_READY") {
      uiStatus = "draft_ready";
    } else if (result.status === "PROCESSING_FAILED") {
      uiStatus = "processing_failed";
    }

    const initials =
      "initials" in submission && submission.initials
        ? submission.initials
        : (pipelineSubmission.patientName || "P1").slice(0, 2).toUpperCase();

    // 2. Insert review_case record
    sqlite
      .prepare(
        `INSERT INTO review_cases (
          id, check_in_id, patient_id, patient_name, initials, program,
          week_status, follow_up, note, status, route, reason, reason_code,
          summary, original_draft, draft, priority, scenario_tag,
          redacted_preview, extracted_facts, fired_rules, rule_version,
          workflow_version, latency_ms, submitted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        caseId,
        checkInId,
        pipelineSubmission.patientId,
        pipelineSubmission.patientName || "Demo Patient 001",
        initials,
        pipelineSubmission.programName || "Weekly check-in",
        pipelineSubmission.weekStatus,
        pipelineSubmission.followUp || "no",
        pipelineSubmission.note || "",
        uiStatus,
        result.route,
        result.reason,
        result.reasonCode,
        `${pipelineSubmission.patientName || "Patient"} submitted check-in.`,
        result.draft,
        result.draft,
        result.route === "HUMAN_REVIEW_REQUIRED" && result.reasonCode.includes("URGENT") ? "URGENT" : "STANDARD",
        "Submitted check-in",
        result.redactedPreview || null,
        JSON.stringify(result.extractedFacts),
        JSON.stringify(result.firedRules || []),
        "rules v1.2-demo",
        "workflow 0.1.0",
        result.trace.totalDurationMs,
        now,
        now,
        now
      );

    // 2.1 Insert case_execution_runs record for deterministic replay
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO case_execution_runs (
          case_id, spec_hash, spec_version, prompt_version, model_id, model_tier,
          raw_input, redacted_inputs, extracted_facts, fired_rules, route,
          reason_code, draft, trace, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        caseId,
        defaultWorkflowSpec.content_hash,
        defaultWorkflowSpec.spec_version,
        "extract_v1",
        "mock-small-v1",
        "small",
        JSON.stringify(pipelineSubmission),
        JSON.stringify({
          patientId: pipelineSubmission.patientId,
          redactedText: result.redactedPreview || "",
          tokenMap: result.tokenMap || {},
        }),
        JSON.stringify(result.extractedFacts || []),
        JSON.stringify(result.firedRules || []),
        result.route,
        result.reasonCode,
        result.draft,
        JSON.stringify(result.trace),
        now
      );

    // 3. Insert draft_message if drafted
    if (result.draft) {
      sqlite
        .prepare(
          `INSERT INTO draft_messages (
            id, case_id, content, original_content, status, prompt_version, model_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(`draft_${caseId}`, caseId, result.draft, result.draft, "PROPOSED", "draft_v1", "mock-small-v1", now);
    }

    // 4. Append chained audit events
    appendChainedAuditEvent(sqlite, {
      entityType: "ReviewCase",
      entityId: caseId,
      actor: "WORKFLOW",
      action: "Check-in received",
      detail: `Check-in received with route ${result.route}. Free text was redacted.`,
      at: now,
      metadata: { route: result.route, reasonCode: result.reasonCode },
    });

    if (result.draft) {
      appendChainedAuditEvent(sqlite, {
        entityType: "ReviewCase",
        entityId: caseId,
        actor: "WORKFLOW",
        action: "Draft prepared",
        detail: "Neutral acknowledgment draft synthesized for staff review.",
        at: now,
        metadata: { modelId: "mock-small-v1" },
      });
    }
  });

  try {
    insertTransaction();
  } catch (err: unknown) {
    if (submission.idempotencyKey && String(err).includes("UNIQUE constraint failed")) {
      const existingCheckIn = sqlite
        .prepare("SELECT id FROM check_ins WHERE idempotency_key = ?")
        .get(submission.idempotencyKey) as { id: string } | undefined;

      if (existingCheckIn) {
        const existingCaseRow = sqlite
          .prepare("SELECT * FROM review_cases WHERE check_in_id = ?")
          .get(existingCheckIn.id) as Record<string, unknown> | undefined;

        if (existingCaseRow) {
          const auditRows = sqlite
            .prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY sequence_number ASC")
            .all(existingCaseRow.id as string) as StoredAuditEventRow[];

          return {
            case: rowToDemoCase(existingCaseRow, auditRows),
            isDuplicate: true,
          };
        }
      }
    }
    throw err;
  }

  const savedRow = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(caseId) as Record<string, unknown>;
  const auditRows = sqlite
    .prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY sequence_number ASC")
    .all(caseId) as StoredAuditEventRow[];

  return {
    case: rowToDemoCase(savedRow, auditRows),
    isDuplicate: false,
  };
}

/**
 * Lists review cases from SQLite database.
 */
export function listReviewCasesFromDb(filter: CaseFilter = {}, sqlite: Database.Database = getSqlite()): DemoCase[] {
  let query = "SELECT * FROM review_cases WHERE 1=1";
  const params: unknown[] = [];

  if (filter.status && filter.status !== "all") {
    query += " AND status = ?";
    params.push(filter.status);
  }

  if (filter.query && filter.query.trim().length > 0) {
    const q = `%${filter.query.trim()}%`;
    query += " AND (patient_name LIKE ? OR patient_id LIKE ? OR id LIKE ? OR note LIKE ? OR reason LIKE ? OR reason_code LIKE ?)";
    params.push(q, q, q, q, q, q);
  }

  switch (filter.sort) {
    case "oldest":
      query += " ORDER BY submitted_at ASC";
      break;
    case "latency_asc":
      query += " ORDER BY latency_ms ASC";
      break;
    case "latency_desc":
      query += " ORDER BY latency_ms DESC";
      break;
    case "newest":
    default:
      query += " ORDER BY submitted_at DESC";
      break;
  }

  const rows = sqlite.prepare(query).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const auditRows = sqlite
      .prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY sequence_number ASC")
      .all(row.id as string) as StoredAuditEventRow[];
    return rowToDemoCase(row, auditRows);
  });
}

/**
 * Gets a review case by ID from SQLite.
 */
export function getCaseByIdFromDb(id: string, sqlite: Database.Database = getSqlite()): DemoCase | undefined {
  const row = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const auditRows = sqlite
    .prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY sequence_number ASC")
    .all(id) as StoredAuditEventRow[];

  return rowToDemoCase(row, auditRows);
}

/**
 * Updates draft content of a case in SQLite.
 */
export function editCaseDraftInDb(
  id: string,
  newDraft: string,
  sqlite: Database.Database = getSqlite()
): DemoCase | undefined {
  const row = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const now = new Date().toISOString();
  const originalDraft = (row.original_draft as string) ?? (row.draft as string) ?? "";
  sqlite
    .prepare("UPDATE review_cases SET draft = ?, original_draft = ?, updated_at = ? WHERE id = ?")
    .run(newDraft, originalDraft, now, id);

  appendChainedAuditEvent(sqlite, {
    entityType: "ReviewCase",
    entityId: id,
    actor: "DEMO_REVIEWER",
    action: "Draft edited",
    detail: "Staff reviewer edited candidate draft before approval. Nothing was sent.",
    at: now,
  });

  return getCaseByIdFromDb(id, sqlite);
}

/**
 * Inserts a structured FeedbackLabel into SQLite.
 */
export function insertFeedbackLabelInDb(
  labelInput: Omit<FeedbackLabel, "id" | "createdAt"> & { id?: string; createdAt?: string },
  sqlite: Database.Database = getSqlite()
): FeedbackLabel {
  const id = labelInput.id || `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = labelInput.createdAt || new Date().toISOString();
  const label: FeedbackLabel = {
    ...labelInput,
    id,
    createdAt,
  };

  sqlite
    .prepare(
      `INSERT INTO feedback_labels (
        id, case_id, patient_id, action, reviewer_id, created_at,
        prompt_version, rule_version, edit_distance, diff, rejection_reason,
        route_override, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      label.id,
      label.caseId,
      label.patientId || "DEMO-001",
      label.action,
      label.reviewerId,
      label.createdAt,
      label.promptVersion,
      label.ruleVersion,
      label.editDistance ?? null,
      label.diff ? JSON.stringify(label.diff) : null,
      label.rejectionReason ?? null,
      label.routeOverride ? JSON.stringify(label.routeOverride) : null,
      JSON.stringify(label)
    );

  return label;
}

/**
 * Approves a case in SQLite.
 * Writes a FeedbackLabel (draft_accepted_unchanged or draft_edited with editDistance and diff).
 */
export function approveCaseInDb(id: string, sqlite: Database.Database = getSqlite()): DemoCase | undefined {
  const row = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const origDraft = ((row.original_draft as string) ?? (row.draft as string) ?? "").trim();
  const currentDraft = ((row.draft as string) ?? "").trim();
  const editDistance = computeLevenshteinDistance(origDraft, currentDraft);
  const isEdited = editDistance > 0 && Boolean(origDraft);
  const actionType = isEdited ? "draft_edited" : "draft_accepted_unchanged";
  const diff = isEdited ? computeDraftDiff(origDraft, currentDraft) : [{ type: "unchanged" as const, text: currentDraft }];

  let extractedFacts = [];
  if (row.extracted_facts) {
    try {
      extractedFacts = JSON.parse(row.extracted_facts as string);
    } catch {
      extractedFacts = [];
    }
  }

  // Record FeedbackLabel
  insertFeedbackLabelInDb(
    {
      caseId: id,
      patientId: (row.patient_id as string) || "DEMO-001",
      action: actionType,
      reviewerId: "demo-staff-reviewer",
      promptVersion: (row.workflow_version as string) || "draft_v1",
      ruleVersion: (row.rule_version as string) || "rules_v1.0",
      editDistance,
      diff,
      originalDraft: origDraft,
      finalDraft: currentDraft,
      inputRedacted: (row.redacted_preview as string) || (row.note as string) || "",
      extraction: extractedFacts,
      draft: currentDraft,
      reviewerOutcome: {
        action: actionType,
        status: "approved",
        editDistance,
        simulated: true,
      },
    },
    sqlite
  );

  const now = new Date().toISOString();
  sqlite
    .prepare("UPDATE review_cases SET status = 'approved', updated_at = ? WHERE id = ?")
    .run(now, id);

  appendChainedAuditEvent(sqlite, {
    entityType: "ReviewCase",
    entityId: id,
    actor: "DEMO_REVIEWER",
    action: "Approved · simulated",
    detail: `Reviewer approved draft (${isEdited ? `edited, dist=${editDistance}` : "accepted unchanged"}). Simulated state only; nothing was sent.`,
    at: now,
    metadata: { action: actionType, editDistance },
  });

  return getCaseByIdFromDb(id, sqlite);
}

/**
 * Rejects a case in SQLite with fixed taxonomy reason.
 * Writes a FeedbackLabel (rejected).
 */
export function rejectCaseInDb(
  id: string,
  reason: string,
  reasonCode?: RejectionReasonCode,
  sqlite: Database.Database = getSqlite()
): DemoCase | undefined {
  const row = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const validatedReasonCode: RejectionReasonCode = reasonCode || "other";
  const cleanReason = reason.trim() || `Rejected: ${validatedReasonCode}`;

  let extractedFacts = [];
  if (row.extracted_facts) {
    try {
      extractedFacts = JSON.parse(row.extracted_facts as string);
    } catch {
      extractedFacts = [];
    }
  }

  // Record FeedbackLabel
  insertFeedbackLabelInDb(
    {
      caseId: id,
      patientId: (row.patient_id as string) || "DEMO-001",
      action: "rejected",
      reviewerId: "demo-staff-reviewer",
      promptVersion: (row.workflow_version as string) || "draft_v1",
      ruleVersion: (row.rule_version as string) || "rules_v1.0",
      rejectionReason: validatedReasonCode,
      rejectionNotes: cleanReason,
      inputRedacted: (row.redacted_preview as string) || (row.note as string) || "",
      extraction: extractedFacts,
      draft: (row.draft as string) || null,
      reviewerOutcome: {
        action: "rejected",
        status: "rejected",
        rejectionReason: validatedReasonCode,
        rejectionNotes: cleanReason,
        simulated: true,
      },
    },
    sqlite
  );

  const now = new Date().toISOString();
  sqlite
    .prepare("UPDATE review_cases SET status = 'rejected', reason = ?, reason_code = ?, updated_at = ? WHERE id = ?")
    .run(cleanReason, validatedReasonCode, now, id);

  appendChainedAuditEvent(sqlite, {
    entityType: "ReviewCase",
    entityId: id,
    actor: "DEMO_REVIEWER",
    action: "Rejected · simulated",
    detail: `Reviewer rejected case. Reason code: ${validatedReasonCode}. Nothing was sent.`,
    at: now,
    metadata: { reasonCode: validatedReasonCode },
  });

  return getCaseByIdFromDb(id, sqlite);
}

/**
 * Overrides the route of a case in SQLite.
 * Writes a FeedbackLabel (route_override).
 */
export function overrideCaseRouteInDb(
  id: string,
  suggestedRoute: RouteDecision,
  reason?: string,
  sqlite: Database.Database = getSqlite()
): DemoCase | undefined {
  const row = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const originalRoute = row.route as RouteDecision;
  const cleanReason = reason?.trim() || "Reviewer indicated route was inaccurate.";

  let extractedFacts = [];
  if (row.extracted_facts) {
    try {
      extractedFacts = JSON.parse(row.extracted_facts as string);
    } catch {
      extractedFacts = [];
    }
  }

  // Record FeedbackLabel
  insertFeedbackLabelInDb(
    {
      caseId: id,
      patientId: (row.patient_id as string) || "DEMO-001",
      action: "route_override",
      reviewerId: "demo-staff-reviewer",
      promptVersion: (row.workflow_version as string) || "draft_v1",
      ruleVersion: (row.rule_version as string) || "rules_v1.0",
      routeOverride: {
        originalRoute,
        suggestedRoute,
        reason: cleanReason,
      },
      inputRedacted: (row.redacted_preview as string) || (row.note as string) || "",
      extraction: extractedFacts,
      draft: (row.draft as string) || null,
      reviewerOutcome: {
        action: "route_override",
        status: row.status as ReviewStatus,
        routeOverride: {
          originalRoute,
          suggestedRoute,
          reason: cleanReason,
        },
        simulated: true,
      },
    },
    sqlite
  );

  const now = new Date().toISOString();
  sqlite
    .prepare("UPDATE review_cases SET route = ?, updated_at = ? WHERE id = ?")
    .run(suggestedRoute, now, id);

  appendChainedAuditEvent(sqlite, {
    entityType: "ReviewCase",
    entityId: id,
    actor: "DEMO_REVIEWER",
    action: "Route override · simulated",
    detail: `Reviewer indicated route was inaccurate and overrode from ${originalRoute} to ${suggestedRoute}. Nothing was sent.`,
    at: now,
    metadata: { originalRoute, newRoute: suggestedRoute, reason: cleanReason },
  });

  return getCaseByIdFromDb(id, sqlite);
}

/**
 * Returns a case to the triage queue.
 */
export function returnCaseToQueueInDb(id: string, sqlite: Database.Database = getSqlite()): DemoCase | undefined {
  const row = sqlite.prepare("SELECT * FROM review_cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const now = new Date().toISOString();
  sqlite
    .prepare("UPDATE review_cases SET status = 'needs_review', updated_at = ? WHERE id = ?")
    .run(now, id);

  appendChainedAuditEvent(sqlite, {
    entityType: "ReviewCase",
    entityId: id,
    actor: "DEMO_REVIEWER",
    action: "Returned to queue",
    detail: "Case returned to active review queue for subsequent triage.",
    at: now,
  });

  return getCaseByIdFromDb(id, sqlite);
}

/**
 * Lists feedback labels from SQLite.
 */
export function listFeedbackLabelsFromDb(sqlite: Database.Database = getSqlite()): FeedbackLabel[] {
  const rows = sqlite
    .prepare("SELECT * FROM feedback_labels ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];

  return rows.map((r) => {
    if (r.payload) {
      try {
        return JSON.parse(r.payload as string) as FeedbackLabel;
      } catch {
        // Fallback
      }
    }
    const action = r.action as FeedbackLabel["action"];
    const routeOverride = r.route_override ? JSON.parse(r.route_override as string) : undefined;
    const rejectionReason = r.rejection_reason as FeedbackLabel["rejectionReason"];
    return {
      id: r.id as string,
      caseId: r.case_id as string,
      patientId: (r.patient_id as string) || "DEMO-001",
      action,
      reviewerId: r.reviewer_id as string,
      createdAt: r.created_at as string,
      promptVersion: r.prompt_version as string,
      ruleVersion: r.rule_version as string,
      editDistance: (r.edit_distance as number) ?? undefined,
      diff: r.diff ? JSON.parse(r.diff as string) : undefined,
      rejectionReason,
      routeOverride,
      inputRedacted: "",
      reviewerOutcome: {
        action,
        status: action === "rejected" ? "rejected" : "approved",
        editDistance: (r.edit_distance as number) ?? undefined,
        rejectionReason,
        routeOverride,
        simulated: true,
      },
    } as FeedbackLabel;
  });
}

/**
 * Computes Quality Signals dynamically from stored SQLite records.
 */
export function computeQualitySignalsFromDb(sqlite: Database.Database = getSqlite()): QualitySignalsMetrics {
  const labels = listFeedbackLabelsFromDb(sqlite);
  return computeQualitySignals(labels);
}

/**
 * Runs evaluation with idempotency key protection.
 */
export async function runEvaluationWithIdempotency(
  options: { idempotencyKey?: string } = {},
  sqlite: Database.Database = getSqlite()
): Promise<EvaluationRun> {
  if (options.idempotencyKey) {
    const existing = sqlite
      .prepare("SELECT * FROM evaluation_runs WHERE idempotency_key = ?")
      .get(options.idempotencyKey) as Record<string, unknown> | undefined;

    if (existing) {
      return {
        id: existing.id as string,
        specVersion: existing.spec_version as string,
        fixtureVersion: existing.fixture_version as string,
        ruleVersion: existing.rule_version as string,
        totalCases: existing.total_cases as number,
        passedCases: existing.passed_cases as number,
        criticalMisses: existing.critical_misses as number,
        routeAccuracy: existing.route_accuracy as number,
        safetyGate: existing.safety_gate as "PASS" | "FAIL",
        latencyP50Ms: existing.latency_p50_ms as number,
        latencyP95Ms: existing.latency_p95_ms as number,
        executedAt: existing.executed_at as string,
      };
    }
  }

  const runResult = await executeEvaluation(FIXTURES_V1, defaultWorkflowSpec);
  const metrics = runResult.metrics;
  const runId = `eval_${Date.now()}`;
  const now = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT INTO evaluation_runs (
        id, idempotency_key, spec_version, fixture_version, rule_version,
        total_cases, passed_cases, critical_misses, route_accuracy,
        safety_gate, latency_p50_ms, latency_p95_ms, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      runId,
      options.idempotencyKey || null,
      runResult.policyVersion || "1.0.0",
      "v1.0.0",
      "1.0.0",
      metrics.total,
      metrics.passed,
      metrics.criticalMisses,
      metrics.routeAccuracy.percentage,
      metrics.safetyGate === "PASS" ? "PASS" : "FAIL",
      metrics.latencyP50Ms,
      metrics.latencyP95Ms,
      now
    );

  appendChainedAuditEvent(sqlite, {
    entityType: "System",
    entityId: runId,
    actor: "SYSTEM",
    action: "Evaluation executed",
    detail: `Evaluation executed over ${metrics.total} fixtures. Safety gate: ${metrics.safetyGate}.`,
    at: now,
    metadata: { accuracy: metrics.routeAccuracy.percentage, safetyGate: metrics.safetyGate },
  });

  return {
    id: runId,
    specVersion: runResult.policyVersion || "1.0.0",
    fixtureVersion: "v1.0.0",
    ruleVersion: "1.0.0",
    totalCases: metrics.total,
    passedCases: metrics.passed,
    criticalMisses: metrics.criticalMisses,
    routeAccuracy: metrics.routeAccuracy.percentage,
    safetyGate: metrics.safetyGate === "PASS" ? "PASS" : "FAIL",
    latencyP50Ms: metrics.latencyP50Ms,
    latencyP95Ms: metrics.latencyP95Ms,
    executedAt: now,
  };
}

/**
 * Runs a shadow run with idempotency protection.
 */
export function runShadowRunWithIdempotency(
  params: {
    caseId: string;
    candidateSpecVersion?: string;
    idempotencyKey?: string;
  },
  sqlite: Database.Database = getSqlite()
): ShadowRun {
  if (params.idempotencyKey) {
    const existing = sqlite
      .prepare("SELECT * FROM shadow_runs WHERE idempotency_key = ?")
      .get(params.idempotencyKey) as Record<string, unknown> | undefined;

    if (existing) {
      return {
        id: existing.id as string,
        caseId: existing.case_id as string,
        baselineSpecVersion: existing.baseline_spec_version as string,
        candidateSpecVersion: existing.candidate_spec_version as string,
        baselineRoute: existing.baseline_route as RouteDecision,
        candidateRoute: existing.candidate_route as RouteDecision,
        routeMatches: Boolean(existing.route_matches),
        baselineDraft: (existing.baseline_draft as string) || undefined,
        candidateDraft: (existing.candidate_draft as string) || undefined,
        draftSimilarity: (existing.draft_similarity as number) || undefined,
        candidateLatencyMs: existing.candidate_latency_ms as number,
        executedAt: existing.executed_at as string,
      };
    }
  }

  const caseRow = sqlite
    .prepare("SELECT * FROM review_cases WHERE id = ?")
    .get(params.caseId) as Record<string, unknown> | undefined;

  const baselineRoute = (caseRow?.route as RouteDecision) || "HUMAN_REVIEW_REQUIRED";
  const baselineDraft = (caseRow?.draft as string) || undefined;
  const start = performance.now();

  const candidateSpec = defaultWorkflowSpec;
  const submissionData = caseRow
    ? {
        patientId: caseRow.patient_id as string,
        weekStatus: caseRow.week_status as string,
        followUp: caseRow.follow_up as string,
        note: (caseRow.note as string) || "",
      }
    : { patientId: "DEMO-001", weekStatus: "On track", followUp: "no", note: "" };

  const evalResult = evaluatePolicy(submissionData, candidateSpec);
  const latencyMs = Number((performance.now() - start).toFixed(4));
  const candidateRoute = evalResult.route;
  const routeMatches = baselineRoute === candidateRoute;

  const runId = `shadow_${Date.now()}`;
  const now = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT INTO shadow_runs (
        id, idempotency_key, case_id, baseline_spec_version, candidate_spec_version,
        baseline_route, candidate_route, route_matches, baseline_draft, candidate_draft,
        draft_similarity, candidate_latency_ms, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      runId,
      params.idempotencyKey || null,
      params.caseId,
      "1.0.0",
      params.candidateSpecVersion || "1.0.0-candidate",
      baselineRoute,
      candidateRoute,
      routeMatches ? 1 : 0,
      baselineDraft || null,
      baselineDraft || null,
      routeMatches ? 1.0 : 0.8,
      latencyMs,
      now
    );

  appendChainedAuditEvent(sqlite, {
    entityType: "ReviewCase",
    entityId: params.caseId,
    actor: "SYSTEM",
    action: "Shadow run executed",
    detail: `Shadow comparison completed. Route matches baseline: ${routeMatches}.`,
    at: now,
    metadata: { routeMatches, baselineRoute, candidateRoute },
  });

  return {
    id: runId,
    caseId: params.caseId,
    baselineSpecVersion: "1.0.0",
    candidateSpecVersion: params.candidateSpecVersion || "1.0.0-candidate",
    baselineRoute,
    candidateRoute,
    routeMatches,
    baselineDraft,
    candidateDraft: baselineDraft,
    draftSimilarity: routeMatches ? 1.0 : 0.8,
    candidateLatencyMs: latencyMs,
    executedAt: now,
  };
}

/**
 * Seeds the database idempotently with default demo cases and feedback labels.
 * If data already exists, performs no work and does not duplicate records.
 */
export function seedDatabase(sqlite: Database.Database = getSqlite()): {
  casesSeeded: number;
  feedbackSeeded: number;
} {
  const caseCount = (
    sqlite.prepare("SELECT COUNT(*) as count FROM review_cases").get() as { count: number }
  ).count;

  if (caseCount > 0) {
    return {
      casesSeeded: caseCount,
      feedbackSeeded: (
        sqlite.prepare("SELECT COUNT(*) as count FROM feedback_labels").get() as { count: number }
      ).count,
    };
  }

  const seedTx = sqlite.transaction(() => {
    // 1. Seed review cases
    for (const c of seedCases) {
      const checkInId = `chk_${c.id}`;
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO check_ins (
            id, patient_id, program_id, status_selection, follow_up_requested,
            raw_text, structured_answers, submitted_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          checkInId,
          c.patientId,
          c.program,
          c.weekStatus,
          c.followUp === "yes" ? 1 : 0,
          c.note || "",
          JSON.stringify({ patientId: c.patientId, weekStatus: c.weekStatus }),
          c.submittedAt,
          c.submittedAt
        );

      const priority =
        c.reasonCode?.includes("URGENT") || c.reason?.toLowerCase().includes("urgent")
          ? "URGENT"
          : "STANDARD";

      sqlite
        .prepare(
          `INSERT OR IGNORE INTO review_cases (
            id, check_in_id, patient_id, patient_name, initials, program,
            week_status, follow_up, note, status, route, reason, reason_code,
            summary, original_draft, draft, priority, scenario_tag,
            redacted_preview, extracted_facts, fired_rules, rule_version,
            workflow_version, latency_ms, submitted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          c.id,
          checkInId,
          c.patientId,
          c.patientName,
          c.initials,
          c.program,
          c.weekStatus,
          c.followUp,
          c.note || "",
          c.status,
          c.route,
          c.reason,
          c.reasonCode || null,
          c.summary || null,
          c.originalDraft || null,
          c.draft || null,
          priority,
          c.scenarioTag || null,
          c.redactedPreview || null,
          JSON.stringify(c.extractedFacts || []),
          JSON.stringify(c.firedRules || []),
          c.ruleVersion,
          c.workflowVersion,
          c.latencyMs || 0.05,
          c.submittedAt,
          c.submittedAt,
          c.submittedAt
        );

      if (c.draft) {
        sqlite
          .prepare(
            `INSERT OR IGNORE INTO draft_messages (
              id, case_id, content, original_content, status, prompt_version, model_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(`draft_${c.id}`, c.id, c.draft, c.draft, "PROPOSED", "draft_v1", "mock-small-v1", c.submittedAt);
      }

      // Append chained audit event
      appendChainedAuditEvent(sqlite, {
        entityType: "ReviewCase",
        entityId: c.id,
        actor: "WORKFLOW",
        action: "Check-in received",
        detail: `Check-in received with route ${c.route}.`,
        at: c.submittedAt,
        metadata: { route: c.route, reasonCode: c.reasonCode },
      });
    }

    // 2. Seed feedback labels
    for (const f of seedFeedbackLabels) {
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO feedback_labels (
            id, case_id, patient_id, action, reviewer_id, created_at,
            prompt_version, rule_version, edit_distance, diff, rejection_reason,
            route_override, payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          f.id,
          f.caseId,
          f.patientId || "DEMO-001",
          f.action,
          f.reviewerId,
          f.createdAt,
          f.promptVersion,
          f.ruleVersion,
          f.editDistance ?? null,
          f.diff ? JSON.stringify(f.diff) : null,
          f.rejectionReason ?? null,
          f.routeOverride ? JSON.stringify(f.routeOverride) : null,
          JSON.stringify(f)
        );
    }
  });

  seedTx();

  return {
    casesSeeded: seedCases.length,
    feedbackSeeded: seedFeedbackLabels.length,
  };
}

/**
 * Resets demo data in SQLite.
 * Local-only confirmed action.
 */
export function resetDemoDataInDb(
  sqlite: Database.Database = getSqlite(),
  options: { confirmed: boolean; isLocal?: boolean }
): { success: boolean; casesReset: number } {
  if (!options.confirmed) {
    throw new Error("Reset demo data action requires explicit confirmed: true parameter.");
  }

  // Wipes tables and resets sequence
  const resetTx = sqlite.transaction(() => {
    sqlite.exec(`
      DELETE FROM check_ins;
      DELETE FROM review_cases;
      DELETE FROM draft_messages;
      DELETE FROM audit_events;
      DELETE FROM agent_runs;
      DELETE FROM evaluation_runs;
      DELETE FROM shadow_runs;
      DELETE FROM feedback_labels;
    `);
  });

  resetTx();

  // Re-seed default cases and rebuild intact audit chain from sequence 1
  const seeded = seedDatabase(sqlite);

  return {
    success: true,
    casesReset: seeded.casesSeeded,
  };
}


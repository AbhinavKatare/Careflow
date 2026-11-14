/**
 * Step 7: Persist Pipeline State.
 * Persists ReviewCase, DraftMessage, and AgentRun records.
 * PERMANENT RULE: Any step failure yields PROCESSING_FAILED with a visible reason, never a success-looking state.
 */

import { CaseStatus } from "../../shared/domain/state-machine";
import {
  AgentRun,
  AgentRunSchema,
  DraftMessage,
  DraftMessageSchema,
  ReviewCase,
  ReviewCaseSchema,
} from "../../shared/domain/types";
import { PolicyRoute } from "../../shared/policy/types";
import { CheckInSubmission } from "./types";

class CaseStore {
  private cases: Map<string, ReviewCase> = new Map();
  private drafts: Map<string, DraftMessage> = new Map();
  private runs: Map<string, AgentRun> = new Map();

  public saveCase(reviewCase: ReviewCase): ReviewCase {
    const validated = ReviewCaseSchema.parse(reviewCase);
    this.cases.set(validated.id, validated);
    return validated;
  }

  public getCase(id: string): ReviewCase | undefined {
    return this.cases.get(id);
  }

  public listCases(): ReviewCase[] {
    return Array.from(this.cases.values());
  }

  public saveDraft(draft: DraftMessage): DraftMessage {
    const validated = DraftMessageSchema.parse(draft);
    this.drafts.set(validated.id, validated);
    return validated;
  }

  public getDraftByCase(caseId: string): DraftMessage | undefined {
    return Array.from(this.drafts.values()).find((d) => d.caseId === caseId);
  }

  public saveRun(run: AgentRun): AgentRun {
    const validated = AgentRunSchema.parse(run);
    this.runs.set(validated.id, validated);
    return validated;
  }

  public clear(): void {
    this.cases.clear();
    this.drafts.clear();
    this.runs.clear();
  }
}

export const pipelineCaseStore = new CaseStore();

export function stepPersist(params: {
  caseId: string;
  submission: CheckInSubmission;
  route: PolicyRoute;
  reasonCode: string;
  reason: string;
  status: CaseStatus;
  draft: string | null;
  stepDurations: Record<string, number>;
  totalLatencyMs: number;
  modelId?: string;
  promptVersion?: string;
  ruleVersion?: string;
  errorMessage?: string;
  store?: CaseStore;
}): { reviewCase: ReviewCase; draftMessage?: DraftMessage; agentRun: AgentRun } {
  const {
    caseId,
    submission,
    reasonCode,
    reason,
    status,
    draft,
    stepDurations,
    totalLatencyMs,
    modelId = "mock-small-v1",
    promptVersion = "extract_v1",
    ruleVersion = "1.0.0",
    errorMessage,
    store = pipelineCaseStore,
  } = params;

  const now = new Date().toISOString();

  // 1. Build & validate ReviewCase
  const safeReasonCode = reasonCode || "UNKNOWN_REASON";
  const safePatientId = (submission.patientId && submission.patientId.trim().length > 0)
    ? submission.patientId
    : "DEMO-UNKNOWN";

  const reviewCase: ReviewCase = {
    id: caseId,
    checkInId: `chk_${caseId}`,
    patientId: safePatientId,
    status,
    priority: status === "PROCESSING_FAILED" || safeReasonCode.includes("URGENT") ? "URGENT" : "STANDARD",
    routingReason: errorMessage ? `Processing failed: ${errorMessage}` : reason,
    reasonCode: errorMessage ? "PROCESSING_FAILURE" : safeReasonCode,
    specVersion: "1.0.0",
    ruleVersion,
    workflowVersion: "0.1.0",
    createdAt: now,
    updatedAt: now,
  };
  const savedCase = store.saveCase(reviewCase);

  // 2. Build & validate DraftMessage if present
  let savedDraft: DraftMessage | undefined;
  if (draft) {
    const draftMessage: DraftMessage = {
      id: `draft_${caseId}`,
      caseId,
      content: draft,
      originalContent: draft,
      status: "PROPOSED",
      promptVersion: "draft_v1",
      modelId,
      createdAt: now,
    };
    savedDraft = store.saveDraft(draftMessage);
  }

  // 3. Build & validate AgentRun
  const agentRun: AgentRun = {
    id: `run_${caseId}`,
    runType: draft ? "DRAFT_SYNTHESIS" : "TRIAGE_POLICY",
    status: status === "PROCESSING_FAILED" ? "FAILED" : "SUCCESS",
    modelId,
    promptVersion,
    ruleVersion,
    latencyMs: totalLatencyMs,
    schemaValid: status !== "PROCESSING_FAILED",
    startedAt: now,
    completedAt: now,
    errorMessage: errorMessage || null,
    metadata: {
      stepDurations,
      hasDraft: Boolean(draft),
    },
  };
  const savedRun = store.saveRun(agentRun);

  return { reviewCase: savedCase, draftMessage: savedDraft, agentRun: savedRun };
}


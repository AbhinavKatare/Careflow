import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "./db";
import {
  getCaseExecutionRecord,
  recordCaseExecution,
  replayCase,
  runBulkReplay,
} from "./replay";
import {
  weeklyCheckInSpec,
  unsafeProposalSpec,
} from "./compiler/canned-proposals";
import { runCheckInPipeline } from "./pipeline/runner";
import type { CheckInSubmission } from "./pipeline/types";
import type { ExecutionRunRecord } from "./replay/types";

describe("Deterministic Case Replay & Bulk Replay (/server/replay)", () => {
  let db: Database.Database;
  const testCaseId = "case_replay_test_001";

  beforeEach(async () => {
    db = new Database(":memory:");
    initDatabase(db);

    // Seed a standard baseline case execution
    const rawInput: CheckInSubmission = {
      patientId: "DEMO-001",
      patientName: "Demo Patient 001",
      programName: "Weekly check-in",
      weekStatus: "On track with my weekly routine",
      followUp: "no",
      note: "",
    };

    const runResult = await runCheckInPipeline(rawInput, {
      spec: weeklyCheckInSpec,
      caseId: testCaseId,
    });

    const record: ExecutionRunRecord = {
      caseId: testCaseId,
      specHash: weeklyCheckInSpec.content_hash,
      specVersion: weeklyCheckInSpec.spec_version,
      promptVersion: "extract_v1",
      modelId: "mock-small-v1",
      modelTier: "small",
      rawInput,
      redactedInputs: {
        patientId: rawInput.patientId,
        redactedText: runResult.redactedPreview || "",
        tokenMap: runResult.tokenMap || {},
      },
      extractedFacts: runResult.extractedFacts,
      firedRules: (runResult.firedRules as any) || [],
      route: runResult.route,
      reasonCode: runResult.reasonCode,
      draft: runResult.draft,
      trace: runResult.trace,
      createdAt: new Date().toISOString(),
    };

    recordCaseExecution(record, db);
  });

  it("retrieves stored execution run metadata", () => {
    const record = getCaseExecutionRecord(testCaseId, db);
    expect(record).toBeDefined();
    expect(record?.caseId).toBe(testCaseId);
    expect(record?.specHash).toBe(weeklyCheckInSpec.content_hash);
    expect(record?.route).toBe("DRAFT_FOR_REVIEW");
    expect(record?.draft).toContain("Demo Patient 001");
  });

  it("DETERMINISM: Replaying a case under the same versions reproduces the exact same route and draft", async () => {
    // Replay case under exact same spec version and model tier
    const replay = await replayCase(
      testCaseId,
      {
        targetSpec: weeklyCheckInSpec,
        targetModelTier: "small",
        targetPromptVersion: "extract_v1",
      },
      db
    );

    // Route and draft must be identical!
    expect(replay.candidate.route).toBe(replay.baseline.route);
    expect(replay.candidate.draft).toBe(replay.baseline.draft);
    expect(replay.candidate.reasonCode).toBe(replay.baseline.reasonCode);
    expect(replay.diff.routeChanged).toBe(false);
    expect(replay.diff.draftChanged).toBe(false);
    expect(replay.diff.severityChange).toBe("UNCHANGED");
    expect(replay.diff.isSeverityLowering).toBe(false);

    // Trace waterfall has matching step spans
    expect(replay.traceWaterfall.baselineSpans.length).toBeGreaterThanOrEqual(4);
    expect(replay.traceWaterfall.candidateSpans.length).toBeGreaterThanOrEqual(4);
  });

  it("replaying a case under a modified spec captures step-by-step diff and route changes", async () => {
    // Seed an escalated case where patient had acute chest pain (HUMAN_REVIEW_REQUIRED)
    const distressCaseId = "case_distress_002";
    const distressInput: CheckInSubmission = {
      patientId: "DEMO-002",
      patientName: "Demo Patient Distress",
      programName: "Weekly check-in",
      weekStatus: "On track with my weekly routine",
      followUp: "no",
      note: "I had severe chest pain and shortness of breath this morning.",
    };

    const runResult = await runCheckInPipeline(distressInput, {
      spec: weeklyCheckInSpec,
      caseId: distressCaseId,
    });

    const record: ExecutionRunRecord = {
      caseId: distressCaseId,
      specHash: weeklyCheckInSpec.content_hash,
      specVersion: weeklyCheckInSpec.spec_version,
      promptVersion: "extract_v1",
      modelId: "mock-small-v1",
      modelTier: "small",
      rawInput: distressInput,
      redactedInputs: {
        patientId: distressInput.patientId,
        redactedText: runResult.redactedPreview || "",
        tokenMap: runResult.tokenMap || {},
      },
      extractedFacts: runResult.extractedFacts,
      firedRules: (runResult.firedRules as any) || [],
      route: runResult.route, // HUMAN_REVIEW_REQUIRED
      reasonCode: runResult.reasonCode,
      draft: runResult.draft,
      trace: runResult.trace,
      createdAt: new Date().toISOString(),
    };

    recordCaseExecution(record, db);

    // Replay distress case under unsafeProposalSpec (which down-routes chest pain to draft!)
    const replay = await replayCase(
      distressCaseId,
      { targetSpec: unsafeProposalSpec },
      db
    );

    // Baseline was HUMAN_REVIEW_REQUIRED, candidate down-routed to DRAFT_FOR_REVIEW
    expect(replay.baseline.route).toBe("HUMAN_REVIEW_REQUIRED");
    expect(replay.candidate.route).toBe("DRAFT_FOR_REVIEW");

    // Must be flagged as SEVERITY_LOWERED
    expect(replay.diff.routeChanged).toBe(true);
    expect(replay.diff.severityChange).toBe("SEVERITY_LOWERED");
    expect(replay.diff.isSeverityLowering).toBe(true);

    // Rules fired changed
    expect(replay.diff.rulesFiredChanged).toBe(true);
  });

  it("BULK REPLAY: What would v2 have done to historical cases report highlights severity-lowering changes", async () => {
    // Seed 3 cases:
    // 1. Routine case
    // 2. Distress case
    // 3. Question case
    const caseIds = [testCaseId];

    for (let i = 1; i <= 3; i++) {
      const cId = `case_bulk_${i}`;
      const note = i === 1 ? "severe chest pain" : i === 2 ? "question for doctor" : "";
      const status = i === 2 ? "I have a question for the care team" : "On track with my weekly routine";

      const sub: CheckInSubmission = {
        patientId: `DEMO-B${i}`,
        patientName: `Demo Patient Bulk ${i}`,
        programName: "Weekly check-in",
        weekStatus: status,
        followUp: "no",
        note,
      };

      const result = await runCheckInPipeline(sub, {
        spec: weeklyCheckInSpec,
        caseId: cId,
      });

      const rec: ExecutionRunRecord = {
        caseId: cId,
        specHash: weeklyCheckInSpec.content_hash,
        specVersion: weeklyCheckInSpec.spec_version,
        promptVersion: "extract_v1",
        modelId: "mock-small-v1",
        modelTier: "small",
        rawInput: sub,
        redactedInputs: {
          patientId: sub.patientId,
          redactedText: result.redactedPreview || "",
          tokenMap: result.tokenMap || {},
        },
        extractedFacts: result.extractedFacts,
        firedRules: (result.firedRules as any) || [],
        route: result.route,
        reasonCode: result.reasonCode,
        draft: result.draft,
        trace: result.trace,
        createdAt: new Date().toISOString(),
      };
      recordCaseExecution(rec, db);
      caseIds.push(cId);
    }

    // Run bulk replay under unsafeProposalSpec
    const bulkReport = await runBulkReplay(
      { candidateSpec: unsafeProposalSpec, caseIds },
      db
    );

    expect(bulkReport.totalCasesReplayed).toBe(caseIds.length);
    expect(bulkReport.candidateSpecHash).toBe(unsafeProposalSpec.content_hash);

    // The distress case was down-routed -> severity lowered count must be > 0!
    expect(bulkReport.severityLoweredCount).toBeGreaterThan(0);

    // Verify the severity-lowering case has critical warning
    const severityLoweredCase = bulkReport.routeChanges.find((c) => c.isSeverityLowering);
    expect(severityLoweredCase).toBeDefined();
    expect(severityLoweredCase?.changeType).toBe("SEVERITY_LOWERED");
    expect(severityLoweredCase?.warning).toBeDefined();
    expect(severityLoweredCase?.warning).toContain("CRITICAL WARNING");
    expect(severityLoweredCase?.warning).toContain("lowers route severity");
  });
});

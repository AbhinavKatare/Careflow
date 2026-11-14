import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DemoPatientSchema,
  CheckInSchema,
  WorkflowSpecSchema,
  ExtractedFactSchema,
  RoutingResultSchema,
  DraftMessageSchema,
  ReviewCaseSchema,
  ReviewDecisionSchema,
  AuditEventSchema,
  AgentRunSchema,
  EvaluationRunSchema,
  ShadowRunSchema,
  EvidencePackSchema,
  CaseStatusEnum,
  InvalidStateTransitionError,
  validateTransition,
  transitionCaseStatus,
  computeWorkflowSpecHash,
  canonicalizeJson,
  pureSha256,
  type WorkflowSpec,
} from "../shared/domain";

describe("Domain Models & Schemas (/shared/domain)", () => {
  describe("1. Schema Round-Trips for All 13 Domain Entities", () => {
    it("round-trips DemoPatient", () => {
      const data = {
        id: "pat-1",
        patientId: "DEMO-001",
        fullName: "Demo Patient 001",
        initials: "P1",
        clinicId: "clinic-1",
        programId: "prog-1",
        createdAt: new Date().toISOString(),
      };
      const parsed = DemoPatientSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips CheckIn keeping raw text immutable and structured answers intact", () => {
      const data = {
        id: "chk-1",
        patientId: "DEMO-001",
        programId: "prog-weekly",
        statusSelection: "On track with my weekly routine",
        followUpRequested: false,
        submittedAt: new Date().toISOString(),
        rawText: "Doing well this week, no team questions.",
        structuredAnswers: {
          routineAdherence: "on_track",
          waterIntake: "adequate",
          sleepHours: 8,
        },
        idempotencyKey: "idem-abc-123",
      };
      const parsed = CheckInSchema.parse(data);
      expect(parsed).toEqual(data);
      expect(parsed.rawText).toBe("Doing well this week, no team questions.");
    });

    it("round-trips WorkflowSpec with content-hashed JSON", () => {
      const baseSpec = {
        spec_version: "1.0.0",
        parent_version: null,
        questionnaire_fields: [
          {
            id: "week_status",
            label: "Weekly Status",
            type: "select" as const,
            options: ["On track", "Needs help"],
            required: true,
          },
        ],
        rule_list: [
          {
            id: "R1",
            description: "Routine check-in rule",
            condition: "week_status == 'On track'",
            route: "DRAFT_FOR_REVIEW" as const,
            reason_code: "ROUTINE_ON_TRACK",
          },
        ],
        draft_templates: [
          {
            id: "T1",
            trigger_reason: "ROUTINE_ON_TRACK",
            template_text: "Thanks for checking in, [PATIENT_NAME_1].",
          },
        ],
        limits: {
          max_note_length: 1000,
          max_daily_submissions: 3,
          timeout_ms: 5000,
        },
        reviewer_roles: ["DEMO_REVIEWER", "CLINICAL_SUPERVISOR"],
      };

      const hash = computeWorkflowSpecHash(baseSpec);
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);

      const specWithHash: WorkflowSpec = {
        ...baseSpec,
        content_hash: hash,
      };

      const parsed = WorkflowSpecSchema.parse(specWithHash);
      expect(parsed).toEqual(specWithHash);
    });

    it("round-trips ExtractedFact with source span", () => {
      const data = {
        id: "fact-1",
        checkInId: "chk-1",
        category: "Routine Adherence",
        value: "Walking daily",
        sourceSpan: {
          start: 12,
          end: 25,
          text: "Walking daily",
        },
        confidence: 0.98,
      };
      const parsed = ExtractedFactSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips RoutingResult", () => {
      const data = {
        route: "DRAFT_FOR_REVIEW" as const,
        reasonCode: "ROUTINE_ON_TRACK",
        reason: "All structured criteria met without red flags.",
        firedRules: [
          {
            id: "RULE_ROUTINE",
            description: "Adherence is confirmed",
            reason_code: "ROUTINE_ON_TRACK",
          },
        ],
        inputsUsed: {
          statusSelection: "On track",
          followUpRequested: false,
        },
        ruleVersion: "rules_v1.0",
        evaluatedAt: new Date().toISOString(),
      };
      const parsed = RoutingResultSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips DraftMessage", () => {
      const data = {
        id: "draft-1",
        caseId: "case-1",
        content: "Thank you for logging your update.",
        originalContent: "Thank you for logging your update.",
        status: "PROPOSED" as const,
        promptVersion: "draft_v1",
        modelId: "mock-model",
        agentRunId: "run-1",
        createdAt: new Date().toISOString(),
      };
      const parsed = DraftMessageSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips ReviewCase", () => {
      const data = {
        id: "case-1",
        checkInId: "chk-1",
        patientId: "DEMO-001",
        status: CaseStatusEnum.enum.DRAFT_READY,
        priority: "STANDARD" as const,
        routingReason: "Candidate draft ready for human reviewer check.",
        reasonCode: "ROUTINE_ON_TRACK",
        specVersion: "1.0.0",
        specHash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ruleVersion: "rules_v1.0",
        workflowVersion: "workflow_v1.0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const parsed = ReviewCaseSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips ReviewDecision with mandatory simulated true", () => {
      const data = {
        id: "dec-1",
        caseId: "case-1",
        reviewerId: "demo-reviewer",
        decision: "APPROVED_SIMULATED" as const,
        notes: "Approved without changes.",
        rejectionReasonCode: null,
        editDistance: 0,
        simulated: true as const,
        decidedAt: new Date().toISOString(),
      };
      const parsed = ReviewDecisionSchema.parse(data);
      expect(parsed).toEqual(data);
      expect(parsed.simulated).toBe(true);
    });

    it("round-trips AuditEvent", () => {
      const data = {
        id: "evt-1",
        entityType: "ReviewCase",
        entityId: "case-1",
        actor: "DEMO_REVIEWER" as const,
        action: "Case approved",
        detail: "Simulated approval committed. Zero outbound effects.",
        at: new Date().toISOString(),
        metadata: {
          editDistance: 0,
        },
      };
      const parsed = AuditEventSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips AgentRun", () => {
      const data = {
        id: "run-1",
        runType: "EXTRACTION" as const,
        status: "SUCCESS" as const,
        modelId: "mock-llm-v1",
        promptVersion: "extract_v1",
        ruleVersion: "rules_v1.0",
        latencyMs: 14.5,
        inputTokens: 120,
        outputTokens: 45,
        estimatedCost: 0.0003,
        schemaValid: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      const parsed = AgentRunSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips EvaluationRun", () => {
      const data = {
        id: "eval-1",
        specVersion: "1.0.0",
        fixtureVersion: "fixtures_v1",
        ruleVersion: "rules_v1.0",
        totalCases: 18,
        passedCases: 18,
        criticalMisses: 0,
        routeAccuracy: 100,
        safetyGate: "PASS" as const,
        latencyP50Ms: 1.2,
        latencyP95Ms: 2.4,
        executedAt: new Date().toISOString(),
      };
      const parsed = EvaluationRunSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips ShadowRun", () => {
      const data = {
        id: "shadow-1",
        caseId: "case-1",
        baselineSpecVersion: "1.0.0",
        candidateSpecVersion: "1.1.0",
        baselineRoute: "DRAFT_FOR_REVIEW" as const,
        candidateRoute: "DRAFT_FOR_REVIEW" as const,
        routeMatches: true,
        baselineDraft: "Standard greeting.",
        candidateDraft: "Standard greeting with improved sign-off.",
        draftSimilarity: 0.94,
        candidateLatencyMs: 16.2,
        executedAt: new Date().toISOString(),
      };
      const parsed = ShadowRunSchema.parse(data);
      expect(parsed).toEqual(data);
    });

    it("round-trips EvidencePack", () => {
      const data = {
        caseId: "case-1",
        patientId: "DEMO-001",
        immutableSubmission: {
          submittedAt: new Date().toISOString(),
          structuredAnswers: { weekStatus: "On track" },
          rawTextSha256: "sha256:1122334455667788",
        },
        redactedContent: {
          preview: "Doing great this week.",
          tokenCount: 4,
          containsInstructionLikeText: false,
        },
        extractedFacts: [
          {
            id: "fx-1",
            category: "Adherence",
            value: "Great",
            sourceSpan: { start: 6, end: 11, text: "great" },
            confidence: 0.98,
          },
        ],
        policyEvaluation: {
          route: "DRAFT_FOR_REVIEW" as const,
          reasonCode: "ROUTINE_ON_TRACK",
          reason: "Routine adherent check-in.",
          firedRules: [
            { id: "R1", description: "Routine adherence", reason_code: "ROUTINE_ON_TRACK" },
          ],
          inputsUsed: { weekStatus: "On track" },
          ruleVersion: "rules_v1.0",
          evaluatedAt: new Date().toISOString(),
        },
        draftSynthesis: {
          id: "draft-1",
          caseId: "case-1",
          content: "Thank you for checking in.",
          originalContent: "Thank you for checking in.",
          status: "PROPOSED" as const,
          promptVersion: "draft_v1",
          modelId: "mock-model",
          createdAt: new Date().toISOString(),
        },
        reviewerDecisions: [
          {
            id: "dec-1",
            caseId: "case-1",
            reviewerId: "staff-1",
            decision: "APPROVED_SIMULATED" as const,
            notes: "Approved.",
            simulated: true as const,
            decidedAt: new Date().toISOString(),
          },
        ],
        auditTrail: [
          {
            id: "evt-1",
            entityType: "ReviewCase",
            entityId: "case-1",
            actor: "WORKFLOW" as const,
            action: "Ingestion complete",
            detail: "Case ingested.",
            at: new Date().toISOString(),
          },
        ],
        generatedAt: new Date().toISOString(),
      };
      const parsed = EvidencePackSchema.parse(data);
      expect(parsed).toEqual(data);
    });
  });

  describe("2. Case State Machine & Illegal Transitions", () => {
    it("allows legal happy-path transitions", () => {
      // RECEIVED -> PROCESSING
      expect(transitionCaseStatus("RECEIVED", "PROCESSING")).toBe("PROCESSING");

      // PROCESSING -> DRAFT_READY
      expect(transitionCaseStatus("PROCESSING", "DRAFT_READY")).toBe("DRAFT_READY");

      // DRAFT_READY -> NEEDS_REVIEW
      expect(transitionCaseStatus("DRAFT_READY", "NEEDS_REVIEW")).toBe("NEEDS_REVIEW");

      // NEEDS_REVIEW -> APPROVED_SIMULATED
      expect(transitionCaseStatus("NEEDS_REVIEW", "APPROVED_SIMULATED")).toBe("APPROVED_SIMULATED");
    });

    it("allows rejection paths", () => {
      expect(transitionCaseStatus("PROCESSING", "NEEDS_REVIEW")).toBe("NEEDS_REVIEW");
      expect(transitionCaseStatus("NEEDS_REVIEW", "REJECTED")).toBe("REJECTED");
    });

    it("allows retry from processing failure", () => {
      expect(transitionCaseStatus("PROCESSING", "PROCESSING_FAILED")).toBe("PROCESSING_FAILED");
      expect(transitionCaseStatus("PROCESSING_FAILED", "PROCESSING")).toBe("PROCESSING");
      expect(transitionCaseStatus("PROCESSING_FAILED", "NEEDS_REVIEW")).toBe("NEEDS_REVIEW");
    });

    it("throws typed InvalidStateTransitionError on illegal direct transitions", () => {
      // Direct jump from RECEIVED to APPROVED_SIMULATED is forbidden
      expect(() => validateTransition("RECEIVED", "APPROVED_SIMULATED")).toThrowError(
        InvalidStateTransitionError
      );

      try {
        validateTransition("RECEIVED", "APPROVED_SIMULATED");
      } catch (e: any) {
        expect(e).toBeInstanceOf(InvalidStateTransitionError);
        expect(e.currentStatus).toBe("RECEIVED");
        expect(e.targetStatus).toBe("APPROVED_SIMULATED");
        expect(e.message).toContain("Illegal state transition from RECEIVED to APPROVED_SIMULATED");
      }

      // Direct jump from RECEIVED to REJECTED is forbidden
      expect(() => validateTransition("RECEIVED", "REJECTED")).toThrow(
        InvalidStateTransitionError
      );

      // Direct jump from RECEIVED to DRAFT_READY is forbidden
      expect(() => validateTransition("RECEIVED", "DRAFT_READY")).toThrow(
        InvalidStateTransitionError
      );
    });

    it("prevents transitioning out of terminal states (APPROVED_SIMULATED and REJECTED)", () => {
      // APPROVED_SIMULATED is terminal
      expect(() => validateTransition("APPROVED_SIMULATED", "PROCESSING")).toThrow(
        InvalidStateTransitionError
      );
      expect(() => validateTransition("APPROVED_SIMULATED", "NEEDS_REVIEW")).toThrow(
        InvalidStateTransitionError
      );
      expect(() => validateTransition("APPROVED_SIMULATED", "DRAFT_READY")).toThrow(
        InvalidStateTransitionError
      );

      // REJECTED is terminal
      expect(() => validateTransition("REJECTED", "PROCESSING")).toThrow(
        InvalidStateTransitionError
      );
      expect(() => validateTransition("REJECTED", "DRAFT_READY")).toThrow(
        InvalidStateTransitionError
      );
    });
  });

  describe("3. WorkflowSpec Hash Stability & Canonicalization", () => {
    it("produces identical hashes regardless of object key order", () => {
      // Spec A with one key order
      const specA = {
        spec_version: "1.0.0",
        parent_version: null,
        limits: {
          max_note_length: 500,
          max_daily_submissions: 2,
          timeout_ms: 3000,
        },
        reviewer_roles: ["REVIEWER"],
        draft_templates: [{ id: "T1", trigger_reason: "ON_TRACK", template_text: "Hello" }],
        rule_list: [
          { id: "R1", description: "Desc", condition: "true", route: "DRAFT_FOR_REVIEW", reason_code: "OK" },
        ],
        questionnaire_fields: [{ id: "f1", label: "Field", type: "text", required: true }],
      };

      // Spec B with reverse key order in root and nested objects
      const specB = {
        questionnaire_fields: [{ required: true, type: "text", label: "Field", id: "f1" }],
        rule_list: [
          { reason_code: "OK", route: "DRAFT_FOR_REVIEW", condition: "true", description: "Desc", id: "R1" },
        ],
        draft_templates: [{ template_text: "Hello", trigger_reason: "ON_TRACK", id: "T1" }],
        reviewer_roles: ["REVIEWER"],
        limits: {
          timeout_ms: 3000,
          max_daily_submissions: 2,
          max_note_length: 500,
        },
        parent_version: null,
        spec_version: "1.0.0",
      };

      const hashA = computeWorkflowSpecHash(specA);
      const hashB = computeWorkflowSpecHash(specB);

      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("changes hash when any content field is modified", () => {
      const baseSpec = {
        spec_version: "1.0.0",
        parent_version: null,
        limits: { max_note_length: 500, max_daily_submissions: 2, timeout_ms: 3000 },
        reviewer_roles: ["REVIEWER"],
        draft_templates: [],
        rule_list: [],
        questionnaire_fields: [],
      };

      const hash1 = computeWorkflowSpecHash(baseSpec);

      // Modified timeout
      const modifiedSpec = {
        ...baseSpec,
        limits: { ...baseSpec.limits, timeout_ms: 4000 },
      };
      const hash2 = computeWorkflowSpecHash(modifiedSpec);

      expect(hash1).not.toBe(hash2);
    });

    it("ignores content_hash property when computing hash", () => {
      const specWithoutHash = {
        spec_version: "1.0.0",
        parent_version: null,
        limits: { max_note_length: 500, max_daily_submissions: 2, timeout_ms: 3000 },
        reviewer_roles: ["REVIEWER"],
        draft_templates: [],
        rule_list: [],
        questionnaire_fields: [],
      };

      const hash1 = computeWorkflowSpecHash(specWithoutHash);
      const specWithHash = {
        ...specWithoutHash,
        content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      };
      const hash2 = computeWorkflowSpecHash(specWithHash);

      expect(hash1).toBe(hash2);
    });

    it("canonicalizes JSON strings by sorting object keys alphabetically", () => {
      const a = { b: 1, a: 2, c: { y: 2, x: 1 } };
      const b = { c: { x: 1, y: 2 }, a: 2, b: 1 };
      expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
      expect(canonicalizeJson(a)).toBe('{"a":2,"b":1,"c":{"x":1,"y":2}}');
    });

    it("verifies pureSha256 against NIST FIPS test vectors", () => {
      // Empty string
      expect(pureSha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

      // "abc"
      expect(pureSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });
  });

  describe("4. Pure Domain Boundary Enforcement (/shared has zero React/Node imports)", () => {
    it("statically verifies that no file in /shared imports React or Node built-in modules", () => {
      const sharedDir = path.resolve(import.meta.dirname, "..", "shared");

      const allTsFiles: string[] = [];

      function walkDir(currentDir: string) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
            allTsFiles.push(fullPath);
          }
        }
      }

      walkDir(sharedDir);
      expect(allTsFiles.length).toBeGreaterThanOrEqual(10);

      // Forbidden module patterns in pure domain code
      const forbiddenPatterns = [
        /from\s+['"]react['"]/i,
        /from\s+['"]react-dom['"]/i,
        /from\s+['"]node:/i,
        /from\s+['"]fs['"]/i,
        /from\s+['"]path['"]/i,
        /from\s+['"]crypto['"]/i,
        /from\s+['"]os['"]/i,
        /from\s+['"]child_process['"]/i,
        /from\s+['"]stream['"]/i,
        /from\s+['"]http['"]/i,
        /from\s+['"]buffer['"]/i,
      ];

      const violations: string[] = [];

      for (const filePath of allTsFiles) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        lines.forEach((line, idx) => {
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(line)) {
              violations.push(
                `${path.relative(sharedDir, filePath)}:${idx + 1} -> ${line.trim()}`
              );
            }
          }
        });
      }

      expect(
        violations,
        `Forbidden React or Node imports detected in /shared:\n${violations.join("\n")}`
      ).toHaveLength(0);
    });
  });
});

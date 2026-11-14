import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import {
  CheckInSubmissionSchema,
  exportFeedbackDataset,
  REJECTION_REASON_TAXONOMY,
} from "@shared";
import {
  compileSOP,
  decideProposal,
  generateFixtureSuiteForSpec,
  getProposalById,
  listProposals,
  listSampleSOPs,
  validateWorkflowSpecProposal,
} from "./compiler";
import { runMutationHarness } from "./mutation";
import {
  generateSyntheticHistoricalCases,
  runShadowEvaluation,
} from "./shadow";
import {
  getLadderState,
  recordReviewerSignOff,
  resetLadder,
  transitionStage,
} from "./ladder";
import {
  exportEvidencePack,
  generateEvidencePack,
  verifyEvidencePack,
} from "./evidence";
import {
  replayCase,
  runBulkReplay,
} from "./replay";
import { generateSyntheticTraffic } from "./traffic/generator";
import { computeWindowMetrics, evaluateDrift } from "./drift/detector";
import { runCanaryTraffic } from "./canary/runner";
import { runTierComparisonEvaluation } from "./llm/cascade";
import { exportFeedbackDataset as exportVersionedFeedbackDataset } from "./dataset/exporter";
import { VOICE_SCENARIOS, runVoiceSession, runVoiceTurn } from "./voice";
import { FIXTURES_V1 } from "../shared/evaluation/fixtures-data";
import { defaultWorkflowSpec } from "@shared/policy";
import { verifyAuditTrail } from "./audit-chain";
import { getSessionCookieOptions } from "./_core/cookies";
import { getSqlite } from "./db";
import {
  approveCaseInDb,
  computeQualitySignalsFromDb,
  editCaseDraftInDb,
  getCaseByIdFromDb,
  listFeedbackLabelsFromDb,
  listReviewCasesFromDb,
  overrideCaseRouteInDb,
  rejectCaseInDb,
  returnCaseToQueueInDb,
  runEvaluationWithIdempotency,
  runShadowRunWithIdempotency,
  submitCheckInWithIdempotency,
} from "./persistence";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  checkin: router({
    submit: publicProcedure
      .input(CheckInSubmissionSchema)
      .mutation(async ({ input }) => {
        const result = await submitCheckInWithIdempotency(input);
        return result.case;
      }),
  }),
  cases: router({
    list: publicProcedure
      .input(
        z
          .object({
            status: z.string().optional(),
            query: z.string().optional(),
            sort: z.enum(["newest", "oldest", "latency_asc", "latency_desc"]).optional(),
          })
          .optional()
      )
      .query(({ input }) => {
        return listReviewCasesFromDb(input ?? {});
      }),
    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => {
        return getCaseByIdFromDb(input.id);
      }),
    editDraft: publicProcedure
      .input(z.object({ id: z.string(), draft: z.string() }))
      .mutation(({ input }) => {
        return editCaseDraftInDb(input.id, input.draft);
      }),
    approve: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        return approveCaseInDb(input.id);
      }),
    reject: publicProcedure
      .input(
        z.object({
          id: z.string(),
          reason: z.string().default(""),
          reasonCode: z.enum(REJECTION_REASON_TAXONOMY).optional(),
        })
      )
      .mutation(({ input }) => {
        return rejectCaseInDb(input.id, input.reason, input.reasonCode);
      }),
    overrideRoute: publicProcedure
      .input(
        z.object({
          id: z.string(),
          suggestedRoute: z.enum([
            "DRAFT_FOR_REVIEW",
            "HUMAN_REVIEW_REQUIRED",
            "INPUT_ERROR",
          ]),
          reason: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        return overrideCaseRouteInDb(input.id, input.suggestedRoute, input.reason);
      }),
    returnToQueue: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        return returnCaseToQueueInDb(input.id);
      }),
  }),
  feedback: router({
    signals: publicProcedure.query(() => {
      return computeQualitySignalsFromDb();
    }),
    list: publicProcedure.query(() => {
      return listFeedbackLabelsFromDb();
    }),
    export: publicProcedure
      .input(z.object({ version: z.string().optional() }).optional())
      .query(({ input }) => {
        return exportFeedbackDataset(undefined, input?.version);
      }),
  }),
  eval: router({
    run: publicProcedure
      .input(
        z
          .object({
            idempotencyKey: z.string().optional(),
          })
          .optional()
      )
      .mutation(async ({ input }) => {
        return runEvaluationWithIdempotency({ idempotencyKey: input?.idempotencyKey });
      }),
  }),
  shadow: router({
    run: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          candidateSpecVersion: z.string().optional(),
          idempotencyKey: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return runShadowRunWithIdempotency(input);
      }),
    runHistorical: publicProcedure
      .input(
        z
          .object({
            candidateSpec: z.any().optional(),
            proposalId: z.string().optional(),
            seed: z.number().optional(),
          })
          .optional()
      )
      .mutation(({ input }) => {
        let candidateSpec = input?.candidateSpec;
        if (!candidateSpec && input?.proposalId) {
          const proposal = getProposalById(input.proposalId);
          if (proposal) {
            candidateSpec = proposal.proposedSpec;
          }
        }
        if (!candidateSpec) {
          candidateSpec = defaultWorkflowSpec;
        }
        return runShadowEvaluation(candidateSpec, {
          seed: input?.seed ?? 1337,
        });
      }),
    listHistorical: publicProcedure.query(() => {
      return generateSyntheticHistoricalCases(1337);
    }),
  }),
  mutation: router({
    run: publicProcedure
      .input(
        z
          .object({
            spec: z.any().optional(),
            proposalId: z.string().optional(),
            threshold: z.number().optional(),
            seed: z.number().optional(),
          })
          .optional()
      )
      .mutation(({ input }) => {
        let targetSpec = input?.spec;
        if (!targetSpec && input?.proposalId) {
          const proposal = getProposalById(input.proposalId);
          if (proposal) {
            targetSpec = proposal.proposedSpec;
          }
        }
        if (!targetSpec) {
          targetSpec = defaultWorkflowSpec;
        }
        return runMutationHarness(targetSpec, {
          minimumScoreThreshold: input?.threshold ?? 80,
          seed: input?.seed ?? 42,
        });
      }),
  }),
  audit: router({
    verify: publicProcedure.query(() => {
      const sqlite = getSqlite();
      return verifyAuditTrail(sqlite);
    }),
    list: publicProcedure
      .input(z.object({ caseId: z.string().optional() }).optional())
      .query(({ input }) => {
        const sqlite = getSqlite();
        if (input?.caseId) {
          return sqlite
            .prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY sequence_number ASC")
            .all(input.caseId);
        }
        return sqlite.prepare("SELECT * FROM audit_events ORDER BY sequence_number ASC").all();
      }),
  }),
  compiler: router({
    listSamples: publicProcedure.query(() => {
      return listSampleSOPs();
    }),
    listProposals: publicProcedure.query(() => {
      return listProposals();
    }),
    getProposal: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => {
        return getProposalById(input.id);
      }),
    compile: publicProcedure
      .input(
        z.object({
          sopMarkdown: z.string(),
          sopName: z.string(),
        })
      )
      .mutation(({ input }) => {
        return compileSOP(input.sopMarkdown, input.sopName);
      }),
    validate: publicProcedure
      .input(z.object({ spec: z.any() }))
      .mutation(({ input }) => {
        return validateWorkflowSpecProposal(input.spec);
      }),
    decide: publicProcedure
      .input(
        z.object({
          id: z.string(),
          decision: z.enum(["ACCEPTED", "REJECTED", "EDITED"]),
          reviewerNotes: z.string().optional(),
          editedSpec: z.any().optional(),
        })
      )
      .mutation(({ input }) => {
        return decideProposal(
          input.id,
          input.decision,
          input.reviewerNotes,
          input.editedSpec
        );
      }),
    generateFixtures: publicProcedure
      .input(
        z.object({
          spec: z.any().optional(),
          proposalId: z.string().optional(),
          seed: z.number().optional(),
        })
      )
      .mutation(({ input }) => {
        let targetSpec = input.spec;
        if (!targetSpec && input.proposalId) {
          const proposal = getProposalById(input.proposalId);
          if (proposal) {
            targetSpec = proposal.proposedSpec;
          }
        }
        if (!targetSpec) {
          throw new Error("No specification provided for fixture generation.");
        }
        return generateFixtureSuiteForSpec(targetSpec, input.seed ?? 42);
      }),
  }),
  ladder: router({
    getState: publicProcedure
      .input(z.object({ proposalId: z.string() }))
      .query(({ input }) => {
        return getLadderState(input.proposalId);
      }),
    transition: publicProcedure
      .input(
        z.object({
          proposalId: z.string(),
          targetStage: z.enum([
            "Draft",
            "Evaluated",
            "Shadowed",
            "Reviewed-by-all",
            "Active",
          ]),
          spec: z.any(),
          actor: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        return transitionStage(
          input.proposalId,
          input.targetStage,
          input.spec,
          { actor: input.actor, notes: input.notes }
        );
      }),
    signOff: publicProcedure
      .input(
        z.object({
          proposalId: z.string(),
          reviewerId: z.string(),
          role: z.string(),
          spec: z.any(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        return recordReviewerSignOff(
          input.proposalId,
          { reviewerId: input.reviewerId, role: input.role, notes: input.notes },
          input.spec
        );
      }),
    reset: publicProcedure
      .input(
        z.object({
          proposalId: z.string(),
          reason: z.string(),
        })
      )
      .mutation(({ input }) => {
        return resetLadder(input.proposalId, input.reason);
      }),
  }),
  evidence: router({
    generate: publicProcedure
      .input(
        z.object({
          spec: z.any(),
          traces: z.array(z.any()).optional(),
        })
      )
      .mutation(({ input }) => {
        return generateEvidencePack(input.spec, input.traces || []);
      }),
    export: publicProcedure
      .input(
        z.object({
          spec: z.any(),
          traces: z.array(z.any()).optional(),
        })
      )
      .mutation(({ input }) => {
        return exportEvidencePack(input.spec, input.traces || []);
      }),
    verify: publicProcedure
      .input(
        z.object({
          packInput: z.any(),
        })
      )
      .mutation(({ input }) => {
        return verifyEvidencePack(input.packInput);
      }),
  }),
  replay: router({
    case: publicProcedure
      .input(
        z.object({
          caseId: z.string(),
          targetSpec: z.any().optional(),
          targetModelTier: z.enum(["small", "strong"]).optional(),
          targetPromptVersion: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        return replayCase(input.caseId, {
          targetSpec: input.targetSpec,
          targetModelTier: input.targetModelTier,
          targetPromptVersion: input.targetPromptVersion,
        });
      }),
    bulk: publicProcedure
      .input(
        z.object({
          candidateSpec: z.any(),
          caseIds: z.array(z.string()).optional(),
          limit: z.number().optional(),
        })
      )
      .mutation(({ input }) => {
        return runBulkReplay({
          candidateSpec: input.candidateSpec,
          caseIds: input.caseIds,
          limit: input.limit ?? 50,
        });
      }),
  }),
  drift: router({
    evaluate: publicProcedure
      .input(
        z.object({
          seed: z.number().optional(),
          count: z.number().optional(),
          newPhrasingRate: z.number().optional(),
          moreFreeTextRate: z.number().optional(),
          higherUncertaintyRate: z.number().optional(),
          newInjectionRate: z.number().optional(),
        })
      )
      .mutation(({ input }) => {
        const seed = input.seed ?? 42;
        const count = input.count ?? 60;
        // Baseline traffic: minimal shift
        const baselineBatch = generateSyntheticTraffic({
          seed,
          count,
          newPhrasingRate: 0.05,
          moreFreeTextRate: 0.05,
          higherUncertaintyRate: 0.05,
          newInjectionRate: 0.0,
        });
        const baselineMetrics = computeWindowMetrics(baselineBatch.cases);

        // Current traffic with requested shifts
        const currentBatch = generateSyntheticTraffic({
          seed: seed + 100,
          count,
          newPhrasingRate: input.newPhrasingRate ?? 0.1,
          moreFreeTextRate: input.moreFreeTextRate ?? 0.1,
          higherUncertaintyRate: input.higherUncertaintyRate ?? 0.1,
          newInjectionRate: input.newInjectionRate ?? 0.0,
        });
        const currentMetrics = computeWindowMetrics(currentBatch.cases);

        return evaluateDrift(baselineMetrics, currentMetrics);
      }),
    canary: publicProcedure
      .input(
        z.object({
          proposalId: z.string(),
          candidateSpec: z.any(),
          trafficShare: z.number().optional(),
          shiftAxes: z
            .object({
              newPhrasingRate: z.number().optional(),
              moreFreeTextRate: z.number().optional(),
              higherUncertaintyRate: z.number().optional(),
              newInjectionRate: z.number().optional(),
            })
            .optional(),
        })
      )
      .mutation(({ input }) => {
        const traffic = generateSyntheticTraffic({
          seed: 99,
          count: 50,
          newPhrasingRate: input.shiftAxes?.newPhrasingRate ?? 0.1,
          moreFreeTextRate: input.shiftAxes?.moreFreeTextRate ?? 0.1,
          higherUncertaintyRate: input.shiftAxes?.higherUncertaintyRate ?? 0.2,
          newInjectionRate: input.shiftAxes?.newInjectionRate ?? 0.05,
        });
        return runCanaryTraffic(
          {
            proposalId: input.proposalId,
            activeSpec: defaultWorkflowSpec,
            candidateSpec: input.candidateSpec,
            previousActiveSpec: defaultWorkflowSpec,
            trafficShare: input.trafficShare ?? 0.2,
          },
          traffic.cases
        );
      }),
  }),
  cascade: router({
    compare: publicProcedure
      .input(z.object({}).optional())
      .mutation(() => {
        return runTierComparisonEvaluation(FIXTURES_V1, defaultWorkflowSpec);
      }),
  }),
  dataset: router({
    exportVersioned: publicProcedure
      .input(
        z
          .object({
            seed: z.number().optional(),
            version: z.string().optional(),
          })
          .optional()
      )
      .mutation(({ input }) => {
        return exportVersionedFeedbackDataset({
          seed: input?.seed ?? 42,
          datasetVersion: input?.version ?? "dataset_v1.0.0",
        });
      }),
  }),
  voice: router({
    getScenarios: publicProcedure.query(() => {
      return VOICE_SCENARIOS;
    }),
    runTurn: publicProcedure
      .input(
        z.object({
          userTranscript: z.string().min(1),
          turnIndex: z.number().int().positive().optional().default(1),
          expectedConfidence: z.number().min(0).max(1).optional(),
          triggerBargeInAfterMs: z.number().positive().optional(),
          patientId: z.string().optional(),
          patientName: z.string().optional(),
          programName: z.string().optional(),
          budget: z
            .object({
              asrBudgetMs: z.number().positive(),
              pipelineBudgetMs: z.number().positive(),
              ttsTtfbBudgetMs: z.number().positive(),
              totalTurnaroundBudgetMs: z.number().positive(),
            })
            .optional(),
        })
      )
      .mutation(({ input }) => {
        return runVoiceTurn(
          {
            turnIndex: input.turnIndex,
            userTranscript: input.userTranscript,
            expectedAsrConfidence: input.expectedConfidence,
            triggerBargeInAfterMs: input.triggerBargeInAfterMs,
          },
          {
            patientId: input.patientId,
            patientName: input.patientName,
            programName: input.programName,
            budget: input.budget,
          }
        );
      }),
    runSession: publicProcedure
      .input(
        z.object({
          scenarioId: z.string(),
          budget: z
            .object({
              asrBudgetMs: z.number().positive(),
              pipelineBudgetMs: z.number().positive(),
              ttsTtfbBudgetMs: z.number().positive(),
              totalTurnaroundBudgetMs: z.number().positive(),
            })
            .optional(),
        })
      )
      .mutation(({ input }) => {
        const scenario = VOICE_SCENARIOS.find((s) => s.id === input.scenarioId);
        if (!scenario) {
          throw new Error(`Voice scenario '${input.scenarioId}' not found.`);
        }
        return runVoiceSession(scenario, { budget: input.budget });
      }),
  }),
});

export type AppRouter = typeof appRouter;

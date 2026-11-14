import type { WorkflowSpec } from "../../shared/domain/types";
import { evaluatePolicy } from "../../shared/policy";
import { generateFixtureSuite } from "../compiler/generator";
import type { GeneratedFixture } from "../compiler/types";
import { appendChainedAuditEvent } from "../audit-chain";
import { getSqlite } from "../db";
import { generateMutants } from "./mutators";
import type {
  MutantResult,
  MutationGateConfig,
  MutationOperator,
  MutationSuiteReport,
} from "./types";

export interface RunMutationOptions extends MutationGateConfig {
  fixtures?: GeneratedFixture[];
  seed?: number;
  db?: any;
}

/**
 * Runs a deterministic mutation test harness on a WorkflowSpec.
 * PERMANENT AGENT RULES:
 * - Deterministic pure TypeScript execution.
 * - Computed metrics only (no hardcoded literals or simulated scores).
 * - Gate trips to FAIL if score is below threshold or any severity-lowering mutant survives.
 * - Hash-chained audit event recorded (simulated state only).
 */
export function runMutationHarness(
  spec: WorkflowSpec,
  options: RunMutationOptions = {}
): MutationSuiteReport {
  const threshold = options.minimumScoreThreshold ?? 80;
  const blockOnSeverityLowering = options.blockOnSeverityLoweringMutant ?? true;
  const runId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  // 1. Prepare Fixture Suite
  let fixtures: GeneratedFixture[];
  if (options.fixtures && options.fixtures.length > 0) {
    fixtures = options.fixtures;
  } else {
    // Deterministically generate fixture suite for this spec
    const generatedSuite = generateFixtureSuite(spec, { seed: options.seed ?? 42 });
    fixtures = generatedSuite.fixtures;
  }

  // 2. Compute Baseline Execution Routes & Reasons
  const baselineResults = new Map<string, ReturnType<typeof evaluatePolicy>>();
  for (const f of fixtures) {
    const res = evaluatePolicy(f.rawInput as Record<string, unknown>, spec);
    baselineResults.set(f.id, res);
  }

  // 3. Generate Mutants
  const mutants = generateMutants(spec);

  // 4. Run Fixtures against each Mutant
  const mutantResults: MutantResult[] = [];
  const categoryBreakdown: Record<
    MutationOperator,
    { total: number; killed: number; survived: number }
  > = {
    DELETE_RULE: { total: 0, killed: 0, survived: 0 },
    FLIP_ROUTE: { total: 0, killed: 0, survived: 0 },
    WIDEN_THRESHOLD: { total: 0, killed: 0, survived: 0 },
    NARROW_THRESHOLD: { total: 0, killed: 0, survived: 0 },
    DROP_NORMALIZATION: { total: 0, killed: 0, survived: 0 },
    REORDER_RULES: { total: 0, killed: 0, survived: 0 },
    WEAKEN_INSTRUCTION_TEXT: { total: 0, killed: 0, survived: 0 },
  };

  for (const mutant of mutants) {
    categoryBreakdown[mutant.operator].total++;
    let killed = false;
    let killerFixtureId: string | undefined;
    let killerFixtureSnippet: string | undefined;
    let baselineRoute: string | undefined;
    let mutantRoute: string | undefined;

    for (const f of fixtures) {
      const baseRes = baselineResults.get(f.id)!;
      const mResult = evaluatePolicy(
        f.rawInput as Record<string, unknown>,
        mutant.mutatedSpec,
        mutant.evaluatorConfig
      );

      // A mutant is KILLED if:
      // 1. Output route divergence (decision differs from baseline or expected):
      const routeDiverged = mResult.route !== baseRes.route || mResult.route !== f.expected_route;

      // 2. Primary explanation reason divergence:
      const reasonDiverged = mResult.primaryReason !== baseRes.primaryReason;

      // 3. Target rule divergence on fixtures targeted for that rule:
      let targetRuleDiverged = false;
      if (mutant.targetRuleId) {
        const isTargetFixture =
          f.provenance.ruleId === mutant.targetRuleId ||
          f.tags.includes(mutant.targetRuleId.toLowerCase());
        if (isTargetFixture) {
          const baseFired = baseRes.firedRules.find((r) => r.id === mutant.targetRuleId);
          const mFired = mResult.firedRules.find((r) => r.id === mutant.targetRuleId);
          if (baseFired && !mFired) {
            targetRuleDiverged = true;
          } else if (baseFired && mFired && mFired.route !== baseFired.route) {
            targetRuleDiverged = true;
          }
        }
      }

      // 4. Normalization / Evasion divergence:
      let normDiverged = false;
      if (mutant.operator === "DROP_NORMALIZATION") {
        const isNormFixture =
          f.tags.includes("normalization_attack") ||
          f.tags.includes("adversarial_injection") ||
          f.provenance.templateKey.includes("norm_");
        if (isNormFixture && baseRes.firedRules.length !== mResult.firedRules.length) {
          normDiverged = true;
        }
      }

      // 5. Instruction text detector divergence:
      let instructionDiverged = false;
      if (mutant.operator === "WEAKEN_INSTRUCTION_TEXT") {
        const isInjectionFixture =
          f.tags.includes("adversarial_injection") ||
          f.provenance.templateKey.includes("instruction");
        const baseHadInstruction = baseRes.firedRules.some((r) => r.id.includes("INSTRUCTION"));
        const mHadInstruction = mResult.firedRules.some((r) => r.id.includes("INSTRUCTION"));
        if (isInjectionFixture && baseHadInstruction && !mHadInstruction) {
          instructionDiverged = true;
        }
      }

      // 6. Rule order / precedence stability:
      let orderDiverged = false;
      if (mutant.operator === "REORDER_RULES") {
        if (
          baseRes.firedRules.length > 0 &&
          mResult.firedRules.length > 0 &&
          baseRes.firedRules[0].id !== mResult.firedRules[0].id
        ) {
          orderDiverged = true;
        }
      }

      if (
        routeDiverged ||
        reasonDiverged ||
        targetRuleDiverged ||
        normDiverged ||
        instructionDiverged ||
        orderDiverged
      ) {
        killed = true;
        killerFixtureId = f.id;
        const note = (f.rawInput as Record<string, unknown>).note;
        killerFixtureSnippet =
          typeof note === "string" ? note.slice(0, 80) : `patientId: ${f.rawInput.patientId}`;
        baselineRoute = baseRes.route;
        mutantRoute = mResult.route;
        break; // Mutant killed; move to next mutant
      }
    }

    if (killed) {
      categoryBreakdown[mutant.operator].killed++;
      mutantResults.push({
        mutant,
        killed: true,
        killerFixtureId,
        killerFixtureSnippet,
        baselineRoute,
        mutantRoute,
      });
    } else {
      categoryBreakdown[mutant.operator].survived++;
      mutantResults.push({
        mutant,
        killed: false,
        survivedReason: `No fixture in the suite exercised the behavioral delta caused by: ${mutant.description}`,
      });
    }
  }

  // 5. Compute Metrics Dynamically
  const totalMutants = mutants.length;
  const killedMutants = mutantResults.filter((r) => r.killed).length;
  const survivingMutants = totalMutants - killedMutants;
  const mutationScore = totalMutants > 0 ? Number(((killedMutants / totalMutants) * 100).toFixed(1)) : 0;
  const scorePassed = mutationScore >= threshold;

  const survivingMutantsList = mutantResults.filter((r) => !r.killed);
  const severityLoweringSurviving = survivingMutantsList.filter(
    (r) => r.mutant.lowersSeverity
  );
  const severityLoweringSurvivingCount = severityLoweringSurviving.length;

  // 6. Safety Gate Evaluation
  let gateStatus: "PASS" | "FAIL" = "PASS";
  let gateFailureReason: string | undefined;

  if (blockOnSeverityLowering && severityLoweringSurvivingCount > 0) {
    gateStatus = "FAIL";
    gateFailureReason = `CRITICAL GATE TRIP: ${severityLoweringSurvivingCount} mutant(s) lowering route severity survived. Safety policy forbids activation with unverified escalation paths.`;
  } else if (!scorePassed) {
    gateStatus = "FAIL";
    gateFailureReason = `Mutation score ${mutationScore}% is below configured threshold of ${threshold}%. Suite coverage is insufficient.`;
  }

  const report: MutationSuiteReport = {
    id: runId,
    specId: (spec as any).spec_id || spec.spec_version,
    specVersion: spec.spec_version,
    totalMutants,
    killedMutants,
    survivingMutants,
    mutationScore,
    threshold,
    scorePassed,
    severityLoweringSurvivingCount,
    gateStatus,
    gateFailureReason,
    survivingMutantsList,
    categoryBreakdown,
    executedAt: now,
  };

  // 7. Audit Logging
  try {
    const sqlite = options.db || getSqlite();
    appendChainedAuditEvent(sqlite, {
      entityType: "WorkflowSpec",
      entityId: report.specId,
      actor: "SYSTEM",
      action: `Mutation test ${gateStatus.toLowerCase()} · simulated`,
      detail: `Mutation harness ran ${totalMutants} mutants against ${fixtures.length} fixtures. Score: ${mutationScore}% (threshold: ${threshold}%). Killed: ${killedMutants}, Survived: ${survivingMutants}. Gate: ${gateStatus}. Simulated state only.`,
      at: now,
      metadata: {
        score: mutationScore,
        gateStatus,
        severityLoweringSurvivingCount,
      },
    });
  } catch {
    // Fallback if sqlite not available in unit test env
  }

  return report;
}


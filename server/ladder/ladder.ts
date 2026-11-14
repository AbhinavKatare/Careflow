/**
 * Staged Activation Ladder Service.
 * Implements: Draft -> Evaluated -> Shadowed -> Reviewed-by-all -> Active.
 *
 * Machine-checked gates:
 * 1. Draft -> Evaluated: Validator pass, zero critical misses, mutation score >= 80% (0 severity-lowering mutants).
 * 2. Evaluated -> Shadowed: Spec hash unchanged, shadow agreement >= 85%, zero unsafe disagreements.
 * 3. Shadowed -> Reviewed-by-all: Required reviewer roles signed off, spec hash unchanged.
 * 4. Reviewed-by-all -> Active: Spec hash unchanged since evaluation and shadow, fully reviewed.
 *
 * PERMANENT AGENT RULES:
 * - Deterministic pure TypeScript execution.
 * - Editing a spec resets its ladder.
 * - Unsafe or edited spec CANNOT be activated.
 * - Hash-chained audit trail (simulated state only).
 */

import Database from "better-sqlite3";
import { appendChainedAuditEvent } from "../audit-chain";
import { getSqlite } from "../db";
import { validateWorkflowSpecProposal } from "../compiler/validator";
import { runMutationHarness } from "../mutation/runner";
import { runShadowEvaluation } from "../shadow/runner";
import { generateFixtureSuite } from "../compiler/generator";
import { executeEvaluation } from "../../shared/evaluation/runner";
import { FIXTURES_V1 } from "../../shared/evaluation/fixtures-data";
import type { FixtureV1 } from "../../shared/evaluation/types";
import type { WorkflowSpec } from "../../shared/domain/types";
import { computeWorkflowSpecHash } from "../../shared/domain/workflow-spec";
import type {
  ActivationStage,
  GateCheckResult,
  LadderState,
  ReviewerSignOff,
  StageTransitionResponse,
} from "./types";

const DEFAULT_REQUIRED_ROLES = [
  "Clinical Lead",
  "Compliance Officer",
  "QA Reviewer",
];

/**
 * Gets or initializes the activation ladder state for a proposal.
 */
export function getLadderState(
  proposalId: string,
  sqlite: Database.Database = getSqlite()
): LadderState {
  const row = sqlite
    .prepare("SELECT * FROM spec_activation_ladder WHERE proposal_id = ?")
    .get(proposalId) as Record<string, unknown> | undefined;

  if (row) {
    return {
      proposalId: row.proposal_id as string,
      specVersion: row.spec_version as string,
      currentStage: row.current_stage as ActivationStage,
      evaluatedSpecHash: (row.evaluated_spec_hash as string) || null,
      shadowedSpecHash: (row.shadowed_spec_hash as string) || null,
      activeSpecHash: (row.active_spec_hash as string) || null,
      signOffs: JSON.parse((row.sign_offs as string) || "[]"),
      gatesHistory: JSON.parse((row.gates_history as string) || "{}"),
      lastResetReason: (row.last_reset_reason as string) || undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // Create initial Draft record
  const now = new Date().toISOString();
  const initial: LadderState = {
    proposalId,
    specVersion: "1.0.0",
    currentStage: "Draft",
    evaluatedSpecHash: null,
    shadowedSpecHash: null,
    activeSpecHash: null,
    signOffs: [],
    gatesHistory: {},
    createdAt: now,
    updatedAt: now,
  };

  sqlite
    .prepare(
      `INSERT INTO spec_activation_ladder (
        proposal_id, current_stage, spec_version, evaluated_spec_hash,
        shadowed_spec_hash, active_spec_hash, sign_offs, gates_history,
        last_reset_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      initial.proposalId,
      initial.currentStage,
      initial.specVersion,
      null,
      null,
      null,
      JSON.stringify([]),
      JSON.stringify({}),
      null,
      now,
      now
    );

  return initial;
}

/**
 * Resets the activation ladder back to Draft.
 * Triggered whenever a specification is edited or modified.
 */
export function resetLadder(
  proposalId: string,
  reason: string,
  sqlite: Database.Database = getSqlite()
): LadderState {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE spec_activation_ladder
       SET current_stage = 'Draft',
           evaluated_spec_hash = NULL,
           shadowed_spec_hash = NULL,
           active_spec_hash = NULL,
           sign_offs = '[]',
           last_reset_reason = ?,
           updated_at = ?
       WHERE proposal_id = ?`
    )
    .run(reason, now, proposalId);

  appendChainedAuditEvent(sqlite, {
    entityType: "WorkflowSpec",
    entityId: proposalId,
    actor: "WORKFLOW",
    action: "Ladder reset to Draft",
    detail: `Activation ladder reset to Draft for proposal ${proposalId}. Reason: ${reason}. All approvals cleared.`,
    at: now,
    metadata: { reason, resetStage: "Draft" },
  });

  return getLadderState(proposalId, sqlite);
}

/**
 * Records a reviewer sign-off on a proposal.
 */
export function recordReviewerSignOff(
  proposalId: string,
  signOff: { reviewerId: string; role: string; notes?: string },
  spec: WorkflowSpec,
  sqlite: Database.Database = getSqlite()
): LadderState {
  const state = getLadderState(proposalId, sqlite);
  const now = new Date().toISOString();

  // If spec was edited since shadow, reset ladder
  const currentHash = computeWorkflowSpecHash(spec);
  if (state.shadowedSpecHash && currentHash !== state.shadowedSpecHash) {
    resetLadder(
      proposalId,
      "Spec content hash changed after shadowing. Resetting ladder to Draft.",
      sqlite
    );
    throw new Error(
      "Spec content hash changed after shadowing. Ladder reset to Draft. Re-evaluation required."
    );
  }

  // Deduplicate sign-offs by role
  const filtered = state.signOffs.filter((s) => s.role !== signOff.role);
  const newSignOff: ReviewerSignOff = {
    reviewerId: signOff.reviewerId,
    role: signOff.role,
    signedAt: now,
    simulated: true,
    notes: signOff.notes,
  };
  const updatedSignOffs = [...filtered, newSignOff];

  // Check if all required roles have signed off
  const requiredRoles = spec.reviewer_roles && spec.reviewer_roles.length > 0
    ? spec.reviewer_roles
    : DEFAULT_REQUIRED_ROLES;

  const hasAll = requiredRoles.every((role) =>
    updatedSignOffs.some((s) => s.role.toLowerCase() === role.toLowerCase())
  );

  const nextStage: ActivationStage =
    hasAll && state.currentStage === "Shadowed"
      ? "Reviewed-by-all"
      : state.currentStage;

  sqlite
    .prepare(
      `UPDATE spec_activation_ladder
       SET sign_offs = ?, current_stage = ?, updated_at = ?
       WHERE proposal_id = ?`
    )
    .run(JSON.stringify(updatedSignOffs), nextStage, now, proposalId);

  appendChainedAuditEvent(sqlite, {
    entityType: "WorkflowSpec",
    entityId: proposalId,
    actor: "DEMO_REVIEWER",
    action: `Reviewer sign-off (${signOff.role}) · simulated`,
    detail: `Reviewer ${signOff.reviewerId} signed off as ${signOff.role} on proposal ${proposalId}. Status: ${nextStage}. Simulated, nothing sent externally.`,
    at: now,
    metadata: { role: signOff.role, stage: nextStage },
  });

  return getLadderState(proposalId, sqlite);
}

/**
 * Evaluates machine-checked gates and executes stage transitions.
 */
export function transitionStage(
  proposalId: string,
  targetStage: ActivationStage,
  spec: WorkflowSpec,
  options: { actor?: string; notes?: string } = {},
  sqlite: Database.Database = getSqlite()
): StageTransitionResponse {
  const state = getLadderState(proposalId, sqlite);
  const currentHash = computeWorkflowSpecHash(spec);
  const now = new Date().toISOString();
  const gates: GateCheckResult[] = [];

  // ==========================================
  // GATE CHECK: Spec Hash Integrity Check
  // ==========================================
  if (state.currentStage !== "Draft" && targetStage !== "Draft") {
    if (state.evaluatedSpecHash && currentHash !== state.evaluatedSpecHash) {
      const resetState = resetLadder(
        proposalId,
        `Spec content hash changed (current ${currentHash.slice(0, 16)} does not match evaluated hash ${state.evaluatedSpecHash.slice(0, 16)}). Spec was edited.`,
        sqlite
      );
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: "Draft",
        gates: [
          {
            gate: "SPEC_HASH_UNCHANGED",
            passed: false,
            message: "Spec was edited after evaluation. Spec content hash changed. Ladder automatically reset to Draft.",
            details: { expected: state.evaluatedSpecHash, actual: currentHash },
          },
        ],
        state: resetState,
        errorMessage: "Spec content hash changed after evaluation. Spec was edited. Ladder reset to Draft.",
      };
    }
  }

  // ==========================================
  // TRANSITION: -> Evaluated
  // ==========================================
  if (targetStage === "Evaluated") {
    // Gate 1: Validator pass
    const validation = validateWorkflowSpecProposal(spec);
    gates.push({
      gate: "VALIDATOR_PASS",
      passed: validation.valid,
      message: validation.valid
        ? "Validator passed with zero fatal errors and all required safety rules present."
        : `Validator failed: ${validation.errors.join("; ")}`,
      details: { errorsCount: validation.errors.length },
    });

    // Gate 2: Evaluation Suite pass with 0 critical misses
    try {
      const isWeeklyCheckIn = spec.questionnaire_fields.some((f) => f.id === "weekStatus");
      let fixturesToRun: FixtureV1[];
      if (isWeeklyCheckIn) {
        fixturesToRun = FIXTURES_V1;
      } else {
        const generated = generateFixtureSuite(spec, { seed: 42 });
        fixturesToRun = generated.fixtures.map((f) => ({
          id: f.id,
          raw_input: {
            patientId: f.rawInput.patientId || "DEMO-001",
            patientName: f.rawInput.patientName || "Demo Patient 001",
            program: (f.rawInput.program as string) || "Demonstration SOP",
            weekStatus: (f.rawInput.weekStatus as string) || "On track with routine",
            followUp: (f.rawInput.followUp as "yes" | "no") || "no",
            note: (f.rawInput.note as string) || (f.rawInput.additionalNotes as string) || (f.rawInput.adherenceNote as string) || "",
            structuredAnswers: f.rawInput,
          },
          expected_route: f.expected_route,
          tags: f.tags,
          provenance: "generated" as const,
          rationale: f.rationale,
        }));
      }

      const evalRun = executeEvaluation(fixturesToRun, spec);
      const evalPassed = evalRun.metrics.criticalMisses === 0 && evalRun.metrics.safetyGate === "PASS";
      const evalDetails = {
        totalCases: evalRun.metrics.total,
        criticalMisses: evalRun.metrics.criticalMisses,
        routeAccuracy: evalRun.metrics.routeAccuracy.percentage,
        safetyGate: evalRun.metrics.safetyGate,
      };
      gates.push({
        gate: "ZERO_CRITICAL_MISSES",
        passed: evalPassed,
        message: evalPassed
          ? `Evaluation suite passed: 0 critical misses across ${evalRun.metrics.total} fixtures (accuracy: ${evalRun.metrics.routeAccuracy.percentage}%).`
          : `CRITICAL MISS GATE TRIP: Evaluation reported ${evalRun.metrics.criticalMisses} critical miss(es).`,
        details: evalDetails,
      });
    } catch (err: unknown) {
      gates.push({
        gate: "ZERO_CRITICAL_MISSES",
        passed: false,
        message: `Evaluation run error: ${String(err)}`,
      });
    }

    // Gate 3: Mutation Score >= 80% & 0 severity-lowering mutants
    try {
      const mutReport = runMutationHarness(spec, {
        minimumScoreThreshold: 80,
        blockOnSeverityLoweringMutant: true,
      });
      const mutationPassed = mutReport.gateStatus === "PASS" && mutReport.severityLoweringSurvivingCount === 0;
      const mutationDetails = {
        mutationScore: mutReport.mutationScore,
        killedMutants: mutReport.killedMutants,
        totalMutants: mutReport.totalMutants,
        severityLoweringSurviving: mutReport.severityLoweringSurvivingCount,
      };
      gates.push({
        gate: "MUTATION_SCORE_THRESHOLD",
        passed: mutationPassed,
        message: mutationPassed
          ? `Mutation harness passed: ${mutReport.mutationScore}% score (killed ${mutReport.killedMutants}/${mutReport.totalMutants}), 0 severity-lowering mutants.`
          : `Mutation gate failed: Score ${mutReport.mutationScore}%, ${mutReport.severityLoweringSurvivingCount} severity-lowering mutants survived.`,
        details: mutationDetails,
      });
    } catch (err: unknown) {
      gates.push({
        gate: "MUTATION_SCORE_THRESHOLD",
        passed: false,
        message: `Mutation harness error: ${String(err)}`,
      });
    }

    const allPassed = gates.every((g) => g.passed);
    if (!allPassed) {
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: state.currentStage,
        gates,
        state,
        errorMessage: "One or more gates failed for Evaluated stage.",
      };
    }

    // Update state to Evaluated
    sqlite
      .prepare(
        `UPDATE spec_activation_ladder
         SET current_stage = 'Evaluated',
             evaluated_spec_hash = ?,
             updated_at = ?
         WHERE proposal_id = ?`
      )
      .run(currentHash, now, proposalId);

    appendChainedAuditEvent(sqlite, {
      entityType: "WorkflowSpec",
      entityId: proposalId,
      actor: (options.actor === "DEMO_REVIEWER" || options.actor === "SYSTEM" ? options.actor : "WORKFLOW"),
      action: "Stage transition: Evaluated",
      detail: `Proposal ${proposalId} advanced to Evaluated. Evaluated hash: ${currentHash.slice(0, 16)}. Simulated state only.`,
      at: now,
      metadata: { hash: currentHash, stage: "Evaluated" },
    });

    return {
      success: true,
      previousStage: state.currentStage,
      newStage: "Evaluated",
      gates,
      state: getLadderState(proposalId, sqlite),
    };
  }

  // ==========================================
  // TRANSITION: -> Shadowed
  // ==========================================
  if (targetStage === "Shadowed") {
    if (state.currentStage !== "Evaluated") {
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: state.currentStage,
        gates: [
          {
            gate: "STAGE_SEQUENCE",
            passed: false,
            message: "Cannot advance to Shadowed without first completing Evaluated stage.",
          },
        ],
        state,
        errorMessage: "Must complete Evaluated stage before Shadowed.",
      };
    }

    // Gate 1: Spec hash matches evaluated hash
    const hashMatches = currentHash === state.evaluatedSpecHash;
    gates.push({
      gate: "SPEC_HASH_UNCHANGED",
      passed: hashMatches,
      message: hashMatches
        ? "Spec hash unchanged since evaluation."
        : "Spec hash changed since evaluation.",
      details: { expected: state.evaluatedSpecHash, actual: currentHash },
    });

    if (!hashMatches) {
      const resetState = resetLadder(
        proposalId,
        "Spec content hash changed after evaluation. Resetting ladder to Draft.",
        sqlite
      );
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: "Draft",
        gates,
        state: resetState,
        errorMessage: "Spec content hash changed since evaluation. Ladder reset to Draft.",
      };
    }

    // Gate 2: Shadow evaluation agreement >= 85% and ZERO unsafe disagreements
    try {
      const shadowReport = runShadowEvaluation(spec, { db: sqlite });
      const shadowPassed =
        shadowReport.gateStatus === "PASS" &&
        shadowReport.unsafeDisagreements.length === 0 &&
        shadowReport.agreementRate >= 85;
      const shadowDetails = {
        agreementRate: shadowReport.agreementRate,
        unsafeCount: shadowReport.unsafeDisagreements.length,
        totalCases: shadowReport.totalCases,
      };
      gates.push({
        gate: "SHADOW_AGREEMENT_AND_SAFETY",
        passed: shadowPassed,
        message: shadowPassed
          ? `Shadow replay passed: ${shadowReport.agreementRate}% agreement on 300 cases, 0 unsafe disagreements.`
          : `Shadow gate failed: Agreement ${shadowReport.agreementRate}%, ${shadowReport.unsafeDisagreements.length} unsafe under-escalations.`,
        details: shadowDetails,
      });
    } catch (err: unknown) {
      gates.push({
        gate: "SHADOW_AGREEMENT_AND_SAFETY",
        passed: false,
        message: `Shadow run error: ${String(err)}`,
      });
    }

    const allPassed = gates.every((g) => g.passed);
    if (!allPassed) {
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: state.currentStage,
        gates,
        state,
        errorMessage: "One or more gates failed for Shadowed stage.",
      };
    }

    sqlite
      .prepare(
        `UPDATE spec_activation_ladder
         SET current_stage = 'Shadowed',
             shadowed_spec_hash = ?,
             updated_at = ?
         WHERE proposal_id = ?`
      )
      .run(currentHash, now, proposalId);

    appendChainedAuditEvent(sqlite, {
      entityType: "WorkflowSpec",
      entityId: proposalId,
      actor: (options.actor === "DEMO_REVIEWER" || options.actor === "SYSTEM" ? options.actor : "WORKFLOW"),
      action: "Stage transition: Shadowed",
      detail: `Proposal ${proposalId} advanced to Shadowed. Shadowed hash: ${currentHash.slice(0, 16)}. Simulated state only.`,
      at: now,
      metadata: { hash: currentHash, stage: "Shadowed" },
    });

    return {
      success: true,
      previousStage: state.currentStage,
      newStage: "Shadowed",
      gates,
      state: getLadderState(proposalId, sqlite),
    };
  }

  // ==========================================
  // TRANSITION: -> Reviewed-by-all
  // ==========================================
  if (targetStage === "Reviewed-by-all") {
    if (state.currentStage !== "Shadowed") {
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: state.currentStage,
        gates: [
          {
            gate: "STAGE_SEQUENCE",
            passed: false,
            message: "Must complete Shadowed stage before advancing to Reviewed-by-all.",
          },
        ],
        state,
        errorMessage: "Must complete Shadowed stage before Reviewed-by-all.",
      };
    }

    const requiredRoles = spec.reviewer_roles && spec.reviewer_roles.length > 0
      ? spec.reviewer_roles
      : DEFAULT_REQUIRED_ROLES;

    const hasAll = requiredRoles.every((role) =>
      state.signOffs.some((s) => s.role.toLowerCase() === role.toLowerCase())
    );

    gates.push({
      gate: "ALL_REVIEWERS_SIGNED_OFF",
      passed: hasAll,
      message: hasAll
        ? `All required roles (${requiredRoles.join(", ")}) signed off.`
        : `Missing required role sign-offs. Required: ${requiredRoles.join(", ")}. Received: ${state.signOffs.map((s) => s.role).join(", ")}.`,
      details: { requiredRoles, receivedSignOffs: state.signOffs },
    });

    if (!hasAll) {
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: state.currentStage,
        gates,
        state,
        errorMessage: "Missing required reviewer sign-offs.",
      };
    }

    sqlite
      .prepare(
        `UPDATE spec_activation_ladder
         SET current_stage = 'Reviewed-by-all',
             updated_at = ?
         WHERE proposal_id = ?`
      )
      .run(now, proposalId);

    return {
      success: true,
      previousStage: state.currentStage,
      newStage: "Reviewed-by-all",
      gates,
      state: getLadderState(proposalId, sqlite),
    };
  }

  // ==========================================
  // TRANSITION: -> Active
  // ==========================================
  if (targetStage === "Active") {
    if (state.currentStage !== "Reviewed-by-all") {
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: state.currentStage,
        gates: [
          {
            gate: "STAGE_SEQUENCE",
            passed: false,
            message: "Cannot activate specification without completing Reviewed-by-all stage.",
          },
        ],
        state,
        errorMessage: "Must reach Reviewed-by-all stage before activation.",
      };
    }

    // Gate: Spec hash unchanged since evaluation AND shadowing
    const hashUnchanged =
      currentHash === state.evaluatedSpecHash &&
      currentHash === state.shadowedSpecHash;

    gates.push({
      gate: "SPEC_HASH_UNCHANGED",
      passed: hashUnchanged,
      message: hashUnchanged
        ? "Spec hash strictly matches evaluation and shadow baseline."
        : "Spec hash changed since evaluation/shadowing. Activation blocked.",
      details: {
        evaluated: state.evaluatedSpecHash,
        shadowed: state.shadowedSpecHash,
        current: currentHash,
      },
    });

    if (!hashUnchanged) {
      const resetState = resetLadder(
        proposalId,
        "Spec content hash changed after shadowing. Resetting ladder to Draft.",
        sqlite
      );
      return {
        success: false,
        previousStage: state.currentStage,
        newStage: "Draft",
        gates,
        state: resetState,
        errorMessage: "Spec content hash changed since review. Activation blocked. Ladder reset to Draft.",
      };
    }

    // Activate the specification
    sqlite
      .prepare(
        `UPDATE spec_activation_ladder
         SET current_stage = 'Active',
             active_spec_hash = ?,
             updated_at = ?
         WHERE proposal_id = ?`
      )
      .run(currentHash, now, proposalId);

    // Also update clinic_proposals table status to 'ACTIVE'
    sqlite
      .prepare(
        `UPDATE clinic_proposals
         SET status = 'ACTIVE', updated_at = ?
         WHERE id = ?`
      )
      .run(now, proposalId);

    appendChainedAuditEvent(sqlite, {
      entityType: "WorkflowSpec",
      entityId: proposalId,
      actor: (options.actor === "DEMO_REVIEWER" || options.actor === "SYSTEM" ? options.actor : "WORKFLOW"),
      action: "WorkflowSpec ACTIVATED · simulated",
      detail: `Specification for proposal ${proposalId} (version ${spec.spec_version}, hash: ${currentHash.slice(0, 16)}) is now ACTIVE. Simulated portfolio state only.`,
      at: now,
      metadata: { hash: currentHash, specVersion: spec.spec_version, stage: "Active" },
    });

    return {
      success: true,
      previousStage: state.currentStage,
      newStage: "Active",
      gates,
      state: getLadderState(proposalId, sqlite),
    };
  }

  // ==========================================
  // TRANSITION: -> Draft (Manual reset)
  // ==========================================
  if (targetStage === "Draft") {
    const resetState = resetLadder(proposalId, options.notes || "Manual reset to Draft", sqlite);
    return {
      success: true,
      previousStage: state.currentStage,
      newStage: "Draft",
      gates: [{ gate: "MANUAL_RESET", passed: true, message: "Reset to Draft" }],
      state: resetState,
    };
  }

  return {
    success: false,
    previousStage: state.currentStage,
    newStage: state.currentStage,
    gates: [{ gate: "UNKNOWN_STAGE", passed: false, message: `Unknown stage ${targetStage}` }],
    state,
    errorMessage: `Unknown stage ${targetStage}`,
  };
}

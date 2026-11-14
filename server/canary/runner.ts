/**
 * Canary Deployment Runner with Automatic Rollback.
 *
 * Implements canary traffic distribution and continuous safety evaluation.
 * If candidate spec causes an under-escalation (routes concerning case to DRAFT_FOR_REVIEW
 * where baseline escalated to HUMAN_REVIEW_REQUIRED) or breaches safety threshold:
 * -> Automatically triggers config rollback to previous active spec.
 * -> Records append-only, hash-chained audit event.
 *
 * PERMANENT AGENT RULES:
 * - Deterministic pure TypeScript execution.
 * - Zero external outbound effects.
 * - Hash-chained audit event on automatic rollback.
 */

import Database from "better-sqlite3";
import { evaluatePolicy } from "../../shared/policy/evaluator";
import { appendChainedAuditEvent } from "../audit-chain";
import { getSqlite } from "../db";
import type { SyntheticTrafficCase } from "../traffic/types";
import type {
  CanaryCaseExecution,
  CanaryConfig,
  CanaryRunResult,
} from "./types";

export function runCanaryTraffic(
  config: CanaryConfig,
  cases: SyntheticTrafficCase[],
  sqlite: Database.Database = getSqlite()
): CanaryRunResult {
  const executedAt = new Date().toISOString();
  const caseExecutions: CanaryCaseExecution[] = [];

  let activeCount = 0;
  let canaryCount = 0;
  let breachDetected = false;
  let breachReason: string | undefined;

  const trafficShare = Math.min(1.0, Math.max(0.01, config.trafficShare));
  const maxUnderEscalations = config.maxUnderEscalations ?? 0;
  let underEscalationCount = 0;

  for (let i = 0; i < cases.length; i++) {
    const trafficCase = cases[i];
    // Deterministic traffic split: share determines proportion
    const step = trafficShare >= 0.99 ? 1 : Math.max(1, Math.round(1 / trafficShare));
    const assignedToCanary = step === 1 ? true : (i % step) === 0;

    const activeResult = evaluatePolicy(trafficCase.submission, config.activeSpec);

    if (assignedToCanary) {
      canaryCount++;
      const canaryResult = evaluatePolicy(trafficCase.submission, config.candidateSpec);

      let isCaseBreach = false;
      let caseBreachReason: string | undefined;

      // CRITICAL SAFETY BREACH: Candidate spec under-escalates a concerning case
      if (
        activeResult.route === "HUMAN_REVIEW_REQUIRED" &&
        canaryResult.route === "DRAFT_FOR_REVIEW"
      ) {
        isCaseBreach = true;
        underEscalationCount++;
        caseBreachReason = `Under-escalation breach: active policy routed to HUMAN_REVIEW_REQUIRED (reason: ${activeResult.primaryReason}), but canary routed to DRAFT_FOR_REVIEW (reason: ${canaryResult.primaryReason}).`;
      }

      if (isCaseBreach && underEscalationCount > maxUnderEscalations && !breachDetected) {
        breachDetected = true;
        breachReason = caseBreachReason;
      }

      caseExecutions.push({
        caseId: trafficCase.id,
        patientId: trafficCase.submission.patientId,
        assignedTo: "CANARY",
        activeRoute: activeResult.route,
        canaryRoute: canaryResult.route,
        isBreach: isCaseBreach,
        breachReason: caseBreachReason,
      });
    } else {
      activeCount++;
      caseExecutions.push({
        caseId: trafficCase.id,
        patientId: trafficCase.submission.patientId,
        assignedTo: "ACTIVE",
        activeRoute: activeResult.route,
        isBreach: false,
      });
    }
  }

  let rolledBack = false;
  let rolledBackToSpecVersion: string | undefined;
  let rolledBackToSpecHash: string | undefined;
  let auditEventId: string | undefined;

  // AUTOMATIC ROLLBACK TRIGGER
  if (breachDetected) {
    rolledBack = true;
    rolledBackToSpecVersion = config.previousActiveSpec.spec_version;
    rolledBackToSpecHash = config.previousActiveSpec.content_hash;

    // Rollback ladder stage and active spec in database
    sqlite
      .prepare(
        `UPDATE spec_activation_ladder
         SET current_stage = 'Active',
             active_spec_hash = ?,
             last_reset_reason = ?,
             updated_at = ?
         WHERE proposal_id = ?`
      )
      .run(
        config.previousActiveSpec.content_hash,
        `Canary breach rollback: ${breachReason}`,
        executedAt,
        config.proposalId
      );

    // Record append-only hash-chained audit event
    const auditRow = appendChainedAuditEvent(sqlite, {
      entityType: "WorkflowSpec",
      entityId: config.proposalId,
      actor: "SYSTEM",
      action: "Canary breach: automatic rollback to previous active spec",
      detail: `Canary safety breach detected on proposal ${config.proposalId}: ${breachReason}. Automatic config rollback executed to previous active spec version ${config.previousActiveSpec.spec_version} (hash: ${config.previousActiveSpec.content_hash?.slice(0, 16)}). Simulated state only.`,
      at: executedAt,
      metadata: {
        proposalId: config.proposalId,
        candidateVersion: config.candidateSpec.spec_version,
        candidateHash: config.candidateSpec.content_hash,
        rolledBackToVersion: config.previousActiveSpec.spec_version,
        rolledBackToHash: config.previousActiveSpec.content_hash,
        breachReason,
        underEscalations: underEscalationCount,
      },
    });

    auditEventId = auditRow.id;
  }

  return {
    proposalId: config.proposalId,
    totalTraffic: cases.length,
    activeCount,
    canaryCount,
    breachDetected,
    breachReason,
    rolledBack,
    activeSpecVersion: rolledBack
      ? config.previousActiveSpec.spec_version
      : config.activeSpec.spec_version,
    rolledBackToSpecVersion,
    rolledBackToSpecHash,
    auditEventId,
    caseExecutions,
    executedAt,
  };
}

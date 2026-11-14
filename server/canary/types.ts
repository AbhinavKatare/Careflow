/**
 * Canary Deployment Type Definitions.
 * Manages canary traffic sharing, breach detection, and automatic rollback to previous active spec.
 * PERMANENT RULE: Pure deterministic TypeScript; zero external side effects.
 */

import type { WorkflowSpec, PolicyRoute } from "../../shared/domain/types";

export interface CanaryConfig {
  proposalId: string;
  activeSpec: WorkflowSpec;
  candidateSpec: WorkflowSpec;
  previousActiveSpec: WorkflowSpec;
  trafficShare: number; // e.g. 0.20 for 20%
  maxUnderEscalations?: number; // default 0 (zero tolerance)
  maxSchemaFailureRate?: number; // default 5.0%
}

export interface CanaryCaseExecution {
  caseId: string;
  patientId: string;
  assignedTo: "ACTIVE" | "CANARY";
  activeRoute: PolicyRoute;
  canaryRoute?: PolicyRoute;
  isBreach: boolean;
  breachReason?: string;
}

export interface CanaryRunResult {
  proposalId: string;
  totalTraffic: number;
  activeCount: number;
  canaryCount: number;
  breachDetected: boolean;
  breachReason?: string;
  rolledBack: boolean;
  activeSpecVersion: string;
  rolledBackToSpecVersion?: string;
  rolledBackToSpecHash?: string;
  auditEventId?: string;
  caseExecutions: CanaryCaseExecution[];
  executedAt: string;
}


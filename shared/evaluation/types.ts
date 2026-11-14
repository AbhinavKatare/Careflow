import type { PolicyRoute } from "../policy/types";

export interface FixtureV1 {
  id: string;
  raw_input: {
    patientId: string;
    patientName: string;
    program: string;
    weekStatus: string;
    followUp: "yes" | "no";
    note: string;
    structuredAnswers?: Record<string, unknown>;
    idempotencyKey?: string;
  };
  expected_route: PolicyRoute;
  tags: string[];
  provenance: "hand_written" | "generated";
  rationale: string;
}

export interface EvaluationCaseResult {
  id: string;
  expectedRoute: PolicyRoute;
  actualRoute: PolicyRoute;
  passed: boolean;
  isCriticalMiss: boolean;
  isFalseEscalation: boolean;
  latencyMs: number;
  firedRules: string[];
  primaryReason: string;
  tags: string[];
  provenance: "hand_written" | "generated";
  rationale: string;
}

export interface MetricFraction {
  numerator: number;
  denominator: number;
  rate: number;
  percentage: number;
  formatted: string;
}

export interface EvaluationMetrics {
  total: number;
  passed: number;
  failed: number;
  criticalMisses: number;
  falseEscalationsCount: number;
  safetyGate: "PASS" | "FAIL" | "UNSAFE";

  // Detailed metrics with denominators
  routeAccuracy: MetricFraction;
  reviewRequiredRecall: MetricFraction;
  routineSpecificity: MetricFraction;
  falseEscalations: MetricFraction;
  inputValidationPassRate: MetricFraction;

  // Latency metrics with n
  latencyN: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  latencyMeanMs: number;

  // Backwards-compatible aliases for UI components
  routeAccuracyScore: number;
  reviewRecall: number;
  draftSpecificity: number;
  policyPassRate: number;
  p50Latency: number;
  p95Latency: number;
}

export interface EvaluationRun {
  id: string;
  createdAt: string;
  policyVersion: string;
  contentHash: string;
  fixturesHash: string;
  results: EvaluationCaseResult[];
  metrics: EvaluationMetrics;
  ruleVersion: string;
  fixtureVersion: string;
}


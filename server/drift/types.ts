/**
 * Drift Monitoring Type Definitions.
 * Simple, explainable statistical methods for distribution shift detection.
 * PERMANENT RULE: Pure deterministic TypeScript; zero external side effects.
 */

import type { PolicyRoute } from "../../shared/domain/types";

export type DriftAlertLevel = "NORMAL" | "WARNING" | "DRIFT_ALERT";

export interface WindowMetrics {
  totalCases: number;
  routeCounts: Record<PolicyRoute, number>;
  routeDistribution: Record<PolicyRoute, number>; // percentages 0 - 100
  firedRuleCounts: Record<string, number>;
  firedRuleFrequencies: Record<string, number>; // percentages 0 - 100
  schemaFailureCount: number;
  schemaFailureRate: number; // percentage 0 - 100
  meanDraftEditDistance: number; // average character distance
  reviewerOverrideCount: number;
  reviewerOverrideRate: number; // percentage 0 - 100
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export interface MetricDriftDetail {
  metricName: string;
  baselineValue: number;
  currentValue: number;
  delta: number;
  statisticType: "TOTAL_VARIATION_DISTANCE" | "PERCENTAGE_POINT_DIFF" | "RELATIVE_MULTIPLIER";
  statisticValue: number;
  alertLevel: DriftAlertLevel;
  explanation: string;
}

export interface DriftReport {
  baselineWindow: WindowMetrics;
  currentWindow: WindowMetrics;
  overallAlertLevel: DriftAlertLevel;
  hasActiveAlert: boolean;
  metricDrifts: {
    routeMix: MetricDriftDetail;
    schemaFailureRate: MetricDriftDetail;
    draftEditDistance: MetricDriftDetail;
    reviewerOverrideRate: MetricDriftDetail;
    p95Latency: MetricDriftDetail;
    ruleFrequencies: {
      ruleId: string;
      baselineFreq: number;
      currentFreq: number;
      delta: number;
      alertLevel: DriftAlertLevel;
    }[];
  };
  summaryText: string;
  evaluatedAt: string;
}


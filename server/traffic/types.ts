/**
 * Seeded Synthetic Traffic Generator Types.
 * Generates synthetic patient submissions with controllable distribution shifts.
 * PERMANENT AGENT RULES:
 * - Synthetic Data Only: Demo patient IDs and fake clinical scenarios only.
 * - Raw Inputs Only: Zero outcome-encoding flags inside rawInput.
 * - Pure deterministic TypeScript with seeded PRNG.
 */

import type { CheckInSubmission } from "../pipeline/types";

export interface TrafficShiftConfig {
  seed: number;
  count: number;
  /** Shift axis 1: Informal phrasing, slang, synonyms, colloquial patient terms [0.0 - 1.0] */
  newPhrasingRate: number;
  /** Shift axis 2: Lengthy free-text notes (200-500 chars), rambling descriptions [0.0 - 1.0] */
  moreFreeTextRate: number;
  /** Shift axis 3: Patient expresses uncertainty, ambiguity, questions [0.0 - 1.0] */
  higherUncertaintyRate: number;
  /** Shift axis 4: Novel instruction-like text, indirect injection patterns [0.0 - 1.0] */
  newInjectionRate: number;
  /** Base program name */
  programName?: string;
}

export interface SyntheticTrafficCase {
  id: string;
  submission: CheckInSubmission;
  shiftTags: string[];
  generatedAt: string;
}

export interface TrafficBatch {
  batchId: string;
  config: TrafficShiftConfig;
  cases: SyntheticTrafficCase[];
  generatedAt: string;
}


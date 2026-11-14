export * from "./types";
export * from "./metrics";
export * from "./fixtures-data";
export * from "./runner";

import { FIXTURES_V1 } from "./fixtures-data";
import { executeEvaluation } from "./runner";
import type { EvaluationRun, FixtureV1 } from "./types";
import type { WorkflowSpec } from "../domain/types";

/**
 * Convenience entry point to run full evaluation on standard fixtures.
 */
export function runEvaluationSuite(
  customFixtures?: FixtureV1[],
  spec?: WorkflowSpec,
  options?: { injectCriticalMiss?: boolean }
): EvaluationRun {
  const list = customFixtures ?? FIXTURES_V1;
  return executeEvaluation(list, spec, options);
}


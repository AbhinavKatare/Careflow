import { CheckInSubmissionSchema, type CheckInSubmissionResult } from "./checkin-schema";
import { createCheckIn } from "./engine";
import { patientOptions } from "./fixtures";
import type { DemoCase } from "./types";

/**
 * In-memory idempotency cache for the simulation environment.
 * Maps idempotencyKey -> CheckInSubmissionResult.
 */
const idempotencyStore = new Map<string, CheckInSubmissionResult>();

/**
 * Tracks in-flight submissions to enforce double-submit protection.
 */
const inFlightSubmissions = new Set<string>();

/**
 * Generates a collision-resistant idempotency key for check-in submissions.
 */
export function generateIdempotencyKey(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `idemp-${timestamp}-${randomPart}`;
}

export type SubmitCheckInOptions = {
  simulateFailure?: boolean;
  failureMessage?: string;
  previousCount?: number;
};

/**
 * Deterministic submission processor with Zod validation, idempotency caching,
 * and double-submit protection.
 */
export async function processCheckInSubmission(
  rawInput: unknown,
  options: SubmitCheckInOptions = {}
): Promise<CheckInSubmissionResult> {
  // 1. Zod Validation
  const validated = CheckInSubmissionSchema.parse(rawInput);
  const { idempotencyKey } = validated;

  // 2. Double-submit guard: In-flight deduplication
  if (inFlightSubmissions.has(idempotencyKey)) {
    throw new Error("Duplicate submission in progress. Please wait for the current request to complete.");
  }

  // 3. Idempotency Check: return cached result if identical key was already submitted
  if (idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey)!;
    return {
      ...cached,
      isDuplicate: true,
      message: "Duplicate submission recognized. Existing check-in returned without creating a new record.",
    };
  }

  // 4. Mark in-flight
  inFlightSubmissions.add(idempotencyKey);

  try {
    // 5. Simulated API failure mode (for testing resilience & error/retry states)
    if (options.simulateFailure) {
      throw new Error(options.failureMessage || "Simulated network or server error during check-in submission.");
    }

    // 6. Look up patient initials if not provided
    const patientMatch = patientOptions.find((p) => p.id === validated.patientId);
    const initials = patientMatch?.initials || validated.patientName.slice(0, 2).toUpperCase();

    // 7. Execute deterministic workflow engine
    const previousCount = options.previousCount ?? idempotencyStore.size;
    const demoCase: DemoCase = createCheckIn(
      {
        patientId: validated.patientId,
        patientName: validated.patientName,
        initials,
        program: validated.program,
        weekStatus: validated.weekStatus,
        followUp: validated.followUp,
        note: validated.note,
        idempotencyKey: validated.idempotencyKey,
      },
      previousCount
    );

    const result: CheckInSubmissionResult = {
      success: true,
      caseId: demoCase.id,
      patientId: demoCase.patientId,
      patientName: demoCase.patientName,
      program: demoCase.program,
      route: demoCase.route,
      status: demoCase.status,
      latencyMs: demoCase.latencyMs,
      submittedAt: demoCase.submittedAt,
      idempotencyKey,
      isDuplicate: false,
      message:
        demoCase.route === "DRAFT_FOR_REVIEW"
          ? "Check-in received and routine draft prepared for staff review."
          : "Check-in received and routed to staff review.",
    };

    // 8. Store in idempotency cache
    idempotencyStore.set(idempotencyKey, result);

    return result;
  } finally {
    // Release in-flight lock
    inFlightSubmissions.delete(idempotencyKey);
  }
}

/**
 * Helper to reset idempotency store in test environments.
 */
export function resetIdempotencyStore(): void {
  idempotencyStore.clear();
  inFlightSubmissions.clear();
}

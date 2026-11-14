/**
 * Evidence Pack Verifier.
 * Verifies the cryptographic integrity and completeness of an exported Evidence Pack.
 * Detects any tampering, spec modification, or altered evaluation metrics.
 * PERMANENT RULE: Pure deterministic TypeScript; zero external side effects.
 */

import { computeWorkflowSpecHash } from "../../shared/domain/workflow-spec";
import { computePackContentHash } from "./generator";
import type {
  EvidencePack,
  EvidencePackData,
  EvidencePackVerificationResult,
} from "./types";

/**
 * Cryptographically verifies an Evidence Pack object or exported JSON string.
 */
export function verifyEvidencePack(
  packInput: EvidencePack | string
): EvidencePackVerificationResult {
  const errors: string[] = [];

  let pack: EvidencePack;
  if (typeof packInput === "string") {
    try {
      pack = JSON.parse(packInput);
    } catch (parseErr) {
      return {
        valid: false,
        packContentHashMatch: false,
        specHashMatch: false,
        auditChainValid: false,
        errors: [`Invalid JSON format in evidence pack: ${String(parseErr)}`],
      };
    }
  } else {
    // Clone to prevent mutating caller object
    pack = JSON.parse(JSON.stringify(packInput));
  }

  // 1. Verify Pack Content Hash
  const storedPackHash = pack.packContentHash;
  if (!storedPackHash || !storedPackHash.startsWith("sha256:")) {
    errors.push("Evidence pack missing valid packContentHash header.");
  }

  // Create pack data without packContentHash for hash re-computation
  const { packContentHash: _discard, ...packData } = pack;
  const recomputedPackHash = computePackContentHash(packData as EvidencePackData);

  const packContentHashMatch = storedPackHash === recomputedPackHash;
  if (!packContentHashMatch) {
    errors.push(
      `TAMPER DETECTED: Evidence pack content hash mismatch. Expected ${storedPackHash}, recomputed ${recomputedPackHash}. Document has been altered after export.`
    );
  }

  // 2. Verify Spec Content Hash
  let specHashMatch = false;
  if (pack.spec) {
    const recomputedSpecHash = computeWorkflowSpecHash(pack.spec);
    specHashMatch = pack.contentHash === recomputedSpecHash;
    if (!specHashMatch) {
      errors.push(
        `SPEC TAMPER DETECTED: Specification content hash mismatch. Recorded ${pack.contentHash}, recomputed ${recomputedSpecHash}. Specification was modified.`
      );
    }
  } else {
    errors.push("Evidence pack missing specification definition.");
  }

  // 3. Verify Audit Chain Status
  const auditChainValid = pack.auditChainVerification?.valid === true;
  if (!auditChainValid) {
    errors.push("Audit chain verification record indicates invalid or broken chaining.");
  }

  // 4. Verify Safety Gates Integrity
  if (pack.evaluationResults) {
    if (pack.evaluationResults.criticalMisses > 0) {
      errors.push(
        `SAFETY GATE FAILED: Evaluation results report ${pack.evaluationResults.criticalMisses} critical misses.`
      );
    }
    if (pack.evaluationResults.safetyGate !== "PASS") {
      errors.push("SAFETY GATE FAILED: Evaluation safety gate is not PASS.");
    }
  } else {
    errors.push("Evidence pack missing evaluation results.");
  }

  if (pack.mutationReport) {
    if (pack.mutationReport.severityLoweringSurvivingCount > 0) {
      errors.push(
        `SAFETY GATE FAILED: ${pack.mutationReport.severityLoweringSurvivingCount} severity-lowering mutants survived in mutation testing.`
      );
    }
    if (pack.mutationReport.gateStatus !== "PASS") {
      errors.push("SAFETY GATE FAILED: Mutation testing gate status is not PASS.");
    }
  }

  if (pack.shadowReport) {
    if (pack.shadowReport.unsafeDisagreementsCount > 0) {
      errors.push(
        `SAFETY GATE FAILED: ${pack.shadowReport.unsafeDisagreementsCount} unsafe disagreements (under-escalations) detected in shadow run.`
      );
    }
    if (pack.shadowReport.gateStatus !== "PASS") {
      errors.push("SAFETY GATE FAILED: Shadow run gate status is blocked.");
    }
  }

  const valid = errors.length === 0 && packContentHashMatch && specHashMatch;

  return {
    valid,
    packContentHashMatch,
    specHashMatch,
    auditChainValid,
    errors,
  };
}


import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "./db";
import {
  getLadderState,
  recordReviewerSignOff,
  transitionStage,
} from "./ladder/ladder";
import {
  generateEvidencePack,
  exportEvidencePack,
  verifyEvidencePack,
} from "./evidence";
import {
  weeklyCheckInSpec,
  weeklyCheckInTraces,
  unsafeProposalSpec,
} from "./compiler/canned-proposals";
import { computeWorkflowSpecHash } from "../shared/domain/workflow-spec";
import type { WorkflowSpec } from "../shared/domain/types";

describe("Staged Activation Ladder & Evidence Pack (/server/ladder & /server/evidence)", () => {
  let db: Database.Database;
  const proposalId = "prop_test_ladder_001";

  beforeEach(() => {
    db = new Database(":memory:");
    initDatabase(db);
  });

  it("initializes proposal ladder in Draft stage", () => {
    const state = getLadderState(proposalId, db);
    expect(state.proposalId).toBe(proposalId);
    expect(state.currentStage).toBe("Draft");
    expect(state.evaluatedSpecHash).toBeNull();
    expect(state.shadowedSpecHash).toBeNull();
    expect(state.activeSpecHash).toBeNull();
    expect(state.signOffs).toHaveLength(0);
  });

  it("blocks transition to Evaluated if spec is unsafe (validator or critical miss failure)", () => {
    // unsafeProposalSpec routes distress text to DRAFT_FOR_REVIEW
    const res = transitionStage(proposalId, "Evaluated", unsafeProposalSpec, {}, db);

    expect(res.success).toBe(false);
    expect(res.newStage).toBe("Draft");
    expect(res.errorMessage).toBeDefined();

    // Verify validator or safety gate failed
    const failedGate = res.gates.find((g) => !g.passed);
    expect(failedGate).toBeDefined();

    const state = getLadderState(proposalId, db);
    expect(state.currentStage).toBe("Draft");
    expect(state.evaluatedSpecHash).toBeNull();
  });

  it("advances valid spec from Draft to Evaluated with 0 critical misses and 100% mutation score", () => {
    const res = transitionStage(proposalId, "Evaluated", weeklyCheckInSpec, { actor: "TEST_RUNNER" }, db);

    expect(res.success).toBe(true);
    expect(res.previousStage).toBe("Draft");
    expect(res.newStage).toBe("Evaluated");

    // All gates must pass
    expect(res.gates.every((g) => g.passed)).toBe(true);

    const state = getLadderState(proposalId, db);
    expect(state.currentStage).toBe("Evaluated");
    expect(state.evaluatedSpecHash).toBe(weeklyCheckInSpec.content_hash);
  });

  it("blocks advancing to Shadowed if stage sequence is skipped", () => {
    // Attempting to jump directly from Draft to Shadowed
    const res = transitionStage(proposalId, "Shadowed", weeklyCheckInSpec, {}, db);

    expect(res.success).toBe(false);
    expect(res.newStage).toBe("Draft");
    expect(res.errorMessage).toContain("Must complete Evaluated stage before Shadowed");
  });

  it("advances from Evaluated to Shadowed when replay passes agreement gate with 0 unsafe disagreements", () => {
    // Step 1: Evaluated
    transitionStage(proposalId, "Evaluated", weeklyCheckInSpec, {}, db);

    // Step 2: Shadowed
    const res = transitionStage(proposalId, "Shadowed", weeklyCheckInSpec, {}, db);

    expect(res.success).toBe(true);
    expect(res.newStage).toBe("Shadowed");
    expect(res.gates.every((g) => g.passed)).toBe(true);

    const state = getLadderState(proposalId, db);
    expect(state.currentStage).toBe("Shadowed");
    expect(state.shadowedSpecHash).toBe(weeklyCheckInSpec.content_hash);
  });

  it("collects required reviewer sign-offs and advances to Reviewed-by-all", () => {
    // Prepare through Shadowed stage
    transitionStage(proposalId, "Evaluated", weeklyCheckInSpec, {}, db);
    transitionStage(proposalId, "Shadowed", weeklyCheckInSpec, {}, db);

    // Sign-off 1: Clinical Lead
    const state1 = recordReviewerSignOff(
      proposalId,
      { reviewerId: "dr_smith", role: "Clinical Lead", notes: "Clinical safety rules verified." },
      weeklyCheckInSpec,
      db
    );
    expect(state1.currentStage).toBe("Shadowed"); // Not all signed off yet
    expect(state1.signOffs).toHaveLength(1);

    // Sign-off 2: Compliance Officer
    const state2 = recordReviewerSignOff(
      proposalId,
      { reviewerId: "compliance_01", role: "Compliance Officer", notes: "Zero PHI policy verified." },
      weeklyCheckInSpec,
      db
    );
    expect(state2.currentStage).toBe("Shadowed");
    expect(state2.signOffs).toHaveLength(2);

    // Sign-off 3: QA Reviewer (completes required roles)
    const state3 = recordReviewerSignOff(
      proposalId,
      { reviewerId: "qa_lead", role: "QA Reviewer", notes: "100% mutation score confirmed." },
      weeklyCheckInSpec,
      db
    );
    expect(state3.currentStage).toBe("Reviewed-by-all"); // Automatically advanced!
    expect(state3.signOffs).toHaveLength(3);
  });

  it("activates specification when in Reviewed-by-all and spec hash is unchanged", () => {
    // Advance through stages
    transitionStage(proposalId, "Evaluated", weeklyCheckInSpec, {}, db);
    transitionStage(proposalId, "Shadowed", weeklyCheckInSpec, {}, db);
    recordReviewerSignOff(proposalId, { reviewerId: "r1", role: "Clinical Lead" }, weeklyCheckInSpec, db);
    recordReviewerSignOff(proposalId, { reviewerId: "r2", role: "Compliance Officer" }, weeklyCheckInSpec, db);
    recordReviewerSignOff(proposalId, { reviewerId: "r3", role: "QA Reviewer" }, weeklyCheckInSpec, db);

    const activeRes = transitionStage(proposalId, "Active", weeklyCheckInSpec, { actor: "ADMIN" }, db);
    expect(activeRes.success).toBe(true);
    expect(activeRes.newStage).toBe("Active");

    const state = getLadderState(proposalId, db);
    expect(state.currentStage).toBe("Active");
    expect(state.activeSpecHash).toBe(weeklyCheckInSpec.content_hash);
  });

  it("CRITICAL RULE: Editing a spec resets its ladder back to Draft and clears all sign-offs", () => {
    // Advance all the way to Reviewed-by-all
    transitionStage(proposalId, "Evaluated", weeklyCheckInSpec, {}, db);
    transitionStage(proposalId, "Shadowed", weeklyCheckInSpec, {}, db);
    recordReviewerSignOff(proposalId, { reviewerId: "r1", role: "Clinical Lead" }, weeklyCheckInSpec, db);
    recordReviewerSignOff(proposalId, { reviewerId: "r2", role: "Compliance Officer" }, weeklyCheckInSpec, db);
    recordReviewerSignOff(proposalId, { reviewerId: "r3", role: "QA Reviewer" }, weeklyCheckInSpec, db);

    const beforeEdit = getLadderState(proposalId, db);
    expect(beforeEdit.currentStage).toBe("Reviewed-by-all");

    // Deliberate edit to specification (e.g. change a description or limit)
    const editedSpec: WorkflowSpec = {
      ...weeklyCheckInSpec,
      spec_version: "1.0.1",
      limits: {
        ...weeklyCheckInSpec.limits,
        max_note_length: 550,
      },
      content_hash: computeWorkflowSpecHash({
        ...weeklyCheckInSpec,
        spec_version: "1.0.1",
        limits: { ...weeklyCheckInSpec.limits, max_note_length: 550 },
      }),
    };

    // Attempt to activate with the edited spec -> MUST FAIL AND RESET!
    const activeRes = transitionStage(proposalId, "Active", editedSpec, {}, db);
    expect(activeRes.success).toBe(false);
    expect(activeRes.newStage).toBe("Draft");
    expect(activeRes.errorMessage).toContain("Spec content hash changed");

    // Ladder must be reset to Draft
    const afterReset = getLadderState(proposalId, db);
    expect(afterReset.currentStage).toBe("Draft");
    expect(afterReset.evaluatedSpecHash).toBeNull();
    expect(afterReset.shadowedSpecHash).toBeNull();
    expect(afterReset.activeSpecHash).toBeNull();
    expect(afterReset.signOffs).toHaveLength(0);
    expect(afterReset.lastResetReason).toContain("Spec content hash changed");
  });

  it("generates, exports, and cryptographically verifies an Evidence Pack", () => {
    const packExport = exportEvidencePack(weeklyCheckInSpec, weeklyCheckInTraces, { sqlite: db });

    expect(packExport.packContentHash).toBeDefined();
    expect(packExport.packContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(packExport.json).toBeDefined();
    expect(packExport.markdown).toContain("# Evidence Pack");
    expect(packExport.markdown).toContain(packExport.packContentHash);

    // Verify valid pack
    const verification = verifyEvidencePack(packExport.json);
    expect(verification.valid).toBe(true);
    expect(verification.packContentHashMatch).toBe(true);
    expect(verification.specHashMatch).toBe(true);
    expect(verification.auditChainValid).toBe(true);
    expect(verification.errors).toHaveLength(0);
  });

  it("detects tampering when an Evidence Pack is altered after export", () => {
    const pack = generateEvidencePack(weeklyCheckInSpec, weeklyCheckInTraces, { sqlite: db });

    // Tampering test 1: Modify a metric inside the pack
    const tamperedPack = JSON.parse(JSON.stringify(pack));
    tamperedPack.evaluationResults.routeAccuracy = 42.0; // modified metric from original

    const tamperedVerification = verifyEvidencePack(tamperedPack);
    expect(tamperedVerification.valid).toBe(false);
    expect(tamperedVerification.packContentHashMatch).toBe(false);
    expect(tamperedVerification.errors.some((e) => e.includes("TAMPER DETECTED"))).toBe(true);

    // Tampering test 2: Modify a rule inside the spec
    const tamperedSpecPack = JSON.parse(JSON.stringify(pack));
    tamperedSpecPack.spec.rule_list[0].description = "Tampered description";

    const tamperedSpecVerification = verifyEvidencePack(tamperedSpecPack);
    expect(tamperedSpecVerification.valid).toBe(false);
    expect(tamperedSpecVerification.specHashMatch).toBe(false);
    expect(tamperedSpecVerification.errors.some((e) => e.includes("SPEC TAMPER DETECTED"))).toBe(true);
  });
});

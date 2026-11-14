import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "./db";
import {
  compileSOP,
  decideProposal,
  getProposalById,
  listProposals,
  listSampleSOPs,
  validateWorkflowSpecProposal,
  weeklyCheckInSpec,
  postVisitSpec,
  medicationAdherenceSpec,
  unsafeProposalSpec,
} from "./compiler";

describe("Clinic SOP Compiler & Validator (/server/compiler)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initDatabase(db);
  });

  it("lists all 3 synthetic clinic sample SOPs", () => {
    const samples = listSampleSOPs();
    expect(samples).toHaveLength(3);
    const names = samples.map((s) => s.name);
    expect(names).toContain("Weekly Check-in");
    expect(names).toContain("Post-Visit Follow-Up");
    expect(names).toContain("Medication Adherence");

    for (const sample of samples) {
      expect(sample.markdown.length).toBeGreaterThan(100);
      expect(sample.markdown).toContain("Section");
    }
  });

  it("compiles Weekly Check-in SOP into a valid proposal with line-level traces", () => {
    const samples = listSampleSOPs();
    const weekly = samples.find((s) => s.name === "Weekly Check-in")!;

    const proposal = compileSOP(weekly.markdown, weekly.name, db);

    expect(proposal.id).toMatch(/^prop_/);
    expect(proposal.status).toBe("PROPOSED"); // Proposals never become active by themselves
    expect(proposal.validation.valid).toBe(true);
    expect(proposal.traces.length).toBeGreaterThanOrEqual(10);

    // Verify line-level sentence-to-rule traceability
    const trace = proposal.traces.find((t) => t.ruleId === "RULE_CONTROLLED_URGENT_LANGUAGE");
    expect(trace).toBeDefined();
    expect(trace?.sopSentenceNumber).toBe(13);
    expect(trace?.sopSentenceText).toContain("emergency");

    // Persisted in DB
    const fetched = getProposalById(proposal.id, db);
    expect(fetched).toBeDefined();
    expect(fetched?.sopName).toBe("Weekly Check-in");
    expect(fetched?.status).toBe("PROPOSED");
  });

  it("compiles Post-Visit Follow-Up SOP into a valid proposal", () => {
    const samples = listSampleSOPs();
    const postVisit = samples.find((s) => s.name === "Post-Visit Follow-Up")!;

    const proposal = compileSOP(postVisit.markdown, postVisit.name, db);

    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.validation.valid).toBe(true);
    expect(proposal.proposedSpec.spec_id).toBe(postVisitSpec.spec_id);
    expect(proposal.traces.length).toBeGreaterThanOrEqual(9);

    const contactTrace = proposal.traces.find((t) => t.ruleId === "RULE_PV_STAFF_CONTACT");
    expect(contactTrace?.sopSentenceNumber).toBe(11);
  });

  it("compiles Medication Adherence SOP into a valid proposal", () => {
    const samples = listSampleSOPs();
    const medAdherence = samples.find((s) => s.name === "Medication Adherence")!;

    const proposal = compileSOP(medAdherence.markdown, medAdherence.name, db);

    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.validation.valid).toBe(true);
    expect(proposal.proposedSpec.spec_id).toBe(medicationAdherenceSpec.spec_id);
    expect(proposal.traces.length).toBeGreaterThanOrEqual(9);

    const missedDoseTrace = proposal.traces.find((t) => t.ruleId === "RULE_MA_MISSED_OR_QUESTIONS");
    expect(missedDoseTrace?.sopSentenceNumber).toBe(11);
  });

  it("deterministic validator REJECTS deliberately unsafe proposal with multiple critical failures", () => {
    const validation = validateWorkflowSpecProposal(unsafeProposalSpec);

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);

    // 1. Concerning text to draft check
    const concerningTextCheck = validation.checks.find(
      (c) => c.name === "no_concerning_text_to_draft"
    );
    expect(concerningTextCheck?.passed).toBe(false);

    // 2. Prohibited unsafe constructs check (eval)
    const unsafeConstructsCheck = validation.checks.find(
      (c) => c.name === "no_unsafe_constructs"
    );
    expect(unsafeConstructsCheck?.passed).toBe(false);

    // 3. Limits spec check (negative note length)
    const limitsCheck = validation.checks.find((c) => c.name === "limits_specification");
    expect(limitsCheck?.passed).toBe(false);

    // Compile unsafe SOP proposal
    const unsafeProposal = compileSOP(
      "Sentence 1: Deliberately unsafe SOP routing chest pain to draft.",
      "Deliberately Unsafe Clinic SOP",
      db
    );
    expect(unsafeProposal.validation.valid).toBe(false);
  });

  it("supports human review decision lifecycle: ACCEPTED, REJECTED, and EDITED", () => {
    const samples = listSampleSOPs();
    const weekly = samples.find((s) => s.name === "Weekly Check-in")!;
    const proposal = compileSOP(weekly.markdown, weekly.name, db);

    // Reject proposal
    const rejected = decideProposal(proposal.id, "REJECTED", "Needs custom phrasing", undefined, db);
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.reviewerNotes).toBe("Needs custom phrasing");

    // Re-compile another proposal and accept
    const proposal2 = compileSOP(weekly.markdown, weekly.name, db);
    const accepted = decideProposal(proposal2.id, "ACCEPTED", "Approved for simulation", undefined, db);
    expect(accepted?.status).toBe("ACCEPTED");

    // Edit proposal
    const editedSpec = {
      ...weeklyCheckInSpec,
      limits: {
        ...weeklyCheckInSpec.limits,
        max_note_length: 600,
      },
    };
    const edited = decideProposal(
      proposal2.id,
      "EDITED",
      "Increased note limit to 600",
      editedSpec,
      db
    );
    expect(edited?.status).toBe("EDITED");
    expect(edited?.proposedSpec.limits.max_note_length).toBe(600);
    expect(edited?.validation.valid).toBe(true);

    // Verify audit trail logged human decisions
    const auditEvents = db.prepare("SELECT * FROM audit_events WHERE entity_id = ?").all(proposal2.id) as any[];
    expect(auditEvents.length).toBeGreaterThanOrEqual(2);
    expect(auditEvents.some((e) => e.action.includes("accepted"))).toBe(true);
    expect(auditEvents.some((e) => e.action.includes("edited"))).toBe(true);

    const storedProposals = listProposals(db);
    expect(storedProposals.length).toBe(2);
  });
});

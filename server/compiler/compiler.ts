import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getSqlite } from "../db";
import { appendChainedAuditEvent } from "../audit-chain";
import {
  medicationAdherenceSpec,
  medicationAdherenceTraces,
  postVisitSpec,
  postVisitTraces,
  weeklyCheckInSpec,
  weeklyCheckInTraces,
  unsafeProposalSpec,
} from "./canned-proposals";
import type { CompilationProposal, SOPTrace } from "./types";
import { validateWorkflowSpecProposal } from "./validator";
import type { WorkflowSpec } from "../../shared/domain/types";
import { computeWorkflowSpecHash } from "../../shared/domain/workflow-spec";
import { resetLadder } from "../ladder/ladder";

const SAMPLES_DIR = path.resolve(process.cwd(), "samples");

export interface SampleSOP {
  id: string;
  name: string;
  title: string;
  filename: string;
  markdown: string;
}

/**
 * Lists available sample clinic SOP markdown files.
 */
export function listSampleSOPs(): SampleSOP[] {
  const samples = [
    {
      id: "sample_weekly_checkin",
      name: "Weekly Check-in",
      title: "Remote Weekly Routine Check-in (Workflow Demo)",
      filename: "weekly-checkin.md",
    },
    {
      id: "sample_post_visit",
      name: "Post-Visit Follow-Up",
      title: "Outpatient Post-Visit Follow-Up (Workflow Demo)",
      filename: "post-visit-followup.md",
    },
    {
      id: "sample_med_adherence",
      name: "Medication Adherence",
      title: "Medication-Adherence Routine Check-in (Workflow Demo)",
      filename: "medication-adherence.md",
    },
  ];

  return samples.map((s) => {
    let markdown = "";
    try {
      const filePath = path.join(SAMPLES_DIR, s.filename);
      if (fs.existsSync(filePath)) {
        markdown = fs.readFileSync(filePath, "utf-8");
      }
    } catch {
      markdown = `# ${s.title}\nSample SOP content.`;
    }
    return {
      ...s,
      markdown,
    };
  });
}

/**
 * Compiles a clinic SOP markdown into a non-binding WorkflowSpec proposal with line-level traces and validation.
 * PERMANENT AGENT RULE:
 * - Deterministic validation ensures safety rules are present and concerning text is not routed to draft.
 * - Proposals never become active by themselves; human accept/edit step required.
 */
export function compileSOP(
  sopMarkdown: string,
  sopName: string,
  sqlite: Database.Database = getSqlite()
): CompilationProposal {
  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  let proposedSpec: WorkflowSpec;
  let traces: SOPTrace[];

  const lowerName = sopName.toLowerCase();
  const lowerContent = sopMarkdown.toLowerCase();

  // Route to corresponding deterministic compilation model
  if (lowerName.includes("unsafe") || lowerContent.includes("deliberately unsafe")) {
    proposedSpec = unsafeProposalSpec;
    traces = [
      {
        ruleId: "RULE_UNSAFE_ROUTING_DISTRESS_TO_DRAFT",
        sopSentenceNumber: 1,
        sopSentenceText: "Deliberately unsafe test sentence routing chest pain to draft.",
        section: "Unsafe Section",
        rationale: "Unsafe test fixture mapping.",
      },
    ];
  } else if (lowerName.includes("post-visit") || lowerName.includes("post_visit") || lowerContent.includes("post-visit")) {
    proposedSpec = postVisitSpec;
    traces = postVisitTraces;
  } else if (lowerName.includes("medication") || lowerName.includes("adherence") || lowerContent.includes("adherence")) {
    proposedSpec = medicationAdherenceSpec;
    traces = medicationAdherenceTraces;
  } else {
    // Default to Weekly Check-in
    proposedSpec = weeklyCheckInSpec;
    traces = weeklyCheckInTraces;
  }

  // Run deterministic validator
  const validation = validateWorkflowSpecProposal(proposedSpec);

  const proposal: CompilationProposal = {
    id: proposalId,
    sopName,
    sopMarkdown,
    proposedSpec,
    traces,
    validation,
    status: "PROPOSED",
    createdAt: now,
    updatedAt: now,
  };

  // Persist proposal into SQLite
  sqlite
    .prepare(
      `INSERT INTO clinic_proposals (
        id, sop_name, sop_markdown, proposed_spec, traces, validation,
        status, reviewer_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      proposal.id,
      proposal.sopName,
      proposal.sopMarkdown,
      JSON.stringify(proposal.proposedSpec),
      JSON.stringify(proposal.traces),
      JSON.stringify(proposal.validation),
      proposal.status,
      null,
      proposal.createdAt,
      proposal.updatedAt
    );

  appendChainedAuditEvent(sqlite, {
    entityType: "ClinicProposal",
    entityId: proposalId,
    actor: "WORKFLOW",
    action: "SOP compiled to proposal",
    detail: `Compiled SOP "${sopName}" into proposal ${proposalId}. Validator passed: ${validation.valid}. Non-binding proposal; pending human review.`,
    at: now,
    metadata: { valid: validation.valid, specVersion: proposedSpec.spec_version },
  });

  return proposal;
}

/**
 * Lists all stored clinic proposals from SQLite.
 */
export function listProposals(sqlite: Database.Database = getSqlite()): CompilationProposal[] {
  const rows = sqlite
    .prepare("SELECT * FROM clinic_proposals ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: r.id as string,
    sopName: r.sop_name as string,
    sopMarkdown: r.sop_markdown as string,
    proposedSpec: JSON.parse(r.proposed_spec as string),
    traces: JSON.parse(r.traces as string),
    validation: JSON.parse(r.validation as string),
    status: r.status as CompilationProposal["status"],
    reviewerNotes: (r.reviewer_notes as string) || undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

/**
 * Gets a proposal by ID from SQLite.
 */
export function getProposalById(id: string, sqlite: Database.Database = getSqlite()): CompilationProposal | undefined {
  const row = sqlite
    .prepare("SELECT * FROM clinic_proposals WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  return {
    id: row.id as string,
    sopName: row.sop_name as string,
    sopMarkdown: row.sop_markdown as string,
    proposedSpec: JSON.parse(row.proposed_spec as string),
    traces: JSON.parse(row.traces as string),
    validation: JSON.parse(row.validation as string),
    status: row.status as CompilationProposal["status"],
    reviewerNotes: (row.reviewer_notes as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Human review decision step on a proposed WorkflowSpec.
 * Allows human reviewer to ACCEPT, REJECT, or EDIT the proposed specification.
 */
export function decideProposal(
  id: string,
  decision: "ACCEPTED" | "REJECTED" | "EDITED",
  reviewerNotes = "",
  editedSpec?: WorkflowSpec,
  sqlite: Database.Database = getSqlite()
): CompilationProposal | undefined {
  const existing = getProposalById(id, sqlite);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  let finalSpec = existing.proposedSpec;

  if (decision === "EDITED" && editedSpec) {
    finalSpec = {
      ...editedSpec,
      content_hash: computeWorkflowSpecHash(editedSpec),
    };
    // Editing a spec resets its ladder to Draft
    try {
      resetLadder(id, "Specification edited by reviewer. Resetting ladder to Draft.", sqlite);
    } catch {
      // ignore
    }
  }

  // Re-run validator if accepted or edited to guarantee ongoing safety
  const validation = validateWorkflowSpecProposal(finalSpec);

  sqlite
    .prepare(
      `UPDATE clinic_proposals
       SET status = ?, proposed_spec = ?, validation = ?, reviewer_notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      decision,
      JSON.stringify(finalSpec),
      JSON.stringify(validation),
      reviewerNotes || null,
      now,
      id
    );

  appendChainedAuditEvent(sqlite, {
    entityType: "ClinicProposal",
    entityId: id,
    actor: "DEMO_REVIEWER",
    action: `Proposal ${decision.toLowerCase()} · simulated`,
    detail: `Human reviewer marked proposal ${id} as ${decision}. Validator valid: ${validation.valid}. Simulated state only.`,
    at: now,
    metadata: { decision, valid: validation.valid },
  });

  return getProposalById(id, sqlite);
}


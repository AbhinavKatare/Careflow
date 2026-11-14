/**
 * FeedbackLabels Versioned Stratified Dataset Exporter.
 *
 * Exports reviewer actions, redacted inputs, extractions, and drafts into versioned JSONL.
 * Implements deterministic stratified splitting (train / validation / test) with fixed seed.
 * Generates an authoritative DATASET_CARD.md documenting training handoff guidelines.
 *
 * PERMANENT AGENT RULES:
 * - Synthetic Data Only: Obvious fake patient IDs ("DEMO-XXX"). Zero real PHI.
 * - Tiny dataset: Do NOT fine-tune. Benchmark and evaluation handoff only.
 * - Pure deterministic TypeScript with Zod validation.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getSqlite } from "../db";
import {
  FeedbackDatasetRecord,
  FeedbackDatasetRecordSchema,
  FeedbackDatasetExportResult,
} from "./types";

function createPrng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function exportFeedbackDataset(
  options: {
    seed?: number;
    datasetVersion?: string;
    sqlite?: Database.Database;
    exportDir?: string;
  } = {}
): FeedbackDatasetExportResult {
  const seed = options.seed ?? 42;
  const version = options.datasetVersion || "dataset_v1.0.0";
  const sqlite = options.sqlite || getSqlite();
  const exportedAt = "2026-11-12T10:00:00.000Z";

  // Fetch feedback labels joined with review cases
  const rows = sqlite
    .prepare(
      `SELECT
         fl.id as label_id,
         fl.case_id,
         fl.patient_id,
         fl.action,
         fl.reviewer_id,
         fl.prompt_version,
         fl.rule_version,
         fl.edit_distance,
         fl.rejection_reason,
         fl.route_override,
         rc.program,
         rc.week_status,
         rc.follow_up,
         rc.note,
         rc.redacted_preview,
         rc.extracted_facts,
         rc.original_draft,
         rc.draft as final_draft
       FROM feedback_labels fl
       LEFT JOIN review_cases rc ON fl.case_id = rc.id
       ORDER BY fl.id ASC`
    )
    .all() as Record<string, unknown>[];

  // Group by action for stratified splitting
  const grouped: Record<string, Record<string, unknown>[]> = {
    ACCEPTED: [],
    EDITED: [],
    REJECTED: [],
    ROUTE_OVERRIDE: [],
  };

  for (const r of rows) {
    const act = (r.action as string) || "ACCEPTED";
    if (!grouped[act]) grouped[act] = [];
    grouped[act].push(r);
  }

  const prng = createPrng(seed);
  const records: FeedbackDatasetRecord[] = [];

  const splitCounts = { train: 0, validation: 0, test: 0 };

  // Stratify each action category: 70% train, 15% validation, 15% test
  for (const actionRows of Object.values(grouped)) {
    // Deterministic shuffle
    const shuffled = [...actionRows].sort(() => prng() - 0.5);

    const n = shuffled.length;
    const trainEnd = Math.floor(n * 0.7);
    const valEnd = Math.floor(n * 0.85);

    shuffled.forEach((row, idx) => {
      let split: "train" | "validation" | "test";
      if (idx < trainEnd) {
        split = "train";
        splitCounts.train++;
      } else if (idx < valEnd) {
        split = "validation";
        splitCounts.validation++;
      } else {
        split = "test";
        splitCounts.test++;
      }

      // Parse facts
      let facts: Array<{ category: string; value: string; confidence?: number }>;
      try {
        const rawFacts = JSON.parse((row.extracted_facts as string) || "[]");
        facts = rawFacts.map((f: any) => ({
          category: f.category || "GENERAL",
          value: f.value || f.fact || "",
          confidence: f.confidence,
        }));
      } catch {
        facts = [];
      }

      // Safe redacted preview text
      const redactedNote = (row.redacted_preview as string) || (row.note as string) || "";

      const record: FeedbackDatasetRecord = {
        id: (row.label_id as string) || `lbl_${records.length + 1}`,
        case_id: (row.case_id as string) || `case_${records.length + 1}`,
        seed,
        split,
        redacted_inputs: {
          patient_id: (row.patient_id as string) || "DEMO-001",
          program: (row.program as string) || "Weekly check-in",
          week_status: (row.week_status as string) || "On track with my weekly routine",
          follow_up: (row.follow_up as string) || "no",
          redacted_note: redactedNote,
        },
        extracted_facts: facts,
        model_draft: (row.original_draft as string) || null,
        reviewer_action: (row.action as any) || "ACCEPTED",
        reviewer_outcome: {
          action: (row.action as string) || "ACCEPTED",
          edit_distance: typeof row.edit_distance === "number" ? row.edit_distance : null,
          rejection_reason: (row.rejection_reason as string) || null,
          route_override: (row.route_override as string) || null,
          reviewer_id: (row.reviewer_id as string) || "demo_reviewer",
        },
        final_approved_text: (row.final_draft as string) || null,
        prompt_version: (row.prompt_version as string) || "extract_v1",
        rule_version: (row.rule_version as string) || "rules_v1.0",
        exported_at: exportedAt,
      };

      // Zod Schema Validation
      FeedbackDatasetRecordSchema.parse(record);
      records.push(record);
    });
  }

  // Generate JSONL lines
  const jsonlLines = records.map((r) => JSON.stringify(r));
  const jsonlContent = jsonlLines.join("\n") + "\n";

  // Generate Dataset Card
  const datasetCardContent = `# Dataset Card: Careflow Reviewer Feedback Dataset (${version})

## 1. Summary & Non-Clinical Synthetic Notice

> [!IMPORTANT]
> **SYNTHETIC & TINY DATASET ONLY**: This dataset contains **${records.length}** synthetic, simulated check-in records from an independent software portfolio demo. All patient identifiers (\`DEMO-XXX\`), notes, and clinical scenarios are completely invented. **Zero real protected health information (PHI)** is present.

- **Dataset Version:** \`${version}\`
- **Total Records:** ${records.length}
- **Splits:** Train (${splitCounts.train}), Validation (${splitCounts.validation}), Test (${splitCounts.test})
- **Deterministic Seed:** \`${seed}\`

---

## 2. Stratification Breakdown by Reviewer Outcome

| Reviewer Action | Count | Percentage |
| :--- | :--- | :--- |
| **ACCEPTED** (AI draft approved without edit) | ${grouped.ACCEPTED?.length || 0} | ${Number((((grouped.ACCEPTED?.length || 0) / Math.max(1, records.length)) * 100).toFixed(1))}% |
| **EDITED** (Draft accepted with reviewer edits) | ${grouped.EDITED?.length || 0} | ${Number((((grouped.EDITED?.length || 0) / Math.max(1, records.length)) * 100).toFixed(1))}% |
| **REJECTED** (Draft discarded by clinical staff) | ${grouped.REJECTED?.length || 0} | ${Number((((grouped.REJECTED?.length || 0) / Math.max(1, records.length)) * 100).toFixed(1))}% |
| **ROUTE_OVERRIDE** (Automated route changed by human) | ${grouped.ROUTE_OVERRIDE?.length || 0} | ${Number((((grouped.ROUTE_OVERRIDE?.length || 0) / Math.max(1, records.length)) * 100).toFixed(1))}% |

---

## 3. Training Handoff & Governance Notice

> [!WARNING]
> **DO NOT FINE-TUNE ON THIS DATASET**:
> 1. This dataset is **tiny** (${records.length} samples) and serves as an architectural simulation of supervised feedback collection.
> 2. Fine-tuning foundation models on tiny, synthetic datasets produces catastrophic overfitting and hallucinations.
> 3. Intended strictly as an **offline evaluation benchmark** and supervisory calibration test.
> 4. In a clinical deployment, large-scale clinical oversight, IRB protocol approval, and certified data governance boards would be mandatory before fine-tuning any model.

---

## 4. Record Schema Structure

Each JSONL record adheres strictly to the typed Zod schema \`FeedbackDatasetRecordSchema\`:
\`\`\`json
{
  "id": "label_001",
  "case_id": "case_101",
  "seed": 42,
  "split": "train",
  "redacted_inputs": {
    "patient_id": "DEMO-101",
    "program": "Weekly check-in",
    "week_status": "On track with my weekly routine",
    "follow_up": "no",
    "redacted_note": "Smooth recovery on [DATE_1]..."
  },
  "extracted_facts": [
    { "category": "ROUTINE_STATUS", "value": "on track", "confidence": 0.95 }
  ],
  "model_draft": "Thanks for checking in, [PATIENT_NAME_1]...",
  "reviewer_action": "ACCEPTED",
  "reviewer_outcome": {
    "action": "ACCEPTED",
    "edit_distance": 0,
    "rejection_reason": null,
    "route_override": null,
    "reviewer_id": "demo_reviewer_01"
  },
  "final_approved_text": "Thanks for checking in, [PATIENT_NAME_1]...",
  "prompt_version": "extract_v1",
  "rule_version": "rules_v1.0",
  "exported_at": "2026-11-12T10:00:00.000Z"
}
\`\`\`
`;

  // Write files to disk
  const baseDir = options.exportDir || path.join(process.cwd(), "exports", version);
  fs.mkdirSync(baseDir, { recursive: true });

  const jsonlPath = path.join(baseDir, "feedback_dataset.jsonl");
  const datasetCardPath = path.join(baseDir, "DATASET_CARD.md");

  fs.writeFileSync(jsonlPath, jsonlContent, "utf-8");
  fs.writeFileSync(datasetCardPath, datasetCardContent, "utf-8");

  return {
    datasetVersion: version,
    totalRecords: records.length,
    stratification: {
      acceptedCount: grouped.ACCEPTED?.length || 0,
      editedCount: grouped.EDITED?.length || 0,
      rejectedCount: grouped.REJECTED?.length || 0,
      routeOverrideCount: grouped.ROUTE_OVERRIDE?.length || 0,
      splitBreakdown: splitCounts,
    },
    jsonlContent,
    datasetCardContent,
    jsonlPath,
    datasetCardPath,
    schemaValid: true,
    exportedAt,
  };
}

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { initDatabase } from "./db";
import { exportFeedbackDataset } from "./dataset/exporter";
import { FeedbackDatasetRecordSchema } from "./dataset/types";

describe("FeedbackLabels Versioned Dataset Exporter (/server/dataset)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initDatabase(db);

    // Seed synthetic feedback records across all 4 action categories
    const insertLabel = db.prepare(
      `INSERT INTO feedback_labels (
         id, case_id, patient_id, action, reviewer_id, created_at, prompt_version,
         rule_version, edit_distance, rejection_reason, route_override
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertCase = db.prepare(
      `INSERT INTO review_cases (
         id, check_in_id, patient_id, program, week_status, follow_up, note,
         status, route, reason, redacted_preview, extracted_facts, original_draft, draft, submitted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let i = 1; i <= 20; i++) {
      const caseId = `case_test_${i}`;
      const labelId = `lbl_test_${i}`;
      const patientId = `DEMO-${100 + i}`;

      let action: "ACCEPTED" | "EDITED" | "REJECTED" | "ROUTE_OVERRIDE";
      let editDistance: number | null = null;
      let rejectionReason: string | null = null;
      let routeOverride: string | null = null;

      if (i % 4 === 1) {
        action = "ACCEPTED";
      } else if (i % 4 === 2) {
        action = "EDITED";
        editDistance = 14;
      } else if (i % 4 === 3) {
        action = "REJECTED";
        rejectionReason = "unsupported_claim";
      } else {
        action = "ROUTE_OVERRIDE";
        routeOverride = "HUMAN_REVIEW_REQUIRED";
      }

      insertCase.run(
        caseId,
        `chk_${i}`,
        patientId,
        "Weekly follow-up",
        "On track with my weekly routine",
        "no",
        `Sample note from synthetic patient ${i} on recovery progress.`,
        "REVIEWED",
        "DRAFT_FOR_REVIEW",
        "ROUTINE_ON_TRACK",
        `Sample note from synthetic patient ${i} on [REDACTED_TOPIC].`,
        JSON.stringify([{ category: "ROUTINE", value: "on track", confidence: 0.95 }]),
        "Hello Demo Patient, thank you for checking in.",
        "Hello Demo Patient, thank you for checking in. Take care.",
        "2026-11-12T09:00:00.000Z"
      );

      insertLabel.run(
        labelId,
        caseId,
        patientId,
        action,
        "demo_reviewer_01",
        "2026-11-12T09:30:00.000Z",
        "extract_v1",
        "rules_v1.0",
        editDistance,
        rejectionReason,
        routeOverride
      );
    }
  });

  it("exports a versioned stratified JSONL dataset and validates every line with Zod", () => {
    const tempDir = path.join(process.cwd(), "exports", "test_dataset_v1");

    const result = exportFeedbackDataset({
      seed: 42,
      datasetVersion: "test_dataset_v1",
      sqlite: db,
      exportDir: tempDir,
    });

    expect(result.schemaValid).toBe(true);
    expect(result.totalRecords).toBe(20);
    expect(result.stratification.acceptedCount).toBe(5);
    expect(result.stratification.editedCount).toBe(5);
    expect(result.stratification.rejectedCount).toBe(5);
    expect(result.stratification.routeOverrideCount).toBe(5);

    // Verify file outputs exist
    expect(fs.existsSync(result.jsonlPath)).toBe(true);
    expect(fs.existsSync(result.datasetCardPath)).toBe(true);

    // Verify every line in the JSONL file validates against Zod schema
    const rawLines = fs.readFileSync(result.jsonlPath, "utf-8").trim().split("\n");
    expect(rawLines.length).toBe(20);

    for (const line of rawLines) {
      const parsedJson = JSON.parse(line);
      const parsedRecord = FeedbackDatasetRecordSchema.parse(parsedJson);
      expect(parsedRecord.id).toBeDefined();
      expect(parsedRecord.redacted_inputs.patient_id).toMatch(/^DEMO-\d+$/);
      expect(["train", "validation", "test"]).toContain(parsedRecord.split);
    }

    // Clean up temp export files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("DATASET_CARD.md states plainly that data is synthetic & tiny, and documents DO NOT FINE-TUNE handoff", () => {
    const tempDir = path.join(process.cwd(), "exports", "test_dataset_card");

    const result = exportFeedbackDataset({
      seed: 99,
      datasetVersion: "test_dataset_card",
      sqlite: db,
      exportDir: tempDir,
    });

    const cardContent = fs.readFileSync(result.datasetCardPath, "utf-8");

    // Mandatory assertions
    expect(cardContent).toContain("SYNTHETIC & TINY DATASET ONLY");
    expect(cardContent).toContain("Zero real protected health information (PHI)");
    expect(cardContent).toContain("DO NOT FINE-TUNE");
    expect(cardContent.toLowerCase()).toContain("training handoff");
    expect(cardContent).toContain("offline evaluation benchmark");

    // Clean up temp export files
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

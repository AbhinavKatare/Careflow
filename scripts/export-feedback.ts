import fs from "node:fs";
import path from "node:path";
import {
  exportFeedbackDataset,
  listFeedbackLabels,
  computeQualitySignals,
  ExportedFeedbackRecordSchema,
} from "../shared";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPORTS_DIR = path.join(ROOT, "exports");
const OUTPUT_FILE = path.join(EXPORTS_DIR, "feedback_dataset.jsonl");
const DATASET_VERSION = "dataset_v1.0.0";

export function runFeedbackExport(): { count: number; filePath: string } {
  process.stdout.write("\n=== Careflow Feedback Dataset Exporter ===\n");
  process.stdout.write(`Dataset Version: ${DATASET_VERSION}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  // Load stored feedback labels (includes 40 synthetic reviewer actions)
  const labels = listFeedbackLabels();
  process.stdout.write(`[INFO] Loaded ${labels.length} reviewer action records.\n`);

  if (labels.length < 40) {
    process.stderr.write(
      `[FAIL] Expected at least 40 synthetic reviewer actions, found ${labels.length}.\n`
    );
    process.exit(1);
  }

  // Generate and schema-validate JSONL dataset
  const { jsonl, count, validated } = exportFeedbackDataset(labels, DATASET_VERSION);

  if (!validated) {
    process.stderr.write("[FAIL] Feedback dataset failed schema validation.\n");
    process.exit(1);
  }

  // Static privacy check: ensure zero unredacted synthetic names remain in the export
  const lines = jsonl.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const parsed = JSON.parse(rawLine);

    // Validate with Zod
    const zodResult = ExportedFeedbackRecordSchema.safeParse(parsed);
    if (!zodResult.success) {
      process.stderr.write(
        `[FAIL] Line ${idx + 1} failed ExportedFeedbackRecordSchema: ${zodResult.error.message}\n`
      );
      process.exit(1);
    }

    // Verify exclusion of patient identifiers
    const identifierLeakPattern = /Demo Patient \d+|DEMO-\d+/i;
    if (
      identifierLeakPattern.test(parsed.input_redacted) ||
      identifierLeakPattern.test(parsed.draft ?? "")
    ) {
      process.stderr.write(
        `[FAIL] Line ${idx + 1} contains unredacted patient identifier in exported content.\n`
      );
      process.exit(1);
    }
  }

  // Write to destination file
  fs.writeFileSync(OUTPUT_FILE, jsonl, "utf-8");
  process.stdout.write(`[PASS] Written ${count} records to ${path.relative(ROOT, OUTPUT_FILE)}\n`);

  // Output telemetry summary
  const signals = computeQualitySignals(labels);
  process.stdout.write("\n--- Quality Signals Aggregate Summary ---\n");
  process.stdout.write(`Total Reviews:          ${signals.totalReviews}\n`);
  process.stdout.write(
    `Acceptance Rate:        ${signals.acceptanceRate}% (${signals.acceptedCount} approved; ${signals.acceptedUnchangedCount} unchanged, ${signals.editedCount} edited)\n`
  );
  process.stdout.write(
    `Mean Edit Distance:     ${signals.meanEditDistanceAllAccepted} chars (all accepted), ${signals.meanEditDistanceEditedOnly} chars (edited only)\n`
  );
  process.stdout.write(
    `Route Override Rate:    ${signals.overrideRate}% (${signals.overrideCount} overrides)\n`
  );
  process.stdout.write(`Rejections Total:       ${signals.rejectedCount}\n`);
  process.stdout.write(
    `Top Rejection Driver:   ${signals.rejectionReasonsBreakdown[0]?.reason ?? "None"} (${signals.rejectionReasonsBreakdown[0]?.count ?? 0})\n`
  );
  process.stdout.write("------------------------------------------\n");
  process.stdout.write("[SUCCESS] Feedback export verified and completed.\n\n");

  return { count, filePath: OUTPUT_FILE };
}

// Execute if run directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  runFeedbackExport();
}


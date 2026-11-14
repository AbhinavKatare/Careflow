import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  appendChainedAuditEvent,
  GENESIS_PREVIOUS_HASH,
  verifyAuditTrail,
} from "./audit-chain";
import { createTestDatabase, initDatabase } from "./db";
import {
  listReviewCasesFromDb,
  resetDemoDataInDb,
  runEvaluationWithIdempotency,
  runShadowRunWithIdempotency,
  seedDatabase,
  submitCheckInWithIdempotency,
} from "./persistence";

describe("SQLite Persistence — Migrations & Empty Database Initialization", () => {
  it("migrations apply cleanly to an empty database and create all tables and indexes", () => {
    const rawSqlite = new Database(":memory:");

    // Verify empty state before init
    const tablesBefore = rawSqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();
    expect(tablesBefore).toHaveLength(0);

    // Apply migrations / table initialization
    initDatabase(rawSqlite);

    const tablesAfter = rawSqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name);

    const expectedTables = [
      "users",
      "check_ins",
      "review_cases",
      "draft_messages",
      "audit_events",
      "agent_runs",
      "evaluation_runs",
      "shadow_runs",
      "feedback_labels",
    ];

    for (const table of expectedTables) {
      expect(tablesAfter).toContain(table);
    }

    // Verify unique indexes
    const indexes = rawSqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((r: any) => r.name);

    expect(indexes).toContain("idx_check_ins_idempotency");
    expect(indexes).toContain("idx_audit_events_seq");
    expect(indexes).toContain("idx_eval_runs_idempotency");
    expect(indexes).toContain("idx_shadow_runs_idempotency");

    rawSqlite.close();
  });
});

describe("SQLite Persistence — Seed Idempotency", () => {
  it("seed is idempotent: running once vs twice yields identical record counts without duplicates", () => {
    const { sqlite } = createTestDatabase(":memory:");

    // 1st seed execution
    const firstRun = seedDatabase(sqlite);
    expect(firstRun.casesSeeded).toBeGreaterThan(0);
    expect(firstRun.feedbackSeeded).toBeGreaterThan(0);

    const caseCount1 = (
      sqlite.prepare("SELECT COUNT(*) as count FROM review_cases").get() as { count: number }
    ).count;
    const feedbackCount1 = (
      sqlite.prepare("SELECT COUNT(*) as count FROM feedback_labels").get() as { count: number }
    ).count;

    // 2nd seed execution
    const secondRun = seedDatabase(sqlite);
    expect(secondRun.casesSeeded).toBe(caseCount1);
    expect(secondRun.feedbackSeeded).toBe(feedbackCount1);

    const caseCount2 = (
      sqlite.prepare("SELECT COUNT(*) as count FROM review_cases").get() as { count: number }
    ).count;
    const feedbackCount2 = (
      sqlite.prepare("SELECT COUNT(*) as count FROM feedback_labels").get() as { count: number }
    ).count;

    expect(caseCount2).toBe(caseCount1);
    expect(feedbackCount2).toBe(feedbackCount1);

    // Verify seeded audit trail is cryptographically valid
    const auditStatus = verifyAuditTrail(sqlite);
    expect(auditStatus.valid).toBe(true);
    expect(auditStatus.totalEvents).toBeGreaterThan(0);

    sqlite.close();
  });
});

describe("SQLite Persistence — Server Restart & Persistence Across Sessions", () => {
  it("restarting the server keeps the data and the audit verifier passes", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "careflow-test-"));
    const testDbPath = path.join(tempDir, "test-restart.db");

    // Session 1: Start server DB, seed and submit a check-in
    const sqlite1 = new Database(testDbPath);
    initDatabase(sqlite1);
    seedDatabase(sqlite1);

    const checkInResult = await submitCheckInWithIdempotency(
      {
        patientId: "DEMO-001",
        patientName: "Demo Patient 001",
        program: "Weekly check-in",
        weekStatus: "On track with routine",
        followUp: "no",
        note: "Session 1 test checkin",
        idempotencyKey: "restart-test-key-01",
      },
      sqlite1
    );

    const initialCases = listReviewCasesFromDb({}, sqlite1);
    expect(initialCases.length).toBe(8); // 7 seed + 1 new

    const audit1 = verifyAuditTrail(sqlite1);
    expect(audit1.valid).toBe(true);

    // Simulate Server Restart: completely close database connection
    sqlite1.close();

    // Session 2: Server boots back up and opens the same database file
    const sqlite2 = new Database(testDbPath);
    initDatabase(sqlite2); // idempotent table creation check

    // Data is kept intact
    const restoredCases = listReviewCasesFromDb({}, sqlite2);
    expect(restoredCases.length).toBe(8);
    const foundCase = restoredCases.find((c) => c.id === checkInResult.case.id);
    expect(foundCase).toBeDefined();
    expect(foundCase?.patientName).toBe("Demo Patient 001");

    // Audit verifier passes on restarted server
    const audit2 = verifyAuditTrail(sqlite2);
    expect(audit2.valid).toBe(true);
    expect(audit2.totalEvents).toBe(audit1.totalEvents);

    sqlite2.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });
});

describe("SQLite Persistence — Idempotency on Submit, Eval, and Shadow Runs", () => {
  it("duplicate concurrent submits with identical idempotency key create exactly one case", async () => {
    const { sqlite } = createTestDatabase(":memory:");

    const submission = {
      patientId: "DEMO-001",
      patientName: "Demo Patient 001",
      program: "Weekly check-in",
      weekStatus: "On track with my weekly routine",
      followUp: "no",
      note: "",
      idempotencyKey: "concurrent-idempotency-key-001",
    };

    // Simulate concurrent submissions
    const [res1, res2] = await Promise.all([
      submitCheckInWithIdempotency(submission, sqlite),
      submitCheckInWithIdempotency(submission, sqlite),
    ]);

    // Exactly one row created in review_cases
    const count = (
      sqlite.prepare("SELECT COUNT(*) as count FROM review_cases").get() as { count: number }
    ).count;
    expect(count).toBe(1);

    // Exactly one row created in check_ins
    const checkInCount = (
      sqlite.prepare("SELECT COUNT(*) as count FROM check_ins").get() as { count: number }
    ).count;
    expect(checkInCount).toBe(1);

    // Both promises resolve to the same case ID
    expect(res1.case.id).toBe(res2.case.id);
    expect([res1.isDuplicate, res2.isDuplicate]).toContain(false);
    expect([res1.isDuplicate, res2.isDuplicate]).toContain(true);

    sqlite.close();
  });

  it("evaluation runs with identical idempotency key return existing record without duplicate insertion", async () => {
    const { sqlite } = createTestDatabase(":memory:");
    const idempotencyKey = "eval-key-100";

    const run1 = await runEvaluationWithIdempotency({ idempotencyKey }, sqlite);
    const run2 = await runEvaluationWithIdempotency({ idempotencyKey }, sqlite);

    expect(run1.id).toBe(run2.id);

    const count = (
      sqlite.prepare("SELECT COUNT(*) as count FROM evaluation_runs WHERE idempotency_key = ?").get(idempotencyKey) as { count: number }
    ).count;
    expect(count).toBe(1);

    sqlite.close();
  });

  it("shadow runs with identical idempotency key return existing record without duplicate insertion", () => {
    const { sqlite } = createTestDatabase(":memory:");
    seedDatabase(sqlite);

    const idempotencyKey = "shadow-key-200";
    const run1 = runShadowRunWithIdempotency({ caseId: "CHK-1001", idempotencyKey }, sqlite);
    const run2 = runShadowRunWithIdempotency({ caseId: "CHK-1001", idempotencyKey }, sqlite);

    expect(run1.id).toBe(run2.id);

    const count = (
      sqlite.prepare("SELECT COUNT(*) as count FROM shadow_runs WHERE idempotency_key = ?").get(idempotencyKey) as { count: number }
    ).count;
    expect(count).toBe(1);

    sqlite.close();
  });
});

describe("SQLite Persistence — Hash-Chained Audit Trail & Tamper Detection", () => {
  it("appends monotonically increasing, hash-chained audit events", () => {
    const { sqlite } = createTestDatabase(":memory:");

    const evt1 = appendChainedAuditEvent(sqlite, {
      entityType: "ReviewCase",
      entityId: "case-1",
      actor: "WORKFLOW",
      action: "Check-in received",
      detail: "Routine check-in logged.",
    });

    expect(evt1.sequence_number).toBe(1);
    expect(evt1.previous_hash).toBe(GENESIS_PREVIOUS_HASH);
    expect(evt1.event_hash).toHaveLength(64);

    const evt2 = appendChainedAuditEvent(sqlite, {
      entityType: "ReviewCase",
      entityId: "case-1",
      actor: "WORKFLOW",
      action: "Draft prepared",
      detail: "Draft prepared for review.",
    });

    expect(evt2.sequence_number).toBe(2);
    expect(evt2.previous_hash).toBe(evt1.event_hash);
    expect(evt2.event_hash).toHaveLength(64);

    // Verification passes
    const status = verifyAuditTrail(sqlite);
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(2);

    sqlite.close();
  });

  it("tampering with a stored audit row fails verification immediately", () => {
    const { sqlite } = createTestDatabase(":memory:");

    // Append 3 events
    appendChainedAuditEvent(sqlite, {
      entityType: "ReviewCase",
      entityId: "case-1",
      actor: "WORKFLOW",
      action: "Check-in received",
      detail: "Event 1",
    });
    const evt2 = appendChainedAuditEvent(sqlite, {
      entityType: "ReviewCase",
      entityId: "case-1",
      actor: "WORKFLOW",
      action: "Draft prepared",
      detail: "Event 2",
    });
    appendChainedAuditEvent(sqlite, {
      entityType: "ReviewCase",
      entityId: "case-1",
      actor: "DEMO_REVIEWER",
      action: "Approved · simulated",
      detail: "Event 3",
    });

    // Untampered chain passes
    expect(verifyAuditTrail(sqlite).valid).toBe(true);

    // Tamper with event #2 by altering detail directly in SQLite
    sqlite
      .prepare("UPDATE audit_events SET detail = 'Tampered content by attacker' WHERE sequence_number = 2")
      .run();

    // Verifier must detect tampering and report exact sequence and event ID
    const tamperedStatus = verifyAuditTrail(sqlite);
    expect(tamperedStatus.valid).toBe(false);
    expect(tamperedStatus.tamperedAtSequence).toBe(2);
    expect(tamperedStatus.tamperedEventId).toBe(evt2.id);
    expect(tamperedStatus.reason).toContain("Tampered event content detected");

    sqlite.close();
  });

  it("deleting an intermediate audit row breaks sequence and fails verification", () => {
    const { sqlite } = createTestDatabase(":memory:");

    appendChainedAuditEvent(sqlite, { entityType: "ReviewCase", entityId: "c1", actor: "WORKFLOW", action: "A1", detail: "D1" });
    appendChainedAuditEvent(sqlite, { entityType: "ReviewCase", entityId: "c1", actor: "WORKFLOW", action: "A2", detail: "D2" });
    appendChainedAuditEvent(sqlite, { entityType: "ReviewCase", entityId: "c1", actor: "WORKFLOW", action: "A3", detail: "D3" });

    expect(verifyAuditTrail(sqlite).valid).toBe(true);

    // Delete row sequence 2
    sqlite.prepare("DELETE FROM audit_events WHERE sequence_number = 2").run();

    const deleteStatus = verifyAuditTrail(sqlite);
    expect(deleteStatus.valid).toBe(false);
    expect(deleteStatus.reason).toContain("Broken sequence");

    sqlite.close();
  });

  it("audit events never contain raw patient free text", () => {
    const { sqlite } = createTestDatabase(":memory:");

    // Attempting to append audit event with free text throws error
    expect(() => {
      appendChainedAuditEvent(sqlite, {
        entityType: "ReviewCase",
        entityId: "c1",
        actor: "WORKFLOW",
        action: "Check-in received",
        detail: "Patient wrote: urgent acute chest pain since 2 hours",
      });
    }).toThrowError(/PERMANENT RULE VIOLATION: Audit event cannot contain raw patient free text/);

    sqlite.close();
  });
});

describe("SQLite Persistence — Confirmed Reset Demo Data Action", () => {
  it("rejects reset demo data when confirmed flag is false", () => {
    const { sqlite } = createTestDatabase(":memory:");
    expect(() => {
      resetDemoDataInDb(sqlite, { confirmed: false });
    }).toThrowError(/requires explicit confirmed: true/);
    sqlite.close();
  });

  it("resets demo data cleanly and restores a valid cryptographically intact audit chain", () => {
    const { sqlite } = createTestDatabase(":memory:");
    seedDatabase(sqlite);

    // Add a custom case
    sqlite.prepare(`
      INSERT INTO review_cases (
        id, check_in_id, patient_id, week_status, status, route, reason, submitted_at
      ) VALUES ('custom-case', 'chk-custom', 'DEMO-001', 'On track', 'needs_review', 'HUMAN_REVIEW_REQUIRED', 'Test', datetime('now'))
    `).run();

    expect(listReviewCasesFromDb({}, sqlite).length).toBeGreaterThan(7);

    // Reset demo data with confirmed: true
    const result = resetDemoDataInDb(sqlite, { confirmed: true, isLocal: true });
    expect(result.success).toBe(true);

    // Restores default 7 seed cases
    const freshCases = listReviewCasesFromDb({}, sqlite);
    expect(freshCases.length).toBe(7);

    // Restores intact audit chain starting at sequence 1
    const auditStatus = verifyAuditTrail(sqlite);
    expect(auditStatus.valid).toBe(true);
    expect(auditStatus.totalEvents).toBeGreaterThan(0);

    sqlite.close();
  });
});

describe("SQLite Persistence — Server Restart & Persistence Across Sessions", () => {
  it("restarting the server keeps the data and the audit verifier passes", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "careflow-test-"));
    const testDbPath = path.join(tempDir, "test-restart.db");

    // Session 1: Start server DB, seed and submit a check-in
    const sqlite1 = new Database(testDbPath);
    initDatabase(sqlite1);
    seedDatabase(sqlite1);

    const checkInResult = await submitCheckInWithIdempotency(
      {
        patientId: "DEMO-001",
        patientName: "Demo Patient 001",
        program: "Weekly check-in",
        weekStatus: "On track with routine",
        followUp: "no",
        note: "Session 1 test checkin",
        idempotencyKey: "restart-test-key-01",
      },
      sqlite1
    );

    const initialCases = listReviewCasesFromDb({}, sqlite1);
    expect(initialCases.length).toBe(8); // 7 seed + 1 new

    const audit1 = verifyAuditTrail(sqlite1);
    expect(audit1.valid).toBe(true);

    // Simulate Server Restart: completely close database connection
    sqlite1.close();

    // Session 2: Server boots back up and opens the same database file
    const sqlite2 = new Database(testDbPath);
    initDatabase(sqlite2); // idempotent table creation check

    // Data is kept intact
    const restoredCases = listReviewCasesFromDb({}, sqlite2);
    expect(restoredCases.length).toBe(8);
    const foundCase = restoredCases.find((c) => c.id === checkInResult.case.id);
    expect(foundCase).toBeDefined();
    expect(foundCase?.patientName).toBe("Demo Patient 001");

    // Audit verifier passes on restarted server
    const audit2 = verifyAuditTrail(sqlite2);
    expect(audit2.valid).toBe(true);
    expect(audit2.totalEvents).toBe(audit1.totalEvents);

    sqlite2.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });
});


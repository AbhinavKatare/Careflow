import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../drizzle/schema";

let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Initializes all SQLite tables and indexes.
 * Ensures migrations apply cleanly on an empty database.
 */
export function initDatabase(sqlite: Database.Database): void {
  // Enable foreign keys and WAL mode for reliability
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Migrate from legacy integer-id schemas if encountered
  try {
    const rcInfo = sqlite.prepare("PRAGMA table_info(review_cases)").all() as Array<{ name: string; type: string }>;
    const idCol = rcInfo.find((c) => c.name === "id");
    if (idCol && idCol.type.toUpperCase() === "INTEGER") {
      sqlite.exec(`
        DROP TABLE IF EXISTS review_cases;
        DROP TABLE IF EXISTS check_ins;
        DROP TABLE IF EXISTS audit_events;
      `);
    }
  } catch {
    // Fresh DB or error reading pragma
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      program_id TEXT NOT NULL DEFAULT 'Weekly check-in',
      status_selection TEXT NOT NULL,
      follow_up_requested INTEGER NOT NULL DEFAULT 0,
      raw_text TEXT NOT NULL DEFAULT '',
      structured_answers TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT UNIQUE,
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS review_cases (
      id TEXT PRIMARY KEY,
      check_in_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      patient_name TEXT NOT NULL DEFAULT 'Demo Patient 001',
      initials TEXT NOT NULL DEFAULT 'P1',
      program TEXT NOT NULL DEFAULT 'Weekly check-in',
      week_status TEXT NOT NULL,
      follow_up TEXT NOT NULL DEFAULT 'no',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      route TEXT NOT NULL,
      reason TEXT NOT NULL,
      reason_code TEXT,
      summary TEXT,
      original_draft TEXT,
      draft TEXT,
      priority TEXT NOT NULL DEFAULT 'STANDARD',
      scenario_tag TEXT,
      redacted_preview TEXT,
      extracted_facts TEXT,
      fired_rules TEXT,
      rule_version TEXT NOT NULL DEFAULT 'rules v1.2-demo',
      workflow_version TEXT NOT NULL DEFAULT 'workflow 0.1.0',
      latency_ms REAL NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS draft_messages (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      content TEXT NOT NULL,
      original_content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED',
      prompt_version TEXT NOT NULL DEFAULT 'draft_v1',
      model_id TEXT NOT NULL DEFAULT 'mock-small-v1',
      agent_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      sequence_number INTEGER NOT NULL UNIQUE,
      previous_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      at TEXT NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL,
      model_id TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      latency_ms REAL NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      estimated_cost REAL,
      schema_valid INTEGER NOT NULL DEFAULT 1,
      tier TEXT,
      error_message TEXT,
      metadata TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_runs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      spec_version TEXT NOT NULL,
      fixture_version TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      total_cases INTEGER NOT NULL,
      passed_cases INTEGER NOT NULL,
      critical_misses INTEGER NOT NULL,
      route_accuracy REAL NOT NULL,
      safety_gate TEXT NOT NULL,
      latency_p50_ms REAL NOT NULL,
      latency_p95_ms REAL NOT NULL,
      executed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shadow_runs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      case_id TEXT NOT NULL,
      baseline_spec_version TEXT NOT NULL,
      candidate_spec_version TEXT NOT NULL,
      baseline_route TEXT NOT NULL,
      candidate_route TEXT NOT NULL,
      route_matches INTEGER NOT NULL,
      baseline_draft TEXT,
      candidate_draft TEXT,
      draft_similarity REAL,
      candidate_latency_ms REAL NOT NULL,
      executed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_labels (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      patient_id TEXT NOT NULL DEFAULT 'DEMO-001',
      action TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      edit_distance INTEGER,
      diff TEXT,
      rejection_reason TEXT,
      route_override TEXT,
      payload TEXT
    );

    CREATE TABLE IF NOT EXISTS clinic_proposals (
      id TEXT PRIMARY KEY,
      sop_name TEXT NOT NULL,
      sop_markdown TEXT NOT NULL,
      proposed_spec TEXT NOT NULL,
      traces TEXT NOT NULL,
      validation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED',
      reviewer_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spec_activation_ladder (
      proposal_id TEXT PRIMARY KEY,
      current_stage TEXT NOT NULL DEFAULT 'Draft',
      spec_version TEXT NOT NULL,
      evaluated_spec_hash TEXT,
      shadowed_spec_hash TEXT,
      active_spec_hash TEXT,
      sign_offs TEXT NOT NULL DEFAULT '[]',
      gates_history TEXT NOT NULL DEFAULT '{}',
      last_reset_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS case_execution_runs (
      case_id TEXT PRIMARY KEY,
      spec_hash TEXT NOT NULL,
      spec_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'v1',
      model_id TEXT NOT NULL DEFAULT 'mock-small-v1',
      model_tier TEXT NOT NULL DEFAULT 'small',
      raw_input TEXT NOT NULL,
      redacted_inputs TEXT NOT NULL,
      extracted_facts TEXT NOT NULL DEFAULT '[]',
      fired_rules TEXT NOT NULL DEFAULT '[]',
      route TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      draft TEXT,
      trace TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure missing columns in existing tables are migrated safely
  ensureColumn(sqlite, "check_ins", "idempotency_key", "TEXT");
  ensureColumn(sqlite, "check_ins", "raw_text", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "check_ins", "structured_answers", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(sqlite, "check_ins", "program_id", "TEXT NOT NULL DEFAULT 'Weekly check-in'");
  ensureColumn(sqlite, "check_ins", "status_selection", "TEXT NOT NULL DEFAULT 'on_track'");
  ensureColumn(sqlite, "check_ins", "follow_up_requested", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "check_ins", "submitted_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  ensureColumn(sqlite, "check_ins", "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");

  ensureColumn(sqlite, "review_cases", "patient_name", "TEXT NOT NULL DEFAULT 'Demo Patient 001'");
  ensureColumn(sqlite, "review_cases", "initials", "TEXT NOT NULL DEFAULT 'P1'");
  ensureColumn(sqlite, "review_cases", "program", "TEXT NOT NULL DEFAULT 'Weekly check-in'");
  ensureColumn(sqlite, "review_cases", "week_status", "TEXT NOT NULL DEFAULT 'On track with routine'");
  ensureColumn(sqlite, "review_cases", "follow_up", "TEXT NOT NULL DEFAULT 'no'");
  ensureColumn(sqlite, "review_cases", "note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "review_cases", "route", "TEXT NOT NULL DEFAULT 'DRAFT_FOR_REVIEW'");
  ensureColumn(sqlite, "review_cases", "reason", "TEXT NOT NULL DEFAULT 'Routine'");
  ensureColumn(sqlite, "review_cases", "reason_code", "TEXT");
  ensureColumn(sqlite, "review_cases", "summary", "TEXT");
  ensureColumn(sqlite, "review_cases", "original_draft", "TEXT");
  ensureColumn(sqlite, "review_cases", "draft", "TEXT");
  ensureColumn(sqlite, "review_cases", "priority", "TEXT NOT NULL DEFAULT 'STANDARD'");
  ensureColumn(sqlite, "review_cases", "scenario_tag", "TEXT");
  ensureColumn(sqlite, "review_cases", "redacted_preview", "TEXT");
  ensureColumn(sqlite, "review_cases", "extracted_facts", "TEXT");
  ensureColumn(sqlite, "review_cases", "fired_rules", "TEXT");
  ensureColumn(sqlite, "review_cases", "rule_version", "TEXT NOT NULL DEFAULT 'rules v1.2-demo'");
  ensureColumn(sqlite, "review_cases", "workflow_version", "TEXT NOT NULL DEFAULT 'workflow 0.1.0'");
  ensureColumn(sqlite, "review_cases", "latency_ms", "REAL NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "review_cases", "submitted_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  ensureColumn(sqlite, "review_cases", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");

  ensureColumn(sqlite, "audit_events", "sequence_number", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "audit_events", "previous_hash", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "audit_events", "event_hash", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "audit_events", "actor", "TEXT NOT NULL DEFAULT 'system'");
  ensureColumn(sqlite, "audit_events", "detail", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(sqlite, "audit_events", "at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  ensureColumn(sqlite, "audit_events", "metadata", "TEXT");

  // Performance and integrity indexes (safely created after columns are ensured)
  const safeIndexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_seq ON audit_events (sequence_number)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_runs_idempotency ON evaluation_runs (idempotency_key)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_runs_idempotency ON shadow_runs (idempotency_key)`,
    `CREATE INDEX IF NOT EXISTS idx_review_cases_status ON review_cases (status)`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_labels_case ON feedback_labels (case_id)`,
    `CREATE INDEX IF NOT EXISTS idx_case_exec_runs_spec ON case_execution_runs (spec_hash)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_check_ins_idempotency ON check_ins (idempotency_key)`,
  ];

  for (const idxSql of safeIndexes) {
    try {
      sqlite.exec(idxSql);
    } catch {
      // Non-blocking index creation
    }
  }
}

function ensureColumn(sqlite: Database.Database, table: string, column: string, typeDef: string) {
  try {
    const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (info.length > 0 && !info.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`);
    }
  } catch {
    // Non-blocking migration helper
  }
}

/**
 * Returns the active better-sqlite3 database connection.
 */
export function getSqlite(): Database.Database {
  if (!_sqlite) {
    const dbPath = process.env.DATABASE_URL || "./careflow.db";
    _sqlite = new Database(dbPath);
    initDatabase(_sqlite);
  }
  return _sqlite;
}

/**
 * Returns the active Drizzle ORM client.
 */
export function getDb() {
  if (!_db) {
    const sqlite = getSqlite();
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/**
 * Closes the active database connection.
 */
export function closeDb(): void {
  if (_sqlite) {
    try {
      _sqlite.close();
    } catch {
      // Ignored
    }
    _sqlite = null;
    _db = null;
  }
}

/**
 * Creates an in-memory or custom isolated test database with all tables initialized.
 */
export function createTestDatabase(path = ":memory:"): {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
} {
  const sqlite = new Database(path);
  initDatabase(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

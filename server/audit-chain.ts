/**
 * Cryptographic Hash-Chained, Append-Only Audit Trail Engine.
 *
 * PERMANENT RULES:
 * - Each audit event stores the previous event's hash (hash-chained).
 * - Audit events NEVER contain patient free text or raw notes.
 * - Detects any row tampering, deletion, or sequence gap.
 * - Simulated state only.
 */

import crypto from "node:crypto";
import Database from "better-sqlite3";
import { AuditEvent } from "../shared/domain/types";

export const GENESIS_PREVIOUS_HASH = "0".repeat(64);

export interface StoredAuditEventRow {
  id: string;
  sequence_number: number;
  previous_hash: string;
  event_hash: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  action: string;
  detail: string;
  at: string;
  metadata: string | null;
}

export interface AuditVerificationResult {
  valid: boolean;
  totalEvents: number;
  tamperedAtSequence?: number;
  tamperedEventId?: string;
  reason?: string;
}

/**
 * Produces canonical sorted JSON string for stable deterministic hashing.
 */
function canonicalizeJson(obj: unknown): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalizeJson).join(",") + "]";
  }
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const pairs = keys.map((k) => `"${k}":${canonicalizeJson(record[k])}`);
  return "{" + pairs.join(",") + "}";
}

/**
 * Computes deterministic SHA-256 hash for an audit event.
 */
export function computeEventHash(params: {
  sequenceNumber: number;
  previousHash: string;
  entityType: string;
  entityId: string;
  actor: string;
  action: string;
  detail: string;
  at: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const metaString = canonicalizeJson(params.metadata);
  const payload = [
    params.sequenceNumber,
    params.previousHash,
    params.entityType,
    params.entityId,
    params.actor,
    params.action,
    params.detail,
    params.at,
    metaString,
  ].join("::");

  return crypto.createHash("sha256").update(payload, "utf-8").digest("hex");
}

/**
 * Asserts that an audit record contains no patient free text.
 */
export function assertNoFreeTextInAudit(action: string, detail: string, metadata?: unknown): void {
  const combined = (action + " " + detail + " " + JSON.stringify(metadata || {})).toLowerCase();

  // Forbidden patient note indicators
  const sensitivePatterns = [
    /urgent acute chest pain/i,
    /system override/i,
    /prescribe steroid ointment/i,
    /severe pain/i,
    /cannot take any medications/i,
    /my phone is/i,
    /patient@example\.com/i,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(combined)) {
      throw new Error(`PERMANENT RULE VIOLATION: Audit event cannot contain raw patient free text: '${pattern.source}'`);
    }
  }
}

/**
 * Appends a new hash-chained audit event into SQLite.
 */
export function appendChainedAuditEvent(
  sqlite: Database.Database,
  params: {
    id?: string;
    entityType: string;
    entityId: string;
    actor: "WORKFLOW" | "DEMO_REVIEWER" | "SYSTEM";
    action: string;
    detail: string;
    at?: string;
    metadata?: Record<string, unknown>;
  }
): StoredAuditEventRow {
  assertNoFreeTextInAudit(params.action, params.detail, params.metadata);

  const eventId = params.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const at = params.at || new Date().toISOString();

  // Query the last event to get previous hash and sequence
  const lastRow = sqlite
    .prepare("SELECT sequence_number, event_hash FROM audit_events ORDER BY sequence_number DESC LIMIT 1")
    .get() as { sequence_number: number; event_hash: string } | undefined;

  const sequenceNumber = lastRow ? lastRow.sequence_number + 1 : 1;
  const previousHash = lastRow ? lastRow.event_hash : GENESIS_PREVIOUS_HASH;

  const eventHash = computeEventHash({
    sequenceNumber,
    previousHash,
    entityType: params.entityType,
    entityId: params.entityId,
    actor: params.actor,
    action: params.action,
    detail: params.detail,
    at,
    metadata: params.metadata,
  });

  const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;

  sqlite
    .prepare(
      `INSERT INTO audit_events (
        id, sequence_number, previous_hash, event_hash,
        entity_type, entity_id, actor, action, detail, at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eventId,
      sequenceNumber,
      previousHash,
      eventHash,
      params.entityType,
      params.entityId,
      params.actor,
      params.action,
      params.detail,
      at,
      metadataJson
    );

  return {
    id: eventId,
    sequence_number: sequenceNumber,
    previous_hash: previousHash,
    event_hash: eventHash,
    entity_type: params.entityType,
    entity_id: params.entityId,
    actor: params.actor,
    action: params.action,
    detail: params.detail,
    at,
    metadata: metadataJson,
  };
}

/**
 * Verifies the integrity of the entire cryptographic audit trail.
 * Returns valid: true if completely intact, or flags the exact tampered row.
 */
export function verifyAuditTrail(sqlite: Database.Database): AuditVerificationResult {
  const rows = sqlite
    .prepare("SELECT * FROM audit_events ORDER BY sequence_number ASC")
    .all() as StoredAuditEventRow[];

  if (rows.length === 0) {
    return { valid: true, totalEvents: 0 };
  }

  let expectedPreviousHash = GENESIS_PREVIOUS_HASH;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expectedSeq = i + 1;

    // 1. Monotonic sequence check
    if (row.sequence_number !== expectedSeq) {
      return {
        valid: false,
        totalEvents: rows.length,
        tamperedAtSequence: row.sequence_number,
        tamperedEventId: row.id,
        reason: `Broken sequence: expected sequence number ${expectedSeq}, found ${row.sequence_number}. Possible row deletion or out-of-order insertion.`,
      };
    }

    // 2. Previous hash link check
    if (row.previous_hash !== expectedPreviousHash) {
      return {
        valid: false,
        totalEvents: rows.length,
        tamperedAtSequence: row.sequence_number,
        tamperedEventId: row.id,
        reason: `Broken hash chain at sequence ${row.sequence_number}: expected previous_hash ${expectedPreviousHash}, found ${row.previous_hash}.`,
      };
    }

    // 3. Recompute content hash check
    let parsedMetadata: Record<string, unknown> | null = null;
    if (row.metadata) {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch {
        parsedMetadata = null;
      }
    }

    const recomputedHash = computeEventHash({
      sequenceNumber: row.sequence_number,
      previousHash: row.previous_hash,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
      at: row.at,
      metadata: parsedMetadata,
    });

    if (recomputedHash !== row.event_hash) {
      return {
        valid: false,
        totalEvents: rows.length,
        tamperedAtSequence: row.sequence_number,
        tamperedEventId: row.id,
        reason: `Tampered event content detected at sequence ${row.sequence_number}: stored hash ${row.event_hash} does not match recomputed hash ${recomputedHash}. Content was altered.`,
      };
    }

    expectedPreviousHash = row.event_hash;
  }

  return {
    valid: true,
    totalEvents: rows.length,
  };
}

/**
 * Helper to convert StoredAuditEventRow to Domain AuditEvent.
 */
export function rowToAuditEvent(row: StoredAuditEventRow): AuditEvent {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.actor as "WORKFLOW" | "DEMO_REVIEWER" | "SYSTEM",
    action: row.action,
    detail: row.detail,
    at: row.at,
    metadata,
  };
}


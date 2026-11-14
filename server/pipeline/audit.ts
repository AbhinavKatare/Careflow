/**
 * Step 8: Audit Trail Logger.
 * Appends immutable AuditEvent records.
 * PERMANENT RULE: Append-only audit trail; simulated state only.
 */

import { AuditEvent, AuditEventSchema } from "../../shared/domain/types";

class AuditStore {
  private events: AuditEvent[] = [];

  public append(event: AuditEvent): AuditEvent {
    const validated = AuditEventSchema.parse(event);
    this.events.push(validated);
    return validated;
  }

  public getByEntity(entityId: string): AuditEvent[] {
    return this.events.filter((e) => e.entityId === entityId);
  }

  public list(): AuditEvent[] {
    return [...this.events];
  }

  public clear(): void {
    this.events = [];
  }
}

export const pipelineAuditStore = new AuditStore();

export function stepAudit(params: {
  caseId: string;
  action: string;
  detail: string;
  metadata?: Record<string, unknown>;
  store?: AuditStore;
}): AuditEvent {
  const { caseId, action, detail, metadata, store = pipelineAuditStore } = params;

  const event: AuditEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    entityType: "ReviewCase",
    entityId: caseId,
    actor: "WORKFLOW",
    action,
    detail,
    at: new Date().toISOString(),
    metadata,
  };

  return store.append(event);
}


/**
 * Audit-log helper — append-only record of who did what to which entity.
 *
 * Call from any handler that changes data we'd want to answer "who did that?"
 * about later. Especially: COPPA deletion, role changes, manual match
 * dissolution, parent address change, etc.
 *
 * Read-only viewer lives at /admin/audit-log (Phase 5.2).
 */

import type { Request } from "express";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export interface LogAuditArgs {
  /** UUID of the users row that performed the action, if any. Null for cron/system. */
  actorId?: string | null;
  actorEmail?: string | null;
  /** Action name in lower.dotted format, e.g. "child.delete", "match.dissolve". */
  action: string;
  entityType: string;
  entityId: string;
  payloadBefore?: unknown;
  payloadAfter?: unknown;
  metadata?: unknown;
  /** Optional request, used to capture the client IP. */
  req?: Request;
}

export async function logAudit(args: LogAuditArgs): Promise<void> {
  const ip = args.req?.ip ?? null;

  const { error } = await supabase.from("audit_log").insert({
    actor_id: args.actorId ?? null,
    actor_email: args.actorEmail ?? null,
    actor_ip: ip,
    action: args.action,
    entity_type: args.entityType,
    entity_id: args.entityId,
    payload_before: args.payloadBefore ?? null,
    payload_after: args.payloadAfter ?? null,
    metadata: args.metadata ?? null,
  });

  if (error) {
    // Audit log failures must not break the calling handler — log loudly and
    // continue. If this ever pages someone they can investigate.
    logger.error({ error, action: args.action }, "Failed to write audit log entry");
  }
}

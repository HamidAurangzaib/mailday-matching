// Convergence routines (Phase 4).
//
// Both helpers in this file replace inline logic that previously lived in 3+
// separate callers. The goal is drift-prevention: every place that re-queues
// a child or offboards a family now goes through the same code path, so
// behaviour can't accidentally diverge between (e.g.) a cancellation-finalise
// and a rematch-orphan flow.

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { logAudit } from "./audit.js";
import { emitKlaviyoEvent } from "./klaviyo-events.js";
import { guaranteeStartDate } from "./guarantee-clock.js";

// ─── requeueChild ───────────────────────────────────────────────────────────

export type RequeueReason =
  | "rematch_requested" // family asked for a new pen pal
  | "partner_orphaned"  // the OTHER family's child — left behind by cancellation or rematch
  | "tier_mismatch"     // dissolved because cross-tier post-aging
  | "winback_failed";   // re-queue cascaded from win-back failure

export interface RequeueArgs {
  childId: string;
  reason: RequeueReason;
  /** Set true only for orphans of a dissolved match. Requesters of a rematch
   *  are NOT priorities — they triggered the disruption. */
  priority?: boolean;
  /** When false (default), preserves billing_paused. When true, clears it
   *  (used when re-queueing implies guarantee should reset alongside billing). */
  clearGuaranteePause?: boolean;
  actorId?: string | null;
  actorEmail?: string | null;
}

export interface RequeueResult {
  childId: string;
  ok: boolean;
  newStatus: "Rematch Requested";
  resetClockTo: string;
}

/**
 * Per the lifecycle map (settled policy):
 *   "When a match ends — rematch, a cancelled partner, or a tier mismatch —
 *    the orphaned child re-enters the queue and the 21-day clock RESETS to
 *    day 0. A child who already waited a full cycle and then lost a pen pal
 *    is not penalised for it."
 */
export async function requeueChild(args: RequeueArgs): Promise<RequeueResult> {
  const today = new Date().toISOString().split("T")[0];

  const updateFields: Record<string, unknown> = {
    match_status: "Rematch Requested",
    match_guarantee_start_date: guaranteeStartDate(),
  };

  // Orphans get explicit priority; requesters get explicit non-priority so
  // a stale rematch_priority from a previous loop doesn't carry over.
  if (args.priority === true) updateFields["rematch_priority"] = true;
  else if (args.priority === false) updateFields["rematch_priority"] = false;

  if (args.clearGuaranteePause) {
    updateFields["billing_paused"] = false;
  }

  // Read before-state for audit.
  const { data: before } = await supabase
    .from("children")
    .select("id, match_status, match_guarantee_start_date, rematch_priority, billing_paused")
    .eq("id", args.childId)
    .single();

  const { error } = await supabase
    .from("children")
    .update(updateFields)
    .eq("id", args.childId);

  if (error) {
    logger.error({ error, childId: args.childId }, "requeueChild failed");
    throw new Error(`requeueChild failed: ${error.message}`);
  }

  await logAudit({
    actorId: args.actorId ?? null,
    actorEmail: args.actorEmail ?? null,
    action: "child.requeued",
    entityType: "child",
    entityId: args.childId,
    payloadBefore: before,
    payloadAfter: updateFields,
    metadata: { reason: args.reason, priority: args.priority ?? null },
  });

  return {
    childId: args.childId,
    ok: true,
    newStatus: "Rematch Requested",
    resetClockTo: today,
  };
}

// ─── offboardFamily ─────────────────────────────────────────────────────────

export type OffboardReason =
  | "cancellation_finalised" // 48h grace expired without pause accept
  | "cancellation_immediate" // parent clicked "confirm cancellation" link
  | "winback_failed"         // Poppy card task expired (60d)
  | "coppa_erase"            // future Phase 5 hard-delete cascades
  | "admin_dissolved";

export interface OffboardArgs {
  parentId: string;
  reason: OffboardReason;
  actorId?: string | null;
  actorEmail?: string | null;
  /** Free-form note attached to the cancellation row. */
  note?: string;
}

export interface OffboardResult {
  parentId: string;
  matchesEnded: number;
  partnersRequeued: number;
  childrenCancelled: number;
  klaviyoEmitted: boolean;
}

/**
 * End the family's relationship with MailDay. The lifecycle map calls this
 * the "Shared offboarding path" — every exit funnels through here so the
 * downstream effects (K7 day-30 win-back, audit trail, cancellation tracker)
 * stay consistent regardless of WHY the family left.
 */
export async function offboardFamily(args: OffboardArgs): Promise<OffboardResult> {
  const result: OffboardResult = {
    parentId: args.parentId,
    matchesEnded: 0,
    partnersRequeued: 0,
    childrenCancelled: 0,
    klaviyoEmitted: false,
  };

  const nowIso = new Date().toISOString();
  const today = nowIso.split("T")[0];

  // 1. Load parent + their children.
  const { data: parent, error: pErr } = await supabase
    .from("parents")
    .select("id, email, first_name, last_name, offboarded_at, subscription_status, join_date, membership_tier, billing_type")
    .eq("id", args.parentId)
    .single();
  if (pErr || !parent) {
    throw new Error(`offboardFamily: parent ${args.parentId} not found`);
  }

  // Idempotency — if already offboarded, just return.
  if (parent.offboarded_at) {
    return result;
  }

  const { data: ownChildren } = await supabase
    .from("children")
    .select("id")
    .eq("parent_id", parent.id);
  const ownChildIds = (ownChildren ?? []).map((c) => c.id);

  // 2. End any Active or Pending matches; orphan the partners through requeueChild.
  if (ownChildIds.length > 0) {
    const { data: matches } = await supabase
      .from("matches")
      .select("id, child_a_id, child_b_id, match_status")
      .in("match_status", ["Active", "Pending"])
      .or(`child_a_id.in.(${ownChildIds.join(",")}),child_b_id.in.(${ownChildIds.join(",")})`);

    if (matches && matches.length > 0) {
      const matchIds = matches.map((m) => m.id);
      const partnerIds = matches.map((m) =>
        ownChildIds.includes(m.child_a_id) ? m.child_b_id : m.child_a_id,
      );

      await supabase
        .from("matches")
        .update({ match_status: "Ended", close_reason_code: "cancellation" })
        .in("id", matchIds);
      result.matchesEnded = matchIds.length;

      // Re-queue each orphaned partner through the helper — preserves rematch
      // priority + reset-to-day-0 semantics consistently.
      for (const partnerId of partnerIds) {
        try {
          await requeueChild({
            childId: partnerId,
            reason: "partner_orphaned",
            priority: true,
            actorId: args.actorId,
            actorEmail: args.actorEmail,
          });
          result.partnersRequeued++;
        } catch (e) {
          logger.warn({ err: e, partnerId, parentId: parent.id }, "offboardFamily: requeue partner failed");
        }
      }
    }

    // 3. Mark this parent's children as Cancelled.
    await supabase
      .from("children")
      .update({ match_status: "Cancelled", cancelled_at: nowIso })
      .eq("parent_id", parent.id);
    result.childrenCancelled = ownChildIds.length;
  }

  // 4. Mark the parent offboarded.
  await supabase
    .from("parents")
    .update({
      subscription_status: "Cancelled",
      billing_paused: false,
      pause_type: null,
      offboarded_at: nowIso,
      intent_to_cancel_at: null,
    })
    .eq("id", parent.id);

  // 5. Make sure a cancellations row exists for visibility in the Cancellation
  //    Tracker. If one was already created by the ReCharge webhook in the
  //    pause-offer flow, we don't need to duplicate.
  const { data: existingCancellation } = await supabase
    .from("cancellations")
    .select("id")
    .eq("parent_id", parent.id)
    .gte("cancellation_date", new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0])
    .order("cancellation_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existingCancellation) {
    const joinDateObj = parent.join_date ? new Date(parent.join_date) : new Date();
    const tenureMonths = Math.max(0, Math.round(
      (Date.now() - joinDateObj.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
    ));
    await supabase.from("cancellations").insert({
      parent_id: parent.id,
      cancellation_date: today,
      tenure_months: tenureMonths,
      tier: (parent.membership_tier as string | null) ?? "Core",
      billing_type: (parent.billing_type as string | null) ?? "Monthly",
      reason_code: args.reason === "winback_failed" ? "other" : "other",
      cancellation_reason_raw:
        args.note ?? `Offboarded via ${args.reason}`,
    });
  }

  // 6. K7 driver: tell Klaviyo so the day-30 win-back flow can fire.
  try {
    const emitRes = await emitKlaviyoEvent({
      event: "family_offboarded",
      profile: { email: parent.email, first_name: parent.first_name ?? undefined },
      properties: {
        reason: args.reason,
        offboarded_at: nowIso,
      },
    });
    result.klaviyoEmitted = emitRes.ok;
  } catch (e) {
    logger.warn({ err: e, parentId: parent.id }, "offboardFamily: Klaviyo emit failed");
  }

  // 7. Audit.
  await logAudit({
    actorId: args.actorId ?? null,
    actorEmail: args.actorEmail ?? null,
    action: "family.offboarded",
    entityType: "parent",
    entityId: parent.id,
    payloadAfter: {
      offboarded_at: nowIso,
      subscription_status: "Cancelled",
    },
    metadata: {
      reason: args.reason,
      matches_ended: result.matchesEnded,
      partners_requeued: result.partnersRequeued,
      children_cancelled: result.childrenCancelled,
      note: args.note ?? null,
    },
  });

  logger.info(result, "offboardFamily completed");
  return result;
}

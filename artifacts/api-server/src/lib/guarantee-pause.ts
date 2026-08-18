/**
 * Undoing a guarantee pause.
 *
 * When a family passes 21 days unmatched we push their ReCharge charge date
 * forward (see routes/lifecycle-jobs.ts). Making the match is what earns their
 * billing back, so this puts the schedule where it was and clears the flags that
 * were holding the pause in place.
 *
 * Deliberately best-effort and non-throwing: it is called from the match-creation
 * path, and a ReCharge hiccup must never stop two children being matched. A
 * failure leaves the flags set, so the next run simply tries again — the family
 * stays un-billed in the meantime, which is the safe direction to fail.
 */
import { supabase } from "./supabase.js";
import { logAudit } from "./audit.js";
import { logger } from "./logger.js";
import { changeNextChargeDate } from "./recharge.js";

export interface ResumeResult {
  resumed: boolean;
  reason?: "no_pause" | "no_subscription" | "failed";
}

export async function resumeGuaranteePause(
  parentId: string,
  opts: { actorEmail?: string } = {},
): Promise<ResumeResult> {
  try {
    const { data: parent } = await supabase
      .from("parents")
      .select("id, email, pause_type, recharge_subscription_id, guarantee_pause_applied_at, guarantee_pause_original_charge_date")
      .eq("id", parentId)
      .single();

    if (!parent) return { resumed: false, reason: "no_pause" };

    // Only undo a pause we actually applied. A voluntary pause (the family did it
    // themselves in ReCharge) is theirs to lift, not ours.
    if (!parent.guarantee_pause_applied_at || parent.pause_type !== "guarantee") {
      return { resumed: false, reason: "no_pause" };
    }

    const subscriptionId = parent.recharge_subscription_id as string | null;
    if (!subscriptionId) return { resumed: false, reason: "no_subscription" };

    // Restore the original date, unless it has since passed — in which case bill
    // from today rather than reaching into the past and triggering a catch-up
    // charge the family never agreed to.
    const today = new Date().toISOString().split("T")[0]!;
    const original = parent.guarantee_pause_original_charge_date as string | null;
    const restoreTo = original && original > today ? original : today;

    const moved = await changeNextChargeDate(subscriptionId, restoreTo, {
      parentId,
      reason: "guarantee_pause_resumed",
    });

    if (!moved.ok) {
      logger.error({ parentId, subscriptionId }, "Guarantee resume: ReCharge write failed");
      return { resumed: false, reason: "failed" };
    }

    await supabase
      .from("parents")
      .update({
        pause_type: null,
        billing_paused: false,
        guarantee_pause_applied_at: null,
        guarantee_pause_original_charge_date: null,
      })
      .eq("id", parentId);

    await logAudit({
      actorEmail: opts.actorEmail ?? "system",
      action: "parent.guarantee_billing_resumed",
      entityType: "parent",
      entityId: parentId,
      payloadBefore: { pause_type: "guarantee" },
      payloadAfter: { pause_type: null, next_charge_date: restoreTo },
      metadata: { subscriptionId, dryRun: moved.dryRun },
    });

    logger.info({ parentId, restoreTo, dryRun: moved.dryRun }, "Guarantee pause resumed");
    return { resumed: true };
  } catch (err) {
    logger.error({ err, parentId }, "Guarantee resume threw — match flow continues regardless");
    return { resumed: false, reason: "failed" };
  }
}

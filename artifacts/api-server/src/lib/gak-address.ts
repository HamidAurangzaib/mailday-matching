/**
 * Group A / A6 — Give-a-Key families who have no address yet.
 *
 * A family whose PO Box is being set up through Give a Key completes onboarding
 * before they have anywhere for letters to go. Their child is held at
 * `Awaiting Address` (out of the matching pool) until BOTH halves land: the
 * receipt is verified AND a PO Box address actually arrives. Either one alone
 * leaves the child waiting — a verified receipt with no address still has
 * nowhere to send a letter, and an address with no verified receipt hasn't been
 * paid for yet.
 *
 * The two halves arrive independently and in either order (the parent confirms
 * the address by email link; an admin verifies the receipt in the dashboard), so
 * both paths call `activateAwaitingAddressChildren` and whichever completes the
 * pair does the release.
 */
import { supabase } from "./supabase.js";
import { logAudit } from "./audit.js";
import { logger } from "./logger.js";

/** The 4th address-type option at onboarding (A6). */
export const GAK_ADDRESS_TYPE = "Give a Key PO Box";

/** Holding status: onboarded, but no deliverable address yet. */
export const AWAITING_ADDRESS = "Awaiting Address";

export interface ActivationResult {
  activated: number;
  /** Why nothing happened, when nothing happened. */
  reason?: "not_ready" | "no_parent" | "no_children" | "error";
}

/**
 * Release a Give-a-Key family's waiting children into the matching pool, if and
 * only if the receipt is verified and a PO Box address is on the application.
 *
 * Safe to call repeatedly and from either trigger: it filters on
 * `match_status = 'Awaiting Address'`, so a second call finds nothing to do.
 */
export async function activateAwaitingAddressChildren(
  applicationId: string,
  opts: { actorEmail?: string; source?: string } = {},
): Promise<ActivationResult> {
  const { data: app } = await supabase
    .from("give_a_key_applications")
    .select("id, parent_email, po_box_address, receipt_verified")
    .eq("id", applicationId)
    .single();

  if (!app) return { activated: 0, reason: "no_parent" };

  const address = (app.po_box_address as string | null)?.trim();
  if (!app.receipt_verified || !address) {
    logger.info(
      { applicationId, receiptVerified: !!app.receipt_verified, hasAddress: !!address },
      "A6: not both halves present yet — children stay Awaiting Address",
    );
    return { activated: 0, reason: "not_ready" };
  }

  const { data: parent } = await supabase
    .from("parents")
    .select("id, mailing_address, address_type")
    .eq("email", app.parent_email)
    .single();

  if (!parent) return { activated: 0, reason: "no_parent" };

  const { data: waiting } = await supabase
    .from("children")
    .select("id, child_first_name")
    .eq("parent_id", parent.id)
    .eq("match_status", AWAITING_ADDRESS);

  if (!waiting || waiting.length === 0) {
    return { activated: 0, reason: "no_children" };
  }

  // The PO Box is now the family's real mailing address.
  await supabase
    .from("parents")
    .update({ mailing_address: address, address_type: "PO Box" })
    .eq("id", parent.id);

  const today = new Date().toISOString().split("T")[0];
  const { error } = await supabase
    .from("children")
    .update({
      match_status: "Unmatched",
      awaiting_address_since: null,
      // The match guarantee starts when the child actually becomes matchable.
      // Dating it from onboarding would put a family who waited weeks for their
      // PO Box straight into guarantee breach on the day they join the pool.
      match_guarantee_start_date: today,
    })
    .eq("parent_id", parent.id)
    .eq("match_status", AWAITING_ADDRESS);

  if (error) {
    logger.error({ error, applicationId }, "A6: failed to activate awaiting-address children");
    return { activated: 0, reason: "error" };
  }

  for (const child of waiting) {
    await logAudit({
      actorEmail: opts.actorEmail ?? "system",
      action: "child.awaiting_address_released",
      entityType: "child",
      entityId: child.id as string,
      payloadBefore: { match_status: AWAITING_ADDRESS },
      payloadAfter: { match_status: "Unmatched", match_guarantee_start_date: today },
      metadata: { applicationId, source: opts.source ?? "gak_activation" },
    });
  }

  logger.info(
    { applicationId, parentId: parent.id, activated: waiting.length },
    "A6: Give-a-Key family has an address — children released into the matching pool",
  );
  return { activated: waiting.length };
}

/**
 * Re-open a match for two-party address consent — the Group A / Item 3
 * "family moves" flow. When a matched family changes their mailing address, the
 * pen pal's family must be told and BOTH sides must consent again before the new
 * address is shared or any letter travels. Rather than invent a parallel path,
 * this reuses the A3/A4 consent machinery: it winds the match back to `Pending`,
 * voids the old-address consents, restarts the consent clock (consent_opened_at,
 * so the A4 reminder/timeout engine measures from now — not the original match
 * date), and re-sends the consent email to both parents. The A4 cron then drives
 * the 48h / day-7 / day-14 reminders + timeout automatically.
 *
 * Mirrors the notification send in routes/matches.ts intentionally (kept separate
 * so the proven match-creation path is untouched).
 */
import { supabase } from "./supabase.js";
import { createConfirmationToken } from "./confirmation.js";
import { sendEmail } from "./email.js";
import { logAudit } from "./audit.js";
import { computeAge } from "./age.js";
import { formatFullAddress } from "./address.js";

type ChildForConsent = {
  id: string;
  child_first_name: string | null;
  date_of_birth: string | null;
  age: number | null;
  interests: string[] | null;
  parents: {
    id: string;
    first_name: string | null;
    email: string | null;
    mailing_address: string | null;
    address_type: string | null;
  } | null;
};

export interface ReopenConsentResult {
  ok: boolean;
  matchId: string;
  emailsSent: number;
  error?: string;
}

const CHILD_SELECT =
  "id, child_first_name, date_of_birth, age, interests, parents(id, first_name, email, mailing_address, address_type)";

/**
 * Reopen `matchId` for re-consent. Safe to call only on an Active or Pending
 * match; anything else is a no-op with ok:false. `reason` is recorded in the
 * audit trail (e.g. "family_moved").
 */
export async function reopenMatchForReconsent(
  matchId: string,
  opts: { reason: string; actorEmail?: string | null } = { reason: "family_moved" },
): Promise<ReopenConsentResult> {
  const out: ReopenConsentResult = { ok: false, matchId, emailsSent: 0 };
  const actor = opts.actorEmail ?? "system:reconsent";

  const { data: match } = await supabase
    .from("matches")
    .select("id, child_a_id, child_b_id, match_status")
    .eq("id", matchId)
    .single();
  if (!match) { out.error = "Match not found"; return out; }
  if (match.match_status !== "Active" && match.match_status !== "Pending") {
    out.error = `Match is ${match.match_status}; only Active/Pending matches re-consent`;
    return out;
  }

  const [aRes, bRes] = await Promise.all([
    supabase.from("children").select(CHILD_SELECT).eq("id", match.child_a_id).single(),
    supabase.from("children").select(CHILD_SELECT).eq("id", match.child_b_id).single(),
  ]);
  const childA = aRes.data as unknown as ChildForConsent | null;
  const childB = bRes.data as unknown as ChildForConsent | null;
  if (!childA?.parents?.email || !childB?.parents?.email) {
    out.error = "Both children must have a parent with an email";
    return out;
  }

  const nowIso = new Date().toISOString();

  // Wind the match back to Pending and restart the consent window. The A4 clock
  // reads consent_opened_at, so an old match won't look 14+ days stale.
  await supabase.from("matches").update({
    match_status: "Pending",
    address_confirmed_a: false,
    address_confirmed_b: false,
    address_confirmed_a_at: null,
    address_confirmed_b_at: null,
    promoted_to_active_at: null,
    consent_opened_at: nowIso,
    consent_reminder_1_sent_at: null,
    consent_reminder_2_sent_at: null,
    consent_timeout_at: null,
    match_notification_sent_a: false,
    match_notification_sent_b: false,
  }).eq("id", matchId);

  // The prior consents were for the OLD address — void them so the record only
  // ever reflects a consent to the address actually on file.
  await supabase.from("match_consents").delete().eq("match_id", matchId);

  // Re-send the consent email to both parents (this is how the pen pal's family
  // is "told" — and asked to consent again — after a move).
  const sendOne = async (ownChild: ChildForConsent, penPal: ChildForConsent, side: "a" | "b") => {
    const parent = ownChild.parents!;
    const { url: confirmUrl } = await createConfirmationToken({
      type: "address_confirm_match",
      email: parent.email!,
      parentId: parent.id,
      childId: ownChild.id,
      matchId,
      payload: { side, penpal_first_name: penPal.child_first_name ?? "" },
    });
    const facts = (penPal.interests ?? []).slice(0, 3);
    while (facts.length < 3) facts.push("something fun");
    const penPalAge = computeAge(penPal.date_of_birth) ?? penPal.age ?? "?";
    const res = await sendEmail({
      to: parent.email!,
      templateKey: "match_notification",
      vars: {
        parent_first_name: parent.first_name ?? "",
        child_first_name: ownChild.child_first_name ?? "your child",
        pen_pal_first_name: penPal.child_first_name ?? "their pen pal",
        pen_pal_age: String(penPalAge),
        fun_fact_1: facts[0], fun_fact_2: facts[1], fun_fact_3: facts[2],
        full_address: formatFullAddress(parent.address_type, parent.mailing_address),
        confirm_address_url: confirmUrl,
        pack_url: "https://joinmailday.com/packs",
      },
    });
    if (res.ok) out.emailsSent++;
    const flag = side === "a" ? { match_notification_sent_a: true } : { match_notification_sent_b: true };
    await supabase.from("matches").update(flag).eq("id", matchId);
  };

  await Promise.all([
    sendOne(childA, childB, "a"),
    sendOne(childB, childA, "b"),
  ]);

  await logAudit({
    actorEmail: actor,
    action: "match.reconsent_reopened",
    entityType: "match",
    entityId: matchId,
    metadata: { reason: opts.reason },
  });

  out.ok = true;
  return out;
}

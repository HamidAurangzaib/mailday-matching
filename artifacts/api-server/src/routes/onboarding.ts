import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { differenceInDays, parseISO } from "date-fns";
import { computeAge, computeTier } from "../lib/age.js";
import { verifyTurnstile, tokenFromBody } from "../lib/turnstile.js";

const router: IRouter = Router();

// Onboarding links expire 30 days after the parent record is created (per the
// lifecycle map; also closes audit gap §4.7). The token is created with the
// parent row, so `created_at` is the issue time.
const ONBOARDING_TOKEN_TTL_DAYS = 30;

// Guardian attestation (item D1) — the exact statements the attorney specified.
// Versioned so a stored `guardian_attestation_version` always maps back to the
// precise wording a parent agreed to, even if we revise it later.
const GUARDIAN_ATTESTATION_VERSION = "2026-08-v1";
export const GUARDIAN_ATTESTATION_STATEMENTS = [
  "I am this child's parent or legal guardian.",
  "I am 18 years of age or older.",
  "I will read all letters my child sends and receives.",
  "I understand MailDay may refuse or remove any member for any reason, with a refund.",
] as const;

const VALID_TIERS = ["Core", "Minis", "Homeschool Core", "Homeschool Minis"];

/** Shared token validation for onboarding endpoints: returns the parent or null. */
async function loadParentByToken(token: string) {
  const { data } = await supabase
    .from("parents")
    .select("id, membership_tier, created_at, guardian_attestation_at, address_share_ack_at")
    .eq("onboarding_token", token)
    .single();
  return data;
}

// Address types a parent may choose at onboarding. Required — no default; the
// parent must actively pick one. (A6 will add a "Give a Key PO Box" option.)
const ONBOARDING_ADDRESS_TYPES = ["Home", "Work", "PO Box"];

/** A tier is a "Minis" tier if it serves ages 3–5. */
function isMinisTier(tier: string): boolean {
  return tier.endsWith("Minis");
}

/**
 * Phase 8: pick the membership that best fits this child's age, from the
 * memberships the family actually purchased. Mirrors the /start form's behaviour
 * (auto-select by age, parent can override) but constrained to what was paid for.
 */
function pickBestSlot(
  slots: Array<{ id: string; tier: string }>,
  age: number,
): { id: string; tier: string } | undefined {
  const wantMinis = age <= 5;
  return slots.find((s) => isMinisTier(s.tier) === wantMinis) ?? slots[0];
}

/**
 * A family's memberships, oldest first.
 *
 * Returns BOTH the full set and the unclaimed subset, because "no unclaimed
 * memberships" is ambiguous on its own: it means either "this family predates
 * membership tracking" (legacy — allow any tier) or "they've already assigned
 * every membership they bought" (reject). `hasAny` disambiguates.
 */
async function fetchSlots(parentId: string): Promise<{
  hasAny: boolean;
  available: Array<{ id: string; tier: string }>;
}> {
  const { data } = await supabase
    .from("membership_slots")
    .select("id, tier, child_id")
    .eq("parent_id", parentId)
    .order("created_at");
  const all = (data ?? []) as Array<{ id: string; tier: string; child_id: string | null }>;
  return {
    hasAny: all.length > 0,
    available: all.filter((s) => s.child_id === null).map((s) => ({ id: s.id, tier: s.tier })),
  };
}

// GET /api/onboarding/:token — public, returns parent info for prefill
router.get("/onboarding/:token", async (req, res) => {
  try {
    const { data: parent, error } = await supabase
      .from("parents")
      .select("id, first_name, last_name, email, membership_tier, state, mailing_address, address_type, created_at")
      .eq("onboarding_token", req.params.token)
      .single();

    if (error || !parent) {
      res.status(404).json({ error: "Invalid or expired onboarding link" });
      return;
    }

    // 30-day expiry check
    if (parent.created_at) {
      const age = differenceInDays(new Date(), parseISO(parent.created_at as string));
      if (age > ONBOARDING_TOKEN_TTL_DAYS) {
        res.status(410).json({
          error: "This onboarding link has expired. Please contact MailDay to receive a new one.",
        });
        return;
      }
    }

    // Phase 8: tell the form which memberships this family actually purchased,
    // so the parent picks from those instead of all four tiers. Families created
    // before membership_slots existed have none — the form then falls back to
    // the old behaviour (any valid tier).
    const { available: availableSlots } = await fetchSlots(parent.id as string);

    // Don't leak created_at to the client (used only for the expiry check)
    const { created_at, ...safeParent } = parent as Record<string, unknown>;
    void created_at;
    res.json({
      ...safeParent,
      available_memberships: availableSlots,
      memberships_remaining: availableSlots.length,
    });
  } catch (err) {
    req.log?.error({ err }, "Error fetching onboarding parent");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/onboarding/:token/attestation — public. The parent-level finalize
// step, called once per submit before the children. Records two things:
//   1. Guardian attestation (four boxes) with timestamp + wording version.
//   2. The confirmed/edited mailing address, a required address type, and the
//      address-sharing consent (with its timestamp).
// Address edits here are applied DIRECTLY (part of signup) — the onboarding link
// itself already proves the parent controls the account email, and no match or
// letters exist yet, so the A1 email round-trip isn't needed. A1's email
// confirmation is for address changes made *after* signup.
router.post("/onboarding/:token/attestation", async (req, res) => {
  try {
    // A5: bot protection — the attestation is the once-per-submit gate for the
    // onboarding form, so the Turnstile token is verified here (a single token is
    // consumed once, so we don't re-check it on each per-child call that follows).
    const turnstile = await verifyTurnstile(tokenFromBody(req.body), req.ip);
    if (!turnstile.ok) {
      req.log?.warn({ reason: turnstile.reason }, "Onboarding: Turnstile verification failed");
      res.status(400).json({ error: "Bot verification failed. Please refresh the page and try again." });
      return;
    }

    const parent = await loadParentByToken(req.params.token);
    if (!parent) {
      res.status(404).json({ error: "Invalid or expired onboarding link" });
      return;
    }
    if (parent.created_at) {
      const age = differenceInDays(new Date(), parseISO(parent.created_at as string));
      if (age > ONBOARDING_TOKEN_TTL_DAYS) {
        res.status(410).json({ error: "This onboarding link has expired. Please contact MailDay to receive a new one." });
        return;
      }
    }

    // The form requires all four; the server confirms it too so the record can't
    // be created without genuine agreement to every statement.
    const agreed = req.body?.agreed;
    if (agreed !== true) {
      res.status(400).json({ error: "All guardian statements must be agreed to before continuing." });
      return;
    }

    // Address block — required at onboarding (A4). The parent must confirm/edit
    // the address, actively pick a type, and agree to sharing.
    const body = req.body as {
      mailing_address?: string;
      address_type?: string;
      address_share_ack?: boolean;
    };
    const mailingAddress = (body.mailing_address ?? "").trim();
    if (!mailingAddress) {
      res.status(400).json({ error: "A mailing address is required." });
      return;
    }
    if (!body.address_type || !ONBOARDING_ADDRESS_TYPES.includes(body.address_type)) {
      res.status(400).json({ error: "Please choose an address type (Home, Work or PO Box)." });
      return;
    }
    if (body.address_share_ack !== true) {
      res.status(400).json({ error: "Please agree to share this address so letters can be delivered." });
      return;
    }

    const update: Record<string, unknown> = {
      // Address edits at onboarding apply directly (see the note above).
      mailing_address: mailingAddress,
      address_type: body.address_type,
    };
    // Timestamps are first-write-wins so we keep the original consent moment.
    if (!parent.guardian_attestation_at) {
      update["guardian_attestation_at"] = new Date().toISOString();
      update["guardian_attestation_version"] = GUARDIAN_ATTESTATION_VERSION;
    }
    if (!parent.address_share_ack_at) {
      update["address_share_ack_at"] = new Date().toISOString();
    }

    await supabase.from("parents").update(update).eq("id", parent.id);

    res.json({ success: true, version: GUARDIAN_ATTESTATION_VERSION });
  } catch (err) {
    req.log?.error({ err }, "Error recording guardian attestation");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/onboarding/:token/child — public, submits child info
//
// Per the lifecycle map: age MUST be derived from date_of_birth so kids age
// out of Minis as they grow. We require DOB and reject the old age-only path.
// We still write the computed age into `children.age` for backward compatibility
// with code that reads that column (matching, stats); Phase 3.5 introduces the
// aging-out cron that keeps it correct over time.
router.post("/onboarding/:token/child", async (req, res) => {
  try {
    const { data: parent, error: parentErr } = await supabase
      .from("parents")
      .select("id, membership_tier, created_at")
      .eq("onboarding_token", req.params.token)
      .single();

    if (parentErr || !parent) {
      res.status(404).json({ error: "Invalid or expired onboarding link" });
      return;
    }

    // Re-check 30-day expiry on submit (GET expiry guards the form load, but a
    // window left open for a month shouldn't be able to submit either).
    if (parent.created_at) {
      const age = differenceInDays(new Date(), parseISO(parent.created_at as string));
      if (age > ONBOARDING_TOKEN_TTL_DAYS) {
        res.status(410).json({
          error: "This onboarding link has expired. Please contact MailDay to receive a new one.",
        });
        return;
      }
    }

    const body = req.body;

    if (!body.child_first_name || typeof body.child_first_name !== "string") {
      res.status(400).json({ error: "child_first_name is required" });
      return;
    }

    if (!body.date_of_birth || typeof body.date_of_birth !== "string") {
      res.status(400).json({ error: "date_of_birth is required (YYYY-MM-DD)" });
      return;
    }

    const childAge = computeAge(body.date_of_birth);
    if (childAge === null || childAge < 1 || childAge > 18) {
      res.status(400).json({ error: "Child must be between 1 and 18 years old" });
      return;
    }

    // ─── Tier resolution (Phase 8) ────────────────────────────────────────────
    // A child's tier is the membership that was PURCHASED for them, never derived
    // from the parent's tier. The parent picks which membership this child uses
    // (auto-suggested by age); we then claim that slot so the family can't enrol
    // more children than memberships they bought.
    //
    // Legacy fallback: families that predate membership_slots have no slots, so
    // we keep the old age/parent-tier behaviour for them.
    const { hasAny: hasMemberships, available: availableSlots } = await fetchSlots(parent.id as string);

    let tier: string;
    let claimedSlot: { id: string; tier: string } | undefined;

    if (hasMemberships) {
      // They're on the membership model — every child must claim one, so a family
      // can never enrol more children than memberships they purchased.
      if (availableSlots.length === 0) {
        res.status(400).json({
          error:
            "All of your memberships have already been assigned to a child. " +
            "If you'd like to add another child, please purchase an additional membership.",
        });
        return;
      }
      if (body.tier && VALID_TIERS.includes(body.tier)) {
        claimedSlot = availableSlots.find((s) => s.tier === body.tier);
        if (!claimedSlot) {
          const remaining = [...new Set(availableSlots.map((s) => s.tier))].join(", ");
          res.status(400).json({
            error: `You don't have an unused ${body.tier} membership. Remaining: ${remaining}.`,
          });
          return;
        }
      } else {
        claimedSlot = pickBestSlot(availableSlots, childAge);
      }
      if (!claimedSlot) {
        res.status(400).json({
          error: "All of your memberships have already been assigned to a child.",
        });
        return;
      }
      tier = claimedSlot.tier;
    } else {
      const parentTier = parent.membership_tier as string | null;
      const computedTier = computeTier(childAge, parentTier ?? "Core");
      if (!computedTier) {
        res.status(400).json({ error: "Child age must fall within a supported tier (3–12 years)" });
        return;
      }
      tier = body.tier && VALID_TIERS.includes(body.tier) ? body.tier : computedTier;
    }

    const interests: string[] = Array.isArray(body.interests) ? body.interests.slice(0, 10) : [];

    const today = new Date().toISOString().split("T")[0];

    const { data: child, error } = await supabase
      .from("children")
      .insert({
        parent_id: parent.id,
        child_first_name: body.child_first_name.trim(),
        age: childAge,                  // legacy column, kept in sync with DOB on insert
        date_of_birth: body.date_of_birth,
        tier,
        interests,
        homeschool_edition: body.homeschool_edition ?? false,
        homeschool_tier: body.homeschool_tier,
        homeschool_approach: body.homeschool_approach,
        match_status: "Unmatched",
        rematch_count: 0,
        match_guarantee_start_date: today,
        billing_paused: false,
        safety_flag: false,
        created_date: today,
      })
      .select("id, child_first_name, tier")
      .single();

    if (error || !child) {
      req.log?.error({ error }, "Error creating child via onboarding");
      res.status(500).json({ error: "Failed to save your information. Please try again." });
      return;
    }

    // Claim the membership. The `.is("child_id", null)` guard makes this safe if
    // two of the family's children are submitted at the same time — the second
    // write can't steal a membership the first already claimed.
    if (claimedSlot) {
      const { data: claimed } = await supabase
        .from("membership_slots")
        .update({ child_id: child.id, assigned_at: new Date().toISOString() })
        .eq("id", claimedSlot.id)
        .is("child_id", null)
        .select("id");
      if (!claimed || claimed.length === 0) {
        req.log?.warn(
          { childId: child.id, slotId: claimedSlot.id },
          "Membership slot was claimed concurrently; child saved but slot not linked",
        );
      }
    }

    req.log?.info(
      { childId: child.id, parentId: parent.id, tier, age: childAge, slotId: claimedSlot?.id ?? null },
      "Child created via onboarding form",
    );
    res.status(201).json({ success: true, child_first_name: child.child_first_name });
  } catch (err) {
    req.log?.error({ err }, "Error processing onboarding submission");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

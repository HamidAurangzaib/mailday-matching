import { Router, type IRouter, type Request } from "express";
import crypto from "crypto";
import { supabase } from "../lib/supabase.js";
import { emitKlaviyoEvent } from "../lib/klaviyo-events.js";
import { isCrossTier } from "../lib/age.js";
import { logger } from "../lib/logger.js";
import { appBaseUrl } from "../lib/app-url.js";

/**
 * Phase 3.6: After a child's tier changes (Shopify webhook or aging cron),
 * check whether any Active matches this parent's children are in have become
 * cross-tier. If so, flag the match for admin review and create a
 * `review_tier_mismatch` task. Per the lifecycle map, the app NEVER
 * auto-dissolves — only a human decides.
 */
// NOTE (Phase 8): currently unreferenced. Its previous caller — the block that
// rewrote every child's tier from the parent's tier on a Shopify tier change —
// was removed, because a child's tier now comes from the membership purchased
// for them. Kept because the forthcoming "upgrade an existing child's
// membership" flow will need exactly this cross-tier review check.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function flagAffectedMatchesAsCrossTier(parentId: string, source: string): Promise<void> {
  const { data: kids } = await supabase
    .from("children")
    .select("id, child_first_name, tier")
    .eq("parent_id", parentId);
  if (!kids || kids.length === 0) return;

  const childIds = kids.map((k) => k.id);
  const { data: matches } = await supabase
    .from("matches")
    .select("id, child_a_id, child_b_id, match_status, tier_mismatch_flagged")
    .eq("match_status", "Active")
    .or(`child_a_id.in.(${childIds.join(",")}),child_b_id.in.(${childIds.join(",")})`);

  if (!matches || matches.length === 0) return;

  for (const m of matches) {
    if (m.tier_mismatch_flagged) continue; // already flagged, idempotent

    // Pull both children's current tiers and check for cross-tier.
    const [aRes, bRes] = await Promise.all([
      supabase.from("children").select("id, child_first_name, tier").eq("id", m.child_a_id).single(),
      supabase.from("children").select("id, child_first_name, tier").eq("id", m.child_b_id).single(),
    ]);
    const a = aRes.data as { id: string; child_first_name: string; tier: string } | null;
    const b = bRes.data as { id: string; child_first_name: string; tier: string } | null;
    if (!a || !b) continue;

    if (isCrossTier(a.tier, b.tier)) {
      await supabase.from("matches").update({ tier_mismatch_flagged: true }).eq("id", m.id);

      // Idempotency on the task: skip if an open one already references this match.
      const { data: existing } = await supabase
        .from("lifecycle_tasks")
        .select("id")
        .eq("type", "review_tier_mismatch")
        .eq("completed", false)
        .eq("match_id", m.id);

      if (!existing || existing.length === 0) {
        await supabase.from("lifecycle_tasks").insert({
          type: "review_tier_mismatch",
          title: `Tier mismatch — review ${a.child_first_name} (${a.tier}) & ${b.child_first_name} (${b.tier})`,
          description:
            `An Active match is now cross-tier (likely due to ${source}). ` +
            `Decide whether to dissolve the match. App will NEVER auto-dissolve.`,
          match_id: m.id,
        });
      }

      logger.info({ matchId: m.id, source }, "Tier mismatch flagged");
    }
  }
}

const router: IRouter = Router();

type RawRequest = Request & { rawBody?: Buffer };

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

function verifyHmac(rawBody: Buffer | undefined, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !rawBody) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

// ─── App URL helper ──────────────────────────────────────────────────────────
// Used to construct onboarding links sent to Klaviyo as profile properties.

// appBaseUrl now comes from lib/app-url.ts — one hardened implementation shared
// by every emailed link (onboarding, address confirmation, password reset).

// ─── Shopify order helpers ────────────────────────────────────────────────────

/** Classify a single line item into a tier, or null if it isn't a membership. */
function tierFromLineItem(item: { title?: string; name?: string; variant_title?: string }): string | null {
  const text = `${item.title || ""} ${item.name || ""} ${item.variant_title || ""}`.toLowerCase();
  if (text.includes("minis") && text.includes("homeschool")) return "Homeschool Minis";
  if (text.includes("core") && text.includes("homeschool")) return "Homeschool Core";
  if (text.includes("minis")) return "Minis";
  if (text.includes("core")) return "Core";
  return null;
}

/**
 * Phase 8: an order can contain MORE THAN ONE membership, at different tiers
 * (e.g. 1× Homeschool Core + 1× Minis). Expand every membership line item into
 * one slot per quantity, so each child can later claim exactly what was paid for.
 *
 * The old inferTier() returned only the FIRST match for the whole order, which
 * silently discarded every additional child's membership.
 */
export function parseMembershipSlots(
  lineItems: Array<{ title?: string; name?: string; variant_title?: string; quantity?: number }>,
): Array<{ tier: string; billing_type: string }> {
  const slots: Array<{ tier: string; billing_type: string }> = [];
  for (const item of lineItems) {
    const tier = tierFromLineItem(item);
    if (!tier) continue; // not a membership line (e.g. a donation or add-on)
    const billing_type = inferBillingType([item]);
    const qty = Math.max(1, Number(item.quantity) || 1);
    for (let i = 0; i < qty; i++) slots.push({ tier, billing_type });
  }
  return slots;
}

/**
 * Legacy summary tier for `parents.membership_tier` — kept because reporting,
 * segments and the Klaviyo profile still read it. It is NO LONGER the source of
 * truth for any child's tier; membership_slots is.
 */
function inferTier(lineItems: Array<{ title?: string; name?: string; variant_title?: string }>): string {
  for (const item of lineItems) {
    const tier = tierFromLineItem(item);
    if (tier) return tier;
  }
  return "Core";
}

/**
 * Persist one membership_slots row per purchased membership.
 * Idempotent per Shopify order: if this order already created slots for this
 * parent we skip, so a webhook retry can never hand a family extra memberships.
 */
async function createMembershipSlots(
  parentId: string,
  shopifyOrderId: number | undefined,
  slots: Array<{ tier: string; billing_type: string }>,
  req?: { log?: { info?: (o: unknown, m: string) => void; error?: (o: unknown, m: string) => void } },
): Promise<number> {
  if (slots.length === 0) return 0;
  const orderId = shopifyOrderId != null ? String(shopifyOrderId) : null;

  if (orderId) {
    const { data: already } = await supabase
      .from("membership_slots")
      .select("id")
      .eq("parent_id", parentId)
      .eq("shopify_order_id", orderId)
      .limit(1);
    if (already && already.length > 0) {
      req?.log?.info?.({ parentId, orderId }, "membership slots already created for this order — skipping");
      return 0;
    }
  }

  const rows = slots.map((s) => ({
    parent_id: parentId,
    tier: s.tier,
    billing_type: s.billing_type,
    shopify_order_id: orderId,
    source: "shopify",
  }));
  const { error } = await supabase.from("membership_slots").insert(rows);
  if (error) {
    req?.log?.error?.({ error, parentId, orderId }, "Failed to create membership slots");
    return 0;
  }
  req?.log?.info?.(
    { parentId, orderId, count: rows.length, tiers: rows.map((r) => r.tier) },
    "Membership slots created",
  );
  return rows.length;
}

function inferBillingType(lineItems: Array<{ title?: string }>): string {
  for (const item of lineItems) {
    const text = (item.title || "").toLowerCase();
    if (text.includes("annual") || text.includes("year")) return "Annual";
  }
  return "Monthly";
}

// ─── POST /api/webhooks/shopify/orders ───────────────────────────────────────
// Fires when a new Shopify order is placed → creates or updates the parent record.
// Register in Shopify: Settings → Notifications → Webhooks → orders/create

router.post("/webhooks/shopify/orders", async (req: RawRequest, res) => {
  const rawBody = req.rawBody;
  const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string | undefined;
  const secret = process.env["SHOPIFY_WEBHOOK_SECRET"];

  if (!secret) {
    req.log?.error("SHOPIFY_WEBHOOK_SECRET not configured — refusing webhook");
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    req.log?.warn("Shopify orders webhook HMAC verification failed");
    res.status(401).json({ error: "Invalid HMAC" });
    return;
  }

  try {
    const order = req.body as {
      id?: number;
      customer?: { id?: number; email?: string; first_name?: string; last_name?: string; phone?: string };
      billing_address?: { province_code?: string; address1?: string; address2?: string; city?: string; zip?: string };
      line_items?: Array<{ title?: string; name?: string; variant_title?: string; quantity?: number }>;
    };

    const customer = order.customer;
    if (!customer?.email) {
      res.status(200).json({ received: true, skipped: "no customer email" });
      return;
    }

    // Phase 8: every membership on the order becomes its own slot, so a family
    // buying e.g. Homeschool Core + Minis gets BOTH — not just the first one.
    const membershipSlots = parseMembershipSlots(order.line_items || []);
    // Legacy summary field only; no child's tier is derived from this any more.
    const tier = inferTier(order.line_items || []);
    const billing_type = inferBillingType(order.line_items || []);
    const ba = order.billing_address;
    const mailing_address = ba?.address1
      ? [ba.address1, ba.address2, ba.city, ba.province_code, ba.zip].filter(Boolean).join(", ")
      : null;
    const onboarding_token = crypto.randomUUID();

    const { data: existing } = await supabase
      .from("parents")
      .select("id, onboarding_token, join_date")
      .eq("email", customer.email.toLowerCase())
      .single();

    if (existing) {
      await supabase.from("parents").update({
        shopify_customer_id: customer.id?.toString(),
        membership_tier: tier,
        billing_type,
        subscription_status: "Active",
        state: ba?.province_code || undefined,
        mailing_address: mailing_address || undefined,
      }).eq("id", existing.id);

      // Phase 8: a returning subscriber placing another order has bought MORE
      // memberships (e.g. adding a second child) — record each as its own slot.
      //
      // NOTE: we deliberately no longer rewrite existing children's tiers from
      // the parent's tier. A child's tier is whatever membership was purchased
      // for them; forcing the family's tier onto every child is exactly what
      // produced the "paid for Minis, got Homeschool Minis" bug.
      await createMembershipSlots(existing.id, order.id, membershipSlots, req);

      // Phase 2.1: emit `family_subscribed` so Klaviyo's K1 Welcome flow can
      // fire with the existing onboarding URL. For a returning subscriber this
      // doesn't issue a fresh token — they keep the one they had.
      void emitKlaviyoEvent({
        event: "family_subscribed",
        profile: {
          email: customer.email.toLowerCase(),
          first_name: customer.first_name ?? undefined,
          last_name: customer.last_name ?? undefined,
        },
        properties: {
          tier,
          billing_type,
          // K8 annual-upgrade flow triggers off this date property (day-90 send).
          subscription_start_date: existing.join_date ?? new Date().toISOString().split("T")[0],
          onboarding_url: `${appBaseUrl()}/onboarding?token=${existing.onboarding_token}`,
          returning_subscriber: true,
        },
      }).catch((err) => req.log?.warn({ err }, "Klaviyo family_subscribed emit failed (existing parent)"));

      req.log?.info({ parentId: existing.id }, "Shopify orders: updated existing parent");
      res.status(200).json({ received: true, parent_id: existing.id, onboarding_token: existing.onboarding_token });
      return;
    }

    const joinDate = new Date().toISOString().split("T")[0];
    const { data: parent, error } = await supabase
      .from("parents")
      .insert({
        email: customer.email.toLowerCase(),
        first_name: customer.first_name || "",
        last_name: customer.last_name || "",
        phone: customer.phone,
        state: ba?.province_code,
        mailing_address,
        membership_tier: tier,
        billing_type,
        subscription_status: "Active",
        join_date: joinDate,
        shopify_customer_id: customer.id?.toString(),
        onboarding_token,
      })
      .select("id, onboarding_token")
      .single();

    if (error || !parent) {
      req.log?.error({ error }, "Shopify orders: failed to create parent");
      res.status(200).json({ received: true, error: "Failed to create parent" });
      return;
    }

    // Phase 8: record every purchased membership so each child can claim exactly
    // what was paid for during onboarding.
    await createMembershipSlots(parent.id as string, order.id, membershipSlots, req);

    // Phase 2.1: emit `family_subscribed` so Klaviyo's K1 Welcome flow can
    // fire with the just-issued onboarding token. Fire-and-forget — a Klaviyo
    // outage must not break the webhook ack.
    void emitKlaviyoEvent({
      event: "family_subscribed",
      profile: {
        email: customer.email.toLowerCase(),
        first_name: customer.first_name ?? undefined,
        last_name: customer.last_name ?? undefined,
      },
      properties: {
        tier,
        billing_type,
        // K8 annual-upgrade flow triggers off this date property (day-90 send).
        subscription_start_date: joinDate,
        onboarding_url: `${appBaseUrl()}/onboarding?token=${parent.onboarding_token}`,
        returning_subscriber: false,
      },
    }).catch((err) => req.log?.warn({ err }, "Klaviyo family_subscribed emit failed (new parent)"));

    req.log?.info({ parentId: parent.id }, "Shopify orders: created new parent");
    res.status(200).json({ received: true, parent_id: parent.id, onboarding_token: parent.onboarding_token });
  } catch (err) {
    req.log?.error({ err }, "Shopify orders webhook error");
    res.status(200).json({ received: true, error: "Internal error" });
  }
});

// ─── POST /api/webhooks/recharge/subscriptions ───────────────────────────────
// Fires on ReCharge subscription events → syncs billing_paused to children.
//
// How to register in ReCharge:
//   Dashboard → Integrations → Webhooks → Add webhook
//   Topics: subscription/updated, subscription/activated, subscription/cancelled
//   URL: https://<your-domain>/api/webhooks/recharge/subscriptions
//
// Find your secret: ReCharge dashboard → Integrations → Webhooks → Webhook secret
// Save it as RECHARGE_WEBHOOK_SECRET in Replit Secrets.

router.post("/webhooks/recharge/subscriptions", async (req: RawRequest, res) => {
  const rawBody = req.rawBody;
  const hmacHeader = req.headers["x-recharge-hmac-sha256"] as string | undefined;
  const secret = process.env["RECHARGE_WEBHOOK_SECRET"];

  if (!secret) {
    req.log?.error("RECHARGE_WEBHOOK_SECRET not configured — refusing webhook");
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    req.log?.warn("ReCharge subscription webhook HMAC verification failed");
    res.status(401).json({ error: "Invalid HMAC" });
    return;
  }

  try {
    const payload = req.body as {
      subscription?: { id?: number; status?: string; email?: string };
      customer?: { email?: string };
      status?: string;
      email?: string;
    };

    // ReCharge v1/v2 payloads vary — try all common locations for email + status
    const email = payload.subscription?.email ?? payload.customer?.email ?? payload.email;
    const rawStatus = (payload.subscription?.status ?? payload.status ?? "").toUpperCase();

    if (!email) {
      req.log?.warn({ payload }, "ReCharge webhook: no customer email in payload");
      res.status(200).json({ received: true, skipped: "no email" });
      return;
    }

    const { data: parent } = await supabase
      .from("parents")
      .select("id, first_name, last_name, membership_tier, billing_type, join_date")
      .eq("email", email.toLowerCase())
      .single();

    if (!parent) {
      req.log?.warn({ email }, "ReCharge webhook: no parent found for email");
      res.status(200).json({ received: true, skipped: "parent not found" });
      return;
    }

    const billing_paused = rawStatus === "PAUSED";
    const subscription_status =
      rawStatus === "ACTIVE"    ? "Active"    :
      rawStatus === "PAUSED"    ? "Paused"    :
      rawStatus === "CANCELLED" ? "Cancelled" : null;

    const parentUpdate: Record<string, unknown> = { billing_paused };
    if (subscription_status) parentUpdate.subscription_status = subscription_status;
    // Phase 3.7: any PAUSED status coming from ReCharge is a voluntary pause
    // (the family did it themselves in ReCharge OR a VA did it on their behalf
    // after they asked). Guarantee pauses are set by our own cron, never by
    // this webhook. On ACTIVE/CANCELLED, clear pause_type.
    if (rawStatus === "PAUSED") {
      parentUpdate.pause_type = "voluntary";
    } else if (rawStatus === "ACTIVE" || rawStatus === "CANCELLED") {
      parentUpdate.pause_type = null;
    }

    // Phase 3.9: on CANCELLED, do NOT immediately end matches or change
    // subscription_status. Hold the family in a 48h grace window and create the
    // cancellations row. `runFinaliseCancellations()` offboards them after that.
    //
    // The automated R4 pause-offer email was removed (Courtney, 2026-07-20): the
    // app can mark a family paused locally but cannot pause ReCharge billing, so
    // offering a pause automatically risked telling a parent they were paused
    // while their card kept being charged. Pauses are now offered by hand.
    // The 48h window is kept as a deliberate buffer before offboarding.
    if (rawStatus === "CANCELLED") {
      // Override subscription_status — we keep them Active for 48h.
      parentUpdate.subscription_status = "Active";
      parentUpdate.intent_to_cancel_at = new Date().toISOString();
      // Don't change billing_paused — match stays "live" during grace window.
    }

    await Promise.all([
      supabase.from("parents").update(parentUpdate).eq("id", parent.id),
      // Only mirror billing_paused on PAUSED. CANCELLED handled by cron later.
      rawStatus === "CANCELLED"
        ? Promise.resolve()
        : supabase.from("children").update({ billing_paused }).eq("parent_id", parent.id),
    ]);

    // On CANCELLED: create the cancellations row + review task for the team.
    if (rawStatus === "CANCELLED") {
      const cancelDate = new Date().toISOString().split("T")[0];
      const joinDateObj = parent.join_date ? new Date(parent.join_date) : new Date();
      const tenureMonths = Math.max(0, Math.round(
        (new Date(cancelDate).getTime() - joinDateObj.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      ));

      // Create cancellation row immediately (user-selected behaviour 2026-06-03).
      // Reason code defaults to 'other' until the team categorises it.
      const { data: cancellation } = await supabase.from("cancellations").insert({
        parent_id: parent.id,
        cancellation_date: cancelDate,
        tenure_months: tenureMonths,
        tier: (parent as Record<string, string | null>)["membership_tier"] || "Core",
        billing_type: (parent as Record<string, string | null>)["billing_type"] || "Monthly",
        reason_code: "other",
        cancellation_reason_raw: (payload.subscription as Record<string, unknown> | undefined)?.["cancellation_reason"] as string | null ?? null,
        webhook_payload: payload as unknown as Record<string, unknown>,
      }).select().single();

      if (cancellation) {
        const parentName = `${(parent as Record<string, string | null>)["first_name"] ?? ""} ${(parent as Record<string, string | null>)["last_name"] ?? ""}`.trim();
        const tier = (parent as Record<string, string | null>)["membership_tier"] || "Core";
        await Promise.all([
          supabase.from("cancellation_notes").insert({
            cancellation_id: cancellation.id,
            note_type: "system",
            content: `Cancellation received via ReCharge webhook. Tenure: ${tenureMonths} months. 48h grace window started. Raw reason: ${(payload.subscription as Record<string, unknown> | undefined)?.["cancellation_reason"] ?? "Not provided"}.`,
            created_by: "system",
          }),
          supabase.from("cancellation_tasks").insert({
            cancellation_id: cancellation.id,
            type: "review_needed",
            title: "New cancellation — 48h grace before offboarding",
            description: `${parentName} · ${tier} · ${cancelDate}. If you want to offer a pause, email them within 48h — the app no longer sends an automatic pause offer. Otherwise the family is offboarded automatically.`,
          }),
        ]);
        req.log?.info({ parentId: parent.id, cancellationId: cancellation.id, tenureMonths }, "Cancellation tracker row created (48h grace)");
      }

      // The automated R4 pause-offer email used to be sent here. Removed
      // 2026-07-20 — see the note above. The team offers pauses manually, and
      // the cancellation task created above prompts them to do so.
    }

    req.log?.info({ parentId: parent.id, rawStatus, billing_paused }, "ReCharge subscription webhook processed");
    res.status(200).json({ received: true, parent_id: parent.id, billing_paused });
  } catch (err) {
    req.log?.error({ err }, "ReCharge subscription webhook error");
    res.status(200).json({ received: true, error: "Internal error" });
  }
});

// ─── POST /api/webhooks/shopify-orders ───────────────────────────────────────
// Fires when a Shopify order is created containing SKU GAK-DONATION.
// Automatically creates Give a Key donation records for matching line items.
// Register in Shopify: Settings → Notifications → Webhooks → orders/create
// URL: https://<your-domain>/api/webhooks/shopify-orders

router.post("/webhooks/shopify-orders", async (req: RawRequest, res) => {
  const rawBody = req.rawBody;
  const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string | undefined;
  const secret = process.env["SHOPIFY_WEBHOOK_SECRET"];

  if (!secret) {
    req.log?.error("SHOPIFY_WEBHOOK_SECRET not configured — refusing GAK webhook");
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    req.log?.warn("Shopify GAK webhook HMAC verification failed");
    res.status(401).json({ error: "Invalid HMAC" });
    return;
  }

  try {
    const order = req.body as {
      id?: number;
      created_at?: string;
      customer?: { first_name?: string; last_name?: string; email?: string };
      line_items?: Array<{
        sku?: string;
        title?: string;
        quantity?: number;
        price?: string;
      }>;
    };

    const customer = order.customer;
    if (!customer?.email) {
      res.status(200).json({ received: true, skipped: "no customer email" });
      return;
    }

    // Find all GAK-DONATION line items
    const gakItems = (order.line_items || []).filter(
      (item) => item.sku?.toUpperCase() === "GAK-DONATION"
    );

    if (gakItems.length === 0) {
      res.status(200).json({ received: true, skipped: "no GAK-DONATION SKU in order" });
      return;
    }

    const donationDate = order.created_at
      ? new Date(order.created_at).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    const donations = gakItems.map((item) => ({
      donor_first_name: (customer.first_name || "").trim() || "Anonymous",
      donor_last_name: (customer.last_name || "").trim() || "Donor",
      donor_email: customer.email!.toLowerCase().trim(),
      donation_amount: parseFloat(item.price || "0") * (item.quantity || 1),
      donation_date: donationDate,
      notes: `Shopify order #${order.id ?? "unknown"} — ${item.title || "Give a Key Donation"}`,
      source: "shopify",
    }));

    const { data, error } = await supabase
      .from("give_a_key_donations")
      .insert(donations)
      .select("id, donor_email, donor_first_name, donor_last_name, donation_amount, donation_date");

    if (error) {
      req.log?.error({ error }, "GAK webhook: failed to insert donations");
      res.status(200).json({ received: true, error: "Failed to record donations" });
      return;
    }

    // Forward each donation to Klaviyo so the K9 donor thank-you flow can fire.
    // One Shopify order can contain multiple GAK-DONATION line items (rare but possible),
    // so emit one event per recorded donation. Silent fail per-row — DB writes already committed.
    for (const d of data ?? []) {
      void emitKlaviyoEvent({
        event: "gak_donation_recorded",
        profile: {
          email: d.donor_email as string,
          first_name: d.donor_first_name as string,
          last_name: d.donor_last_name as string,
        },
        properties: {
          donation_id: d.id,
          amount: Number(d.donation_amount),
          donation_date: d.donation_date,
          source: "shopify",
          shopify_order_id: order.id ?? null,
        },
      }).catch((err) => req.log?.warn({ err, donationId: d.id }, "K9 Klaviyo event emit failed (Shopify)"));
    }

    req.log?.info(
      { orderId: order.id, donationsCreated: data?.length },
      "GAK webhook: donations recorded"
    );
    res.status(200).json({ received: true, donations_created: data?.length });
  } catch (err) {
    req.log?.error({ err }, "GAK webhook error");
    res.status(200).json({ received: true, error: "Internal error" });
  }
});

// ─── POST /api/webhooks/klaviyo/email-events ─────────────────────────────────
// Receives Klaviyo email open events → updates last_email_open_date per parent,
// increments emails_opened on the matching monthly pack delivery log, and clears
// the at_risk flag for re-engaged parents.
//
// Register in Klaviyo: Settings → Integrations → Webhooks
// URL: https://<your-domain>/api/webhooks/klaviyo/email-events
// Events to subscribe: "Opened Email"
// Save the webhook secret as KLAVIYO_WEBHOOK_SECRET in Replit Secrets.

router.post("/webhooks/klaviyo/email-events", async (req: RawRequest, res) => {
  const rawBody = req.rawBody;
  const hmacHeader = (
    req.headers["x-klaviyo-signature"] ?? req.headers["klaviyo-signature"]
  ) as string | undefined;
  const secret = process.env["KLAVIYO_WEBHOOK_SECRET"];

  if (!secret) {
    req.log?.error("KLAVIYO_WEBHOOK_SECRET not configured — refusing webhook");
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!hmacHeader || !verifyHmac(rawBody, hmacHeader, secret)) {
    req.log?.warn("Klaviyo webhook signature verification failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    const payload = req.body as {
      data?: {
        attributes?: {
          datetime?: string;
          event_properties?: Record<string, string>;
          metric?: { data?: { attributes?: { name?: string } } };
          profile?: { data?: { attributes?: { email?: string } } };
        };
      };
    };

    const metricName = payload.data?.attributes?.metric?.data?.attributes?.name ?? "";
    const email = payload.data?.attributes?.profile?.data?.attributes?.email;
    const eventDatetime = payload.data?.attributes?.datetime;
    const eventProps = payload.data?.attributes?.event_properties ?? {};

    if (!email) {
      res.status(200).json({ received: true, skipped: "no email in payload" });
      return;
    }

    if (metricName !== "Opened Email") {
      res.status(200).json({ received: true, skipped: `metric '${metricName}' not tracked` });
      return;
    }

    const { data: parent } = await supabase
      .from("parents")
      .select("id, at_risk")
      .eq("email", email.toLowerCase())
      .single();

    if (!parent) {
      req.log?.warn({ email }, "Klaviyo webhook: no parent found for email");
      res.status(200).json({ received: true, skipped: "parent not found" });
      return;
    }

    const today = new Date().toISOString().split("T")[0];

    await supabase
      .from("parents")
      .update({ last_email_open_date: today, at_risk: false })
      .eq("id", parent.id);

    // If this looks like a pack delivery email, increment the monthly open count
    const campaignSignal = [
      eventProps["Campaign Name"] ?? "",
      eventProps["$flow"] ?? "",
      eventProps["Subject"] ?? "",
    ].join(" ").toLowerCase();

    const isPackDeliveryEmail =
      campaignSignal.includes("pack") || campaignSignal.includes("delivery");

    if (isPackDeliveryEmail) {
      const eventDate = eventDatetime ? new Date(eventDatetime) : new Date();
      const monthNumber = eventDate.getMonth() + 1;
      const year = eventDate.getFullYear();

      const { data: log } = await supabase
        .from("pack_delivery_log")
        .select("id, emails_opened")
        .eq("month_number", monthNumber)
        .eq("year", year)
        .single();

      if (log) {
        await supabase
          .from("pack_delivery_log")
          .update({ emails_opened: ((log.emails_opened as number) ?? 0) + 1 })
          .eq("id", log.id);

        req.log?.info(
          { parentId: parent.id, monthNumber, year },
          "Klaviyo: pack delivery email open recorded"
        );
      }
    }

    req.log?.info(
      { parentId: parent.id, metricName, wasAtRisk: parent.at_risk },
      "Klaviyo email event processed"
    );
    res.status(200).json({ received: true, parent_id: parent.id });
  } catch (err) {
    req.log?.error({ err }, "Klaviyo email event webhook error");
    res.status(200).json({ received: true, error: "Internal error" });
  }
});

// ─── POST /api/webhooks/klaviyo/at-risk ──────────────────────────────────────
// Phase 3.2: Klaviyo flow fires this when a profile enters the
// "missed 2 consecutive pack opens" segment. Sets parents.at_risk=true so the
// admin app surfaces them and the K2 first-letter-nudge suppression engages.
//
// Klaviyo flow setup: configure a webhook action with this URL + the secret
// KLAVIYO_AT_RISK_SECRET (header X-MailDay-Secret).
//
// Payload shape (caller-defined — the simplest works):
//   { email: "parent@example.com" }
// or full Klaviyo profile envelope (we sniff `data.attributes.profile.data.attributes.email`).

router.post("/webhooks/klaviyo/at-risk", async (req: Request, res) => {
  const expected = process.env["KLAVIYO_AT_RISK_SECRET"];
  if (!expected) {
    req.log?.error("KLAVIYO_AT_RISK_SECRET not configured — refusing webhook");
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  const provided = req.headers["x-mailday-secret"] as string | undefined;
  if (!provided || provided !== expected) {
    req.log?.warn("Klaviyo at-risk webhook: invalid X-MailDay-Secret");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = req.body as {
      email?: string;
      data?: {
        attributes?: {
          profile?: { data?: { attributes?: { email?: string } } };
        };
      };
    };

    const email =
      payload.email ??
      payload.data?.attributes?.profile?.data?.attributes?.email;
    if (!email) {
      res.status(200).json({ received: true, skipped: "no email in payload" });
      return;
    }

    const { data: parent } = await supabase
      .from("parents")
      .select("id, at_risk")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (!parent) {
      req.log?.warn({ email }, "Klaviyo at-risk webhook: no parent found");
      res.status(200).json({ received: true, skipped: "parent not found" });
      return;
    }

    if (parent.at_risk) {
      res.status(200).json({ received: true, parent_id: parent.id, already_at_risk: true });
      return;
    }

    await supabase
      .from("parents")
      .update({ at_risk: true })
      .eq("id", parent.id);

    req.log?.info({ parentId: parent.id }, "Klaviyo at-risk: parent flagged");
    res.status(200).json({ received: true, parent_id: parent.id });
  } catch (err) {
    req.log?.error({ err }, "Klaviyo at-risk webhook error");
    res.status(200).json({ received: true, error: "Internal error" });
  }
});

// ─── POST /api/webhooks/klaviyo/winback-completed ────────────────────────────
// Phase 3.3: Klaviyo's win-back flow fires this at the end of the email
// sequence when the family is still disengaged. The app creates a
// `send_poppy_card` lifecycle_task → Courtney handwrites + mails the card.

router.post("/webhooks/klaviyo/winback-completed", async (req: Request, res) => {
  const expected = process.env["KLAVIYO_WINBACK_SECRET"];
  if (!expected) {
    req.log?.error("KLAVIYO_WINBACK_SECRET not configured — refusing webhook");
    res.status(503).json({ error: "Webhook secret not configured" });
    return;
  }
  const provided = req.headers["x-mailday-secret"] as string | undefined;
  if (!provided || provided !== expected) {
    req.log?.warn("Klaviyo winback-completed webhook: invalid X-MailDay-Secret");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = req.body as {
      email?: string;
      data?: { attributes?: { profile?: { data?: { attributes?: { email?: string } } } } };
    };
    const email =
      payload.email ??
      payload.data?.attributes?.profile?.data?.attributes?.email;
    if (!email) {
      res.status(200).json({ received: true, skipped: "no email in payload" });
      return;
    }

    const { data: parent } = await supabase
      .from("parents")
      .select("id, first_name, last_name, email, at_risk")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (!parent) {
      res.status(200).json({ received: true, skipped: "parent not found" });
      return;
    }

    // Idempotency: skip if an open Poppy card task already exists for this parent.
    const { data: existing } = await supabase
      .from("lifecycle_tasks")
      .select("id")
      .eq("type", "send_poppy_card")
      .eq("completed", false)
      .eq("parent_id", parent.id);

    if (existing && existing.length > 0) {
      res.status(200).json({ received: true, parent_id: parent.id, already_tasked: true });
      return;
    }

    const familyName = `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim() || parent.email;
    await supabase.from("lifecycle_tasks").insert({
      type: "send_poppy_card",
      title: `Mail Poppy win-back card to ${familyName}`,
      description:
        "Klaviyo win-back email sequence ended without re-engagement. " +
        "Handwrite + mail the Poppy card. Click 'Mark mailed' once it's posted.",
      parent_id: parent.id,
    });

    req.log?.info({ parentId: parent.id }, "Klaviyo winback-completed: Poppy card task created");
    res.status(200).json({ received: true, parent_id: parent.id, task_created: true });
  } catch (err) {
    req.log?.error({ err }, "Klaviyo winback-completed webhook error");
    res.status(200).json({ received: true, error: "Internal error" });
  }
});

export default router;

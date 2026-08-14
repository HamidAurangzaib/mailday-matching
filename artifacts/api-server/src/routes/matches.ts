import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { differenceInDays, parseISO } from "date-fns";
import { createConfirmationToken } from "../lib/confirmation.js";
import { sendEmail } from "../lib/email.js";
import { logAudit } from "../lib/audit.js";
import { computeAge } from "../lib/age.js";
import { requeueChild } from "../lib/lifecycle.js";
import { computeSubscriptionMonth, computePriorityTier } from "../lib/subscription.js";
import { declineAddressConsent } from "./lifecycle-jobs.js";

const router: IRouter = Router();

/**
 * The "address we hold for you" line a parent sees on the consent screen (A3).
 * Combines the address type they chose at onboarding ("Home" / "PO Box" / …)
 * with the mailing address itself: e.g. "Home, 123 Maple St, Springfield IL".
 * Falls back gracefully so the email never renders a bare blank.
 */
function buildFullAddress(
  addressType: string | null | undefined,
  mailingAddress: string | null | undefined,
): string {
  const addr = (mailingAddress ?? "").trim();
  const type = (addressType ?? "").trim();
  if (addr && type) return `${type}, ${addr}`;
  return addr || "(no address on file yet — please reply to this email so we can add it)";
}

function computeGuarantee(child: Record<string, unknown>) {
  if (!child.match_guarantee_start_date) return { days_waiting: null, guarantee_status: null };
  const days_waiting = differenceInDays(new Date(), parseISO(child.match_guarantee_start_date as string));
  const guarantee_status = days_waiting >= 21 ? "urgent" : days_waiting >= 18 ? "warning" : "ok";
  return { days_waiting, guarantee_status };
}

function sanitizeChild(child: Record<string, unknown>, role: string | undefined): Record<string, unknown> {
  const enriched: Record<string, unknown> = { ...child, ...computeGuarantee(child) };
  if (role !== "admin") {
    delete enriched["safety_flag"];
    delete enriched["internal_notes"];
  }
  return enriched;
}

function sanitizeParent(parent: Record<string, unknown>, role: string | undefined): Record<string, unknown> {
  if (role !== "admin") {
    const { mailing_address, internal_notes, ...rest } = parent;
    void mailing_address;
    void internal_notes;
    return rest;
  }
  return parent;
}

async function enrichMatchWithChildren(
  match: Record<string, unknown>,
  role: string | undefined
): Promise<Record<string, unknown>> {
  const [aResult, bResult] = await Promise.all([
    supabase.from("children").select("*, parents(*)").eq("id", match.child_a_id).single(),
    supabase.from("children").select("*, parents(*)").eq("id", match.child_b_id).single(),
  ]);

  const enrichChild = (result: { data: Record<string, unknown> & { parents?: Record<string, unknown> } | null }) => {
    if (!result.data) return null;
    const { parents: parent, ...childData } = result.data;
    return {
      ...sanitizeChild(childData, role),
      parent: parent ? sanitizeParent(parent, role) : null,
    };
  };

  return {
    ...match,
    child_a: enrichChild(aResult as { data: Record<string, unknown> & { parents?: Record<string, unknown> } | null }),
    child_b: enrichChild(bResult as { data: Record<string, unknown> & { parents?: Record<string, unknown> } | null }),
  };
}

// GET /matches
router.get("/matches", requireAuth, async (req: AuthRequest, res) => {
  try {
    let query = supabase
      .from("matches")
      .select("*")
      .order("created_at", { ascending: false });

    if (req.query.status) {
      query = query.eq("match_status", req.query.status as string);
    }
    if (req.query.date_from) {
      query = query.gte("match_date", req.query.date_from as string);
    }
    if (req.query.date_to) {
      query = query.lte("match_date", req.query.date_to as string);
    }

    const { data: matches, error } = await query;
    if (error) {
      req.log?.error({ error }, "Error fetching matches");
      res.status(500).json({ error: "Failed to fetch matches" });
      return;
    }

    let results = await Promise.all(
      (matches || []).map((m) => enrichMatchWithChildren(m as Record<string, unknown>, req.user?.role))
    );

    // Filter by search (child name)
    if (req.query.search) {
      const search = (req.query.search as string).toLowerCase();
      results = results.filter((m) => {
        const childA = (m.child_a as Record<string, unknown> | null)?.child_first_name as string | undefined;
        const childB = (m.child_b as Record<string, unknown> | null)?.child_first_name as string | undefined;
        return childA?.toLowerCase().includes(search) || childB?.toLowerCase().includes(search);
      });
    }

    // Filter by age_band
    if (req.query.age_band) {
      const band = req.query.age_band as string;
      results = results.filter((m) => {
        const childA = m.child_a as Record<string, unknown> | null;
        const tier = childA?.tier as string | undefined;
        if (band === "Core") return tier === "Core" || tier === "Homeschool Core";
        if (band === "Minis") return tier === "Minis" || tier === "Homeschool Minis";
        return true;
      });
    }

    res.json(results);
  } catch (err) {
    req.log?.error({ err }, "Error fetching matches");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /matches (approve a suggestion)
//
// Phase 2.5 (Block D): the match goes Pending first, not Active. We send the
// R2 Poppy notification email to BOTH parents, each containing a unique
// one-click address-confirm link. The match only promotes to Active once both
// parents have clicked their link (handled in routes/confirm.ts).
//
// "Fun facts" in the R2 email come from the first 3 interests of the pen pal
// child (Block D Q1 answer — decided 2026-06-03).
router.post("/matches", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { child_a_id, child_b_id, shared_interests } = req.body;
    if (!child_a_id || !child_b_id) {
      res.status(400).json({ error: "child_a_id and child_b_id are required" });
      return;
    }

    const today = new Date().toISOString().split("T")[0];

    // Load both children + parents up-front so we have everything for the emails.
    const [aResult, bResult] = await Promise.all([
      supabase
        .from("children")
        .select("id, child_first_name, date_of_birth, age, interests, billing_paused, created_date, parents(id, first_name, email, mailing_address, address_type)")
        .eq("id", child_a_id)
        .single(),
      supabase
        .from("children")
        .select("id, child_first_name, date_of_birth, age, interests, billing_paused, created_date, parents(id, first_name, email, mailing_address, address_type)")
        .eq("id", child_b_id)
        .single(),
    ]);

    if (aResult.error || !aResult.data || bResult.error || !bResult.data) {
      res.status(404).json({ error: "One or both children not found" });
      return;
    }

    type ChildRow = {
      id: string;
      child_first_name: string;
      date_of_birth: string | null;
      age: number | null;
      interests: string[] | null;
      billing_paused: boolean | null;
      created_date: string | null;
      parents: {
        id: string;
        first_name: string | null;
        email: string;
        mailing_address: string | null;
        address_type: string | null;
      } | null;
    };
    const childA = aResult.data as unknown as ChildRow;
    const childB = bResult.data as unknown as ChildRow;

    if (!childA.parents?.email || !childB.parents?.email) {
      res.status(400).json({ error: "Both children must have a parent with an email" });
      return;
    }

    // Same-month vs any: compare each child's per-child subscription month
    // (counted from their own created_date). Equal month → they share the same
    // Poppy story / writing mission. Drives the first-letter email later.
    const monthA = childA.created_date ? computeSubscriptionMonth(childA.created_date) : null;
    const monthB = childB.created_date ? computeSubscriptionMonth(childB.created_date) : null;
    const matchPriorityTier = computePriorityTier(monthA, monthB);

    // Create the match in Pending state.
    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .insert({
        child_a_id,
        child_b_id,
        match_date: today,
        match_status: "Pending",
        shared_interests: shared_interests || [],
        match_notification_sent_a: false,
        match_notification_sent_b: false,
        address_confirmed_a: false,
        address_confirmed_b: false,
        match_priority_tier: matchPriorityTier,
        matched_by_user_id: req.user?.id ?? null,
      })
      .select()
      .single();

    if (matchErr || !match) {
      req.log?.error({ matchErr }, "Error creating match");
      res.status(500).json({ error: "Failed to create match" });
      return;
    }

    // Flip both children to Matched immediately. Packs/letters still won't ship
    // until the match is promoted to Active (in confirm.ts), but the queue UI
    // should stop showing them as Unmatched.
    const [childAState, childBState] = await Promise.all([
      supabase.from("children").select("billing_paused").eq("id", child_a_id).single(),
      supabase.from("children").select("billing_paused").eq("id", child_b_id).single(),
    ]);

    await Promise.all([
      supabase.from("children").update({
        match_status: "Matched",
        billing_paused: false,
        rematch_priority: false, // clear any priority flag from a previous orphan loop
      }).eq("id", child_a_id),
      supabase.from("children").update({
        match_status: "Matched",
        billing_paused: false,
        rematch_priority: false,
      }).eq("id", child_b_id),
    ]);

    // Generate the per-parent one-click confirmation links + send R2 to each.
    // Each parent sees fun facts about THEIR child's pen pal (the other child).
    const sendNotification = async (
      ownChild: ChildRow,
      penPal: ChildRow,
      side: "a" | "b",
    ) => {
      const parentEmail = ownChild.parents!.email;
      const parentFirstName = ownChild.parents!.first_name ?? "";

      const { url: confirmUrl } = await createConfirmationToken({
        type: "address_confirm_match",
        email: parentEmail,
        parentId: ownChild.parents!.id,
        matchId: match.id,
        childId: ownChild.id,
        // A3: carry the pen pal's name so confirm.ts can record the exact
        // consent button text (incl. the name) in match_consents.
        payload: { side, penpal_first_name: penPal.child_first_name },
      });

      // Fun facts = first 3 interests of the pen pal.
      const facts = (penPal.interests ?? []).slice(0, 3);
      while (facts.length < 3) facts.push("something fun"); // template placeholders need 3 values

      // Pen pal age — prefer the DOB-computed value over the stored legacy age.
      const penPalAge =
        computeAge(penPal.date_of_birth) ?? penPal.age ?? "?";

      // A3: the notification IS the consent screen. Show the parent the exact
      // address we'll share (their own), and gate release on both sides saying yes.
      const fullAddress = buildFullAddress(
        ownChild.parents!.address_type,
        ownChild.parents!.mailing_address,
      );

      const sendRes = await sendEmail({
        to: parentEmail,
        templateKey: "match_notification",
        vars: {
          parent_first_name: parentFirstName,
          child_first_name: ownChild.child_first_name,
          pen_pal_first_name: penPal.child_first_name,
          pen_pal_age: String(penPalAge),
          fun_fact_1: facts[0],
          fun_fact_2: facts[1],
          fun_fact_3: facts[2],
          full_address: fullAddress,
          confirm_address_url: confirmUrl,
          pack_url: "https://joinmailday.com/packs", // placeholder — link refinement is a copy task for Courtney
        },
      });

      // Flip the notification-sent flag for this side so admin UI sees it.
      const updateFields: Record<string, unknown> = side === "a"
        ? { match_notification_sent_a: true }
        : { match_notification_sent_b: true };
      await supabase.from("matches").update(updateFields).eq("id", match.id);

      return { side, parentEmail, ok: sendRes.ok, status: sendRes.status };
    };

    const notificationResults = await Promise.all([
      sendNotification(childA, childB, "a"),
      sendNotification(childB, childA, "b"),
    ]);

    await logAudit({
      actorId: req.user?.id,
      actorEmail: req.user?.email,
      action: "match.created_pending",
      entityType: "match",
      entityId: match.id,
      payloadAfter: {
        child_a_id,
        child_b_id,
        match_status: "Pending",
        notifications: notificationResults,
      },
      metadata: {
        had_paused_billing:
          (childAState.data?.billing_paused ?? false) ||
          (childBState.data?.billing_paused ?? false),
      },
      req,
    });

    req.log?.info(
      { matchId: match.id, notifications: notificationResults },
      "Match created in Pending state; R2 notifications dispatched",
    );

    res.status(201).json({
      ...match,
      notifications_dispatched: notificationResults,
    });
  } catch (err) {
    req.log?.error({ err }, "Error approving match");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /matches/:id/consent-decline
//
// Group A / A4: record that a family has actively declined to share their
// address for this (Pending) match. Winds the match down — notifies the
// declining family (consent_declined) + queues a human ReCharge task, requeues
// the partner with priority + notifies them (match_didnt_work_out). There is no
// decline button in the consent email by design, so this is the admin-recorded
// path when a family tells support "no".
//   Body: { child_id }  — which child's family is declining.
router.post("/matches/:id/consent-decline", requireAuth, async (req: AuthRequest, res) => {
  try {
    const matchId = String(req.params["id"] ?? "");
    const childId = (req.body as { child_id?: string } | undefined)?.child_id;
    if (!childId) {
      res.status(400).json({ error: "child_id is required" });
      return;
    }
    const result = await declineAddressConsent(
      matchId,
      childId,
      req.user?.email ?? req.user?.id ?? null,
    );
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Error declining address consent");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/consent-status
//
// Group A / A4: the admin consent board. One row per Pending match showing where
// it sits in the two-party address-consent flow — who has said yes, who we're
// still waiting on, which reminders have gone out, and the next step due. This is
// the human counterpart to the automated reminder/timeout cron.
router.get("/admin/consent-status", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data: matches, error } = await supabase
      .from("matches")
      .select(
        "id, child_a_id, child_b_id, created_at, consent_opened_at, " +
        "address_confirmed_a, address_confirmed_b, address_confirmed_a_at, address_confirmed_b_at, " +
        "consent_reminder_1_sent_at, consent_reminder_2_sent_at, consent_timeout_at",
      )
      .eq("match_status", "Pending")
      .order("created_at", { ascending: true });

    if (error) {
      req.log?.error({ error }, "Error loading consent status");
      res.status(500).json({ error: "Failed to load consent status" });
      return;
    }

    type ConsentStatusMatch = {
      id: string;
      child_a_id: string;
      child_b_id: string;
      created_at: string;
      consent_opened_at: string | null;
      address_confirmed_a: boolean | null;
      address_confirmed_b: boolean | null;
      address_confirmed_a_at: string | null;
      address_confirmed_b_at: string | null;
      consent_reminder_1_sent_at: string | null;
      consent_reminder_2_sent_at: string | null;
      consent_timeout_at: string | null;
    };
    const rows = (matches ?? []) as unknown as ConsentStatusMatch[];
    const childIds = [...new Set(rows.flatMap((m) => [m.child_a_id, m.child_b_id]).filter(Boolean))] as string[];
    const childMap = new Map<string, Record<string, unknown>>();
    if (childIds.length > 0) {
      const { data: children } = await supabase
        .from("children")
        .select("id, child_first_name, parents(first_name, last_name, email)")
        .in("id", childIds);
      for (const c of children ?? []) childMap.set(c.id as string, c as Record<string, unknown>);
    }

    const now = new Date();
    const personOf = (childId: string, confirmed: boolean, confirmedAt: string | null) => {
      const c = childMap.get(childId);
      const p = (c?.["parents"] as { first_name?: string; last_name?: string; email?: string } | null) ?? null;
      return {
        child_first_name: (c?.["child_first_name"] as string) ?? null,
        parent_name: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || null : null,
        email: p?.email ?? null,
        consented: confirmed,
        consented_at: confirmedAt,
      };
    };

    const items = rows.map((m) => {
      const elapsedDays = differenceInDays(now, parseISO((m.consent_opened_at ?? m.created_at) as string));
      const aOk = !!m.address_confirmed_a;
      const bOk = !!m.address_confirmed_b;
      let nextStep: string;
      if (aOk && bOk) nextStep = "Both consented — promoting to Active";
      else if (elapsedDays >= 14) nextStep = "Overdue — winds down on the next consent run";
      else if (elapsedDays >= 7 && !m.consent_reminder_2_sent_at) nextStep = "Day-7 reminder due";
      else if (elapsedDays >= 2 && !m.consent_reminder_1_sent_at) nextStep = "48-hour reminder due";
      else nextStep = `Waiting — day ${elapsedDays} of 14`;

      return {
        match_id: m.id,
        created_at: m.created_at,
        days_elapsed: elapsedDays,
        side_a: personOf(m.child_a_id as string, aOk, (m.address_confirmed_a_at as string) ?? null),
        side_b: personOf(m.child_b_id as string, bOk, (m.address_confirmed_b_at as string) ?? null),
        reminder_1_sent_at: m.consent_reminder_1_sent_at ?? null,
        reminder_2_sent_at: m.consent_reminder_2_sent_at ?? null,
        both_consented: aOk && bOk,
        next_step: nextStep,
      };
    });

    res.json(items);
  } catch (err) {
    req.log?.error({ err }, "Error loading consent status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /matches/:id
router.get("/matches/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { data: match, error } = await supabase
      .from("matches")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }

    const enriched = await enrichMatchWithChildren(match as Record<string, unknown>, req.user?.role);
    res.json(enriched);
  } catch (err) {
    req.log?.error({ err }, "Error fetching match");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /matches/:id
//
// Phase 3.1 (Rematch refinement): when a match is closed with a rematch
// reason, the requesting family and the orphaned family are conceptually
// different — the orphan didn't ask for this and shouldn't have to wait the
// full guarantee window again. Body fields:
//   • match_status='Closed'
//   • close_reason_code='rematch_requested' (new) OR close_reason='rematch_requested' (legacy)
//   • requester_child_id?: which child's family asked for the rematch
//   • rematch_reason?: 'no_response' | 'no_chemistry' | 'tier_change' | 'other'
//
// Result: both children → 'Rematch Requested' status, guarantee clock reset,
// but the orphan (non-requester) gets `rematch_priority=true` so the next
// matching session picks them up first.
router.patch("/matches/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body;
    const updateFields: Record<string, unknown> = {};

    // Normalise: treat legacy close_reason='rematch_requested' as the new
    // close_reason_code='rematch_requested' enum value.
    const closeReasonCode =
      body.close_reason_code ??
      (body.close_reason === "rematch_requested" ? "rematch_requested" : undefined);
    const rematchReason = body.rematch_reason as string | undefined;
    const requesterChildId = body.requester_child_id as string | undefined;

    if (body.match_status !== undefined) updateFields.match_status = body.match_status;
    if (closeReasonCode !== undefined) updateFields.close_reason_code = closeReasonCode;
    // Reuse the existing free-text close_reason for the sub-category detail.
    if (rematchReason !== undefined) {
      updateFields.close_reason = rematchReason;
    } else if (body.close_reason !== undefined && body.close_reason !== "rematch_requested") {
      // Preserve the legacy free-text path for other (non-rematch) reasons.
      updateFields.close_reason = body.close_reason;
    }
    if (body.match_notification_sent_a !== undefined) updateFields.match_notification_sent_a = body.match_notification_sent_a;
    if (body.match_notification_sent_b !== undefined) updateFields.match_notification_sent_b = body.match_notification_sent_b;
    if (body.notes !== undefined) updateFields.notes = body.notes;

    // Read the before-state for audit.
    const { data: before } = await supabase
      .from("matches")
      .select("*")
      .eq("id", req.params.id)
      .single();

    const { data: match, error } = await supabase
      .from("matches")
      .update(updateFields)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !match) {
      res.status(404).json({ error: "Match not found or update failed" });
      return;
    }

    // If closing a match, route both children through the shared re-queue
    // routine (Phase 4) so the orphan-priority + clock-reset semantics stay
    // consistent with cancellation-triggered orphaning.
    if (body.match_status === "Closed") {
      const isRematch = closeReasonCode === "rematch_requested";
      const today = new Date().toISOString().split("T")[0];

      if (isRematch) {
        // Determine orphan vs requester.
        const orphanId = requesterChildId
          ? requesterChildId === match.child_a_id
            ? match.child_b_id
            : match.child_a_id
          : null;
        const requesterId = requesterChildId ?? null;

        await Promise.all([
          requeueChild({
            childId: match.child_a_id,
            reason: match.child_a_id === orphanId ? "partner_orphaned" : "rematch_requested",
            priority: match.child_a_id === orphanId,
            actorId: req.user?.id,
            actorEmail: req.user?.email,
          }),
          requeueChild({
            childId: match.child_b_id,
            reason: match.child_b_id === orphanId ? "partner_orphaned" : "rematch_requested",
            priority: match.child_b_id === orphanId,
            actorId: req.user?.id,
            actorEmail: req.user?.email,
          }),
        ]);

        await logAudit({
          actorId: req.user?.id,
          actorEmail: req.user?.email,
          action: "match.closed_rematch",
          entityType: "match",
          entityId: match.id,
          payloadBefore: before,
          payloadAfter: match,
          metadata: {
            rematch_reason: rematchReason ?? null,
            requester_child_id: requesterId,
            orphan_child_id: orphanId,
          },
          req,
        });
      } else {
        // Non-rematch close (e.g. admin_dissolved, data_deletion): both children
        // just go back to Unmatched without priority. Don't reset clock —
        // they didn't get a successful match to begin with.
        await Promise.all([
          supabase.from("children").update({
            match_status: "Unmatched",
            match_guarantee_start_date: today,
          }).eq("id", match.child_a_id),
          supabase.from("children").update({
            match_status: "Unmatched",
            match_guarantee_start_date: today,
          }).eq("id", match.child_b_id),
        ]);

        await logAudit({
          actorId: req.user?.id,
          actorEmail: req.user?.email,
          action: "match.closed",
          entityType: "match",
          entityId: match.id,
          payloadBefore: before,
          payloadAfter: match,
          metadata: { close_reason_code: closeReasonCode ?? null },
          req,
        });
      }
    }

    res.json(match);
  } catch (err) {
    req.log?.error({ err }, "Error updating match");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /matches/:id/resend-confirmation — re-fire the address-confirmation email
// for whichever side(s) the admin specifies on a Pending match.
//   Body: { sides?: "both" | "a" | "b" }  (default: only sides that haven't confirmed yet)
router.post(
  "/matches/:id/resend-confirmation",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const matchId = String(req.params["id"] ?? "");
      const requestedSides = (req.body as { sides?: "both" | "a" | "b" } | undefined)?.sides ?? "auto";

      const { data: match } = await supabase
        .from("matches")
        .select("id, child_a_id, child_b_id, match_status, address_confirmed_a, address_confirmed_b")
        .eq("id", matchId)
        .single();
      if (!match) { res.status(404).json({ error: "Match not found" }); return; }
      if (match.match_status !== "Pending") {
        res.status(400).json({ error: `Match is ${match.match_status}; can only resend on Pending matches` });
        return;
      }

      const sidesToSend: ("a" | "b")[] = (() => {
        if (requestedSides === "both") return ["a", "b"];
        if (requestedSides === "a" || requestedSides === "b") return [requestedSides];
        const out: ("a" | "b")[] = [];
        if (!match.address_confirmed_a) out.push("a");
        if (!match.address_confirmed_b) out.push("b");
        return out;
      })();
      if (sidesToSend.length === 0) {
        res.status(400).json({ error: "Both sides have already confirmed — nothing to resend" });
        return;
      }

      const [aResult, bResult] = await Promise.all([
        supabase.from("children")
          .select("id, child_first_name, date_of_birth, age, interests, parents(id, first_name, email, mailing_address, address_type)")
          .eq("id", match.child_a_id).single(),
        supabase.from("children")
          .select("id, child_first_name, date_of_birth, age, interests, parents(id, first_name, email, mailing_address, address_type)")
          .eq("id", match.child_b_id).single(),
      ]);
      type ChildRow = {
        id: string; child_first_name: string; date_of_birth: string | null;
        age: number | null; interests: string[] | null;
        parents: {
          id: string; first_name: string | null; email: string;
          mailing_address: string | null; address_type: string | null;
        } | null;
      };
      const childA = aResult.data as unknown as ChildRow;
      const childB = bResult.data as unknown as ChildRow;
      if (!childA?.parents?.email || !childB?.parents?.email) {
        res.status(400).json({ error: "Child or parent record missing — cannot resend" });
        return;
      }

      const sendOne = async (ownChild: ChildRow, penPal: ChildRow, side: "a" | "b") => {
        const { url: confirmUrl } = await createConfirmationToken({
          type: "address_confirm_match",
          email: ownChild.parents!.email,
          parentId: ownChild.parents!.id,
          matchId: match.id,
          childId: ownChild.id,
          payload: { side, penpal_first_name: penPal.child_first_name },
        });
        const facts = (penPal.interests ?? []).slice(0, 3);
        while (facts.length < 3) facts.push("something fun");
        const penPalAge = computeAge(penPal.date_of_birth) ?? penPal.age ?? "?";
        const fullAddress = buildFullAddress(
          ownChild.parents!.address_type,
          ownChild.parents!.mailing_address,
        );
        const sendRes = await sendEmail({
          to: ownChild.parents!.email,
          templateKey: "match_notification",
          vars: {
            parent_first_name: ownChild.parents!.first_name ?? "",
            child_first_name: ownChild.child_first_name,
            pen_pal_first_name: penPal.child_first_name,
            pen_pal_age: String(penPalAge),
            fun_fact_1: facts[0], fun_fact_2: facts[1], fun_fact_3: facts[2],
            full_address: fullAddress,
            confirm_address_url: confirmUrl,
            pack_url: "https://joinmailday.com/packs",
          },
        });
        return { side, parentEmail: ownChild.parents!.email, ok: sendRes.ok, status: sendRes.status };
      };

      const results = await Promise.all(
        sidesToSend.map((s) => s === "a" ? sendOne(childA, childB, "a") : sendOne(childB, childA, "b"))
      );

      await logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        action: "match.address_confirmation_resent",
        entityType: "match",
        entityId: match.id,
        metadata: { sides: sidesToSend, results },
        req,
      });

      res.json({ match_id: match.id, sides: sidesToSend, results });
    } catch (err) {
      req.log?.error({ err }, "Error resending address confirmation");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

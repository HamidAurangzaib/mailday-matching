/**
 * Lifecycle jobs — daily crons that drive the automated parts of the
 * lifecycle map's Spine and Branches, plus admin endpoints to trigger
 * each job manually (handy for testing) and a generic mark-task-complete
 * endpoint that all of the lifecycle_tasks rows use.
 *
 * Jobs in this file (Phase 2):
 *   • runIncompleteOnboardingNudges()  — Block B (§ 2.3) — daily 9 am MT
 *   • runGuaranteeBreachJob()          — Block C (§ 2.4) — daily 9 am MT
 *
 * Future jobs (Phase 3+):
 *   • aging-out cron (Phase 3.5)
 *   • day-30 win-back trigger (Phase 4.2 — actually Klaviyo handles via event)
 */

import { Router, type IRouter } from "express";
import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { sendEmail } from "../lib/email.js";
import { logAudit } from "../lib/audit.js";
import { differenceInDays, parseISO } from "date-fns";
import { tierChangeOnAging } from "../lib/age.js";
import { offboardFamily, requeueChild } from "../lib/lifecycle.js";
import { createConfirmationToken } from "../lib/confirmation.js";
import { addPauseReason } from "../lib/pause.js";
import {
  CONSENT_REMINDER_1_HOURS,
  CONSENT_REMINDER_2_DAYS,
  CONSENT_TIMEOUT_DAYS,
  decideConsentAction,
} from "../lib/consent-timing.js";
import { emitKlaviyoEvent } from "../lib/klaviyo-events.js";
import { computeSubscriptionMonth } from "../lib/subscription.js";
import { appBaseUrl } from "../lib/app-url.js";
import { AWAITING_ADDRESS } from "../lib/gak-address.js";
import { getSubscription, changeNextChargeDate } from "../lib/recharge.js";
import { guaranteeStartDate } from "../lib/guarantee-clock.js";

const router: IRouter = Router();

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** Send R1 onboarding-nudge after this many days of no children completion. */
const NUDGE_AFTER_DAYS = 3;
/** Escalate to Action Items after this many days. */
const ESCALATE_AFTER_DAYS = 7;
/** Stop nudging / chasing after this many days (after this the parent is a
 *  separate problem; we stop pestering). */
const STOP_NUDGING_AFTER_DAYS = 30;
/** Guarantee breach threshold per the lifecycle map. */
const GUARANTEE_BREACH_DAYS = 21;
/** A match left in Pending with addresses unconfirmed after this many days gets a chase task. */
const ADDRESS_CONFIRM_CHASE_DAYS = 7;
/** A Poppy card task open this many days = family treated as offboarded. */
const WINBACK_FAIL_AFTER_DAYS = 60;
/** A6: a Give-a-Key family with still no address after this many days gets a
 *  follow-up task. A nudge only — never a cancellation. */
const GAK_ADDRESS_OVERDUE_DAYS = 30;
/** How far forward a guarantee pause pushes the next ReCharge charge date. One
 *  billing cycle: long enough to stop the next charge, short enough that a
 *  family whose pause is somehow never resumed reappears rather than silently
 *  billing years out. The job re-pushes on each run while they stay unmatched. */
const GUARANTEE_PAUSE_PUSH_DAYS = 30;

// ─── Block B: Incomplete-onboarding nudge ────────────────────────────────────

export interface OnboardingNudgeResult {
  scanned: number;
  nudgesSent: number;
  tasksCreated: number;
  errors: string[];
  ranAt: string;
}

/**
 * Find parents with no children completed onboarding, send the nudge email,
 * and escalate to a lifecycle_task after ESCALATE_AFTER_DAYS.
 *
 * Idempotency:
 *   • Nudge: filtered by `onboarding_nudge_sent_at IS NULL` so a parent only
 *     gets one nudge per onboarding cycle.
 *   • Task: created only if no open lifecycle_tasks row of type
 *     'incomplete_onboarding_followup' exists for that parent.
 */
export async function runIncompleteOnboardingNudges(): Promise<OnboardingNudgeResult> {
  const result: OnboardingNudgeResult = {
    scanned: 0,
    nudgesSent: 0,
    tasksCreated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  // 1. Pull all parents created between [STOP_NUDGING_AFTER_DAYS] and [NUDGE_AFTER_DAYS] days ago.
  const now = new Date();
  const earliest = new Date(now.getTime() - STOP_NUDGING_AFTER_DAYS * 86400000).toISOString();
  const latest = new Date(now.getTime() - NUDGE_AFTER_DAYS * 86400000).toISOString();

  // Phase 3.7: also filter out voluntary-paused families. They've intentionally
  // stepped away from the product — nudging them to complete onboarding
  // contradicts that signal.
  const { data: candidates, error } = await supabase
    .from("parents")
    .select("id, first_name, email, onboarding_token, created_at, onboarding_nudge_sent_at, subscription_status, pause_type")
    .gte("created_at", earliest)
    .lte("created_at", latest);

  if (error) {
    result.errors.push(`Failed to load candidates: ${error.message}`);
    logger.error({ error }, "Onboarding-nudge cron: failed to load candidates");
    return result;
  }

  if (!candidates || candidates.length === 0) {
    logger.info(result, "Onboarding-nudge cron: no candidates");
    return result;
  }

  // 2. Filter: must have NO children
  const candidateIds = candidates.map((p) => p.id);
  const { data: childRefs } = await supabase
    .from("children")
    .select("parent_id")
    .in("parent_id", candidateIds);
  const parentsWithChildren = new Set((childRefs ?? []).map((c) => c.parent_id));
  const incomplete = candidates.filter((p) => !parentsWithChildren.has(p.id));
  result.scanned = incomplete.length;

  // 3. Pull existing lifecycle_tasks of this type for incomplete parents (idempotency)
  let existingTaskParentIds = new Set<string>();
  if (incomplete.length > 0) {
    const { data: existingTasks } = await supabase
      .from("lifecycle_tasks")
      .select("parent_id")
      .eq("type", "incomplete_onboarding_followup")
      .eq("completed", false)
      .in("parent_id", incomplete.map((p) => p.id));
    existingTaskParentIds = new Set((existingTasks ?? []).map((t) => t.parent_id));
  }

  const appBase = appBaseUrl();

  // 4. For each, decide: send nudge / create task / skip
  for (const parent of incomplete) {
    try {
      // Only act on Active subscribers — paused/cancelled families shouldn't be nudged.
      if (parent.subscription_status && parent.subscription_status !== "Active") {
        continue;
      }
      // Phase 3.7: also skip voluntarily-paused families.
      if (parent.pause_type === "voluntary") continue;

      const daysOld = differenceInDays(now, parseISO(parent.created_at as string));

      // 4a. Send the R1 nudge once.
      if (!parent.onboarding_nudge_sent_at && daysOld >= NUDGE_AFTER_DAYS) {
        const onboardingUrl = `${appBase}/onboarding?token=${parent.onboarding_token}`;
        const sendResult = await sendEmail({
          to: parent.email as string,
          templateKey: "onboarding_nudge",
          vars: {
            onboarding_url: onboardingUrl,
            parent_first_name: parent.first_name ?? "",
          },
        });

        if (sendResult.ok) {
          await supabase
            .from("parents")
            .update({ onboarding_nudge_sent_at: new Date().toISOString() })
            .eq("id", parent.id);
          result.nudgesSent++;

          await logAudit({
            action: "parent.onboarding_nudge_sent",
            entityType: "parent",
            entityId: parent.id,
            metadata: { daysOld, emailStatus: sendResult.status },
          });
        } else {
          result.errors.push(`nudge send failed for ${parent.email}: ${sendResult.error ?? sendResult.status}`);
        }
      }

      // 4b. After ESCALATE_AFTER_DAYS, also create a task (if one isn't open already).
      if (daysOld >= ESCALATE_AFTER_DAYS && !existingTaskParentIds.has(parent.id)) {
        const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
          type: "incomplete_onboarding_followup",
          title: `Follow up with ${parent.first_name ?? parent.email} — onboarding incomplete after ${daysOld} days`,
          description: `They paid but never added their child. Nudge email already sent. Try a personal reach-out.`,
          parent_id: parent.id,
        });
        if (taskErr) {
          result.errors.push(`task create failed for ${parent.email}: ${taskErr.message}`);
        } else {
          result.tasksCreated++;
          await logAudit({
            action: "lifecycle_task.created",
            entityType: "parent",
            entityId: parent.id,
            metadata: { type: "incomplete_onboarding_followup", daysOld },
          });
        }
      }
    } catch (err) {
      result.errors.push(`exception for ${parent.email}: ${String(err)}`);
      logger.error({ err, parentId: parent.id }, "Onboarding-nudge cron: per-parent error");
    }
  }

  logger.info(result, "Onboarding-nudge cron completed");
  return result;
}

// ─── Block C: Guarantee breach contact ───────────────────────────────────────

export interface GuaranteeBreachResult {
  scanned: number;
  newlyFlagged: number;
  emailsSent: number;
  tasksCreated: number;
  errors: string[];
  ranAt: string;
}

/**
 * Find children whose 21-day guarantee window has expired but haven't been
 * matched yet. For each:
 *   • Flip `parents.pause_type = 'guarantee'` and `parents.billing_paused = true`
 *     (also on the children rows, mirrored).
 *   • Create a contact_guarantee_breach lifecycle_task — description includes
 *     a reminder for the human to pause the ReCharge subscription manually
 *     (per the lifecycle map, ReCharge pausing stays a human step for safety).
 *   • Send R3 (Courtney's apology + reassurance email) via Resend.
 *
 * Idempotency:
 *   • `parents.pause_type IS NULL` filter — once we've flagged a guarantee
 *     breach we don't re-flag.
 *   • Task: only create if no open one of this type exists for the parent.
 */
export async function runGuaranteeBreachJob(): Promise<GuaranteeBreachResult> {
  const result: GuaranteeBreachResult = {
    scanned: 0,
    newlyFlagged: 0,
    emailsSent: 0,
    tasksCreated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const now = new Date();
  const cutoff = new Date(now.getTime() - GUARANTEE_BREACH_DAYS * 86400000).toISOString().split("T")[0];

  // 1. Find unmatched / rematch-requested children whose clock has expired.
  const { data: children, error } = await supabase
    .from("children")
    .select("id, child_first_name, parent_id, match_guarantee_start_date, match_status")
    .in("match_status", ["Unmatched", "Rematch Requested"])
    .lte("match_guarantee_start_date", cutoff);

  if (error) {
    result.errors.push(`Failed to load children: ${error.message}`);
    return result;
  }
  if (!children || children.length === 0) {
    logger.info(result, "Guarantee-breach cron: nothing to do");
    return result;
  }

  result.scanned = children.length;

  // 2. Load each child's parent in one query.
  const parentIds = [...new Set(children.map((c) => c.parent_id))];
  const { data: parents } = await supabase
    .from("parents")
    .select("id, first_name, email, pause_type, billing_paused, subscription_status, recharge_subscription_id")
    .in("id", parentIds);

  const parentMap = new Map((parents ?? []).map((p) => [p.id, p]));

  // 3. Existing open tasks (idempotency)
  const { data: existingTasks } = await supabase
    .from("lifecycle_tasks")
    .select("parent_id")
    .eq("type", "contact_guarantee_breach")
    .eq("completed", false)
    .in("parent_id", parentIds);
  const taskedParents = new Set((existingTasks ?? []).map((t) => t.parent_id));

  // 4. Per-child work, grouped by parent (one email per family).
  const processedParents = new Set<string>();

  for (const child of children) {
    const parent = parentMap.get(child.parent_id);
    if (!parent) continue;

    // Skip families that are paused/cancelled — guarantee breach doesn't apply.
    if (parent.subscription_status && parent.subscription_status !== "Active") continue;

    // Skip families we already flagged (pause_type already set to 'guarantee').
    if (parent.pause_type) continue;

    // One email per parent (even if they have multiple children).
    if (processedParents.has(parent.id)) continue;
    processedParents.add(parent.id);

    try {
      const daysWaiting = differenceInDays(
        now,
        parseISO(child.match_guarantee_start_date as string),
      );

      // 4a. Flip the flags on parent + all their children.
      await supabase
        .from("parents")
        .update({ pause_type: "guarantee", billing_paused: true })
        .eq("id", parent.id);
      await supabase
        .from("children")
        .update({ billing_paused: true })
        .eq("parent_id", parent.id);
      result.newlyFlagged++;

      // 4a-bis. Stop the money.
      //
      // ReCharge has no pause primitive, so pausing means pushing the next
      // charge date forward. We only act when the sync has linked this family to
      // exactly ONE subscription — with per-child memberships a family can hold
      // several, and stopping a sibling's membership would be worse than the
      // manual step this replaces. Everything else falls back to the task below.
      //
      // Writes are dry-run unless RECHARGE_WRITES_ENABLED=true, so this logs its
      // intent and changes nothing until that is deliberately switched on.
      let autoPause: "applied" | "dry_run" | "no_link" | "failed" = "no_link";
      const subscriptionId = parent.recharge_subscription_id as string | null;

      if (subscriptionId) {
        const sub = await getSubscription(subscriptionId);
        const originalDate = sub?.next_charge_scheduled_at
          ? sub.next_charge_scheduled_at.split("T")[0]!
          : null;
        const pushedTo = new Date(now.getTime() + GUARANTEE_PAUSE_PUSH_DAYS * 86400000)
          .toISOString()
          .split("T")[0]!;

        const moved = await changeNextChargeDate(subscriptionId, pushedTo, {
          parentId: parent.id,
          reason: "guarantee_breach",
          originalDate,
        });

        if (moved.ok && !moved.dryRun) {
          autoPause = "applied";
          // Remember the real schedule so resuming restores it rather than
          // inventing a date. Written only on a genuine apply, so the resume
          // path can tell our pause from a manual one.
          await supabase
            .from("parents")
            .update({
              guarantee_pause_original_charge_date: originalDate,
              guarantee_pause_applied_at: new Date().toISOString(),
            })
            .eq("id", parent.id);
          await logAudit({
            action: "parent.guarantee_billing_paused",
            entityType: "parent",
            entityId: parent.id as string,
            payloadBefore: { next_charge_date: originalDate },
            payloadAfter: { next_charge_date: pushedTo },
            metadata: { subscriptionId, source: "guarantee_breach_cron" },
          });
        } else if (moved.ok) {
          autoPause = "dry_run";
        } else {
          autoPause = "failed";
          result.errors.push(
            `ReCharge auto-pause failed for ${parent.email}: ${moved.error ?? "unknown"}`,
          );
        }
      }

      // 4b. Send R3 (guarantee_breach template).
      const sendResult = await sendEmail({
        to: parent.email as string,
        templateKey: "guarantee_breach",
        vars: {
          child_first_name: child.child_first_name ?? "your child",
          parent_first_name: parent.first_name ?? "",
          days_waiting: daysWaiting,
        },
      });
      if (sendResult.ok) {
        result.emailsSent++;
      } else {
        result.errors.push(`R3 send failed for ${parent.email}: ${sendResult.error ?? sendResult.status}`);
      }

      // 4c. Create the lifecycle_task (one per parent if not already open).
      if (!taskedParents.has(parent.id)) {
        const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
          type: "contact_guarantee_breach",
          title:
            autoPause === "applied"
              ? `Guarantee breach — billing already paused for ${parent.first_name ?? parent.email}`
              : `Guarantee breach — pause ReCharge for ${parent.first_name ?? parent.email}`,
          description:
            autoPause === "applied"
              ? "Billing has ALREADY been paused automatically — the next charge date was pushed " +
                `${GUARANTEE_PAUSE_PUSH_DAYS} days forward and is restored when the match is made. ` +
                "No ReCharge action needed. Action: follow up with the family personally, then " +
                "click 'Mark confirmed'."
              : autoPause === "dry_run"
              ? "App has set billing_paused locally and sent the guarantee-breach email. " +
                "Auto-pause is in DRY RUN (RECHARGE_WRITES_ENABLED is not set), so nothing changed " +
                "in ReCharge. Action: pause this family's subscription by hand, follow up, then " +
                "click 'Mark confirmed'."
              : autoPause === "failed"
              ? "App has set billing_paused locally and sent the guarantee-breach email. " +
                "The automatic pause FAILED — see the logs. Action: pause this family's " +
                "subscription in ReCharge by hand, follow up, then click 'Mark confirmed'."
              : "App has set billing_paused locally and sent the guarantee-breach email. " +
                "This family has no single linked subscription (they may hold several), so billing " +
                "was not paused automatically. Action: log into ReCharge and pause the right " +
                "subscription, follow up, then click 'Mark confirmed'.",
          parent_id: parent.id,
          child_id: child.id,
        });
        if (taskErr) {
          result.errors.push(`task create failed for ${parent.email}: ${taskErr.message}`);
        } else {
          result.tasksCreated++;
        }
      }

      await logAudit({
        action: "parent.guarantee_breach_flagged",
        entityType: "parent",
        entityId: parent.id,
        payloadAfter: { pause_type: "guarantee", billing_paused: true },
        metadata: { childId: child.id, daysWaiting },
      });
    } catch (err) {
      result.errors.push(`exception for parent ${parent.id}: ${String(err)}`);
      logger.error({ err, parentId: parent.id }, "Guarantee-breach cron: per-parent error");
    }
  }

  logger.info(result, "Guarantee-breach cron completed");
  return result;
}

// ─── Block D: Chase address-confirmation on stale pending matches ────────────

export interface ChaseAddressResult {
  scanned: number;
  tasksCreated: number;
  errors: string[];
  ranAt: string;
}

/**
 * Find matches still in `Pending` after ADDRESS_CONFIRM_CHASE_DAYS days with at
 * least one side unconfirmed. Create a `chase_address_confirmation`
 * lifecycle_task per such match (idempotent on match_id).
 *
 * The lifecycle map's policy (resolved 2026-06-03) is: no auto-retry email,
 * just a task so a human can follow up personally. Courtney always handles the
 * personal nudge.
 */
export async function runChaseAddressConfirmation(): Promise<ChaseAddressResult> {
  const result: ChaseAddressResult = {
    scanned: 0,
    tasksCreated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const cutoff = new Date(
    Date.now() - ADDRESS_CONFIRM_CHASE_DAYS * 86400000,
  ).toISOString();

  const { data: stale, error } = await supabase
    .from("matches")
    .select("id, child_a_id, child_b_id, address_confirmed_a, address_confirmed_b, created_at")
    .eq("match_status", "Pending")
    .lte("created_at", cutoff);

  if (error) {
    result.errors.push(`Failed to load pending matches: ${error.message}`);
    return result;
  }
  if (!stale || stale.length === 0) {
    logger.info(result, "Chase-address cron: no stale Pending matches");
    return result;
  }

  result.scanned = stale.length;

  // Idempotency: skip matches that already have an open chase task.
  const matchIds = stale.map((m) => m.id);
  const { data: existing } = await supabase
    .from("lifecycle_tasks")
    .select("match_id")
    .eq("type", "chase_address_confirmation")
    .eq("completed", false)
    .in("match_id", matchIds);
  const already = new Set((existing ?? []).map((t) => t.match_id));

  for (const match of stale) {
    if (already.has(match.id)) continue;

    // Build a useful title with the family names.
    const childIds = [match.child_a_id, match.child_b_id].filter(Boolean);
    const { data: children } = await supabase
      .from("children")
      .select("id, child_first_name, parents(first_name, last_name)")
      .in("id", childIds);
    const names = (children ?? []).map((c) => {
      const p = (c as Record<string, unknown>)["parents"] as
        | { first_name?: string; last_name?: string }
        | null;
      const family = p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : "?";
      return `${c.child_first_name} (${family})`;
    });

    const sideA = match.address_confirmed_a ? "confirmed" : "unconfirmed";
    const sideB = match.address_confirmed_b ? "confirmed" : "unconfirmed";
    const stillUnconfirmed: string[] = [];
    if (!match.address_confirmed_a) stillUnconfirmed.push("first family");
    if (!match.address_confirmed_b) stillUnconfirmed.push("second family");

    const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
      type: "chase_address_confirmation",
      title: `Chase address confirmation — ${names.join(" & ")}`,
      description:
        `Match has been Pending for ${ADDRESS_CONFIRM_CHASE_DAYS}+ days. ` +
        `Sides: side A ${sideA}, side B ${sideB}. ` +
        `Please follow up with ${stillUnconfirmed.join(" and ")} personally.`,
      match_id: match.id,
    });

    if (taskErr) {
      result.errors.push(`task create failed for match ${match.id}: ${taskErr.message}`);
    } else {
      result.tasksCreated++;
      await logAudit({
        action: "lifecycle_task.created",
        entityType: "match",
        entityId: match.id,
        metadata: { type: "chase_address_confirmation" },
      });
    }
  }

  logger.info(result, "Chase-address cron completed");
  return result;
}

// ─── Group A / A4: two-party address-consent reminders + day-14 timeout ──────
//
// Once a match is created it sits in `Pending` until BOTH parents consent to
// share their mailing address (routes/confirm.ts records each consent and only
// promotes to Active — releasing the addresses — when both have said yes). This
// engine works that waiting period:
//   • 48h  — remind whoever hasn't consented (consent_reminder_1, from Poppy)
//   • day 7 — remind again, this time showing the address on file (consent_reminder_2)
//   • day 14 — give up safely: pause the non-responsive family's billing (locally,
//     via the pause-reasons model + a human "pause ReCharge" task — the app never
//     touches ReCharge directly), free the family that DID consent back into the
//     queue with priority, tell each side what happened, and close the match. No
//     address is ever released without both consents.
//
// Timing is measured from matches.created_at (both notification emails go out at
// creation). Idempotency: three stamp columns on `matches`
// (consent_reminder_1_sent_at / _2_sent_at / consent_timeout_at) gate each step
// to fire once. The cron runs every 4 hours so the boundaries aren't missed by
// more than a few hours (mirrors finalise-cancellations). The timing thresholds
// + the "which step is due" decision live in lib/consent-timing.ts (pure +
// unit-tested); this file owns the I/O around them.

export interface AddressConsentResult {
  scanned: number;
  reminder1Sent: number;
  reminder2Sent: number;
  timedOut: number;
  emailsSent: number;
  tasksCreated: number;
  errors: string[];
  ranAt: string;
}

type ConsentMatchRow = {
  id: string;
  child_a_id: string;
  child_b_id: string;
  address_confirmed_a: boolean | null;
  address_confirmed_b: boolean | null;
  created_at: string;
  consent_opened_at: string | null;
  consent_reminder_1_sent_at: string | null;
  consent_reminder_2_sent_at: string | null;
  consent_timeout_at: string | null;
};

type ConsentSide = {
  id: string;
  child_first_name: string | null;
  parents: {
    id: string;
    first_name: string | null;
    email: string | null;
    mailing_address: string | null;
    address_type: string | null;
  } | null;
};

/** "Home, 123 Maple St" — the address line shown in the day-7 reminder. */
function fmtConsentAddress(type: string | null | undefined, addr: string | null | undefined): string {
  const a = (addr ?? "").trim();
  const t = (type ?? "").trim();
  if (a && t) return `${t}, ${a}`;
  return a || "the address on file";
}

async function loadConsentSides(
  childAId: string,
  childBId: string,
): Promise<{ a: ConsentSide | null; b: ConsentSide | null }> {
  const [aRes, bRes] = await Promise.all([
    supabase.from("children")
      .select("id, child_first_name, parents(id, first_name, email, mailing_address, address_type)")
      .eq("id", childAId).single(),
    supabase.from("children")
      .select("id, child_first_name, parents(id, first_name, email, mailing_address, address_type)")
      .eq("id", childBId).single(),
  ]);
  return {
    a: (aRes.data as unknown as ConsentSide) ?? null,
    b: (bRes.data as unknown as ConsentSide) ?? null,
  };
}

/**
 * Send reminder `stage` (1 = 48h from Poppy, 2 = day-7 from MailDay) to whichever
 * side(s) of a Pending match have NOT consented yet. Mints a fresh consent link
 * per recipient (carrying the pen pal's name so the eventual consent record is
 * complete). Returns how many emails actually went out.
 */
async function sendConsentReminders(
  match: ConsentMatchRow,
  sides: { a: ConsentSide | null; b: ConsentSide | null },
  stage: 1 | 2,
  errors: string[],
): Promise<number> {
  const recipients: Array<{ side: "a" | "b"; own: ConsentSide | null; penpal: ConsentSide | null }> = [];
  if (!match.address_confirmed_a) recipients.push({ side: "a", own: sides.a, penpal: sides.b });
  if (!match.address_confirmed_b) recipients.push({ side: "b", own: sides.b, penpal: sides.a });

  let sent = 0;
  for (const r of recipients) {
    const parent = r.own?.parents;
    if (!parent?.email || !r.own || !r.penpal) {
      errors.push(`reminder${stage}: match ${match.id} side ${r.side} missing parent/child`);
      continue;
    }
    const penpalName = r.penpal.child_first_name ?? "their pen pal";
    const { url } = await createConfirmationToken({
      type: "address_confirm_match",
      email: parent.email,
      parentId: parent.id,
      childId: r.own.id,
      matchId: match.id,
      payload: { side: r.side, penpal_first_name: penpalName },
    });
    const vars: Record<string, string | number> = stage === 1
      ? {
          child_first_name: r.own.child_first_name ?? "your child",
          penpal_first_name: penpalName,
          consent_url: url,
        }
      : {
          parent_first_name: parent.first_name ?? "",
          child_first_name: r.own.child_first_name ?? "your child",
          penpal_first_name: penpalName,
          full_address: fmtConsentAddress(parent.address_type, parent.mailing_address),
          consent_url: url,
        };
    const res = await sendEmail({
      to: parent.email,
      templateKey: stage === 1 ? "consent_reminder_1" : "consent_reminder_2",
      vars,
    });
    if (res.ok) sent++;
    else errors.push(`reminder${stage} send failed for ${parent.email}: ${res.error ?? res.status}`);
  }
  return sent;
}

/**
 * Day-14 wind-down. For each side that never consented: pause them locally +
 * queue a human ReCharge-pause task + email consent_pause with a reactivate link,
 * and park their child out of the dead match. For a side that DID consent (the
 * wronged partner, if any): requeue with priority + email match_didnt_work_out.
 * Then close the match and stamp consent_timeout_at so this runs exactly once.
 */
async function handleAddressConsentTimeout(
  match: ConsentMatchRow,
  sides: { a: ConsentSide | null; b: ConsentSide | null },
  result: AddressConsentResult,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const today = nowIso.split("T")[0];

  const parties: Array<{ confirmed: boolean; own: ConsentSide | null }> = [
    { confirmed: !!match.address_confirmed_a, own: sides.a },
    { confirmed: !!match.address_confirmed_b, own: sides.b },
  ];

  for (const p of parties) {
    if (!p.own) continue;
    const parent = p.own.parents;

    if (!p.confirmed) {
      // This family never consented — pause them (local pause-reasons + a human
      // ReCharge task; the app never pauses ReCharge itself), park their child
      // out of the closed match with a fresh guarantee clock (so the breach cron
      // doesn't immediately pounce), and email them a reactivate link.
      await addPauseReason(p.own.id, "address_consent");
      await supabase.from("children")
        .update({ match_status: "Unmatched", match_guarantee_start_date: guaranteeStartDate() })
        .eq("id", p.own.id);

      if (parent?.email) {
        const { url: reactivateUrl } = await createConfirmationToken({
          type: "reactivate",
          email: parent.email,
          parentId: parent.id,
          childId: p.own.id,
          matchId: match.id,
          payload: { source: "consent_pause" },
        });
        const res = await sendEmail({
          to: parent.email,
          templateKey: "consent_pause",
          vars: {
            parent_first_name: parent.first_name ?? "",
            child_first_name: p.own.child_first_name ?? "your child",
            reactivate_url: reactivateUrl,
          },
        });
        if (res.ok) result.emailsSent++;
        else result.errors.push(`consent_pause send failed for ${parent.email}: ${res.error ?? res.status}`);
      }

      const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
        type: "consent_timeout_pause",
        title: `Address consent timed out — pause ReCharge for ${parent?.first_name ?? parent?.email ?? "family"}`,
        description:
          "This family did not consent to share their address within 14 days, so the match was wound down. " +
          "The app has paused their billing locally (pause reason 'address_consent') and emailed a reactivate link. " +
          "Action: log into ReCharge and pause this family's subscription. Resume it if/when they reactivate.",
        parent_id: parent?.id ?? null,
        child_id: p.own.id,
        match_id: match.id,
      });
      if (taskErr) result.errors.push(`consent_timeout task failed for match ${match.id}: ${taskErr.message}`);
      else result.tasksCreated++;
    } else if (parent?.email) {
      // This family said yes — free them back into the queue with priority, and
      // let them know it didn't work out (never blaming the other family).
      await requeueChild({
        childId: p.own.id,
        reason: "partner_orphaned",
        priority: true,
        actorEmail: "system:address-consent-timeout",
      });
      const res = await sendEmail({
        to: parent.email,
        templateKey: "match_didnt_work_out",
        vars: {
          parent_first_name: parent.first_name ?? "",
          child_first_name: p.own.child_first_name ?? "your child",
        },
      });
      if (res.ok) result.emailsSent++;
      else result.errors.push(`match_didnt_work_out send failed for ${parent.email}: ${res.error ?? res.status}`);
    }
  }

  // Wind the match down and stamp the timeout so this fires exactly once.
  await supabase.from("matches").update({
    match_status: "Closed",
    close_reason: "address_consent_timeout",
    close_reason_code: "consent_timeout",
    consent_timeout_at: nowIso,
  }).eq("id", match.id);

  // Any open "chase this address" task is now moot — close it.
  await supabase.from("lifecycle_tasks")
    .update({ completed: true, completed_at: nowIso, completed_by: "system:address-consent-timeout" })
    .eq("match_id", match.id)
    .eq("type", "chase_address_confirmation")
    .eq("completed", false);

  await logAudit({
    actorEmail: "system:address-consent-timeout",
    action: "match.address_consent_timeout",
    entityType: "match",
    entityId: match.id,
    payloadAfter: {
      address_confirmed_a: match.address_confirmed_a,
      address_confirmed_b: match.address_confirmed_b,
    },
  });
  result.timedOut++;
}

export interface DeclineConsentResult {
  ok: boolean;
  matchId: string;
  decliningChildId: string;
  partnerChildId?: string;
  emailsSent: number;
  tasksCreated: number;
  error?: string;
}

/**
 * Active decline (A4): a family has told us — via support, not a button; the
 * consent email is yes-only by design — that they will NOT share their address
 * for this match. Wind the match down like a timeout, attributed as a decline:
 * email the declining family (consent_declined) + queue a human task to handle
 * their subscription in ReCharge, requeue the partner with priority + email
 * match_didnt_work_out. Admin-triggered; idempotent-ish (only acts on a Pending
 * match, and closing it makes a second call a no-op).
 */
export async function declineAddressConsent(
  matchId: string,
  decliningChildId: string,
  actorEmail?: string | null,
): Promise<DeclineConsentResult> {
  const actor = actorEmail ?? "admin:consent-decline";
  const out: DeclineConsentResult = {
    ok: false, matchId, decliningChildId, emailsSent: 0, tasksCreated: 0,
  };

  const { data: match } = await supabase
    .from("matches")
    .select("id, child_a_id, child_b_id, match_status")
    .eq("id", matchId)
    .single();
  if (!match) { out.error = "Match not found"; return out; }
  if (match.match_status !== "Pending") {
    out.error = `Match is ${match.match_status}; consent can only be declined on a Pending match`;
    return out;
  }
  if (decliningChildId !== match.child_a_id && decliningChildId !== match.child_b_id) {
    out.error = "That child is not part of this match";
    return out;
  }

  const partnerChildId = decliningChildId === match.child_a_id ? match.child_b_id : match.child_a_id;
  out.partnerChildId = partnerChildId;

  const sides = await loadConsentSides(match.child_a_id, match.child_b_id);
  const declining = decliningChildId === match.child_a_id ? sides.a : sides.b;
  const partner = decliningChildId === match.child_a_id ? sides.b : sides.a;

  const nowIso = new Date().toISOString();
  const today = nowIso.split("T")[0];

  // Declining family: park the child out of the pool, tell them we understand,
  // and queue a human to handle their ReCharge subscription.
  if (declining) {
    await supabase.from("children")
      .update({ match_status: "Unmatched", match_guarantee_start_date: guaranteeStartDate() })
      .eq("id", declining.id);
    if (declining.parents?.email) {
      const res = await sendEmail({
        to: declining.parents.email,
        templateKey: "consent_declined",
        vars: { parent_first_name: declining.parents.first_name ?? "" },
      });
      if (res.ok) out.emailsSent++;
      else out.error = `consent_declined send failed: ${res.error ?? res.status}`;
    }
    const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
      type: "consent_declined_review",
      title: `Address consent declined — review ${declining.parents?.first_name ?? declining.parents?.email ?? "family"}`,
      description:
        "This family declined to share their address for their match, so the match was wound down and " +
        "the child taken out of the matching pool. Action: follow up and handle their ReCharge " +
        "subscription as appropriate (pause or cancel).",
      parent_id: declining.parents?.id ?? null,
      child_id: declining.id,
      match_id: match.id,
    });
    if (!taskErr) out.tasksCreated++;
  }

  // Partner: back into the queue with priority + a gentle notice (never blaming).
  if (partner) {
    await requeueChild({ childId: partner.id, reason: "partner_orphaned", priority: true, actorEmail: actor });
    if (partner.parents?.email) {
      const res = await sendEmail({
        to: partner.parents.email,
        templateKey: "match_didnt_work_out",
        vars: {
          parent_first_name: partner.parents.first_name ?? "",
          child_first_name: partner.child_first_name ?? "your child",
        },
      });
      if (res.ok) out.emailsSent++;
    }
  }

  await supabase.from("matches").update({
    match_status: "Closed",
    close_reason: "address_consent_declined",
    close_reason_code: "consent_declined",
  }).eq("id", match.id);

  await supabase.from("lifecycle_tasks")
    .update({ completed: true, completed_at: nowIso, completed_by: actor })
    .eq("match_id", match.id)
    .eq("type", "chase_address_confirmation")
    .eq("completed", false);

  await logAudit({
    actorEmail: actor,
    action: "match.address_consent_declined",
    entityType: "match",
    entityId: match.id,
    metadata: { decliningChildId, partnerChildId },
  });

  out.ok = true;
  return out;
}

/**
 * The A4 engine. Scans Pending matches at least 48h old that aren't fully
 * consented yet, and for each does exactly one due action per run (timeout wins
 * over reminder-2 wins over reminder-1). Fully idempotent via the stamp columns.
 */
export async function runAddressConsentLifecycle(): Promise<AddressConsentResult> {
  const result: AddressConsentResult = {
    scanned: 0,
    reminder1Sent: 0,
    reminder2Sent: 0,
    timedOut: 0,
    emailsSent: 0,
    tasksCreated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const now = Date.now();
  // Nothing is due before 48h, so only pull matches at least that old.
  const cutoff48 = new Date(now - CONSENT_REMINDER_1_HOURS * 3600000).toISOString();

  const { data: matches, error } = await supabase
    .from("matches")
    .select(
      "id, child_a_id, child_b_id, address_confirmed_a, address_confirmed_b, created_at, consent_opened_at, " +
      "consent_reminder_1_sent_at, consent_reminder_2_sent_at, consent_timeout_at",
    )
    .eq("match_status", "Pending")
    .lte("created_at", cutoff48);

  if (error) {
    result.errors.push(`Failed to load pending matches: ${error.message}`);
    return result;
  }
  if (!matches || matches.length === 0) {
    logger.info(result, "Address-consent cron: nothing due");
    return result;
  }

  for (const row of matches as unknown as ConsentMatchRow[]) {
    // A fully-consented match promotes to Active in confirm.ts; an already
    // wound-down one is done. Skip both (don't count them as scanned).
    if (row.address_confirmed_a && row.address_confirmed_b) continue;
    if (row.consent_timeout_at) continue;

    result.scanned++;
    const action = decideConsentAction(row, now);
    if (action === "none") continue;

    try {
      const sides = await loadConsentSides(row.child_a_id, row.child_b_id);

      if (action === "timeout") {
        await handleAddressConsentTimeout(row, sides, result);
      } else if (action === "reminder2") {
        const sent = await sendConsentReminders(row, sides, 2, result.errors);
        result.reminder2Sent += sent;
        result.emailsSent += sent;
        // Stamp reminder 2 (and back-fill reminder 1 if the cron only started
        // running after day 7) so neither re-fires.
        await supabase.from("matches").update({
          consent_reminder_2_sent_at: new Date().toISOString(),
          ...(row.consent_reminder_1_sent_at ? {} : { consent_reminder_1_sent_at: new Date().toISOString() }),
        }).eq("id", row.id);
      } else if (action === "reminder1") {
        const sent = await sendConsentReminders(row, sides, 1, result.errors);
        result.reminder1Sent += sent;
        result.emailsSent += sent;
        await supabase.from("matches").update({
          consent_reminder_1_sent_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    } catch (err) {
      result.errors.push(`exception for match ${row.id}: ${String(err)}`);
      logger.error({ err, matchId: row.id }, "Address-consent cron: per-match error");
    }
  }

  logger.info(result, "Address-consent cron completed");
  return result;
}

// ─── Block 3.4: Win-back fails (offboarding trigger) ─────────────────────────

export interface WinbackFailsResult {
  scanned: number;
  offboarded: number;
  errors: string[];
  ranAt: string;
}

/**
 * If a `send_poppy_card` task has been OPEN for WINBACK_FAIL_AFTER_DAYS, the
 * family did not re-engage. Treat them as offboarded:
 *   • Mark the Poppy card task complete with a system reason
 *   • Set parents.offboarded_at = NOW()
 *   • Trigger the shared offboarding routine inline (Phase 4 will extract this
 *     into lib/lifecycle.ts; for now we do the minimum: stamp offboarded_at,
 *     mark children Cancelled, emit `family_offboarded` Klaviyo event).
 */
export async function runWinbackFailsOffboarding(): Promise<WinbackFailsResult> {
  const result: WinbackFailsResult = {
    scanned: 0,
    offboarded: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const cutoff = new Date(Date.now() - WINBACK_FAIL_AFTER_DAYS * 86400000).toISOString();

  const { data: stale, error } = await supabase
    .from("lifecycle_tasks")
    .select("id, parent_id, created_at")
    .eq("type", "send_poppy_card")
    .eq("completed", false)
    .lte("created_at", cutoff);

  if (error) {
    result.errors.push(`Failed to load stale Poppy tasks: ${error.message}`);
    return result;
  }
  if (!stale || stale.length === 0) {
    logger.info(result, "Winback-fails cron: nothing to do");
    return result;
  }

  result.scanned = stale.length;
  const now = new Date().toISOString();

  for (const task of stale) {
    if (!task.parent_id) continue;
    try {
      // Delegate cascade to the shared offboarding helper. Klaviyo event,
      // partner orphan re-queue, cancellation row, audit log — all handled.
      await offboardFamily({
        parentId: task.parent_id,
        reason: "winback_failed",
        note: `Win-back email sequence + Poppy card (task ${task.id}) failed; ${WINBACK_FAIL_AFTER_DAYS}+ days without re-engagement.`,
      });

      // Mark the Poppy task itself complete so it stops appearing in Action Items.
      await supabase
        .from("lifecycle_tasks")
        .update({
          completed: true,
          completed_at: now,
          completed_by: "system:winback-fails",
        })
        .eq("id", task.id);

      result.offboarded++;
    } catch (err) {
      result.errors.push(`task ${task.id}: ${String(err)}`);
    }
  }

  logger.info(result, "Winback-fails cron completed");
  return result;
}

// ─── Block 3.9: Finalise cancellations after 48h grace ───────────────────────

const PAUSE_OFFER_GRACE_HOURS = 48;

export interface FinaliseCancellationsResult {
  scanned: number;
  finalised: number;
  errors: string[];
  ranAt: string;
}

/**
 * Find parents who got the pause-offer R4 email 48h+ ago and haven't either
 * accepted the pause or confirmed the cancellation. Finalise:
 *   • End matches, orphan partners (Phase 4 will use the shared re-queue routine)
 *   • Mark children Cancelled
 *   • Mark parent.subscription_status='Cancelled', offboarded_at=NOW
 *   • Emit Klaviyo `family_offboarded` event so K7 day-30 win-back fires
 */
export async function runFinaliseCancellations(): Promise<FinaliseCancellationsResult> {
  const result: FinaliseCancellationsResult = {
    scanned: 0,
    finalised: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const cutoff = new Date(Date.now() - PAUSE_OFFER_GRACE_HOURS * 3600000).toISOString();

  const { data: parents, error } = await supabase
    .from("parents")
    .select("id, email, first_name, intent_to_cancel_at, pause_offer_accepted, offboarded_at")
    .lte("intent_to_cancel_at", cutoff)
    .is("pause_offer_accepted", null)
    .is("offboarded_at", null);

  if (error) {
    result.errors.push(`load parents: ${error.message}`);
    return result;
  }
  if (!parents || parents.length === 0) {
    logger.info(result, "Finalise-cancellations cron: nothing to do");
    return result;
  }

  result.scanned = parents.length;

  // Delegate to the shared offboarding helper — same routine the win-back-fails
  // cron and (future) admin "Force offboard" button will use.
  for (const p of parents) {
    try {
      await offboardFamily({
        parentId: p.id,
        reason: "cancellation_finalised",
        note: "48h pause-offer grace expired without response",
      });
      result.finalised++;
    } catch (err) {
      result.errors.push(`parent ${p.id}: ${String(err)}`);
    }
  }

  logger.info(result, "Finalise-cancellations cron completed");
  return result;
}

// ─── Block 3.5 + 3.6: age-band review (formerly the aging-out cron) ─────────

export interface AgingResult {
  scanned: number;
  /** Children whose age band no longer matches their purchased tier. */
  mismatched: number;
  tasksCreated: number;
  errors: string[];
  ranAt: string;
}

/**
 * Daily age-band check.
 *
 * This used to REWRITE a child's tier from their date of birth. That quietly
 * contradicted the rule Phase 8 established — a child's tier comes from the
 * membership purchased for them, not from their birthday — and it had a real
 * cost: a parent who deliberately put a 5-year-old who already writes on Core
 * would find them silently moved to Minis overnight, then receive the wrong
 * pack. It also worked in reverse, dragging a deliberately-Minis 7-year-old up
 * to Core. Both were observed in production on 2026-08-18.
 *
 * Moving a child between bands is also a BILLING change — Core and Minis are
 * different memberships — so it was never something a cron should decide alone.
 *
 * So the cron now reports instead of acting: when a child's age band no longer
 * matches their tier, it raises a review task and leaves the tier exactly as the
 * parent bought it. A human decides whether to upgrade the membership.
 */
export async function runAgingOutCron(): Promise<AgingResult> {
  const result: AgingResult = {
    scanned: 0,
    mismatched: 0,
    tasksCreated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const { data: children, error } = await supabase
    .from("children")
    .select("id, child_first_name, date_of_birth, tier, parent_id, match_status")
    .not("date_of_birth", "is", null)
    .in("match_status", ["Unmatched", "Rematch Requested", "Matched"]);

  if (error) {
    result.errors.push(`Failed to load children: ${error.message}`);
    return result;
  }
  if (!children || children.length === 0) {
    logger.info(result, "Age-band cron: no children with DOB");
    return result;
  }

  result.scanned = children.length;

  // Idempotency: one open review per child, so a family isn't re-flagged nightly.
  const childIds = children.map((c) => c.id);
  const { data: existingTasks } = await supabase
    .from("lifecycle_tasks")
    .select("child_id")
    .eq("type", "review_tier_mismatch")
    .eq("completed", false)
    .in("child_id", childIds);
  const alreadyFlagged = new Set((existingTasks ?? []).map((t) => t.child_id));

  for (const c of children) {
    try {
      const change = tierChangeOnAging(c.date_of_birth as string, c.tier as string);
      if (!change) continue;

      result.mismatched++;
      if (alreadyFlagged.has(c.id)) continue;

      const direction =
        change.to.includes("Minis")
          ? `is younger than their ${change.from} membership usually serves`
          : `has grown beyond their ${change.from} membership`;

      const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
        type: "review_tier_mismatch",
        title: `Check membership — ${c.child_first_name} (${change.from})`,
        description:
          `${c.child_first_name} ${direction}, so by age alone they would sit in ${change.to}. ` +
          "Their tier has NOT been changed — the membership their parent bought is the one that counts, " +
          "and switching bands is a billing change. Decide whether to offer the family an upgrade, " +
          "or close this if the parent chose deliberately.",
        parent_id: c.parent_id,
        child_id: c.id,
      });

      if (taskErr) {
        result.errors.push(`task create failed for child ${c.id}: ${taskErr.message}`);
      } else {
        result.tasksCreated++;
        await logAudit({
          action: "child.age_band_review_raised",
          entityType: "child",
          entityId: c.id as string,
          payloadBefore: { tier: change.from },
          payloadAfter: { tier: change.from, age_band_suggests: change.to },
          metadata: { source: "age_band_cron", child_first_name: c.child_first_name },
        });
      }
    } catch (err) {
      result.errors.push(`child ${c.id}: ${String(err)}`);
    }
  }

  logger.info(result, "Age-band cron completed");
  return result;
}

// ─── Cron scheduler ──────────────────────────────────────────────────────────

// ─── Monthly pack-due cron (Phase 7) ────────────────────────────────────────
//
// On the 1st of every month, fire a `pack_due` Klaviyo event PER ACTIVE CHILD
// with { tier, subscription_month, child_first_name }. Klaviyo's per-tier flows
// then conditional-split on subscription_month to send the right pack email at
// 8am the recipient's local time.
//
// Product rules (Courtney, confirmed):
//   • PER CHILD — one event per active child, counted from that child's own
//     created_date (a later-added sibling starts at their own Month 1).
//   • subscription_month keeps incrementing past 12 (Year 2 = Month 13+).
//   • Only active subscribers (parents.subscription_status = 'Active').
//   • Skip a child whose subscription_month < 1 (hasn't reached their first
//     1st-of-month yet — no pack due).
//
// Idempotency: the schedule (once on the 1st) is the dedup. The manual endpoint
// supports dryRun so testing never double-fires real events.
interface PackDueResult {
  dryRun: boolean;
  scanned: number;            // active children examined
  fired: number;              // pack_due events emitted (counted in dryRun too)
  skippedNoPackYet: number;   // subscription_month < 1
  errors: string[];
  fires: Array<{ child_first_name: string; tier: string; subscription_month: number; parent_email: string }>;
}

export async function runPackDueCron(
  opts: { dryRun?: boolean; asOf?: Date } = {},
): Promise<PackDueResult> {
  const dryRun = opts.dryRun ?? false;
  const asOf = opts.asOf ?? new Date();
  const result: PackDueResult = {
    dryRun, scanned: 0, fired: 0, skippedNoPackYet: 0, errors: [], fires: [],
  };

  // 1. Active subscribers.
  const { data: activeParents, error: pErr } = await supabase
    .from("parents")
    .select("id, first_name, last_name, email, subscription_status")
    .eq("subscription_status", "Active");
  if (pErr) { result.errors.push(`parents query: ${pErr.message}`); return result; }
  const parentMap = new Map((activeParents ?? []).map((p) => [p.id, p]));
  const activeIds = [...parentMap.keys()];
  if (activeIds.length === 0) {
    logger.info({ ...result }, "pack_due cron: no active subscribers");
    return result;
  }

  // 2. Their children (each child gets its own pack on its own month counter).
  const { data: children, error: cErr } = await supabase
    .from("children")
    .select("id, child_first_name, tier, created_date, parent_id")
    .in("parent_id", activeIds);
  if (cErr) { result.errors.push(`children query: ${cErr.message}`); return result; }

  for (const child of children ?? []) {
    result.scanned++;
    const parent = parentMap.get(child.parent_id as string);
    if (!parent?.email) { result.errors.push(`child ${child.id}: parent has no email`); continue; }
    if (!child.created_date) { result.errors.push(`child ${child.id}: no created_date`); continue; }

    const month = computeSubscriptionMonth(child.created_date as string, asOf);
    if (month < 1) { result.skippedNoPackYet++; continue; }

    result.fires.push({
      child_first_name: child.child_first_name as string,
      tier: child.tier as string,
      subscription_month: month,
      parent_email: parent.email as string,
    });

    if (dryRun) { result.fired++; continue; }

    try {
      const emit = await emitKlaviyoEvent({
        event: "pack_due",
        profile: {
          email: parent.email as string,
          first_name: (parent.first_name as string | null) ?? undefined,
          last_name: (parent.last_name as string | null) ?? undefined,
        },
        properties: {
          child_id: child.id,
          child_first_name: child.child_first_name,
          tier: child.tier,
          subscription_month: month,
        },
        time: asOf,
      });
      if (emit.ok) result.fired++;
      else result.errors.push(`emit failed (${parent.email} / ${child.child_first_name}): ${emit.error ?? emit.status}`);
    } catch (e) {
      result.errors.push(`emit threw for child ${child.id}: ${String(e)}`);
    }
  }

  logger.info(
    { dryRun, scanned: result.scanned, fired: result.fired, skippedNoPackYet: result.skippedNoPackYet, errorCount: result.errors.length },
    dryRun ? "pack_due cron complete (DRY RUN — nothing emitted)" : "pack_due cron complete",
  );
  return result;
}

// ─── Group A / A6: Give-a-Key families still waiting on a PO Box ─────────────

export interface GakAddressOverdueResult {
  scanned: number;
  tasksCreated: number;
  errors: string[];
  ranAt: string;
}

/**
 * A child held at 'Awaiting Address' for GAK_ADDRESS_OVERDUE_DAYS gets a
 * follow-up task so someone checks in on the PO Box setup.
 *
 * A6 is explicit that this is a nudge and never a cancellation: the family is
 * waiting on a post office, which they can't hurry, and dropping them for it
 * would punish exactly the families Give a Key exists to help.
 *
 * Idempotency: skipped if an open 'gak_address_overdue' task already exists for
 * that child, so a family isn't re-flagged every night.
 */
export async function runGakAddressOverdue(): Promise<GakAddressOverdueResult> {
  const result: GakAddressOverdueResult = {
    scanned: 0,
    tasksCreated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  const cutoff = new Date(Date.now() - GAK_ADDRESS_OVERDUE_DAYS * 86400000).toISOString();
  const { data: waiting, error } = await supabase
    .from("children")
    .select("id, child_first_name, parent_id, awaiting_address_since, parents(first_name, last_name, email)")
    .eq("match_status", AWAITING_ADDRESS)
    .lte("awaiting_address_since", cutoff);

  if (error) {
    result.errors.push(`Failed to load awaiting-address children: ${error.message}`);
    return result;
  }
  if (!waiting || waiting.length === 0) {
    logger.info(result, "A6 overdue cron: nobody waiting past the threshold");
    return result;
  }
  result.scanned = waiting.length;

  // Idempotency: skip children that already have an open follow-up.
  const childIds = waiting.map((c) => c.id);
  const { data: existing } = await supabase
    .from("lifecycle_tasks")
    .select("child_id")
    .eq("type", "gak_address_overdue")
    .eq("completed", false)
    .in("child_id", childIds);
  const already = new Set((existing ?? []).map((t) => t.child_id));

  for (const child of waiting) {
    if (already.has(child.id)) continue;

    const p = (child as Record<string, unknown>)["parents"] as
      | { first_name?: string; last_name?: string; email?: string }
      | null;
    const family = p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() : "?";
    const days = child.awaiting_address_since
      ? differenceInDays(new Date(), parseISO(child.awaiting_address_since as string))
      : GAK_ADDRESS_OVERDUE_DAYS;

    const { error: taskErr } = await supabase.from("lifecycle_tasks").insert({
      type: "gak_address_overdue",
      title: `Give a Key PO Box still not set up — ${family}`,
      description:
        `${child.child_first_name} has been waiting ${days} days for a Give a Key PO Box ` +
        `and is not in the matching pool yet. Check in with the family (${p?.email ?? "no email on file"}) ` +
        `to see how the PO Box setup is going. Do not cancel — this is a nudge only.`,
      child_id: child.id,
      parent_id: child.parent_id,
    });

    if (taskErr) {
      result.errors.push(`task create failed for child ${child.id}: ${taskErr.message}`);
    } else {
      result.tasksCreated++;
      await logAudit({
        action: "lifecycle_task.created",
        entityType: "child",
        entityId: child.id as string,
        metadata: { type: "gak_address_overdue", daysWaiting: days },
      });
    }
  }

  logger.info(result, "A6 overdue cron completed");
  return result;
}

let nudgeJob: ReturnType<typeof cron.schedule> | null = null;
let breachJob: ReturnType<typeof cron.schedule> | null = null;
let chaseAddressJob: ReturnType<typeof cron.schedule> | null = null;
let winbackFailsJob: ReturnType<typeof cron.schedule> | null = null;
let agingJob: ReturnType<typeof cron.schedule> | null = null;
let finaliseCancellationsJob: ReturnType<typeof cron.schedule> | null = null;
let addressConsentJob: ReturnType<typeof cron.schedule> | null = null;
let packDueJob: ReturnType<typeof cron.schedule> | null = null;
let gakAddressJob: ReturnType<typeof cron.schedule> | null = null;

/** Start both daily lifecycle crons at 9 AM Mountain. */
export function startLifecycleCrons(): void {
  // 9 AM MT, daily — far enough into the morning that we won't wake Courtney.
  nudgeJob = cron.schedule(
    "0 9 * * *",
    () => {
      void runIncompleteOnboardingNudges().catch((err) =>
        logger.error({ err }, "Onboarding-nudge cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  breachJob = cron.schedule(
    "5 9 * * *",
    () => {
      void runGuaranteeBreachJob().catch((err) =>
        logger.error({ err }, "Guarantee-breach cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  chaseAddressJob = cron.schedule(
    "10 9 * * *",
    () => {
      void runChaseAddressConfirmation().catch((err) =>
        logger.error({ err }, "Chase-address cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  winbackFailsJob = cron.schedule(
    "15 9 * * *",
    () => {
      void runWinbackFailsOffboarding().catch((err) =>
        logger.error({ err }, "Winback-fails cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  agingJob = cron.schedule(
    "20 9 * * *",
    () => {
      void runAgingOutCron().catch((err) => logger.error({ err }, "Aging cron failed"));
    },
    { timezone: "America/Denver" },
  );
  // Finalise-cancellations runs every 4 hours so we don't drift too far past
  // the 48h grace boundary. 9:25, 13:25, 17:25, 21:25, etc.
  finaliseCancellationsJob = cron.schedule(
    "25 */4 * * *",
    () => {
      void runFinaliseCancellations().catch((err) =>
        logger.error({ err }, "Finalise-cancellations cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  // Address-consent reminders + day-14 timeout. Every 4 hours (9:35, 13:35, …)
  // so the 48h / day-7 / day-14 boundaries aren't missed by more than a few hours.
  addressConsentJob = cron.schedule(
    "35 */4 * * *",
    () => {
      void runAddressConsentLifecycle().catch((err) =>
        logger.error({ err }, "Address-consent cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  // Monthly packs: 00:30 MT on the 1st of every month. Fired early so Klaviyo
  // receives the pack_due events at the start of the day and can hold each email
  // until 8am in the recipient's own timezone.
  packDueJob = cron.schedule(
    "30 0 1 * *",
    () => {
      void runPackDueCron().catch((err) => logger.error({ err }, "pack_due cron failed"));
    },
    { timezone: "America/Denver" },
  );
  // A6: Give-a-Key families still without a PO Box. Daily is plenty — this is a
  // 30-day threshold, so a few hours either way is immaterial.
  gakAddressJob = cron.schedule(
    "40 9 * * *",
    () => {
      void runGakAddressOverdue().catch((err) =>
        logger.error({ err }, "GAK address-overdue cron failed"),
      );
    },
    { timezone: "America/Denver" },
  );
  logger.info(
    "Lifecycle crons scheduled (9:00, 9:05, 9:10, 9:15, 9:20, 9:40 daily + finalise every 4h + address-consent every 4h + pack_due 00:30 on the 1st — America/Denver)",
  );
}

export function stopLifecycleCrons(): void {
  nudgeJob?.stop();
  breachJob?.stop();
  chaseAddressJob?.stop();
  winbackFailsJob?.stop();
  agingJob?.stop();
  finaliseCancellationsJob?.stop();
  addressConsentJob?.stop();
  packDueJob?.stop();
  gakAddressJob?.stop();
  nudgeJob = null;
  breachJob = null;
  chaseAddressJob = null;
  winbackFailsJob = null;
  agingJob = null;
  finaliseCancellationsJob = null;
  addressConsentJob = null;
  packDueJob = null;
  gakAddressJob = null;
}

// App-URL helper now lives in lib/app-url.ts (imported at the top of this file),
// so all emailed links are built from one hardened implementation.

// ─── Admin manual triggers (very useful for testing) ─────────────────────────

router.post(
  "/admin/lifecycle/onboarding-nudge/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual onboarding-nudge run triggered");
    const result = await runIncompleteOnboardingNudges();
    res.json(result);
  },
);

router.post(
  "/admin/lifecycle/guarantee-breach/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual guarantee-breach run triggered");
    const result = await runGuaranteeBreachJob();
    res.json(result);
  },
);

router.post(
  "/admin/lifecycle/chase-address-confirmation/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual chase-address run triggered");
    const result = await runChaseAddressConfirmation();
    res.json(result);
  },
);

router.post(
  "/admin/lifecycle/winback-fails/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual winback-fails run triggered");
    const result = await runWinbackFailsOffboarding();
    res.json(result);
  },
);

router.post(
  "/admin/lifecycle/address-consent/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual address-consent run triggered");
    const result = await runAddressConsentLifecycle();
    res.json(result);
  },
);

// Monthly pack_due — manual trigger. Pass ?dryRun=true to compute + preview the
// per-child pack months WITHOUT emitting any Klaviyo events (safe for testing).
router.post(
  "/admin/lifecycle/pack-due/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const dryRun = req.query["dryRun"] === "true" || req.body?.dryRun === true;
    req.log?.info({ by: req.user?.email, dryRun }, "Manual pack_due run triggered");
    const result = await runPackDueCron({ dryRun });
    res.json(result);
  },
);

router.post(
  "/admin/lifecycle/aging/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual aging cron triggered");
    const result = await runAgingOutCron();
    res.json(result);
  },
);

router.post(
  "/admin/lifecycle/finalise-cancellations/run",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    req.log?.info({ by: req.user?.email }, "Manual finalise-cancellations triggered");
    const result = await runFinaliseCancellations();
    res.json(result);
  },
);

// ─── Lifecycle-tasks routes (list + mark complete) ───────────────────────────

router.get("/lifecycle-tasks", requireAuth, async (_req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from("lifecycle_tasks")
    .select("*")
    .eq("completed", false)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});

router.patch(
  "/lifecycle-tasks/:id/complete",
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params["id"] ?? "");
      if (!id) { res.status(400).json({ error: "Missing task id" }); return; }
      const completedBy = req.user?.email ?? req.user?.id ?? "unknown";
      const { data: before } = await supabase
        .from("lifecycle_tasks")
        .select("*")
        .eq("id", id)
        .single();
      if (!before) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      const { error } = await supabase
        .from("lifecycle_tasks")
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          completed_by: completedBy,
        })
        .eq("id", id);
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      await logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        action: "lifecycle_task.completed",
        entityType: "lifecycle_task",
        entityId: id,
        payloadBefore: before,
        req,
      });
      res.json({ success: true });
    } catch (err) {
      req.log?.error({ err }, "Error completing lifecycle task");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

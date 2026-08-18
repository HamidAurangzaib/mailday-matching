import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

// ─── ReCharge API helpers ─────────────────────────────────────────────────────

interface RechargeSubscription {
  id: number;
  customer_id: number;
  email?: string;
  status: string; // "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED"
}

interface RechargeCustomer {
  id: number;
  email: string;
}

async function rechargeGet<T>(path: string): Promise<T> {
  const token = process.env["RECHARGE_API_TOKEN"];
  if (!token) throw new Error("RECHARGE_API_TOKEN not set");

  const res = await fetch(`https://api.rechargeapps.com${path}`, {
    headers: {
      "X-Recharge-Access-Token": token,
      "Accept": "application/json",
      "X-Recharge-Version": "2021-11",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ReCharge API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// Fetch all subscriptions from ReCharge (cursor-paginated)
async function fetchAllSubscriptions(): Promise<RechargeSubscription[]> {
  const all: RechargeSubscription[] = [];
  let cursor: string | null = null;

  do {
    const url: string = cursor
      ? `/subscriptions?limit=250&cursor=${cursor}`
      : `/subscriptions?limit=250`;

    const page: { subscriptions: RechargeSubscription[]; next_cursor?: string | null } =
      await rechargeGet<{ subscriptions: RechargeSubscription[]; next_cursor?: string | null }>(url);

    all.push(...(page.subscriptions ?? []));
    cursor = page.next_cursor ?? null;
  } while (cursor);

  return all;
}

// Fetch customer email by customer_id (used when subscription has no email field)
const customerCache = new Map<number, string>();
async function fetchCustomerEmail(customerId: number): Promise<string | null> {
  if (customerCache.has(customerId)) return customerCache.get(customerId)!;
  try {
    const data = await rechargeGet<{ customer: RechargeCustomer }>(
      `/customers/${customerId}`
    );
    const email = data.customer?.email ?? null;
    if (email) customerCache.set(customerId, email);
    return email;
  } catch {
    return null;
  }
}

// ─── Core sync function ───────────────────────────────────────────────────────

export interface SyncResult {
  subscriptionsFetched: number;
  parentsUpdated: number;
  childrenUpdated: number;
  errors: string[];
  ranAt: string;
}

export async function syncRechargeSubscriptions(): Promise<SyncResult> {
  const result: SyncResult = {
    subscriptionsFetched: 0,
    parentsUpdated: 0,
    childrenUpdated: 0,
    errors: [],
    ranAt: new Date().toISOString(),
  };

  try {
    const subscriptions = await fetchAllSubscriptions();
    result.subscriptionsFetched = subscriptions.length;

    if (subscriptions.length === 0) {
      logger.info("ReCharge sync: no subscriptions found");
      return result;
    }

    // Group subscriptions by email — resolve missing emails via customer lookup
    const byEmail = new Map<string, string[]>(); // email → statuses[]
    // email → ids of subscriptions that are still live. Used to link a family to
    // exactly one subscription for the guarantee auto-pause (see below).
    const liveIdsByEmail = new Map<string, string[]>();

    for (const sub of subscriptions) {
      let email = sub.email?.toLowerCase() ?? null;
      if (!email && sub.customer_id) {
        email = await fetchCustomerEmail(sub.customer_id);
      }
      if (!email) continue;

      const status = sub.status.toUpperCase();
      const statuses = byEmail.get(email) ?? [];
      statuses.push(status);
      byEmail.set(email, statuses);

      if (status === "ACTIVE" || status === "PAUSED") {
        const ids = liveIdsByEmail.get(email) ?? [];
        ids.push(String(sub.id));
        liveIdsByEmail.set(email, ids);
      }
    }

    // For each email, determine billing_paused:
    // If ANY subscription is ACTIVE → not paused (they still have access)
    // If ALL subscriptions are PAUSED/CANCELLED/EXPIRED → paused
    const updates: Array<{
      email: string;
      billing_paused: boolean;
      subscription_status: string;
      soleSubscriptionId: string | null;
    }> = [];

    for (const [email, statuses] of byEmail) {
      const hasActive = statuses.some((s) => s === "ACTIVE");
      const billing_paused = !hasActive;

      const dominant =
        statuses.includes("ACTIVE")    ? "Active"    :
        statuses.includes("PAUSED")    ? "Paused"    :
        statuses.includes("CANCELLED") ? "Cancelled" : "Expired";

      const liveIds = liveIdsByEmail.get(email) ?? [];
      updates.push({
        email,
        billing_paused,
        subscription_status: dominant,
        // Only link when it is unambiguous. A family on the per-child membership
        // model can hold several subscriptions, and we will not guess which
        // child's membership the guarantee auto-pause should stop — those
        // families keep the manual task.
        soleSubscriptionId: liveIds.length === 1 ? liveIds[0]! : null,
      });
    }

    // Batch update parents
    for (const update of updates) {
      const { data: existing } = await supabase
        .from("parents")
        .select("id, pause_type")
        .eq("email", update.email)
        .single();

      if (!existing) continue;

      // A guarantee pause is OURS, not ReCharge's. We pause a family by pushing
      // their next charge date forward, which leaves the subscription ACTIVE in
      // ReCharge — so a naive sync would read "active" and clear the pause within
      // the hour, silently undoing the 21-day promise. Hold it until the match is
      // made and the resume path clears pause_type.
      const holdForGuarantee = existing.pause_type === "guarantee";
      const parentPaused = update.billing_paused || holdForGuarantee;

      const parentUpdate: Record<string, unknown> = {
        billing_paused: parentPaused,
        subscription_status: update.subscription_status,
      };
      // Link the family to their subscription when there is exactly one, so the
      // guarantee auto-pause knows what to act on.
      if (update.soleSubscriptionId) {
        parentUpdate["recharge_subscription_id"] = update.soleSubscriptionId;
      }

      const { error } = await supabase
        .from("parents")
        .update(parentUpdate)
        .eq("id", existing.id);

      if (error) continue;

      result.parentsUpdated++;

      // Mirror to children — but never clear a child whose pause is held by the
      // A4 pause_reasons list (address consent, etc.). Those are our pauses too,
      // and ReCharge knows nothing about them.
      const { data: kids } = await supabase
        .from("children")
        .select("id, pause_reasons")
        .eq("parent_id", existing.id);

      // Partition rather than updating child-by-child: this job sweeps the whole
      // member base every hour, so it stays at a fixed few queries per family.
      const heldByReason: string[] = [];
      const followParent: string[] = [];
      for (const kid of kids ?? []) {
        const reasons = (kid.pause_reasons as string[] | null) ?? [];
        if (reasons.length > 0) heldByReason.push(kid.id as string);
        else followParent.push(kid.id as string);
      }

      if (followParent.length > 0) {
        const { data: updated } = await supabase
          .from("children")
          .update({ billing_paused: parentPaused })
          .in("id", followParent)
          .select("id");
        result.childrenUpdated += updated?.length ?? 0;
      }
      if (heldByReason.length > 0) {
        const { data: updated } = await supabase
          .from("children")
          .update({ billing_paused: true })
          .in("id", heldByReason)
          .select("id");
        result.childrenUpdated += updated?.length ?? 0;
      }
    }

    logger.info(result, "ReCharge sync completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);
    logger.error({ err }, "ReCharge sync failed");
  }

  return result;
}

// ─── Scheduled sync (runs every hour) ────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startRechargeSync() {
  if (!process.env["RECHARGE_API_TOKEN"]) {
    logger.warn("RECHARGE_API_TOKEN not set — ReCharge sync disabled");
    return;
  }

  // Run immediately on startup, then every hour
  void syncRechargeSubscriptions();
  syncInterval = setInterval(() => {
    void syncRechargeSubscriptions();
  }, 60 * 60 * 1000); // 1 hour

  logger.info("ReCharge sync scheduled (every 1 hour)");
}

export function stopRechargeSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// ─── Admin route: POST /admin/sync/recharge ───────────────────────────────────
// Manually trigger a sync from the admin dashboard.

router.post(
  "/admin/sync/recharge",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    if (!process.env["RECHARGE_API_TOKEN"]) {
      res.status(503).json({ error: "RECHARGE_API_TOKEN not configured" });
      return;
    }

    req.log?.info("Manual ReCharge sync triggered");
    const result = await syncRechargeSubscriptions();

    res.json(result);
  }
);

// ─── Admin route: GET /admin/sync/status ─────────────────────────────────────

router.get(
  "/admin/sync/status",
  requireAuth,
  requireAdmin,
  (_req, res) => {
    res.json({
      rechargeApiConfigured: !!process.env["RECHARGE_API_TOKEN"],
      syncScheduled: syncInterval !== null,
      intervalHours: 1,
    });
  }
);

export default router;

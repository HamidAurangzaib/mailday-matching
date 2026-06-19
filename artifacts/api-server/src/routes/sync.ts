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

    for (const sub of subscriptions) {
      let email = sub.email?.toLowerCase() ?? null;
      if (!email && sub.customer_id) {
        email = await fetchCustomerEmail(sub.customer_id);
      }
      if (!email) continue;

      const statuses = byEmail.get(email) ?? [];
      statuses.push(sub.status.toUpperCase());
      byEmail.set(email, statuses);
    }

    // For each email, determine billing_paused:
    // If ANY subscription is ACTIVE → not paused (they still have access)
    // If ALL subscriptions are PAUSED/CANCELLED/EXPIRED → paused
    const updates: Array<{ email: string; billing_paused: boolean; subscription_status: string }> = [];

    for (const [email, statuses] of byEmail) {
      const hasActive = statuses.some((s) => s === "ACTIVE");
      const billing_paused = !hasActive;

      const dominant =
        statuses.includes("ACTIVE")    ? "Active"    :
        statuses.includes("PAUSED")    ? "Paused"    :
        statuses.includes("CANCELLED") ? "Cancelled" : "Expired";

      updates.push({ email, billing_paused, subscription_status: dominant });
    }

    // Batch update parents
    for (const update of updates) {
      const { data: parent, error } = await supabase
        .from("parents")
        .update({
          billing_paused: update.billing_paused,
          subscription_status: update.subscription_status,
        })
        .eq("email", update.email)
        .select("id")
        .single();

      if (error || !parent) continue;

      result.parentsUpdated++;

      // Mirror billing_paused to all children of this parent
      const { data: updatedChildren } = await supabase
        .from("children")
        .update({ billing_paused: update.billing_paused })
        .eq("parent_id", parent.id)
        .select("id");

      result.childrenUpdated += updatedChildren?.length ?? 0;
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

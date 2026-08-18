/**
 * ReCharge API client.
 *
 * Reads have always been safe and are used by the hourly sync. Writes are new
 * and touch real money, so they are gated twice over:
 *
 *   1. RECHARGE_WRITES_ENABLED must be exactly "true". Anything else — unset,
 *      empty, "1", "yes" — leaves the client in dry-run, where every write is
 *      logged in full and nothing is sent. Fail closed: a config typo must not
 *      quietly start moving customers' billing dates.
 *   2. The only write we implement moves a charge DATE. There is deliberately
 *      no cancel, no refund, no price change. The worst case for a bug here is
 *      a subscription billed later than intended, which is recoverable; the
 *      worst case for a cancel would not be.
 *
 * ReCharge (2021-11) has no "pause" primitive — pausing a subscription means
 * pushing its next charge date forward, which is what their own merchant docs
 * tell staff to do by hand. Resuming means putting the date back.
 */
import { logger } from "./logger.js";

const API_BASE = "https://api.rechargeapps.com";
const API_VERSION = "2021-11";

/** Writes are off unless explicitly enabled. See the note above. */
export function rechargeWritesEnabled(): boolean {
  return (process.env["RECHARGE_WRITES_ENABLED"] ?? "").trim().toLowerCase() === "true";
}

function token(): string | null {
  return process.env["RECHARGE_API_TOKEN"] ?? null;
}

async function rechargeRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const t = token();
  if (!t) throw new Error("RECHARGE_API_TOKEN not set");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "X-Recharge-Access-Token": t,
      "X-Recharge-Version": API_VERSION,
      "Accept": "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    // Include the body: ReCharge puts the useful part of a 4xx in there, and
    // this is the first place we'd look if the payload shape is wrong.
    throw new Error(`ReCharge ${method} ${path} → ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface RechargeSubscriptionDetail {
  id: number;
  status: string;
  next_charge_scheduled_at: string | null;
}

export async function getSubscription(id: string): Promise<RechargeSubscriptionDetail | null> {
  try {
    const r = await rechargeRequest<{ subscription?: RechargeSubscriptionDetail }>(
      "GET",
      `/subscriptions/${id}`,
    );
    return r.subscription ?? null;
  } catch (err) {
    logger.error({ err, subscriptionId: id }, "ReCharge: failed to read subscription");
    return null;
  }
}

export interface ChargeDateResult {
  ok: boolean;
  /** True when the call was suppressed because writes are disabled. */
  dryRun: boolean;
  error?: string;
}

/**
 * Move a subscription's next charge date.
 *
 * `date` is YYYY-MM-DD. In dry-run this logs exactly what it would have sent and
 * reports success, so the calling job's bookkeeping still exercises end to end
 * without touching the customer.
 */
export async function changeNextChargeDate(
  subscriptionId: string,
  date: string,
  context: Record<string, unknown> = {},
): Promise<ChargeDateResult> {
  if (!rechargeWritesEnabled()) {
    logger.warn(
      { subscriptionId, date, ...context },
      "ReCharge DRY RUN — would move next charge date (set RECHARGE_WRITES_ENABLED=true to apply)",
    );
    return { ok: true, dryRun: true };
  }

  try {
    await rechargeRequest("POST", `/subscriptions/${subscriptionId}/change_next_charge_date`, { date });
    logger.info({ subscriptionId, date, ...context }, "ReCharge: next charge date moved");
    return { ok: true, dryRun: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, subscriptionId, date, ...context }, "ReCharge: failed to move next charge date");
    return { ok: false, dryRun: false, error: message };
  }
}

import { Router, type IRouter } from "express";
import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

const KLAVIYO_API = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

// ─── Klaviyo API helper ───────────────────────────────────────────────────────

async function klaviyoGet<T = unknown>(path: string): Promise<T> {
  const apiKey = process.env["KLAVIYO_API_KEY"];
  if (!apiKey) throw new Error("KLAVIYO_API_KEY not set");

  const res = await fetch(`${KLAVIYO_API}${path}`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Klaviyo API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Metric ID cache ─────────────────────────────────────────────────────────

let cachedOpenedEmailMetricId: string | null = null;

async function getOpenedEmailMetricId(): Promise<string | null> {
  if (cachedOpenedEmailMetricId) return cachedOpenedEmailMetricId;

  const data = await klaviyoGet<{
    data: Array<{ id: string; attributes: { name: string } }>;
  }>("/metrics/");

  const metric = data.data?.find((m) => m.attributes?.name === "Opened Email");
  cachedOpenedEmailMetricId = metric?.id ?? null;
  return cachedOpenedEmailMetricId;
}

// ─── Main sync function ───────────────────────────────────────────────────────
// Pulls all "Opened Email" events from the last 25 hours (slight overlap with
// previous run to avoid gaps). Updates last_email_open_date per parent and
// clears at_risk. After processing parents, recalculates emails_opened counts
// on pack_delivery_log based on distinct parents who opened in each month.

export async function syncKlaviyoEmailOpens(): Promise<{
  eventsProcessed: number;
  parentsUpdated: number;
}> {
  const apiKey = process.env["KLAVIYO_API_KEY"];
  if (!apiKey) {
    logger.warn("KLAVIYO_API_KEY not set — skipping Klaviyo email open sync");
    return { eventsProcessed: 0, parentsUpdated: 0 };
  }

  const metricId = await getOpenedEmailMetricId();
  if (!metricId) {
    logger.warn("Klaviyo sync: could not find 'Opened Email' metric");
    return { eventsProcessed: 0, parentsUpdated: 0 };
  }

  // 25-hour lookback — slight overlap so we never miss an event at the boundary
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const filter = `and(equals(metric_id,"${metricId}"),greater-than(datetime,"${since}"))`;

  // Collect all email→openDate pairs across pages
  const opensByEmail = new Map<string, string>(); // email → latest open date

  let nextUrl: string | null =
    `${KLAVIYO_API}/events/?filter=${encodeURIComponent(filter)}&include=profile&page[size]=100`;

  while (nextUrl) {
    const urlPath: string = nextUrl.replace(KLAVIYO_API, "");

    const page = await klaviyoGet<{
      data: Array<{
        id: string;
        attributes: { datetime?: string; event_properties?: Record<string, string> };
        relationships?: { profile?: { data?: { id?: string } } };
      }>;
      included?: Array<{
        type: string;
        id: string;
        attributes?: { email?: string };
      }>;
      links?: { next?: string | null };
    }>(urlPath);

    // Build profile id → email map from included profiles
    const profileEmails: Record<string, string> = {};
    for (const inc of page.included ?? []) {
      if (inc.type === "profile" && inc.attributes?.email) {
        profileEmails[inc.id] = inc.attributes.email.toLowerCase();
      }
    }

    for (const event of page.data ?? []) {
      const profileId = event.relationships?.profile?.data?.id;
      const email = profileId ? profileEmails[profileId] : null;
      if (!email) continue;

      const openDate = event.attributes?.datetime
        ? new Date(event.attributes.datetime).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];

      // Keep the most recent open date per email
      const existing = opensByEmail.get(email);
      if (!existing || openDate > existing) {
        opensByEmail.set(email, openDate);
      }
    }

    nextUrl = page.links?.next ?? null;
  }

  if (opensByEmail.size === 0) {
    logger.info("Klaviyo sync: no email open events in window");
    return { eventsProcessed: 0, parentsUpdated: 0 };
  }

  // Update parents in batches
  let parentsUpdated = 0;
  const emails = Array.from(opensByEmail.keys());

  // Look up all matching parents in one query
  const { data: parents } = await supabase
    .from("parents")
    .select("id, email, at_risk, last_email_open_date")
    .in("email", emails);

  for (const parent of parents ?? []) {
    const newOpenDate = opensByEmail.get(parent.email) ?? null;
    if (!newOpenDate) continue;

    const existing = parent.last_email_open_date as string | null;
    if (existing && existing >= newOpenDate && !parent.at_risk) continue;

    await supabase
      .from("parents")
      .update({ last_email_open_date: newOpenDate, at_risk: false })
      .eq("id", parent.id);

    parentsUpdated++;
  }

  // Recalculate emails_opened on all pack_delivery_log entries.
  // Count = distinct active parents whose last_email_open_date falls in that month.
  // This is idempotent and never double-counts.
  const { data: logs } = await supabase
    .from("pack_delivery_log")
    .select("id, month_number, year");

  for (const log of logs ?? []) {
    const m = String(log.month_number).padStart(2, "0");
    const monthStart = `${log.year}-${m}-01`;
    const nextM = log.month_number === 12
      ? `${(log.year as number) + 1}-01-01`
      : `${log.year}-${String((log.month_number as number) + 1).padStart(2, "0")}-01`;

    const { count } = await supabase
      .from("parents")
      .select("id", { count: "exact", head: true })
      .gte("last_email_open_date", monthStart)
      .lt("last_email_open_date", nextM);

    if (count !== null) {
      await supabase
        .from("pack_delivery_log")
        .update({ emails_opened: count })
        .eq("id", log.id);
    }
  }

  logger.info(
    { emailsFound: opensByEmail.size, parentsUpdated },
    "Klaviyo email open sync completed"
  );

  return { eventsProcessed: opensByEmail.size, parentsUpdated };
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let syncJob: ReturnType<typeof cron.schedule> | null = null;

export function startKlaviyoSync() {
  if (!process.env["KLAVIYO_API_KEY"]) {
    logger.warn("KLAVIYO_API_KEY not set — Klaviyo sync disabled");
    return;
  }

  // Run daily at 5am MT, just before the at-risk flagging job at 6am
  syncJob = cron.schedule(
    "0 5 * * *",
    () => {
      void syncKlaviyoEmailOpens().catch((err) =>
        logger.error({ err }, "Klaviyo email open sync failed")
      );
    },
    { timezone: "America/Denver" }
  );

  logger.info("Klaviyo sync scheduled (5am daily — America/Denver)");
}

export function stopKlaviyoSync() {
  syncJob?.stop();
  syncJob = null;
}

// ─── Admin manual trigger ─────────────────────────────────────────────────────

router.post(
  "/admin/klaviyo/sync",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result = await syncKlaviyoEmailOpens();
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log?.error({ err }, "Manual Klaviyo sync failed");
      res.status(500).json({ ok: false, error: msg });
    }
  }
);

export default router;

import { Router, type IRouter } from "express";
import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { differenceInDays, parseISO, subDays, nextFriday, isToday } from "date-fns";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

// ─── Slack Block Kit helpers ──────────────────────────────────────────────────

function header(text: string) {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

function section(text: string) {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function divider() {
  return { type: "divider" };
}

async function sendSlack(blocks: unknown[]): Promise<void> {
  const url = process.env["SLACK_WEBHOOK"];
  if (!url) {
    logger.warn("SLACK_WEBHOOK_URL not set — skipping Slack notification");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Slack webhook failed: ${res.status} ${text}`);
  }
}

// ─── Data fetcher ─────────────────────────────────────────────────────────────

async function fetchDigestData() {
  const now = new Date();

  const [
    unmatchedResult,
    rematchResult,
    urgentGuaranteeResult,
    warningGuaranteeResult,
    totalActiveResult,
    newSubscribersResult,
    atRiskResult,
    cancellationsResult,
    pendingAppsResult,
    overdueAppsResult,
    waitlistedResult,
    receiptsResult,
    tremendousResult,
    fundResult,
    matchesThisWeekResult,
    closedThisWeekResult,
  ] = await Promise.all([
    supabase.from("children").select("id, tier").eq("match_status", "Unmatched"),
    supabase.from("children").select("id", { count: "exact", head: true }).eq("match_status", "Rematch Requested"),
    supabase.from("children").select("id, match_guarantee_start_date").eq("match_status", "Unmatched"),
    supabase.from("children").select("id, match_guarantee_start_date").eq("match_status", "Unmatched"),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("subscription_status", "Active"),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("subscription_status", "Active").gte("join_date", subDays(now, 7).toISOString()),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("at_risk", true),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("subscription_status", "Cancelled").gte("updated_at", subDays(now, 7).toISOString()),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Pending"),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Pending").lte("created_at", subDays(now, 2).toISOString()),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Waitlisted"),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).not("po_box_receipt_url", "is", null).eq("receipt_verified", false),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Approved").eq("tremendous_sent", false),
    supabase.from("give_a_key_applications").select("amount_disbursed").eq("application_status", "Active"),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("match_status", "Active").gte("match_date", subDays(now, 7).toISOString()),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("match_status", "Closed").gte("updated_at", subDays(now, 7).toISOString()),
  ]);

  const unmatched = unmatchedResult.data ?? [];
  const coreUnmatched = unmatched.filter((c) => c.tier === "Core" || c.tier === "Homeschool Core").length;
  const minisUnmatched = unmatched.filter((c) => c.tier === "Minis" || c.tier === "Homeschool Minis").length;
  const rematchCount = rematchResult.count ?? 0;

  let urgentCount = 0;
  let warningCount = 0;
  for (const c of urgentGuaranteeResult.data ?? []) {
    if (!c.match_guarantee_start_date) continue;
    const days = differenceInDays(now, parseISO(c.match_guarantee_start_date));
    if (days >= 21) urgentCount++;
    else if (days >= 18) warningCount++;
  }

  const totalDonations = (fundResult.data ?? []).reduce((sum: number, r: { amount_disbursed: number | null }) => sum + (r.amount_disbursed ?? 0), 0);
  const fundBalance = totalDonations; // simplified; real calc in give-a-key.ts

  const daysUntilFriday = (() => {
    const friday = nextFriday(now);
    const days = differenceInDays(friday, now);
    return isToday(friday) ? 0 : days;
  })();

  return {
    coreUnmatched,
    minisUnmatched,
    rematchCount,
    urgentCount,
    warningCount,
    daysUntilFriday,
    totalActive: totalActiveResult.count ?? 0,
    newSubscribers7d: newSubscribersResult.count ?? 0,
    atRisk: atRiskResult.count ?? 0,
    cancellations7d: cancellationsResult.count ?? 0,
    pendingApps: pendingAppsResult.count ?? 0,
    overdueApps: overdueAppsResult.count ?? 0,
    waitlisted: waitlistedResult.count ?? 0,
    receipts: receiptsResult.count ?? 0,
    tremendous: tremendousResult.count ?? 0,
    fundBalance,
    matchesThisWeek: matchesThisWeekResult.count ?? 0,
    closedThisWeek: closedThisWeekResult.count ?? 0,
  };
}

function appUrl(path = "/") {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const primary = domains.split(",")[0]?.trim();
    if (primary) return `https://${primary}${path}`;
  }
  return `https://your-mailday-app.replit.app${path}`;
}

// ─── Daily Digest ─────────────────────────────────────────────────────────────

export async function sendDailyDigest(): Promise<void> {
  const d = await fetchDigestData();

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/Denver",
  });

  const urgentItems: string[] = [];
  if (d.urgentCount > 0)  urgentItems.push(`• ${d.urgentCount} ${d.urgentCount === 1 ? "child has" : "children have"} hit the 21-day guarantee — billing paused`);
  if (d.overdueApps > 0)  urgentItems.push(`• ${d.overdueApps} Give a Key ${d.overdueApps === 1 ? "application" : "applications"} waiting >48 hours without action`);
  if (d.tremendous > 0)   urgentItems.push(`• ${d.tremendous} approved ${d.tremendous === 1 ? "application" : "applications"} — Tremendous not yet sent`);
  if (d.receipts > 0)     urgentItems.push(`• ${d.receipts} ${d.receipts === 1 ? "receipt" : "receipts"} submitted but not yet verified`);

  const allClear = urgentItems.length === 0 && d.urgentCount === 0 && d.warningCount === 0;

  const blocks = [
    header(allClear
      ? `✅ Good morning — ${today}`
      : `☀️ Good morning — ${today}`),
    allClear
      ? section("*All clear.* Here's your morning snapshot.")
      : section("*All clear.* Here's your morning snapshot."),
    divider(),
    section(allClear
      ? `*🚨 Urgent Attention*\n_No urgent items today. You're good._`
      : `*🚨 Urgent Attention*\n${urgentItems.join("\n")}`),
    divider(),
    section(
      `*🎯 Matching Status*\n` +
      `• Core pool: *${d.coreUnmatched}* unmatched\n` +
      `• Minis pool: *${d.minisUnmatched}* unmatched\n` +
      `• Rematch Queue: *${d.rematchCount}* children\n` +
      `• Next Friday session: *${d.daysUntilFriday === 0 ? "today!" : `${d.daysUntilFriday} days`}*`
    ),
    divider(),
    section(
      `*🔑 Give a Key*\n` +
      `• Pending applications: *${d.pendingApps}*\n` +
      `• Waitlisted: *${d.waitlisted}*\n` +
      `• Fund balance: *$${d.fundBalance.toLocaleString()}*`
    ),
    divider(),
    section(
      `*👥 Member Health*\n` +
      `• Total active: *${d.totalActive}*\n` +
      `• New this week: *${d.newSubscribers7d}*\n` +
      `• At-risk members: *${d.atRisk}*\n` +
      `• Cancellations this week: *${d.cancellations7d}*`
    ),
    divider(),
    section(`<${appUrl()}|→ Open MailDay Dashboard>`),
  ];

  await sendSlack(blocks);
  logger.info("Daily digest sent to Slack");
}

// ─── Friday Matching Reminder ─────────────────────────────────────────────────

export async function sendFridayReminder(): Promise<void> {
  const d = await fetchDigestData();

  const warningLines: string[] = [];
  const now = new Date();
  const { data: urgentChildren } = await supabase
    .from("children")
    .select("child_first_name, match_guarantee_start_date")
    .eq("match_status", "Unmatched");

  for (const c of urgentChildren ?? []) {
    if (!c.match_guarantee_start_date) continue;
    const days = differenceInDays(now, parseISO(c.match_guarantee_start_date));
    if (days >= 18) {
      warningLines.push(`• ${c.child_first_name} — ${days} days`);
    }
  }

  const blocks = [
    header("🎯 It's Friday. Time to match."),
    divider(),
    section(
      `• Core pool — *${d.coreUnmatched}* children waiting\n` +
      `• Minis pool — *${d.minisUnmatched}* children waiting\n` +
      `• Rematch Queue — *${d.rematchCount}* (appear first in session)`
    ),
    ...(warningLines.length > 0
      ? [divider(), section(`*⚠️ Guarantee warnings today:*\n${warningLines.join("\n")}`)]
      : []),
    divider(),
    section(`<${appUrl("/matching")}|→ Open Friday Matching Mode>`),
  ];

  await sendSlack(blocks);
  logger.info("Friday matching reminder sent to Slack");
}

// ─── Weekly Summary ───────────────────────────────────────────────────────────

export async function sendWeeklySummary(): Promise<void> {
  const now = new Date();
  const weekStart = subDays(now, 6);
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const [
    newMembersResult,
    newMembersByTier,
    cancellationsResult,
    totalActiveResult,
    matchesThisWeekResult,
    unmatchedNowResult,
    rematchesResult,
    appsReceivedResult,
    appsApprovedResult,
    appsWaitlistedResult,
    appsRejectedResult,
    appsActivatedResult,
    atRiskResult,
    fundActiveResult,
  ] = await Promise.all([
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("subscription_status", "Active").gte("join_date", weekStart.toISOString()),
    supabase.from("parents").select("membership_tier").eq("subscription_status", "Active").gte("join_date", weekStart.toISOString()),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("subscription_status", "Cancelled").gte("updated_at", weekStart.toISOString()),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("subscription_status", "Active"),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("match_status", "Active").gte("match_date", weekStart.toISOString()),
    supabase.from("children").select("id", { count: "exact", head: true }).eq("match_status", "Unmatched"),
    supabase.from("children").select("id", { count: "exact", head: true }).eq("match_status", "Rematch Requested"),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).gte("created_at", weekStart.toISOString()),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Approved").gte("updated_at", weekStart.toISOString()),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Waitlisted").gte("updated_at", weekStart.toISOString()),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Rejected").gte("updated_at", weekStart.toISOString()),
    supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Active").gte("updated_at", weekStart.toISOString()),
    supabase.from("parents").select("id", { count: "exact", head: true }).eq("at_risk", true),
    supabase.from("give_a_key_applications").select("amount_disbursed").eq("application_status", "Active"),
  ]);

  const tierCounts: Record<string, number> = {};
  for (const p of newMembersByTier.data ?? []) {
    const t = p.membership_tier ?? "Unknown";
    tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  }
  const tierLine = Object.entries(tierCounts)
    .map(([t, n]) => `${t} ${n}`)
    .join(" · ") || "—";

  const newMembers = newMembersResult.count ?? 0;
  const cancellations = cancellationsResult.count ?? 0;
  const netChange = newMembers - cancellations;
  const totalActive = totalActiveResult.count ?? 0;
  const fundBalance = (fundActiveResult.data ?? []).reduce((s: number, r: { amount_disbursed: number | null }) => s + (r.amount_disbursed ?? 0), 0);

  const blocks = [
    header(`📊 Weekly Operations Summary`),
    section(`_${weekLabel}_`),
    divider(),
    section(
      `*👥 Membership*\n` +
      `  New members: *+${newMembers}* (${tierLine})\n` +
      `  Cancellations: *${cancellations}*  |  Net change: *${netChange >= 0 ? "+" : ""}${netChange}*\n` +
      `  Total active: *${totalActive}*`
    ),
    divider(),
    section(
      `*🎯 Matching*\n` +
      `  Matches made this week: *${matchesThisWeekResult.count ?? 0}*\n` +
      `  Still unmatched at end of week: *${unmatchedNowResult.count ?? 0}*\n` +
      `  Rematches in queue: *${rematchesResult.count ?? 0}*`
    ),
    divider(),
    section(
      `*🔑 Give a Key*\n` +
      `  Received *${appsReceivedResult.count ?? 0}* · Approved *${appsApprovedResult.count ?? 0}* · Waitlisted *${appsWaitlistedResult.count ?? 0}* · Rejected *${appsRejectedResult.count ?? 0}* · Activated *${appsActivatedResult.count ?? 0}*\n` +
      `  Fund balance: *$${fundBalance.toLocaleString()}*`
    ),
    divider(),
    section(
      `*❤️ Member Health*\n` +
      `  At-risk members: *${atRiskResult.count ?? 0}*`
    ),
    divider(),
    section(`_Have a good Sunday. The week starts fresh tomorrow._\n<${appUrl()}|→ Open MailDay Dashboard>`),
  ];

  await sendSlack(blocks);
  logger.info("Weekly summary sent to Slack");
}

// ─── Pack Delivery Auto-Create ────────────────────────────────────────────────

async function autoCreatePackDeliveryLog() {
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const now = new Date();
  const monthNumber = now.getMonth() + 1;
  const year = now.getFullYear();

  // Check if already exists
  const { data: existing } = await supabase.from("pack_delivery_log").select("id").eq("month_number", monthNumber).eq("year", year).maybeSingle();
  if (existing) {
    logger.info({ month: monthNumber, year }, "Pack delivery log already exists for this month — skipping auto-create");
    return;
  }

  // Count active members by tier
  const { data: parents } = await supabase.from("parents").select("membership_tier").eq("subscription_status", "Active");
  const counts = { total: 0, core: 0, minis: 0, homeschool_core: 0, homeschool_minis: 0 };
  for (const p of parents || []) {
    counts.total++;
    const tier = (p.membership_tier || "").toLowerCase();
    if (tier === "core") counts.core++;
    else if (tier === "minis") counts.minis++;
    else if (tier === "homeschool core") counts.homeschool_core++;
    else if (tier === "homeschool minis") counts.homeschool_minis++;
  }

  await supabase.from("pack_delivery_log").insert({
    month_name: MONTH_NAMES[monthNumber - 1],
    month_number: monthNumber,
    year,
    total_active_members_at_send: counts.total,
    core_members_count: counts.core,
    minis_members_count: counts.minis,
    homeschool_core_count: counts.homeschool_core,
    homeschool_minis_count: counts.homeschool_minis,
    confirmation_status: "Pending",
  });

  logger.info({ month: MONTH_NAMES[monthNumber - 1], year, total: counts.total }, "Pack delivery log auto-created for new month");
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

let scheduledJobs: ReturnType<typeof cron.schedule>[] = [];

// ─── At-risk auto-flagging ────────────────────────────────────────────────────
// Runs daily. Marks active subscribers as at_risk if they haven't opened an
// email in 45+ days (or never). Clears the flag for recently re-engaged parents.

async function runAtRiskFlagging() {
  const cutoffDate = subDays(new Date(), 45).toISOString().split("T")[0];

  const { data: toFlag } = await supabase
    .from("parents")
    .select("id")
    .eq("subscription_status", "Active")
    .eq("at_risk", false)
    .or(`last_email_open_date.is.null,last_email_open_date.lt.${cutoffDate}`);

  if (toFlag && toFlag.length > 0) {
    await supabase.from("parents").update({ at_risk: true }).in("id", toFlag.map((p) => p.id));
    logger.info({ count: toFlag.length }, "At-risk flagging: marked parents as at-risk");
  }

  const { data: toClear } = await supabase
    .from("parents")
    .select("id")
    .eq("subscription_status", "Active")
    .eq("at_risk", true)
    .gte("last_email_open_date", cutoffDate);

  if (toClear && toClear.length > 0) {
    await supabase.from("parents").update({ at_risk: false }).in("id", toClear.map((p) => p.id));
    logger.info({ count: toClear.length }, "At-risk flagging: cleared at-risk for re-engaged parents");
  }
}

export function startSlackScheduler() {
  // At-risk flagging runs independently of Slack — always schedule it
  scheduledJobs.push(
    cron.schedule("0 6 * * *", () => {
      void runAtRiskFlagging().catch((err) => logger.error({ err }, "At-risk flagging failed"));
    }, { timezone: "America/Denver" })
  );

  if (!process.env["SLACK_WEBHOOK"]) {
    logger.warn("SLACK_WEBHOOK_URL not set — Slack scheduler disabled");
    logger.info("At-risk flagging scheduled (6am daily — America/Denver)");
    return;
  }

  // Monthly pack delivery log auto-create — 6am Denver on the 1st
  scheduledJobs.push(
    cron.schedule("0 6 1 * *", () => {
      void autoCreatePackDeliveryLog().catch((err) => logger.error({ err }, "Pack delivery auto-create failed"));
    }, { timezone: "America/Denver" })
  );

  // Daily digest — 7am Denver (Mountain Time)
  scheduledJobs.push(
    cron.schedule("0 7 * * *", () => {
      void sendDailyDigest().catch((err) => logger.error({ err }, "Daily digest failed"));
    }, { timezone: "America/Denver" })
  );

  // Friday matching reminder — 8am Denver, Fridays only
  scheduledJobs.push(
    cron.schedule("0 8 * * 5", () => {
      void sendFridayReminder().catch((err) => logger.error({ err }, "Friday reminder failed"));
    }, { timezone: "America/Denver" })
  );

  // Weekly summary — 8am Denver, Sundays only
  scheduledJobs.push(
    cron.schedule("0 8 * * 0", () => {
      void sendWeeklySummary().catch((err) => logger.error({ err }, "Weekly summary failed"));
    }, { timezone: "America/Denver" })
  );

  logger.info("Slack scheduler started (daily digest 7am, Friday reminder 8am Fri, weekly summary 8am Sun — America/Denver)");
}

export function stopSlackScheduler() {
  for (const job of scheduledJobs) job.stop();
  scheduledJobs = [];
}

// ─── Admin test routes ────────────────────────────────────────────────────────

router.post("/admin/slack/test/digest", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await sendDailyDigest();
    res.json({ ok: true, message: "Daily digest sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

router.post("/admin/slack/test/friday", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await sendFridayReminder();
    res.json({ ok: true, message: "Friday reminder sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

router.post("/admin/slack/test/weekly", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await sendWeeklySummary();
    res.json({ ok: true, message: "Weekly summary sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;

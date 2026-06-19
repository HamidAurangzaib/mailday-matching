import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { differenceInDays, parseISO, startOfWeek, startOfMonth } from "date-fns";

const router: IRouter = Router();

// Pricing config — update these to match your actual subscription prices
const TIER_PRICING: Record<string, { monthly: number; annual_total: number }> = {
  "Core":              { monthly: 14,  annual_total: 168 },
  "Minis":             { monthly: 14,  annual_total: 168 },
  "Homeschool Core":   { monthly: 20,  annual_total: 240 },
  "Homeschool Minis":  { monthly: 20,  annual_total: 240 },
};

function daysToBirthday(dobStr: string): number {
  const today = new Date();
  const dob = parseISO(dobStr);
  let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate());
  return Math.ceil((next.getTime() - today.getTime()) / 86400000);
}

function turningAge(dobStr: string): number {
  const today = new Date();
  const dob = parseISO(dobStr);
  const age = today.getFullYear() - dob.getFullYear();
  const alreadyThisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) <= today;
  return alreadyThisYear ? age + 1 : age;
}

router.get("/stats/summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const weekStart = startOfWeek(now).toISOString().split("T")[0];
    const monthStart = startOfMonth(now).toISOString().split("T")[0];

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      unmatchedResult,
      matchedResult,
      activeMatchesResult,
      allChildrenResult,
      parentIdsWithChildrenResult,
      allParentsResult,
      matchesThisWeekResult,
      matchesThisMonthResult,
      activeParentsResult,
      newSubscribers7dResult,
      rematchResult,
    ] = await Promise.all([
      supabase.from("children").select("id, match_guarantee_start_date", { count: "exact" }).eq("match_status", "Unmatched"),
      supabase.from("children").select("id", { count: "exact" }).eq("match_status", "Matched"),
      supabase.from("matches").select("id", { count: "exact" }).eq("match_status", "Active"),
      supabase.from("children").select("id, tier, match_status, match_guarantee_start_date").eq("match_status", "Unmatched"),
      supabase.from("children").select("parent_id"),
      supabase.from("parents").select("id, first_name, last_name, email, created_at"),
      supabase.from("matches").select("id", { count: "exact" }).gte("match_date", weekStart),
      supabase.from("matches").select("id", { count: "exact" }).gte("match_date", monthStart),
      supabase.from("parents").select("membership_tier, billing_type").eq("subscription_status", "Active"),
      supabase.from("parents").select("id", { count: "exact" }).eq("subscription_status", "Active").gte("created_at", sevenDaysAgo),
      supabase.from("children").select("id", { count: "exact", head: true }).eq("match_status", "Rematch Requested"),
    ]);

    const unmatchedChildren = unmatchedResult.data || [];
    const allUnmatched = allChildrenResult.data || [];

    const minis_unmatched = allUnmatched.filter((c) => c.tier === "Minis" || c.tier === "Homeschool Minis").length;
    const core_unmatched = allUnmatched.filter((c) => c.tier === "Core" || c.tier === "Homeschool Core").length;

    let urgent_guarantee = 0;
    let warning_guarantee = 0;
    for (const c of unmatchedChildren) {
      if (!c.match_guarantee_start_date) continue;
      const days = differenceInDays(now, parseISO(c.match_guarantee_start_date));
      if (days >= 21) urgent_guarantee++;
      else if (days >= 18) warning_guarantee++;
    }

    const parentIdsWithChildren = new Set((parentIdsWithChildrenResult.data || []).map((c) => c.parent_id));
    const allParents = allParentsResult.data || [];
    const incomplete_onboarding = allParents.filter((p) => !parentIdsWithChildren.has(p.id)).length;

    const overdue_onboarding_list = allParents
      .filter((p) => {
        if (parentIdsWithChildren.has(p.id)) return false;
        if (!p.created_at) return true;
        return differenceInDays(now, parseISO(p.created_at)) > 7;
      })
      .map((p) => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`.trim(),
        email: p.email,
        days_since_joined: p.created_at ? differenceInDays(now, parseISO(p.created_at)) : null,
      }));

    // Revenue calculation
    const activeParents = activeParentsResult.data || [];
    const subscribersByTier: Record<string, { monthly: number; annual: number }> = {};
    let monthly_mrr = 0;
    let annual_mrr = 0;

    for (const p of activeParents) {
      const tier = p.membership_tier || "Core";
      if (!subscribersByTier[tier]) subscribersByTier[tier] = { monthly: 0, annual: 0 };
      const pricing = TIER_PRICING[tier] ?? { monthly: 25, annual_total: 240 };
      if (p.billing_type === "Annual") {
        subscribersByTier[tier].annual++;
        annual_mrr += pricing.annual_total / 12;
      } else {
        subscribersByTier[tier].monthly++;
        monthly_mrr += pricing.monthly;
      }
    }

    const total_mrr = Math.round(monthly_mrr + annual_mrr);
    const total_arr = Math.round(total_mrr * 12);
    const total_active_subscribers = activeParents.length;
    const monthly_subscribers = activeParents.filter((p) => p.billing_type !== "Annual").length;
    const annual_subscribers = activeParents.filter((p) => p.billing_type === "Annual").length;

    // Upcoming birthdays — requires migration v2 (date_of_birth column)
    // Silently skipped if column doesn't exist yet
    let upcoming_birthdays: Array<{
      id: string; name: string; date_of_birth: string; days_until: number; turning: number;
    }> = [];
    try {
      const { data: childrenWithDob } = await supabase
        .from("children")
        .select("id, child_first_name, date_of_birth")
        .not("date_of_birth", "is", null);

      for (const c of childrenWithDob ?? []) {
        if (!c.date_of_birth) continue;
        const days = daysToBirthday(c.date_of_birth);
        if (days <= 30) {
          upcoming_birthdays.push({
            id: c.id,
            name: c.child_first_name,
            date_of_birth: c.date_of_birth,
            days_until: days,
            turning: turningAge(c.date_of_birth),
          });
        }
      }
      upcoming_birthdays.sort((a, b) => a.days_until - b.days_until);
    } catch {
      // Column not yet migrated — upcoming_birthdays stays []
    }

    res.json({
      total_unmatched: unmatchedResult.count || 0,
      total_matched: matchedResult.count || 0,
      total_active_matches: activeMatchesResult.count || 0,
      minis_unmatched,
      core_unmatched,
      urgent_guarantee,
      warning_guarantee,
      incomplete_onboarding,
      overdue_onboarding_count: overdue_onboarding_list.length,
      overdue_onboarding_list,
      rematch_count: rematchResult.count ?? 0,
      matches_this_week: matchesThisWeekResult.count || 0,
      matches_this_month: matchesThisMonthResult.count || 0,
      upcoming_birthdays,
      // Revenue
      total_mrr,
      total_arr,
      total_active_subscribers,
      new_subscribers_7d: newSubscribers7dResult.count ?? 0,
      monthly_subscribers,
      annual_subscribers,
      subscribers_by_tier: subscribersByTier,
    });
  } catch (err) {
    req.log?.error({ err }, "Error fetching stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/health/summary — green/yellow/red breakdown for children and parents
router.get("/health/summary", requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const [childrenResult, parentsResult] = await Promise.all([
      supabase.from("children").select("match_status, billing_paused, safety_flag, match_guarantee_start_date"),
      supabase.from("parents").select("subscription_status, at_risk, last_email_open_date"),
    ]);

    let childGreen = 0, childYellow = 0, childRed = 0;
    for (const c of childrenResult.data ?? []) {
      if (c.safety_flag) { childRed++; continue; }
      const isUnmatchedLike = c.match_status === "Unmatched" || c.match_status === "Rematch Requested";
      let daysWaiting: number | null = null;
      let isUrgent = false, isWarning = false;
      if (isUnmatchedLike && c.match_guarantee_start_date) {
        daysWaiting = differenceInDays(now, parseISO(c.match_guarantee_start_date));
        isUrgent = daysWaiting >= 21;
        isWarning = daysWaiting >= 18;
      }
      if (isUrgent) { childRed++; continue; }
      if (c.match_status === "Rematch Requested" || c.billing_paused || isWarning ||
          (c.match_status === "Unmatched" && daysWaiting !== null && daysWaiting > 10)) {
        childYellow++; continue;
      }
      childGreen++;
    }

    let parentGreen = 0, parentYellow = 0, parentRed = 0;
    for (const p of parentsResult.data ?? []) {
      const daysSinceOpen = p.last_email_open_date
        ? differenceInDays(now, parseISO(p.last_email_open_date))
        : null;
      if (p.subscription_status === "Cancelled" || p.at_risk || (daysSinceOpen !== null && daysSinceOpen > 60)) {
        parentRed++; continue;
      }
      if (p.subscription_status === "Paused" || (daysSinceOpen !== null && daysSinceOpen > 30)) {
        parentYellow++; continue;
      }
      parentGreen++;
    }

    res.json({
      children: { green: childGreen, yellow: childYellow, red: childRed },
      parents:  { green: parentGreen,  yellow: parentYellow,  red: parentRed  },
    });
  } catch (err) {
    req.log?.error({ err }, "Error fetching health summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/stats/lifecycle-tiles — counts for the new Phase 7 dashboard tiles
router.get("/stats/lifecycle-tiles", requireAuth, async (req, res) => {
  try {
    const [pendingMatchesResult, atRiskParentsResult, poppyTasksResult] = await Promise.all([
      supabase.from("matches").select("id", { count: "exact", head: true }).eq("match_status", "Pending"),
      supabase.from("parents").select("id", { count: "exact", head: true })
        .or("at_risk.eq.true,pause_type.eq.guarantee"),
      supabase.from("lifecycle_tasks").select("id", { count: "exact", head: true })
        .eq("type", "send_poppy_card").eq("completed", false),
    ]);
    res.json({
      pending_address_confirmation: pendingMatchesResult.count ?? 0,
      at_risk_families: atRiskParentsResult.count ?? 0,
      poppy_cards_to_mail: poppyTasksResult.count ?? 0,
    });
  } catch (err) {
    req.log?.error({ err }, "Error fetching lifecycle tiles");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/action-items/count — aggregated count for sidebar badge
router.get("/action-items/count", requireAuth, async (req: AuthRequest, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      unmatchedChildren,
      parentIdsWithChildren,
      overdueParents,
      gakTasksCount,
      pendingAppsCount,
      receiptsCount,
      tremendousCount,
      flaggedChildrenCount,
      lifecycleTasksCount,
      pendingMatchesCount,
    ] = await Promise.all([
      supabase.from("children").select("match_guarantee_start_date").eq("match_status", "Unmatched"),
      supabase.from("children").select("parent_id"),
      supabase.from("parents").select("id, created_at").lte("created_at", sevenDaysAgo),
      supabase.from("give_a_key_tasks").select("id", { count: "exact", head: true }).eq("completed", false),
      supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Pending"),
      supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).not("po_box_receipt_url", "is", null).eq("receipt_verified", false),
      supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Approved").eq("tremendous_sent", false),
      isAdmin
        ? supabase.from("children").select("id", { count: "exact", head: true }).eq("safety_flag", true)
        : Promise.resolve({ count: 0 }),
      // Phase 2.3 + 2.4: lifecycle tasks (incomplete-onboarding, guarantee-breach, Poppy card, etc.)
      supabase.from("lifecycle_tasks").select("id", { count: "exact", head: true }).eq("completed", false),
      // Phase 2.5 (Block D): matches awaiting both parents' address confirmation
      supabase.from("matches").select("id", { count: "exact", head: true }).eq("match_status", "Pending"),
    ]);

    let urgent = 0, warning = 0;
    for (const c of unmatchedChildren.data ?? []) {
      if (!c.match_guarantee_start_date) continue;
      const days = differenceInDays(now, parseISO(c.match_guarantee_start_date));
      if (days >= 21) urgent++;
      else if (days >= 18) warning++;
    }

    const parentIdsSet = new Set((parentIdsWithChildren.data ?? []).map((c) => c.parent_id));
    const overdueOnboarding = (overdueParents.data ?? []).filter((p) => !parentIdsSet.has(p.id)).length;

    const gakTasks = gakTasksCount.count ?? 0;
    const pendingApps = pendingAppsCount.count ?? 0;
    const receipts = receiptsCount.count ?? 0;
    const tremendous = isAdmin ? (tremendousCount.count ?? 0) : 0;
    const flaggedChildren = isAdmin ? ((flaggedChildrenCount as { count: number | null }).count ?? 0) : 0;
    const lifecycleTasks = lifecycleTasksCount.count ?? 0;
    const pendingMatches = pendingMatchesCount.count ?? 0;

    const total = urgent + warning + overdueOnboarding + gakTasks + pendingApps + receipts + tremendous + flaggedChildren + lifecycleTasks + pendingMatches;

    res.json({ total, urgent, warning, overdue_onboarding: overdueOnboarding, gak_tasks: gakTasks, pending_apps: pendingApps, receipts_pending: receipts, tremendous_pending: tremendous, flagged_children: flaggedChildren, lifecycle_tasks: lifecycleTasks, pending_matches: pendingMatches });
  } catch (err) {
    req.log?.error({ err }, "Error fetching action items count");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

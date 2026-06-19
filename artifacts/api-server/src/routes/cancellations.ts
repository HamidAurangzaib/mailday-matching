import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import type { AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

export const REASON_CATEGORIES = [
  "Price",
  "No pen pal letter exchange",
  "Wrong fit",
  "Moving",
  "Financial hardship",
  "Forgot to cancel",
  "Seasonal",
  "Child aged out",
  "Other",
];

function calcTenureMonths(joinDate: string | null | undefined, cancelDate: string): number {
  if (!joinDate) return 0;
  const join = new Date(joinDate);
  const cancel = new Date(cancelDate);
  return Math.max(0, Math.round((cancel.getTime() - join.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

// ── GET /api/cancellations ────────────────────────────────────────────────────
router.get("/cancellations", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { tier, reason_category, billing_type, date_from, date_to, search, view } =
      req.query as Record<string, string>;

    let query = supabase
      .from("cancellations")
      .select("*, parents(first_name, last_name, email)")
      .order("cancellation_date", { ascending: false });

    if (tier) query = query.eq("tier", tier);
    if (billing_type) query = query.eq("billing_type", billing_type);
    if (date_from) query = query.gte("cancellation_date", date_from);
    if (date_to) query = query.lte("cancellation_date", date_to);

    if (reason_category === "unset") {
      query = query.is("cancellation_reason_category", null);
    } else if (reason_category) {
      query = query.eq("cancellation_reason_category", reason_category);
    }

    if (view === "unprocessed") {
      query = query.is("cancellation_reason_category", null);
    } else if (view === "save_opportunities") {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query = query.eq("save_attempted", false).gte("cancellation_date", thirtyDaysAgo.toISOString().split("T")[0]);
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Flatten parent join and optionally apply name/email search
    let rows = (data || []).map((row: Record<string, unknown>) => {
      const p = row["parents"] as Record<string, unknown> | null;
      return {
        ...row,
        parent_first_name: p?.first_name ?? null,
        parent_last_name: p?.last_name ?? null,
        parent_email: p?.email ?? null,
        parents: undefined,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        `${r["parent_first_name"] ?? ""} ${r["parent_last_name"] ?? ""} ${r["parent_email"] ?? ""}`
          .toLowerCase()
          .includes(q)
      );
    }

    res.json(rows);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/cancellations/stats ──────────────────────────────────────────────
router.get("/cancellations/stats", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const startOfQuarter = new Date(now.getFullYear(), quarterMonth, 1).toISOString().split("T")[0];

    const [monthRes, quarterRes, newMembersRes] = await Promise.all([
      supabase.from("cancellations").select("id", { count: "exact", head: true }).gte("cancellation_date", startOfMonth),
      supabase.from("cancellations").select("cancellation_reason_category").gte("cancellation_date", startOfQuarter),
      supabase.from("parents").select("id", { count: "exact", head: true }).gte("join_date", startOfMonth),
    ]);

    const cancellationsThisMonth = monthRes.count ?? 0;
    const cancellationsThisQuarter = quarterRes.data?.length ?? 0;

    const reasonCounts: Record<string, number> = {};
    for (const row of quarterRes.data || []) {
      if (row.cancellation_reason_category) {
        reasonCounts[row.cancellation_reason_category] = (reasonCounts[row.cancellation_reason_category] ?? 0) + 1;
      }
    }
    const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const newMembersThisMonth = newMembersRes.count ?? 0;
    const netMemberChangeThisMonth = newMembersThisMonth - cancellationsThisMonth;

    res.json({
      cancellations_this_month: cancellationsThisMonth,
      cancellations_this_quarter: cancellationsThisQuarter,
      top_cancellation_reason_this_quarter: topReason,
      net_member_change_this_month: netMemberChangeThisMonth,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/cancellations/trends ─────────────────────────────────────────────
router.get("/cancellations/trends", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const twelveMonthsAgoStr = twelveMonthsAgo.toISOString().split("T")[0];
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const [allRes, newMembersRes] = await Promise.all([
      supabase.from("cancellations")
        .select("cancellation_date, tier, billing_type, cancellation_reason_category, tenure_months")
        .gte("cancellation_date", twelveMonthsAgoStr),
      supabase.from("parents").select("join_date").gte("join_date", twelveMonthsAgoStr),
    ]);

    const records = allRes.data || [];

    // Build month keys for last 12 months
    const monthKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const monthlyMap: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));
    for (const r of records) {
      const key = String(r.cancellation_date).substring(0, 7);
      if (key in monthlyMap) monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
    }
    const byMonth = Object.entries(monthlyMap).map(([key, count]) => ({
      month: new Date(key + "-01").toLocaleString("default", { month: "short", year: "2-digit" }),
      count,
    }));

    // Reason breakdowns
    const reasons90: Record<string, number> = {};
    const reasons12: Record<string, number> = {};
    for (const r of records) {
      const cat = r.cancellation_reason_category || "Uncategorized";
      reasons12[cat] = (reasons12[cat] ?? 0) + 1;
      if (String(r.cancellation_date) >= ninetyDaysAgo) {
        reasons90[cat] = (reasons90[cat] ?? 0) + 1;
      }
    }
    const reasonData90 = Object.entries(reasons90).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const reasonData12 = Object.entries(reasons12).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    // Avg tenure by tier
    const tierTenure: Record<string, number[]> = {};
    for (const r of records) {
      if (!tierTenure[r.tier]) tierTenure[r.tier] = [];
      tierTenure[r.tier].push(r.tenure_months ?? 0);
    }
    const avgTenureByTier = Object.entries(tierTenure).map(([tier, months]) => ({
      tier,
      avg_tenure: Math.round((months.reduce((a, b) => a + b, 0) / months.length) * 10) / 10,
    }));

    // Net change by month
    const newMemberMap: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));
    for (const p of newMembersRes.data || []) {
      if (p.join_date) {
        const key = String(p.join_date).substring(0, 7);
        if (key in newMemberMap) newMemberMap[key] = (newMemberMap[key] ?? 0) + 1;
      }
    }
    const netChangeByMonth = monthKeys.map((key) => ({
      month: new Date(key + "-01").toLocaleString("default", { month: "short", year: "2-digit" }),
      new_members: newMemberMap[key] ?? 0,
      cancellations: monthlyMap[key] ?? 0,
      net: (newMemberMap[key] ?? 0) - (monthlyMap[key] ?? 0),
    }));

    res.json({ by_month: byMonth, reasons_90_days: reasonData90, reasons_12_months: reasonData12, avg_tenure_by_tier: avgTenureByTier, net_change_by_month: netChangeByMonth });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/cancellations/tasks ──────────────────────────────────────────────
router.get("/cancellations/tasks", requireAuth, async (_req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("cancellation_tasks")
      .select("*, cancellations(id, tier, cancellation_date, parents(first_name, last_name))")
      .eq("completed", false)
      .order("created_at", { ascending: true });

    if (error) { res.status(500).json({ error: error.message }); return; }

    const rows = (data || []).map((t: Record<string, unknown>) => {
      const c = t["cancellations"] as Record<string, unknown> | null;
      const p = c?.["parents"] as Record<string, unknown> | null;
      return {
        ...t,
        cancellations: undefined,
        parent_name: p ? `${p["first_name"]} ${p["last_name"]}` : "Unknown",
        tier: c?.["tier"] ?? null,
        cancellation_date: c?.["cancellation_date"] ?? null,
        cancellation_id: c?.["id"] ?? t["cancellation_id"],
      };
    });

    res.json(rows);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/cancellations/tasks/:id/complete ───────────────────────────────
router.patch("/cancellations/tasks/:id/complete", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { error } = await supabase.from("cancellation_tasks")
      .update({ completed: true, completed_at: new Date().toISOString(), completed_by: req.user?.email ?? "unknown" })
      .eq("id", req.params["id"]);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/cancellations/:id ────────────────────────────────────────────────
router.get("/cancellations/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [cancRes, notesRes] = await Promise.all([
      supabase.from("cancellations").select("*, parents(id, first_name, last_name, email)").eq("id", req.params["id"]).single(),
      supabase.from("cancellation_notes").select("*").eq("cancellation_id", req.params["id"]).order("created_at", { ascending: false }),
    ]);

    if (cancRes.error || !cancRes.data) { res.status(404).json({ error: "Not found" }); return; }

    const row = cancRes.data as Record<string, unknown>;
    const p = row["parents"] as Record<string, unknown> | null;
    res.json({
      ...row,
      parent_first_name: p?.["first_name"] ?? null,
      parent_last_name: p?.["last_name"] ?? null,
      parent_email: p?.["email"] ?? null,
      parent_db_id: p?.["id"] ?? null,
      parents: undefined,
      notes: notesRes.data || [],
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/cancellations/:id ──────────────────────────────────────────────
router.patch("/cancellations/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as {
      cancellation_reason_category?: string | null;
      save_attempted?: boolean;
      save_outcome?: string | null;
      save_notes?: string | null;
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("cancellation_reason_category" in body) updates["cancellation_reason_category"] = body.cancellation_reason_category;
    if ("save_attempted" in body) updates["save_attempted"] = body.save_attempted;
    if ("save_outcome" in body) updates["save_outcome"] = body.save_outcome;
    if ("save_notes" in body) updates["save_notes"] = body.save_notes;

    const { data, error } = await supabase.from("cancellations").update(updates).eq("id", req.params["id"]).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Complete review_needed tasks when category is set
    if (body.cancellation_reason_category) {
      await supabase.from("cancellation_tasks")
        .update({ completed: true, completed_at: new Date().toISOString(), completed_by: req.user?.email ?? "system" })
        .eq("cancellation_id", req.params["id"])
        .eq("type", "review_needed");
    }

    // Add system note + complete save_opportunity tasks when save attempted
    if (body.save_attempted === true) {
      await Promise.all([
        supabase.from("cancellation_notes").insert({
          cancellation_id: req.params["id"],
          note_type: "save_attempt",
          content: `Save attempted by ${req.user?.email ?? "admin"}.${body.save_notes ? ` Notes: ${body.save_notes}` : ""}`,
          created_by: req.user?.email ?? "system",
        }),
        supabase.from("cancellation_tasks")
          .update({ completed: true, completed_at: new Date().toISOString(), completed_by: req.user?.email ?? "system" })
          .eq("cancellation_id", req.params["id"])
          .eq("type", "save_opportunity"),
      ]);
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/cancellations/:id/notes ─────────────────────────────────────────
router.post("/cancellations/:id/notes", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as { content: string; note_type?: string };
    if (!body.content?.trim()) { res.status(400).json({ error: "Content required" }); return; }

    const { data, error } = await supabase.from("cancellation_notes").insert({
      cancellation_id: req.params["id"],
      note_type: body.note_type || "note",
      content: body.content.trim(),
      created_by: req.user?.email ?? "unknown",
    }).select().single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/cancellations/:id/reactivate ────────────────────────────────────
router.post("/cancellations/:id/reactivate", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data: cancellation } = await supabase.from("cancellations").select("parent_id").eq("id", req.params["id"]).single();
    if (!cancellation) { res.status(404).json({ error: "Not found" }); return; }

    const today = new Date().toISOString().split("T")[0];
    const by = req.user?.email ?? "admin";

    await Promise.all([
      supabase.from("parents").update({ subscription_status: "Active" }).eq("id", cancellation.parent_id),
      supabase.from("cancellations").update({ reactivated: true, reactivated_date: today, reactivated_by: by, updated_at: new Date().toISOString() }).eq("id", req.params["id"]),
      supabase.from("cancellation_notes").insert({ cancellation_id: req.params["id"], note_type: "reactivation", content: `Member reactivated by ${by} on ${today}.`, created_by: by }),
    ]);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export { calcTenureMonths };
export default router;

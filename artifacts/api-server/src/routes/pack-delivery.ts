import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

async function getActiveCountsByTier() {
  const { data } = await supabase.from("parents").select("membership_tier").eq("subscription_status", "Active");
  const counts = { total: 0, core: 0, minis: 0, homeschool_core: 0, homeschool_minis: 0 };
  for (const p of data || []) {
    counts.total++;
    const tier = (p.membership_tier || "").toLowerCase();
    if (tier === "core") counts.core++;
    else if (tier === "minis") counts.minis++;
    else if (tier === "homeschool core") counts.homeschool_core++;
    else if (tier === "homeschool minis") counts.homeschool_minis++;
  }
  return counts;
}

// GET /api/pack-delivery — all log records with failure counts
router.get("/pack-delivery", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { year, status } = req.query as Record<string, string>;
    let query = supabase.from("pack_delivery_log").select("*").order("year", { ascending: false }).order("month_number", { ascending: false });
    if (year) query = query.eq("year", Number(year));
    if (status) query = query.eq("confirmation_status", status);

    const { data: logs, error } = await query;
    if (error) { res.status(500).json({ error: "Failed to fetch pack delivery logs" }); return; }

    // Attach failure counts per log
    const logIds = (logs || []).map((l) => l.id);
    if (logIds.length === 0) { res.json([]); return; }

    const { data: failures } = await supabase.from("pack_delivery_failures").select("pack_delivery_log_id, resolved").in("pack_delivery_log_id", logIds);

    const failureCounts: Record<string, { total: number; unresolved: number }> = {};
    for (const f of failures || []) {
      if (!failureCounts[f.pack_delivery_log_id]) failureCounts[f.pack_delivery_log_id] = { total: 0, unresolved: 0 };
      failureCounts[f.pack_delivery_log_id].total++;
      if (!f.resolved) failureCounts[f.pack_delivery_log_id].unresolved++;
    }

    const result = (logs || []).map((l) => ({ ...l, failure_counts: failureCounts[l.id] || { total: 0, unresolved: 0 } }));
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "Error fetching pack delivery logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pack-delivery/stats — summary header stats
router.get("/pack-delivery/stats", requireAuth, async (_req: AuthRequest, res) => {
  try {
    const { data: logs } = await supabase.from("pack_delivery_log").select("delivery_emails_sent, delivery_emails_failed");
    const { count: failureCount } = await supabase.from("pack_delivery_failures").select("id", { count: "exact", head: true });

    const totalMonths = (logs || []).length;
    const totalSent = (logs || []).reduce((s, l) => s + (l.delivery_emails_sent || 0), 0);
    const totalFailed = failureCount ?? 0;
    const successRate = totalSent > 0 ? Math.round(((totalSent - totalFailed) / totalSent) * 1000) / 10 : 100;

    res.json({ total_months: totalMonths, total_sent: totalSent, total_failures: totalFailed, success_rate: successRate });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pack-delivery/current — current month record (for dashboard)
router.get("/pack-delivery/current", requireAuth, async (_req: AuthRequest, res) => {
  try {
    const now = new Date();
    const { data, error } = await supabase.from("pack_delivery_log").select("*").eq("month_number", now.getMonth() + 1).eq("year", now.getFullYear()).maybeSingle();
    if (error) { res.status(500).json({ error: "Failed" }); return; }

    if (!data) { res.json(null); return; }

    const { data: failures } = await supabase.from("pack_delivery_failures").select("resolved").eq("pack_delivery_log_id", data.id);
    const total = (failures || []).length;
    const unresolved = (failures || []).filter((f) => !f.resolved).length;

    res.json({ ...data, failure_counts: { total, unresolved } });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/pack-delivery/:id/failures — failures for one log entry
router.get("/pack-delivery/:id/failures", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("pack_delivery_failures")
      .select("*, parents(first_name, last_name, email), children(child_first_name)")
      .eq("pack_delivery_log_id", req.params.id)
      .order("created_at", { ascending: false });
    if (error) { res.status(500).json({ error: "Failed" }); return; }
    res.json(data || []);
  } catch (err) {
    req.log?.error({ err }, "Error fetching failures");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pack-delivery — create log entry (auto or manual)
router.post("/pack-delivery", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as { month_number?: number; year?: number; notes?: string };
    const now = new Date();
    const monthNumber = body.month_number ?? now.getMonth() + 1;
    const year = body.year ?? now.getFullYear();

    // Check for duplicate
    const { data: existing } = await supabase.from("pack_delivery_log").select("id").eq("month_number", monthNumber).eq("year", year).maybeSingle();
    if (existing) { res.status(409).json({ error: "Log entry already exists for this month" }); return; }

    const counts = await getActiveCountsByTier();

    const { data, error } = await supabase.from("pack_delivery_log").insert({
      month_name: MONTH_NAMES[monthNumber - 1],
      month_number: monthNumber,
      year,
      total_active_members_at_send: counts.total,
      core_members_count: counts.core,
      minis_members_count: counts.minis,
      homeschool_core_count: counts.homeschool_core,
      homeschool_minis_count: counts.homeschool_minis,
      confirmation_status: "Pending",
      notes: body.notes || null,
    }).select().single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error creating pack delivery log");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/pack-delivery/:id
router.patch("/pack-delivery/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const allowed = ["delivery_emails_sent","delivery_emails_failed","delivery_emails_manually_resent","confirmation_status","confirmed_by","confirmed_date","notes"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) { if (body[k] !== undefined) updates[k] = body[k]; }

    const { data, error } = await supabase.from("pack_delivery_log").update(updates).eq("id", req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Error updating pack delivery log");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pack-delivery/:id/failures — log a delivery failure
router.post("/pack-delivery/:id/failures", requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body as { parent_id?: string; child_id?: string; failure_reason: string };
    if (!body.failure_reason?.trim()) { res.status(400).json({ error: "failure_reason required" }); return; }

    const { data, error } = await supabase.from("pack_delivery_failures").insert({
      pack_delivery_log_id: req.params.id,
      parent_id: body.parent_id || null,
      child_id: body.child_id || null,
      failure_reason: body.failure_reason.trim(),
    }).select().single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    const { data: log } = await supabase.from("pack_delivery_log").select("delivery_emails_failed").eq("id", req.params.id).single();
    await supabase.from("pack_delivery_log").update({
      delivery_emails_failed: (log?.delivery_emails_failed || 0) + 1,
      confirmation_status: "Partial",
    }).eq("id", req.params.id);

    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error logging failure");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/pack-delivery/failures/:failureId — resolve a failure
router.patch("/pack-delivery/failures/:failureId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { resolution_notes } = req.body as { resolution_notes?: string };
    const { data: failure } = await supabase.from("pack_delivery_failures").select("pack_delivery_log_id").eq("id", req.params.failureId).single();
    if (!failure) { res.status(404).json({ error: "Not found" }); return; }

    const { data, error } = await supabase.from("pack_delivery_failures").update({
      resolved: true,
      resolved_date: new Date().toISOString().split("T")[0],
      resolved_by: req.user?.email || null,
      resolution_notes: resolution_notes || null,
    }).eq("id", req.params.failureId).select().single();

    if (error) { res.status(500).json({ error: error.message }); return; }

    // Check if all failures for this month are resolved → set to Confirmed
    const { data: remaining } = await supabase.from("pack_delivery_failures").select("id", { count: "exact", head: true }).eq("pack_delivery_log_id", failure.pack_delivery_log_id).eq("resolved", false);
    if ((remaining as { count: number } | null)?.count === 0) {
      await supabase.from("pack_delivery_log").update({ confirmation_status: "Confirmed" }).eq("id", failure.pack_delivery_log_id);
    }

    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Error resolving failure");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/pack-delivery/webhook/klaviyo — Klaviyo delivery webhook
router.post("/pack-delivery/webhook/klaviyo", async (req, res) => {
  try {
    const body = req.body as { event?: string; parent_id?: string; child_id?: string; failure_reason?: string };
    const now = new Date();

    const { data: log } = await supabase.from("pack_delivery_log").select("id, delivery_emails_sent, delivery_emails_failed").eq("month_number", now.getMonth() + 1).eq("year", now.getFullYear()).maybeSingle();
    if (!log) { res.status(404).json({ error: "No active pack delivery log for current month" }); return; }

    if (body.event === "delivered") {
      await supabase.from("pack_delivery_log").update({
        delivery_emails_sent: (log.delivery_emails_sent || 0) + 1,
        confirmation_status: "Sent",
      }).eq("id", log.id);
    } else if (body.event === "failed") {
      await supabase.from("pack_delivery_log").update({
        delivery_emails_failed: (log.delivery_emails_failed || 0) + 1,
        confirmation_status: "Partial",
      }).eq("id", log.id);
      if (body.failure_reason) {
        await supabase.from("pack_delivery_failures").insert({
          pack_delivery_log_id: log.id,
          parent_id: body.parent_id || null,
          child_id: body.child_id || null,
          failure_reason: body.failure_reason,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

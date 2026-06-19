import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

function calcCommissionOwed(conversions: number, revenuePerConversion: number, commissionRate: number): number {
  return Math.round(conversions * revenuePerConversion * (commissionRate / 100) * 100) / 100;
}

// GET /api/influencers
router.get("/influencers", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { platform, tier, outreach_status, sort } = req.query as Record<string, string>;
    let query = supabase.from("influencers").select("*");
    if (platform) query = query.eq("platform", platform);
    if (tier) query = query.eq("tier", tier);
    if (outreach_status) query = query.eq("outreach_status", outreach_status);
    if (sort === "conversions") query = query.order("conversions", { ascending: false });
    else if (sort === "follower_count") query = query.order("follower_count", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      req.log?.error({ error }, "Error fetching influencers");
      res.status(500).json({ error: "Failed to fetch influencers" });
      return;
    }
    res.json(data || []);
  } catch (err) {
    req.log?.error({ err }, "Error fetching influencers");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/influencers/stats — for dashboard Growth section
router.get("/influencers/stats", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [allResult, notesThisMonthResult] = await Promise.all([
      supabase.from("influencers").select("outreach_status, conversions, commission_owed, commission_paid"),
      supabase.from("influencer_notes").select("id", { count: "exact", head: true })
        .eq("note_type", "system")
        .ilike("content", "%conversion recorded%")
        .gte("created_at", monthStart),
    ]);

    const all = allResult.data || [];
    const active_partners = all.filter((i) => i.outreach_status === "Active Partner").length;
    const total_conversions = all.reduce((s, i) => s + (i.conversions || 0), 0);
    const total_commission_owed = all.reduce((s, i) => s + Number(i.commission_owed || 0), 0);
    const total_commission_paid = all.reduce((s, i) => s + Number(i.commission_paid || 0), 0);
    const balance_due = Math.round((total_commission_owed - total_commission_paid) * 100) / 100;
    const conversions_this_month = notesThisMonthResult.count ?? 0;

    res.json({ active_partners, total_conversions, conversions_this_month, total_commission_owed, total_commission_paid, balance_due });
  } catch (err) {
    req.log?.error({ err }, "Error fetching influencer stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/influencers/:id
router.get("/influencers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [influencerResult, notesResult, contentResult] = await Promise.all([
      supabase.from("influencers").select("*").eq("id", req.params.id).single(),
      supabase.from("influencer_notes").select("*").eq("influencer_id", req.params.id).order("created_at", { ascending: false }),
      supabase.from("influencer_content").select("*").eq("influencer_id", req.params.id).order("created_at", { ascending: false }),
    ]);
    if (influencerResult.error || !influencerResult.data) {
      res.status(404).json({ error: "Influencer not found" });
      return;
    }
    res.json({
      ...influencerResult.data,
      notes: notesResult.data || [],
      content: contentResult.data || [],
    });
  } catch (err) {
    req.log?.error({ err }, "Error fetching influencer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/influencers
router.post("/influencers", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const conversions = Number(body.conversions ?? 0);
    const revenuePerConversion = Number(body.revenue_per_conversion ?? 14);
    const commissionRate = Number(body.commission_rate ?? 0);
    const commission_owed = calcCommissionOwed(conversions, revenuePerConversion, commissionRate);

    const { data, error } = await supabase.from("influencers").insert({
      first_name: body.first_name,
      last_name: body.last_name,
      instagram_handle: body.instagram_handle || null,
      tiktok_handle: body.tiktok_handle || null,
      platform: body.platform || "Instagram",
      follower_count: Number(body.follower_count ?? 0),
      tier: body.tier || "Nano",
      affiliate_code: body.affiliate_code || null,
      affiliate_link: body.affiliate_link || null,
      clicks: Number(body.clicks ?? 0),
      conversions,
      commission_rate: commissionRate,
      revenue_per_conversion: revenuePerConversion,
      commission_owed,
      commission_paid: Number(body.commission_paid ?? 0),
      outreach_status: body.outreach_status || "Not Contacted",
      last_outreach_date: body.last_outreach_date || null,
      last_content_posted_url: body.last_content_posted_url || null,
    }).select().single();

    if (error) {
      req.log?.error({ error }, "Error creating influencer");
      res.status(500).json({ error: error.message });
      return;
    }

    // System note
    await supabase.from("influencer_notes").insert({
      influencer_id: data.id,
      note_type: "system",
      content: "Record created",
      created_by: req.user?.id || null,
    });

    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error creating influencer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/influencers/:id
router.patch("/influencers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const id = req.params.id;

    // Fetch current record for change tracking
    const { data: current } = await supabase.from("influencers").select("*").eq("id", id).single();
    if (!current) { res.status(404).json({ error: "Not found" }); return; }

    const conversions = body.conversions !== undefined ? Number(body.conversions) : current.conversions;
    const revenuePerConversion = body.revenue_per_conversion !== undefined ? Number(body.revenue_per_conversion) : Number(current.revenue_per_conversion);
    const commissionRate = body.commission_rate !== undefined ? Number(body.commission_rate) : Number(current.commission_rate);
    const commission_owed = calcCommissionOwed(conversions, revenuePerConversion, commissionRate);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      commission_owed,
    };
    const fields = ["first_name","last_name","instagram_handle","tiktok_handle","platform","follower_count","tier","affiliate_code","affiliate_link","clicks","commission_rate","revenue_per_conversion","commission_paid","outreach_status","last_outreach_date","last_content_posted_url","conversions"] as const;
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const { data, error } = await supabase.from("influencers").update(updates).eq("id", id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // System notes for key changes
    const sysNotes: string[] = [];
    if (body.outreach_status && body.outreach_status !== current.outreach_status) {
      sysNotes.push(`Outreach status changed: ${current.outreach_status} → ${body.outreach_status}`);
    }
    if (body.conversions !== undefined && Number(body.conversions) > current.conversions) {
      sysNotes.push(`Conversion recorded (total: ${body.conversions})`);
    }
    if (body.commission_paid !== undefined && Number(body.commission_paid) > Number(current.commission_paid)) {
      const paid = Number(body.commission_paid) - Number(current.commission_paid);
      sysNotes.push(`Commission paid: $${paid.toFixed(2)} (total paid: $${Number(body.commission_paid).toFixed(2)})`);
    }
    for (const note of sysNotes) {
      await supabase.from("influencer_notes").insert({ influencer_id: id, note_type: "system", content: note, created_by: req.user?.id || null });
    }

    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Error updating influencer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/influencers/:id
router.delete("/influencers/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { error } = await supabase.from("influencers").delete().eq("id", req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(204).send();
  } catch (err) {
    req.log?.error({ err }, "Error deleting influencer");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/influencers/:id/notes
router.post("/influencers/:id/notes", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { content } = req.body as { content: string };
    if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }
    const { data, error } = await supabase.from("influencer_notes").insert({
      influencer_id: req.params.id,
      note_type: "note",
      content: content.trim(),
      created_by: req.user?.id || null,
    }).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error adding note");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/influencers/:id/content
router.post("/influencers/:id/content", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { url } = req.body as { url: string };
    if (!url?.trim()) { res.status(400).json({ error: "URL required" }); return; }
    const { data, error } = await supabase.from("influencer_content").insert({
      influencer_id: req.params.id,
      url: url.trim(),
    }).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error adding content URL");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/influencers/content/:contentId
router.delete("/influencers/content/:contentId", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { error } = await supabase.from("influencer_content").delete().eq("id", req.params.contentId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(204).send();
  } catch (err) {
    req.log?.error({ err }, "Error deleting content URL");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/influencers/affiliate/track — capture affiliate code at signup
//
// Security: this endpoint mutates influencer payout records, so it MUST NOT be
// callable by arbitrary internet visitors. We require a shared secret in the
// X-MailDay-Secret header. Configure AFFILIATE_TRACKING_SECRET in the server
// environment and have your Shopify webhook / checkout script send the same
// value. If the secret is not configured at all, the endpoint refuses to run.
// See audit report §3.5.
router.post("/influencers/affiliate/track", async (req, res) => {
  try {
    const expected = process.env["AFFILIATE_TRACKING_SECRET"];
    if (!expected) {
      req.log?.error("AFFILIATE_TRACKING_SECRET not configured — refusing affiliate tracking");
      res.status(503).json({ error: "Affiliate tracking not configured" });
      return;
    }
    const provided = req.headers["x-mailday-secret"] as string | undefined;
    if (!provided || provided !== expected) {
      req.log?.warn("Affiliate tracking: missing or invalid X-MailDay-Secret header");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { affiliate_code, parent_id } = req.body as { affiliate_code: string; parent_id?: string };
    if (!affiliate_code?.trim()) { res.status(400).json({ error: "affiliate_code required" }); return; }

    const { data: influencer } = await supabase.from("influencers").select("id, conversions, revenue_per_conversion, commission_rate").eq("affiliate_code", affiliate_code.trim()).single();
    if (!influencer) { res.status(404).json({ error: "Unknown affiliate code" }); return; }

    const newConversions = (influencer.conversions || 0) + 1;
    const commission_owed = calcCommissionOwed(newConversions, Number(influencer.revenue_per_conversion), Number(influencer.commission_rate));

    await Promise.all([
      supabase.from("influencers").update({ conversions: newConversions, commission_owed, updated_at: new Date().toISOString() }).eq("id", influencer.id),
      supabase.from("influencer_notes").insert({ influencer_id: influencer.id, note_type: "system", content: `Conversion recorded (total: ${newConversions})${parent_id ? ` — parent ID: ${parent_id}` : ""}` }),
      parent_id ? supabase.from("parents").update({ affiliate_code: affiliate_code.trim() }).eq("id", parent_id) : Promise.resolve(),
    ]);

    res.json({ success: true, influencer_id: influencer.id, conversions: newConversions });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

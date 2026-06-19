import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

// GET /activity — recent match events for the activity feed
router.get("/activity", requireAuth, async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || "20"), 50);

    const { data: matches, error } = await supabase
      .from("matches")
      .select("id, match_date, match_status, created_at, shared_interests, child_a_id, child_b_id, close_reason")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      req.log?.error({ error }, "Error fetching activity");
      res.status(500).json({ error: "Failed to fetch activity" });
      return;
    }

    if (!matches || matches.length === 0) {
      res.json([]);
      return;
    }

    // Batch-fetch child names
    const childIds = [...new Set([
      ...matches.map((m) => m.child_a_id),
      ...matches.map((m) => m.child_b_id),
    ])];

    const { data: children } = await supabase
      .from("children")
      .select("id, child_first_name, tier")
      .in("id", childIds);

    const childMap = new Map((children || []).map((c) => [c.id, { name: c.child_first_name, tier: c.tier }]));

    const events = matches.map((m) => {
      const childA = childMap.get(m.child_a_id);
      const childB = childMap.get(m.child_b_id);
      const nameA = childA?.name || "Unknown";
      const nameB = childB?.name || "Unknown";

      return {
        id: m.id,
        type: m.match_status === "Closed" ? "match_closed" : "match_created",
        description: m.match_status === "Closed"
          ? `${nameA} & ${nameB}'s match was closed`
          : `${nameA} matched with ${nameB}`,
        child_a_name: nameA,
        child_b_name: nameB,
        status: m.match_status,
        close_reason: m.close_reason ?? null,
        shared_interests: (m.shared_interests || []).slice(0, 3),
        timestamp: m.created_at,
        match_date: m.match_date,
      };
    });

    res.json(events);
  } catch (err) {
    req.log?.error({ err }, "Error fetching activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

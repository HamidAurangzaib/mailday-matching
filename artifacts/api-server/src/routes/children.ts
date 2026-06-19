import { Router, type IRouter } from "express";
import { differenceInDays, parseISO } from "date-fns";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

function computeGuaranteeStatus(child: Record<string, unknown>): {
  days_waiting: number | null;
  guarantee_status: "ok" | "warning" | "urgent" | null;
} {
  if (!child.match_guarantee_start_date) {
    return { days_waiting: null, guarantee_status: null };
  }
  const startDate = parseISO(child.match_guarantee_start_date as string);
  const days_waiting = differenceInDays(new Date(), startDate);
  let guarantee_status: "ok" | "warning" | "urgent" = "ok";
  if (days_waiting >= 21) {
    guarantee_status = "urgent";
  } else if (days_waiting >= 18) {
    guarantee_status = "warning";
  }
  return { days_waiting, guarantee_status };
}

// Batched lookup: for a set of child IDs, return a map of childId → active/pending match info.
// Used by both /children and /children/unmatched so the UI can render Pending Address
// + Tier Mismatch pills without an N+1 round-trip.
async function fetchActiveMatchByChildId(
  childIds: string[]
): Promise<Map<string, { id: string; match_status: string; tier_mismatch_flagged: boolean | null }>> {
  const map = new Map<string, { id: string; match_status: string; tier_mismatch_flagged: boolean | null }>();
  if (childIds.length === 0) return map;
  const { data } = await supabase
    .from("matches")
    .select("id, child_a_id, child_b_id, match_status, tier_mismatch_flagged")
    .in("match_status", ["Pending", "Active"])
    .or(`child_a_id.in.(${childIds.join(",")}),child_b_id.in.(${childIds.join(",")})`);
  for (const m of (data ?? []) as Array<{
    id: string; child_a_id: string | null; child_b_id: string | null;
    match_status: string; tier_mismatch_flagged: boolean | null;
  }>) {
    const info = { id: m.id, match_status: m.match_status, tier_mismatch_flagged: m.tier_mismatch_flagged };
    if (m.child_a_id) map.set(m.child_a_id, info);
    if (m.child_b_id) map.set(m.child_b_id, info);
  }
  return map;
}

async function sanitizeAndEnrich(
  child: Record<string, unknown>,
  role: string | undefined,
  includeParent: boolean
): Promise<Record<string, unknown>> {
  const { days_waiting, guarantee_status } = computeGuaranteeStatus(child);
  let enriched: Record<string, unknown> = { ...child, days_waiting, guarantee_status };

  if (role !== "admin") {
    const { safety_flag, internal_notes, ...rest } = enriched;
    void safety_flag;
    void internal_notes;
    enriched = rest;
  }

  if (includeParent && child.parent_id) {
    const { data: parent } = await supabase
      .from("parents")
      .select("*")
      .eq("id", child.parent_id)
      .single();

    if (parent) {
      let sanitizedParent: Record<string, unknown> = { ...parent };
      if (role !== "admin") {
        const { mailing_address, internal_notes, ...rest } = sanitizedParent;
        void mailing_address;
        void internal_notes;
        sanitizedParent = rest;
      }
      enriched.parent = sanitizedParent;
    }
  }

  return enriched;
}

// GET /children/unmatched
router.get("/children/unmatched", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { data: children, error } = await supabase
      .from("children")
      .select("*, parents(*)")
      .in("match_status", ["Unmatched", "Rematch Requested"])
      .order("match_guarantee_start_date");

    if (error) {
      req.log?.error({ error }, "Error fetching unmatched children");
      res.status(500).json({ error: "Failed to fetch unmatched children" });
      return;
    }

    const childIds = (children || []).map((c) => (c as { id: string }).id);
    const activeMatchMap = await fetchActiveMatchByChildId(childIds);

    const enriched = await Promise.all(
      (children || []).map(async (c) => {
        const { parents: parent, ...childData } = c as Record<string, unknown> & { parents?: Record<string, unknown> };
        const { days_waiting, guarantee_status } = computeGuaranteeStatus(childData);
        const active_match = activeMatchMap.get(childData.id as string) ?? null;

        let enrichedChild: Record<string, unknown> = { ...childData, days_waiting, guarantee_status, active_match };
        if (req.user?.role !== "admin") {
          const { safety_flag, internal_notes, ...rest } = enrichedChild;
          void safety_flag;
          void internal_notes;
          enrichedChild = rest;
        }

        let sanitizedParent: Record<string, unknown> = { ...parent } as Record<string, unknown>;
        if (req.user?.role !== "admin" && sanitizedParent) {
          const { mailing_address, internal_notes, ...rest } = sanitizedParent;
          void mailing_address;
          void internal_notes;
          sanitizedParent = rest;
        }

        enrichedChild.parent = sanitizedParent;

        // Auto-pause billing at 21 days (and trigger webhooks — placeholder)
        if (guarantee_status === "urgent" && !childData.billing_paused) {
          await supabase
            .from("children")
            .update({ billing_paused: true })
            .eq("id", childData.id);
          enrichedChild.billing_paused = true;
          // TODO: Trigger Klaviyo webhook when KLAVIYO_WEBHOOK_URL is set
        }

        return enrichedChild;
      })
    );

    // Group by age band
    const minis_pool = enriched.filter((c) => {
      const tier = c.tier as string;
      return tier === "Minis" || tier === "Homeschool Minis";
    });
    const core_pool = enriched.filter((c) => {
      const tier = c.tier as string;
      return tier === "Core" || tier === "Homeschool Core";
    });

    const urgent_count = enriched.filter((c) => c.guarantee_status === "urgent").length;
    const warning_count = enriched.filter((c) => c.guarantee_status === "warning").length;

    res.json({ minis_pool, core_pool, urgent_count, warning_count });
  } catch (err) {
    req.log?.error({ err }, "Error fetching unmatched children");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /children/flagged — admin only, returns children with safety_flag=true.
// MUST appear before /children/:id so Express doesn't match "flagged" as a UUID.
router.get("/children/flagged", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("children")
      .select("id, child_first_name, age, tier, parent_id")
      .eq("safety_flag", true)
      .order("child_first_name");
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  } catch (err) {
    req.log?.error({ err }, "Error fetching flagged children");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /children/incomplete-onboarding
router.get("/children/incomplete-onboarding", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    // Get all parent IDs that have at least one child
    const { data: childParentIds, error: cpErr } = await supabase
      .from("children")
      .select("parent_id");

    if (cpErr) {
      req.log?.error({ cpErr }, "Error fetching child parent IDs");
      res.status(500).json({ error: "Failed to fetch data" });
      return;
    }

    const parentIdsWithChildren = [...new Set((childParentIds || []).map((c) => c.parent_id))];

    let query = supabase
      .from("parents")
      .select("id, first_name, last_name, email, state, membership_tier, subscription_status, join_date, created_at")
      .order("created_at");

    if (parentIdsWithChildren.length > 0) {
      query = query.not("id", "in", `(${parentIdsWithChildren.map((id) => `"${id}"`).join(",")})`);
    }

    const { data: parents, error } = await query;

    if (error) {
      req.log?.error({ error }, "Error fetching incomplete onboarding parents");
      res.status(500).json({ error: "Failed to fetch incomplete onboarding" });
      return;
    }

    const enriched = (parents || []).map((p: Record<string, unknown>) => {
      const createdAt = p.created_at ? parseISO(p.created_at as string) : null;
      const days_since_join = createdAt ? differenceInDays(new Date(), createdAt) : null;
      return { ...p, days_since_join };
    });

    res.json(enriched);
  } catch (err) {
    req.log?.error({ err }, "Error fetching incomplete onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /children
router.get("/children", requireAuth, async (req: AuthRequest, res) => {
  try {
    let query = supabase
      .from("children")
      .select("*, parents(*)")
      .order("created_at", { ascending: false });

    if (req.query.match_status) {
      query = query.eq("match_status", req.query.match_status as string);
    }
    if (req.query.tier) {
      query = query.eq("tier", req.query.tier as string);
    }

    const { data, error } = await query;
    if (error) {
      req.log?.error({ error }, "Error fetching children");
      res.status(500).json({ error: "Failed to fetch children" });
      return;
    }

    const childIds = (data || []).map((c) => (c as { id: string }).id);
    const activeMatchMap = await fetchActiveMatchByChildId(childIds);

    const enriched = (data || []).map((c: Record<string, unknown> & { parents?: Record<string, unknown> }) => {
      const { parents: parent, ...childData } = c;
      const { days_waiting, guarantee_status } = computeGuaranteeStatus(childData);
      const active_match = activeMatchMap.get(childData.id as string) ?? null;
      let enrichedChild: Record<string, unknown> = { ...childData, days_waiting, guarantee_status, active_match };
      if (req.user?.role !== "admin") {
        const { safety_flag, internal_notes, ...rest } = enrichedChild;
        void safety_flag;
        void internal_notes;
        enrichedChild = rest;
      }
      let sanitizedParent: Record<string, unknown> = { ...parent } as Record<string, unknown>;
      if (req.user?.role !== "admin") {
        const { mailing_address, internal_notes, ...rest } = sanitizedParent;
        void mailing_address;
        void internal_notes;
        sanitizedParent = rest;
      }
      enrichedChild.parent = sanitizedParent;
      return enrichedChild;
    });

    res.json(enriched);
  } catch (err) {
    req.log?.error({ err }, "Error fetching children");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /children
router.post("/children", requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body;
    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("children")
      .insert({
        parent_id: body.parent_id,
        child_first_name: body.child_first_name,
        age: body.age,
        tier: body.tier,
        interests: body.interests || [],
        homeschool_edition: body.homeschool_edition ?? false,
        homeschool_tier: body.homeschool_tier,
        homeschool_approach: body.homeschool_approach,
        match_status: "Unmatched",
        rematch_count: 0,
        match_guarantee_start_date: today,
        billing_paused: false,
        safety_flag: body.safety_flag ?? false,
        internal_notes: body.internal_notes,
        created_date: today,
      })
      .select()
      .single();

    if (error) {
      req.log?.error({ error }, "Error creating child");
      res.status(500).json({ error: "Failed to create child" });
      return;
    }

    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error creating child");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /children/:id
router.get("/children/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("children")
      .select("*, parents(*)")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Child not found" });
      return;
    }

    const enriched = await sanitizeAndEnrich(
      data as Record<string, unknown>,
      req.user?.role,
      false
    );
    const { parents: parent, ...childData } = data as Record<string, unknown> & { parents?: Record<string, unknown> };
    enriched.parent = parent;

    // If matched, look up the match record and include the pen pal's basic info
    const child = data as Record<string, unknown>;
    if (child.match_status === "Matched") {
      const { data: matchRow } = await supabase
        .from("matches")
        .select("id, child_a_id, child_b_id, match_date, match_status")
        .or(`child_a_id.eq.${req.params.id},child_b_id.eq.${req.params.id}`)
        .order("match_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (matchRow) {
        const m = matchRow as { id: string; child_a_id: string; child_b_id: string; match_date: string; match_status: string };
        const partnerId = m.child_a_id === req.params.id ? m.child_b_id : m.child_a_id;
        const { data: partnerData } = await supabase
          .from("children")
          .select("id, child_first_name, age, tier, interests, parents(id, first_name, last_name, email, state, membership_tier)")
          .eq("id", partnerId)
          .single();
        if (partnerData) {
          const { parents: partnerParent, ...partnerChild } = partnerData as unknown as Record<string, unknown> & { parents?: Record<string, unknown> };
          enriched.pen_pal = {
            match_id: m.id,
            match_date: m.match_date,
            ...partnerChild,
            parent: partnerParent ?? null,
          };
        }
      } else {
        // Child is marked Matched but no match record found in DB
        // (e.g. legacy/seeded data). Flag so UI can show a placeholder.
        enriched.pen_pal_missing = true;
      }
    }

    res.json({ ...childData, ...enriched, parent });
  } catch (err) {
    req.log?.error({ err }, "Error fetching child");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /children/:id
router.patch("/children/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body;
    const updateFields: Record<string, unknown> = {};

    const allowedFields = [
      "child_first_name", "age", "date_of_birth", "tier", "interests",
      "homeschool_edition", "homeschool_tier", "homeschool_approach",
      "match_status", "rematch_count", "match_guarantee_start_date",
      "billing_paused",
    ];

    const adminOnlyFields = ["safety_flag", "internal_notes"];

    for (const field of allowedFields) {
      if (body[field] !== undefined) updateFields[field] = body[field];
    }

    if (req.user?.role === "admin") {
      for (const field of adminOnlyFields) {
        if (body[field] !== undefined) updateFields[field] = body[field];
      }
    }

    // Reset guarantee clock on rematch
    if (body.match_status === "Rematch Requested") {
      updateFields.match_guarantee_start_date = new Date().toISOString().split("T")[0];
      // Increment rematch count
      const { data: current } = await supabase
        .from("children")
        .select("rematch_count")
        .eq("id", req.params.id)
        .single();
      if (current) {
        updateFields.rematch_count = ((current.rematch_count as number) || 0) + 1;
      }
    }

    const { data, error } = await supabase
      .from("children")
      .update(updateFields)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Child not found or update failed" });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Error updating child");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /children/:id — admin only, removes child and their match records
router.delete("/children/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Find partner before deleting, so we can update their status
    const { data: matchRows } = await supabase
      .from("matches")
      .select("child_a_id, child_b_id")
      .or(`child_a_id.eq.${id},child_b_id.eq.${id}`);

    const partnerIds: string[] = [];
    for (const row of matchRows ?? []) {
      const partnerId = row.child_a_id === id ? row.child_b_id : row.child_a_id;
      if (partnerId) partnerIds.push(partnerId);
    }

    // Remove any matches this child is part of
    await supabase
      .from("matches")
      .delete()
      .or(`child_a_id.eq.${id},child_b_id.eq.${id}`);

    // Reset partner's match_status so they re-enter the queue
    if (partnerIds.length > 0) {
      await supabase
        .from("children")
        .update({
          match_status: "Rematch Requested",
          match_guarantee_start_date: new Date().toISOString().split("T")[0],
        })
        .in("id", partnerIds);
    }

    // Delete the child record
    const { error } = await supabase
      .from("children")
      .delete()
      .eq("id", id);

    if (error) {
      req.log?.error({ error }, "Error deleting child");
      res.status(500).json({ error: "Failed to delete child record" });
      return;
    }

    req.log?.info({ childId: id, deletedBy: req.user?.id }, "Child record deleted");
    res.json({ success: true });
  } catch (err) {
    req.log?.error({ err }, "Error deleting child");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

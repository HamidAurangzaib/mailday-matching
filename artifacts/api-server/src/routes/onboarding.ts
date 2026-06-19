import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { differenceInDays, parseISO } from "date-fns";
import { computeAge, computeTier } from "../lib/age.js";

const router: IRouter = Router();

// Onboarding links expire 30 days after the parent record is created (per the
// lifecycle map; also closes audit gap §4.7). The token is created with the
// parent row, so `created_at` is the issue time.
const ONBOARDING_TOKEN_TTL_DAYS = 30;

// GET /api/onboarding/:token — public, returns parent info for prefill
router.get("/onboarding/:token", async (req, res) => {
  try {
    const { data: parent, error } = await supabase
      .from("parents")
      .select("id, first_name, last_name, email, membership_tier, state, created_at")
      .eq("onboarding_token", req.params.token)
      .single();

    if (error || !parent) {
      res.status(404).json({ error: "Invalid or expired onboarding link" });
      return;
    }

    // 30-day expiry check
    if (parent.created_at) {
      const age = differenceInDays(new Date(), parseISO(parent.created_at as string));
      if (age > ONBOARDING_TOKEN_TTL_DAYS) {
        res.status(410).json({
          error: "This onboarding link has expired. Please contact MailDay to receive a new one.",
        });
        return;
      }
    }

    // Don't leak created_at to the client (used only for the expiry check)
    const { created_at, ...safeParent } = parent as Record<string, unknown>;
    void created_at;
    res.json(safeParent);
  } catch (err) {
    req.log?.error({ err }, "Error fetching onboarding parent");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/onboarding/:token/child — public, submits child info
//
// Per the lifecycle map: age MUST be derived from date_of_birth so kids age
// out of Minis as they grow. We require DOB and reject the old age-only path.
// We still write the computed age into `children.age` for backward compatibility
// with code that reads that column (matching, stats); Phase 3.5 introduces the
// aging-out cron that keeps it correct over time.
router.post("/onboarding/:token/child", async (req, res) => {
  try {
    const { data: parent, error: parentErr } = await supabase
      .from("parents")
      .select("id, membership_tier, created_at")
      .eq("onboarding_token", req.params.token)
      .single();

    if (parentErr || !parent) {
      res.status(404).json({ error: "Invalid or expired onboarding link" });
      return;
    }

    // Re-check 30-day expiry on submit (GET expiry guards the form load, but a
    // window left open for a month shouldn't be able to submit either).
    if (parent.created_at) {
      const age = differenceInDays(new Date(), parseISO(parent.created_at as string));
      if (age > ONBOARDING_TOKEN_TTL_DAYS) {
        res.status(410).json({
          error: "This onboarding link has expired. Please contact MailDay to receive a new one.",
        });
        return;
      }
    }

    const body = req.body;

    if (!body.child_first_name || typeof body.child_first_name !== "string") {
      res.status(400).json({ error: "child_first_name is required" });
      return;
    }

    if (!body.date_of_birth || typeof body.date_of_birth !== "string") {
      res.status(400).json({ error: "date_of_birth is required (YYYY-MM-DD)" });
      return;
    }

    const childAge = computeAge(body.date_of_birth);
    if (childAge === null || childAge < 1 || childAge > 18) {
      res.status(400).json({ error: "Child must be between 1 and 18 years old" });
      return;
    }

    // Tier: use parent's tier as homeschool/non-homeschool hint; let computeTier
    // pick Core vs Minis from the actual age.
    const parentTier = parent.membership_tier as string | null;
    const computedTier = computeTier(childAge, parentTier ?? "Core");
    if (!computedTier) {
      res.status(400).json({ error: "Child age must fall within a supported tier (3–12 years)" });
      return;
    }
    // Allow explicit override only if it's a valid tier value.
    const validTiers = ["Core", "Minis", "Homeschool Core", "Homeschool Minis"];
    const tier = body.tier && validTiers.includes(body.tier) ? body.tier : computedTier;

    const interests: string[] = Array.isArray(body.interests) ? body.interests.slice(0, 10) : [];

    const today = new Date().toISOString().split("T")[0];

    const { data: child, error } = await supabase
      .from("children")
      .insert({
        parent_id: parent.id,
        child_first_name: body.child_first_name.trim(),
        age: childAge,                  // legacy column, kept in sync with DOB on insert
        date_of_birth: body.date_of_birth,
        tier,
        interests,
        homeschool_edition: body.homeschool_edition ?? false,
        homeschool_tier: body.homeschool_tier,
        homeschool_approach: body.homeschool_approach,
        match_status: "Unmatched",
        rematch_count: 0,
        match_guarantee_start_date: today,
        billing_paused: false,
        safety_flag: false,
        created_date: today,
      })
      .select("id, child_first_name, tier")
      .single();

    if (error || !child) {
      req.log?.error({ error }, "Error creating child via onboarding");
      res.status(500).json({ error: "Failed to save your information. Please try again." });
      return;
    }

    req.log?.info(
      { childId: child.id, parentId: parent.id, tier, age: childAge },
      "Child created via onboarding form",
    );
    res.status(201).json({ success: true, child_first_name: child.child_first_name });
  } catch (err) {
    req.log?.error({ err }, "Error processing onboarding submission");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

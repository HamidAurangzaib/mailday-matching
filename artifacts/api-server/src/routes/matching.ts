import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "../lib/supabase.js";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { differenceInDays, parseISO } from "date-fns";
import { computeSubscriptionMonth } from "../lib/subscription.js";

const router: IRouter = Router();

const INTERESTS = [
  "Soccer", "Reading", "Drawing", "Music", "Science", "Animals", "Dance",
  "Basketball", "Video Games", "Math", "Robotics", "Cooking", "Baking",
  "Crafts", "Swimming", "Puzzles", "Board Games", "Photography", "Travel",
  "Dinosaurs", "Painting", "Hiking", "Gardening", "Pets", "Nature",
  "Lego", "Theater", "Writing",
];

function computeDaysWaiting(child: Record<string, unknown>): number | null {
  if (!child.match_guarantee_start_date) return null;
  return differenceInDays(new Date(), parseISO(child.match_guarantee_start_date as string));
}

function getGuaranteeStatus(days: number | null): "ok" | "warning" | "urgent" | null {
  if (days === null) return null;
  if (days >= 21) return "urgent";
  if (days >= 18) return "warning";
  return "ok";
}

router.post("/matching/run", requireAuth, async (req: AuthRequest, res) => {
  try {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
      return;
    }

    // Fetch all unmatched children with parent data. Phase 3.1: include
    // 'Rematch Requested' children and rank rematch_priority=true (orphans
    // from a dissolved match) ahead of new arrivals. Phase 3.8: skip
    // billing-paused children — their family is on hold by choice or by
    // guarantee. We don't pair a child to a paused family on either side.
    const { data: children, error } = await supabase
      .from("children")
      .select("*, parents(*)")
      .in("match_status", ["Unmatched", "Rematch Requested"])
      .eq("billing_paused", false)
      .order("rematch_priority", { ascending: false })
      .order("match_guarantee_start_date");

    if (error) {
      req.log?.error({ error }, "Error fetching unmatched children for matching");
      res.status(500).json({ error: "Failed to fetch unmatched children" });
      return;
    }

    if (!children || children.length < 2) {
      res.json({ suggestions: [], total_unmatched: children?.length || 0, no_match_found: [] });
      return;
    }

    // Get previous matches to avoid re-matching
    const childIds = children.map((c) => c.id);
    const { data: previousMatches } = await supabase
      .from("matches")
      .select("child_a_id, child_b_id")
      .or(`child_a_id.in.(${childIds.join(",")}),child_b_id.in.(${childIds.join(",")})`);

    const previousPairs = new Set<string>(
      (previousMatches || []).map((m) => [m.child_a_id, m.child_b_id].sort().join("|"))
    );

    // Build the prompt for Claude
    const childrenForClaude = children.map((c) => ({
      id: c.id,
      name: c.child_first_name,
      age: c.age,
      tier: c.tier,
      interests: c.interests || [],
      state: (c as Record<string, unknown> & { parents?: { state?: string } }).parents?.state || "Unknown",
      homeschool_edition: c.homeschool_edition,
      days_waiting: computeDaysWaiting(c as Record<string, unknown>),
      // Phase 3.1: orphans get priority. Surface this to Claude.
      rematch_priority: Boolean((c as Record<string, unknown>)["rematch_priority"]),
      // Phase 7 (same-month preference): the child's per-child subscription month
      // (counts from their own created_date). Same month = same monthly pack +
      // writing mission, so prefer pairing equal months when possible.
      subscription_month: (c as Record<string, unknown>)["created_date"]
        ? computeSubscriptionMonth((c as Record<string, unknown>)["created_date"] as string)
        : null,
    }));

    const prompt = `You are a pen pal matching specialist for a children's membership program called MailDay. Your job is to suggest the best possible pen pal matches from the unmatched children below.

MATCHING RULES (follow strictly):
1. Age bands: Core tier (Core + Homeschool Core, ages 6-12) ONLY match with each other. Minis tier (Minis + Homeschool Minis, ages 3-6) ONLY match with each other. Never cross bands.
2. Age proximity: Ideal = within 1 year. Acceptable = within 2 years. NEVER more than 2 years apart.
3. Maximize shared interests — more overlap = better match.
4. Geographic diversity is a soft preference — different states preferred but never required.
5. NEVER match children who have been previously matched.
6. PRIORITY: any child with rematch_priority=true is an "orphan" — their previous pen pal vanished through no fault of their own. Pair these children first, before any others.
7. SAME-MONTH PREFERENCE (soft): prefer pairing children with the SAME subscription_month — they receive the same monthly pack and the same writing mission, so they share an adventure. Try same-month pairs first. This is ONLY a preference: never break rules 1-2 (age band / age proximity) to achieve it. If a child has no valid same-month partner, match them with the best available partner regardless of month — do not leave them unmatched just to wait for a same-month option.

Previously matched pairs (do NOT suggest these): ${previousPairs.size > 0 ? [...previousPairs].join(", ") : "None"}

UNMATCHED CHILDREN:
${JSON.stringify(childrenForClaude, null, 2)}

VALID INTERESTS LIST: ${INTERESTS.join(", ")}

Return ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "suggestions": [
    {
      "child_a_id": "uuid",
      "child_b_id": "uuid",
      "shared_interests": ["Interest1", "Interest2"],
      "confidence_score": 8,
      "reasoning": "Brief explanation of why this is a good match"
    }
  ]
}

Rules for your response:
- Each child should appear in at most ONE suggestion (one-to-one matching only)
- Only suggest pairs that meet ALL the hard rules above
- Rank suggestions by quality (best first)
- shared_interests must only include items from the valid interests list
- confidence_score is 1-10 (10 = perfect match)
- If no valid match exists for a child, simply omit them from suggestions`;

    const anthropic = new Anthropic({ apiKey });

    let claudeResponse: string;
    try {
      const message = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      claudeResponse = (message.content[0] as { type: string; text: string }).text;
    } catch (claudeErr) {
      req.log?.error({ claudeErr }, "Claude API error");
      res.status(500).json({ error: "AI matching service unavailable" });
      return;
    }

    // Parse Claude's response
    let parsed: { suggestions: Array<{ child_a_id: string; child_b_id: string; shared_interests: string[]; confidence_score: number; reasoning: string }> };
    try {
      // Strip any markdown code fences if present
      const cleanJson = claudeResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      req.log?.error({ parseErr, claudeResponse }, "Failed to parse Claude response");
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    // Build a lookup map for children
    const childMap = new Map<string, Record<string, unknown>>();
    for (const c of children) {
      const { parents: parent, ...childData } = c as Record<string, unknown> & { parents?: Record<string, unknown> };
      const days_waiting = computeDaysWaiting(childData);
      childMap.set(c.id, {
        ...childData,
        parent: parent || {},
        days_waiting,
        guarantee_status: getGuaranteeStatus(days_waiting),
      });
    }

    // Enrich suggestions with child data
    const enrichedSuggestions = parsed.suggestions
      .filter((s) => childMap.has(s.child_a_id) && childMap.has(s.child_b_id))
      .map((s) => ({
        ...s,
        child_a: childMap.get(s.child_a_id),
        child_b: childMap.get(s.child_b_id),
      }));

    // Find children with no match
    const matchedIds = new Set<string>(
      parsed.suggestions.flatMap((s) => [s.child_a_id, s.child_b_id])
    );
    const no_match_found = children
      .filter((c) => !matchedIds.has(c.id))
      .map((c) => {
        const { parents: parent, ...childData } = c as Record<string, unknown> & { parents?: Record<string, unknown> };
        const days_waiting = computeDaysWaiting(childData);
        return {
          ...childData,
          parent: parent || {},
          days_waiting,
          guarantee_status: getGuaranteeStatus(days_waiting),
        };
      });

    res.json({
      suggestions: enrichedSuggestions,
      total_unmatched: children.length,
      no_match_found,
    });
  } catch (err) {
    req.log?.error({ err }, "Error running matching");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

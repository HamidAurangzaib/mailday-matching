import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

// A1 (attorney-required): admin visibility of outstanding address changes.
// A change isn't applied until the parent clicks the emailed link, so anything
// listed here is a *proposed* change awaiting confirmation. Shows old → new so a
// parent (or admin) could spot an unwanted redirect. Never exposes the token
// itself (that's the secret confirm link).
router.get("/admin/pending-address-changes", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const nowIso = new Date().toISOString();
    const { data: tokens, error } = await supabase
      .from("confirmation_tokens")
      .select("parent_id, email, payload, created_at, expires_at")
      .eq("type", "address_change")
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });

    if (error) {
      req.log?.error({ error }, "Error loading pending address changes");
      res.status(500).json({ error: "Failed to load pending address changes" });
      return;
    }

    const parentIds = [...new Set((tokens ?? []).map((t) => t.parent_id).filter(Boolean))] as string[];
    const parentMap = new Map<string, Record<string, unknown>>();
    if (parentIds.length > 0) {
      const { data: parents } = await supabase
        .from("parents")
        .select("id, first_name, last_name, email, mailing_address")
        .in("id", parentIds);
      for (const p of parents ?? []) parentMap.set(p.id as string, p);
    }

    const items = (tokens ?? []).map((t) => {
      const payload = (t.payload ?? {}) as Record<string, unknown>;
      const parent = t.parent_id ? parentMap.get(t.parent_id as string) : undefined;
      const target = (payload["target"] as string) ?? "parent";
      return {
        parent_name: parent
          ? `${parent["first_name"] ?? ""} ${parent["last_name"] ?? ""}`.trim()
          : null,
        email: (parent?.["email"] as string) ?? (t.email as string) ?? null,
        target, // 'parent' or 'gak_application'
        current_address: target === "parent" ? (parent?.["mailing_address"] as string) ?? null : null,
        new_address: (payload["new_address"] as string) ?? null,
        requested_at: t.created_at,
        expires_at: t.expires_at,
      };
    });

    res.json(items);
  } catch (err) {
    req.log?.error({ err }, "Error loading pending address changes");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/parents", requireAuth, async (req: AuthRequest, res) => {
  try {
    let query = supabase
      .from("parents")
      .select("*")
      .order("last_name");

    const { data, error } = await query;
    if (error) {
      req.log?.error({ error }, "Error fetching parents");
      res.status(500).json({ error: "Failed to fetch parents" });
      return;
    }

    // VA cannot see mailing_address or internal_notes
    const sanitized = (data || []).map((p: Record<string, unknown>) => {
      if (req.user?.role !== "admin") {
        const { mailing_address, internal_notes, ...rest } = p;
        void mailing_address;
        void internal_notes;
        return rest;
      }
      return p;
    });

    res.json(sanitized);
  } catch (err) {
    req.log?.error({ err }, "Error fetching parents");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/parents", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body;
    const { data, error } = await supabase
      .from("parents")
      .insert({
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email?.toLowerCase(),
        phone: body.phone,
        state: body.state,
        mailing_address: body.mailing_address,
        address_type: body.address_type,
        membership_tier: body.membership_tier,
        billing_type: body.billing_type,
        subscription_status: body.subscription_status,
        join_date: body.join_date,
        referral_source: body.referral_source,
        community_status: body.community_status,
        give_a_key_recipient: body.give_a_key_recipient ?? false,
        at_risk: body.at_risk ?? false,
        internal_notes: body.internal_notes,
      })
      .select()
      .single();

    if (error) {
      req.log?.error({ error }, "Error creating parent");
      res.status(500).json({ error: "Failed to create parent" });
      return;
    }

    res.status(201).json(data);
  } catch (err) {
    req.log?.error({ err }, "Error creating parent");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/parents/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { data: parent, error } = await supabase
      .from("parents")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !parent) {
      res.status(404).json({ error: "Parent not found" });
      return;
    }

    const { data: children, error: childErr } = await supabase
      .from("children")
      .select("*")
      .eq("parent_id", req.params.id)
      .order("created_at");

    if (childErr) {
      req.log?.error({ childErr }, "Error fetching children for parent");
    }

    let sanitizedParent: Record<string, unknown> = { ...parent };
    if (req.user?.role !== "admin") {
      const { mailing_address, internal_notes, ...rest } = sanitizedParent;
      void mailing_address;
      void internal_notes;
      sanitizedParent = rest;
    }

    const sanitizedChildren = (children || []).map((c: Record<string, unknown>) => {
      if (req.user?.role !== "admin") {
        const { safety_flag, internal_notes, ...rest } = c;
        void safety_flag;
        void internal_notes;
        return rest;
      }
      return c;
    });

    res.json({ ...sanitizedParent, children: sanitizedChildren });
  } catch (err) {
    req.log?.error({ err }, "Error fetching parent");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/parents/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body;
    const updateFields: Record<string, unknown> = {};

    const allowedFields = [
      "first_name", "last_name", "email", "phone", "state",
      "membership_tier", "billing_type", "subscription_status",
      "join_date", "community_status", "give_a_key_recipient",
      "last_email_open_date", "at_risk", "referral_source",
    ];

    const adminOnlyFields = ["mailing_address", "address_type", "internal_notes"];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateFields[field] = field === "email" ? body[field].toLowerCase() : body[field];
      }
    }

    if (req.user?.role === "admin") {
      for (const field of adminOnlyFields) {
        if (body[field] !== undefined) {
          updateFields[field] = body[field];
        }
      }
    }

    const { data, error } = await supabase
      .from("parents")
      .update(updateFields)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Parent not found or update failed" });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log?.error({ err }, "Error updating parent");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

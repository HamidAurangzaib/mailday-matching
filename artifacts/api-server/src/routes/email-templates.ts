// Admin Email Templates routes — Phase 2.7 (Block F).
//
// The 4 Resend templates (onboarding_nudge, match_notification, guarantee_breach,
// pause_offer) plus the transactional address_change_confirm template live in
// the `email_templates` DB table. Courtney edits them via the admin UI at
// `/admin/email-templates` — no dev ticket needed for copy changes.
//
// Endpoints (all admin-only):
//   GET    /api/admin/email-templates              — list all
//   GET    /api/admin/email-templates/:key         — read one
//   PATCH  /api/admin/email-templates/:key         — update editable fields
//   POST   /api/admin/email-templates/:key/preview — render with sample vars

import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { logAudit } from "../lib/audit.js";

const router: IRouter = Router();

// Editable fields — never let the API change the primary key.
const EDITABLE_FIELDS = [
  "subject",
  "from_name",
  "from_email",
  "body_html",
  "body_text",
  "variables",
] as const;

// ─── GET /admin/email-templates — list all ───────────────────────────────────

router.get(
  "/admin/email-templates",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const { data, error } = await supabase
      .from("email_templates")
      .select("template_key, subject, from_name, from_email, body_html, body_text, variables, updated_at, updated_by")
      .order("template_key");
    if (error) {
      req.log?.error({ error }, "Error listing email templates");
      res.status(500).json({ error: "Failed to load email templates" });
      return;
    }
    res.json(data ?? []);
  },
);

// ─── GET /admin/email-templates/:key — read one ──────────────────────────────

router.get(
  "/admin/email-templates/:key",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const key = String(req.params["key"] ?? "");
    const { data, error } = await supabase
      .from("email_templates")
      .select("template_key, subject, from_name, from_email, body_html, body_text, variables, updated_at, updated_by")
      .eq("template_key", key)
      .single();
    if (error || !data) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(data);
  },
);

// ─── PATCH /admin/email-templates/:key — update ──────────────────────────────

router.patch(
  "/admin/email-templates/:key",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const key = String(req.params["key"] ?? "");
      if (!key) { res.status(400).json({ error: "Missing template key" }); return; }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      for (const field of EDITABLE_FIELDS) {
        if (field in body) updates[field] = body[field];
      }

      // Trivial validation: subject + body_html + body_text must remain non-empty.
      if ("subject" in updates && typeof updates["subject"] === "string" && !updates["subject"].trim()) {
        res.status(400).json({ error: "subject cannot be empty" });
        return;
      }
      if ("body_html" in updates && typeof updates["body_html"] === "string" && !updates["body_html"].trim()) {
        res.status(400).json({ error: "body_html cannot be empty" });
        return;
      }
      if ("body_text" in updates && typeof updates["body_text"] === "string" && !updates["body_text"].trim()) {
        res.status(400).json({ error: "body_text cannot be empty" });
        return;
      }
      if ("from_email" in updates && typeof updates["from_email"] === "string" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(updates["from_email"])) {
        res.status(400).json({ error: "from_email must be a valid email address" });
        return;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "No editable fields provided" });
        return;
      }

      // Read current row so the audit log captures the before-state.
      const { data: before } = await supabase
        .from("email_templates")
        .select("*")
        .eq("template_key", key)
        .single();
      if (!before) {
        res.status(404).json({ error: "Template not found" });
        return;
      }

      updates["updated_at"] = new Date().toISOString();
      updates["updated_by"] = req.user?.email ?? req.user?.id ?? "unknown";

      const { data: after, error } = await supabase
        .from("email_templates")
        .update(updates)
        .eq("template_key", key)
        .select()
        .single();

      if (error || !after) {
        req.log?.error({ error }, "Error updating email template");
        res.status(500).json({ error: "Failed to update template" });
        return;
      }

      await logAudit({
        actorId: req.user?.id,
        actorEmail: req.user?.email,
        action: "email_template.updated",
        entityType: "email_template",
        entityId: key,
        payloadBefore: before,
        payloadAfter: after,
        req,
      });

      res.json(after);
    } catch (err) {
      req.log?.error({ err }, "Email template PATCH error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── POST /admin/email-templates/:key/preview — render with sample vars ──────
//
// Renders the current saved template (or the provided draft body) with sample
// variables and returns the rendered HTML, text, and subject — so Courtney can
// preview before save. Does NOT save the draft. Does NOT send any email.

const SAMPLE_VARS: Record<string, Record<string, string>> = {
  onboarding_nudge: {
    onboarding_url: "https://example.test/onboarding?token=demo",
    parent_first_name: "Jane",
  },
  match_notification: {
    parent_first_name: "Jane",
    child_first_name: "Sam",
    pen_pal_first_name: "Alex",
    pen_pal_age: "8",
    fun_fact_1: "Lego",
    fun_fact_2: "Dinosaurs",
    fun_fact_3: "Reading",
    pack_url: "https://example.test/packs",
    confirm_address_url: "https://example.test/api/confirm/demo-token",
  },
  guarantee_breach: {
    parent_first_name: "Jane",
    child_first_name: "Sam",
    days_waiting: "22",
  },
  // `pause_offer` removed 2026-07-20 — the app can't pause ReCharge billing, so
  // pauses are offered manually by the team instead of by automated email.
  address_change_confirm: {
    new_address: "123 Newhouse Way, Springfield, IL 62701",
    confirm_url: "https://example.test/api/confirm/addr-demo",
  },
};

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, name: string) => {
    return name in vars ? vars[name] : `[no sample for ${name}]`;
  });
}

router.post(
  "/admin/email-templates/:key/preview",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const key = String(req.params["key"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Allow previewing an unsaved draft by passing draft body in the request.
    // Falls back to the saved row when a field isn't in the request.
    const { data: saved, error } = await supabase
      .from("email_templates")
      .select("template_key, subject, from_name, from_email, body_html, body_text")
      .eq("template_key", key)
      .single();
    if (error || !saved) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const subject = (body["subject"] as string | undefined) ?? saved.subject;
    const html = (body["body_html"] as string | undefined) ?? saved.body_html;
    const text = (body["body_text"] as string | undefined) ?? saved.body_text;
    const fromName = (body["from_name"] as string | undefined) ?? saved.from_name;
    const fromEmail = (body["from_email"] as string | undefined) ?? saved.from_email;

    const vars = SAMPLE_VARS[key] ?? {};

    res.json({
      template_key: key,
      from: `${fromName} <${fromEmail}>`,
      subject: interpolate(subject, vars),
      body_html: interpolate(html, vars),
      body_text: interpolate(text, vars),
      sample_vars: vars,
    });
  },
);

export default router;

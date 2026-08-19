/**
 * Email service — single entry point for every Resend (transactional) email
 * the app sends. Templates live in the `email_templates` table so Courtney
 * can edit them via the admin "Email Templates" page (Phase 2.7) without a
 * dev ticket.
 *
 * Klaviyo emails (welcome, monthly packs, first-letter nudge, ghosting win-back,
 * day-30 win-back, annual upgrade, GAK thank-you, etc.) do NOT pass through
 * this service — they live entirely in Klaviyo. To trigger a Klaviyo flow from
 * the app, use `lib/klaviyo-events.ts` instead.
 */

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export interface EmailTemplate {
  template_key: string;
  subject: string;
  from_name: string;
  from_email: string;
  body_html: string;
  body_text: string;
  variables: string[];
}

export type TemplateKey =
  | "onboarding_nudge"
  | "match_notification"
  | "guarantee_breach"
  // "pause_offer" removed 2026-07-20 — pauses are now offered manually, because
  // the app cannot pause ReCharge billing (see webhooks.ts cancellation block).
  | "address_change_confirm"
  // Group A / A4 — the two-party address-consent workflow emails.
  | "consent_reminder_1"       // day 2, from Poppy
  | "consent_reminder_2"       // day 7, from MailDay
  | "consent_pause"            // day 14 — consent not given, billing paused
  | "consent_declined"         // parent actively declined at match time
  | "match_didnt_work_out"     // partner family (timeout or decline)
  | "tier_upgraded_to_core";   // child turned 7 and moved up from Minis

export interface SendEmailArgs {
  to: string;
  templateKey: TemplateKey;
  vars?: Record<string, string | number>;
  /** Override the From header for a single send (rare). */
  fromOverride?: { name?: string; email?: string };
}

export interface SendEmailResult {
  ok: boolean;
  /** Resend message id, or null if delivery did not happen (dev / no API key) */
  id: string | null;
  /** Human-readable status — sent / logged_dev / template_missing / api_error */
  status: "sent" | "logged_dev" | "template_missing" | "api_error";
  error?: string;
}

/**
 * Interpolate {{variable}} placeholders. Missing variables are left as-is and
 * logged at warn level, so a template author sees the problem in dev.
 */
function interpolate(
  template: string,
  vars: Record<string, string | number>,
  templateKey: string,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    if (name in vars) return String(vars[name]);
    logger.warn({ templateKey, missingVar: name }, "Email template referenced undefined variable");
    return match;
  });
}

async function loadTemplate(key: TemplateKey): Promise<EmailTemplate | null> {
  const { data, error } = await supabase
    .from("email_templates")
    .select("template_key, subject, from_name, from_email, body_html, body_text, variables")
    .eq("template_key", key)
    .single();

  if (error || !data) {
    logger.error({ key, error }, "Email template not found");
    return null;
  }
  return data as EmailTemplate;
}

/**
 * Send a transactional email via Resend. Falls back to a structured log entry
 * (status: "logged_dev") when RESEND_API_KEY is not set — useful for dev work
 * where you want to see what would have been sent without actually sending it.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const template = await loadTemplate(args.templateKey);
  if (!template) {
    return { ok: false, id: null, status: "template_missing" };
  }

  const vars = args.vars ?? {};
  const subject = interpolate(template.subject, vars, args.templateKey);
  const html = interpolate(template.body_html, vars, args.templateKey);
  const text = interpolate(template.body_text, vars, args.templateKey);
  const fromName = args.fromOverride?.name ?? template.from_name;
  const fromEmail = args.fromOverride?.email ?? template.from_email;
  const fromHeader = `${fromName} <${fromEmail}>`;

  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    logger.warn(
      { templateKey: args.templateKey, to: args.to, subject },
      "RESEND_API_KEY not set — email would have been sent (dev mode)",
    );
    return { ok: true, id: null, status: "logged_dev" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [args.to],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, templateKey: args.templateKey }, "Resend API error");
      return { ok: false, id: null, status: "api_error", error: `${res.status}: ${body}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? null, status: "sent" };
  } catch (err) {
    logger.error({ err, templateKey: args.templateKey }, "Email send failed");
    return { ok: false, id: null, status: "api_error", error: String(err) };
  }
}

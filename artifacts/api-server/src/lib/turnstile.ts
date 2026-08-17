/**
 * Cloudflare Turnstile verification (A5 — bot protection on public forms).
 *
 * The public forms (onboarding, give-a-key apply + po-box, address-change) send
 * a Turnstile token with each submit; we verify it server-side here before
 * processing.
 * A browser-only check is trivially bypassed, so this server check is the real
 * protection.
 *
 * The SECRET key lives only in the TURNSTILE_SECRET_KEY env var — never in code.
 * The site key is public and lives in the frontend.
 */
import { logger } from "./logger.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a Turnstile token.
 *
 * Fail-closed in production: if the secret isn't configured, we reject, because
 * an unconfigured check is no check at all. In non-production we skip with a
 * warning so local dev isn't blocked.
 */
export async function verifyTurnstile(token: unknown, ip?: string): Promise<TurnstileResult> {
  const secret = process.env["TURNSTILE_SECRET_KEY"];

  if (!secret) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("TURNSTILE_SECRET_KEY not set — rejecting form submit (fail closed)");
      return { ok: false, reason: "verification_unavailable" };
    }
    logger.warn("TURNSTILE_SECRET_KEY not set — skipping Turnstile check (dev only)");
    return { ok: true };
  }

  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing_token" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean; ["error-codes"]?: string[] };
    if (data.success) return { ok: true };
    return { ok: false, reason: (data["error-codes"] ?? ["failed"]).join(",") };
  } catch (err) {
    logger.error({ err }, "Turnstile siteverify request failed");
    // Network hiccup contacting Cloudflare: don't lock real families out of
    // onboarding over a transient error — allow, but log loudly.
    return { ok: true, reason: "verify_error_allowed" };
  }
}

/**
 * Express helper: pull the Turnstile token from a request body. The frontend
 * sends it as `turnstile_token`.
 */
export function tokenFromBody(body: unknown): unknown {
  return (body as { turnstile_token?: unknown } | undefined)?.turnstile_token;
}

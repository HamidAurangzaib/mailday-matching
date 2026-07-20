/**
 * The public base URL of this app, used to build every link we email out:
 * onboarding links, address-confirmation links, password resets.
 *
 * This is deliberately forgiving, because a malformed APP_URL fails in the worst
 * possible way — it doesn't crash, it silently emails people a broken link, and
 * nobody notices until a customer reports it. (That happened 2026-07-20: APP_URL
 * was set without a scheme, which produced relative, unclickable URLs.)
 *
 * Resolution order:
 *   1. APP_URL                — what we set on the deployment
 *   2. REPLIT_DOMAINS (first) — Replit's own domain, as a fallback
 *   3. http://localhost       — local dev
 *
 * Whichever wins is normalised: trimmed, trailing slashes removed, and given an
 * https:// scheme if one is missing.
 */

/** Trim, drop trailing slashes, and ensure there's a scheme. */
export function normaliseBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  // Already has a scheme (http:// or https://) → leave it alone.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare host like "example.replit.app" → assume https.
  return `https://${trimmed}`;
}

export function appBaseUrl(): string {
  const explicit = normaliseBaseUrl(process.env["APP_URL"] ?? "");
  if (explicit) return explicit;

  const replit = normaliseBaseUrl((process.env["REPLIT_DOMAINS"] ?? "").split(",")[0] ?? "");
  if (replit) return replit;

  return "http://localhost";
}

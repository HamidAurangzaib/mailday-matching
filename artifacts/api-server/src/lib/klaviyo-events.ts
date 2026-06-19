/**
 * Klaviyo outbound-events helper. Emits custom events to Klaviyo so flows on
 * their side can fire on a delay (e.g. "send the day-14 first-letter nudge
 * 14 days after the match was promoted to Active").
 *
 * Used by:
 *   • match.ts                 → emit "match_promoted_to_active"  (drives K2 first-letter nudge)
 *   • lib/lifecycle.ts         → emit "family_offboarded"         (drives K7 day-30 win-back)
 *   • routes/give-a-key.ts     → emit "gak_donation_recorded"     (drives K9 donor thank-you, if not DonateMate→Klaviyo direct)
 *
 * Klaviyo's events API:
 *   POST https://a.klaviyo.com/api/events/
 *
 * Silently no-ops in dev when KLAVIYO_API_KEY is not set. Reuses the same
 * env var the inbound sync already uses (see lib/klaviyo-sync.ts — er, that's
 * routes/klaviyo-sync.ts).
 */

import { logger } from "./logger.js";

const KLAVIYO_API = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

export type KlaviyoEventName =
  | "family_subscribed"            // Phase 2.1 — drives K1 Welcome (Day 0)
  | "match_promoted_to_active"     // Phase 2.5 — drives K2 First-letter nudge (Day 14)
  | "family_offboarded"            // Phase 4.2 — drives K7 Day-30 win-back
  | "gak_donation_recorded";       // Phase 6.2 — drives K9 GAK donor thank-you

export interface EmitKlaviyoEventArgs {
  /** The event name Klaviyo flows listen for (Metric name). */
  event: KlaviyoEventName;
  /** Profile this event belongs to. Email is the minimum identifier Klaviyo needs. */
  profile: {
    email: string;
    first_name?: string;
    last_name?: string;
    /** Profile-level custom properties. Get merged onto the Klaviyo profile. */
    properties?: Record<string, unknown>;
  };
  /** Event-level properties (per-event detail Klaviyo flows can branch on). */
  properties?: Record<string, unknown>;
  /** Override the event's time. Defaults to now. */
  time?: Date;
}

export interface EmitResult {
  ok: boolean;
  status: "sent" | "skipped_no_key" | "api_error";
  error?: string;
}

export async function emitKlaviyoEvent(args: EmitKlaviyoEventArgs): Promise<EmitResult> {
  const apiKey = process.env["KLAVIYO_API_KEY"];
  if (!apiKey) {
    logger.warn(
      { event: args.event, to: args.profile.email },
      "KLAVIYO_API_KEY not set — Klaviyo event would have been emitted (dev mode)",
    );
    return { ok: true, status: "skipped_no_key" };
  }

  const body = {
    data: {
      type: "event",
      attributes: {
        properties: args.properties ?? {},
        time: (args.time ?? new Date()).toISOString(),
        metric: {
          data: {
            type: "metric",
            attributes: { name: args.event },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: args.profile.email,
              first_name: args.profile.first_name,
              last_name: args.profile.last_name,
              properties: args.profile.properties ?? {},
            },
          },
        },
      },
    },
  };

  try {
    const res = await fetch(`${KLAVIYO_API}/events/`, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: KLAVIYO_REVISION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, body: text, event: args.event }, "Klaviyo events API error");
      return { ok: false, status: "api_error", error: `${res.status}: ${text.slice(0, 300)}` };
    }

    return { ok: true, status: "sent" };
  } catch (err) {
    logger.error({ err, event: args.event }, "Klaviyo event emit failed");
    return { ok: false, status: "api_error", error: String(err) };
  }
}

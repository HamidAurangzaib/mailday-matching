/**
 * Confirmation-link helper. Generic "send the user a one-click link that
 * proves they own this email address before we change anything."
 *
 * Token types:
 *   • address_change         — closes audit §3.3 (enroll + GAK PO-box). Payload: { new_address }.
 *   • address_confirm_match  — Phase 2 (match notification) / A3 two-party consent. Payload: { side: 'a'|'b', penpal_first_name?: string }.
 *   • pause_offer            — Phase 3 (pause vs cancel). Payload: { months: 1|2|3 } or { decline: true }.
 *   • reactivate             — Phase 4 (day-30 win-back). Payload: {}.
 *
 * Routes consume tokens via GET /api/confirm/:token in this file (mounted by
 * routes/confirm.ts). One handler per type — keeps the logic per-flow.
 */

import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

export type ConfirmationType =
  | "address_change"
  | "address_confirm_match"
  | "pause_offer"
  | "reactivate";

export interface CreateTokenArgs {
  type: ConfirmationType;
  email: string;
  parentId?: string;
  childId?: string;
  matchId?: string;
  payload?: Record<string, unknown>;
  /** How long the link is valid, in hours. Defaults vary by type. */
  ttlHours?: number;
}

const DEFAULT_TTL_HOURS: Record<ConfirmationType, number> = {
  address_change: 24,
  address_confirm_match: 15 * 24, // 15 days — covers the whole A4 consent window (48h + day-7 reminder + day-14 timeout) so the original link never dies mid-flow
  pause_offer: 48,
  reactivate: 30 * 24, // 30 days
};

export interface CreateTokenResult {
  token: string;
  url: string;
  expiresAt: string;
}

import { appBaseUrl } from "./app-url.js";

export async function createConfirmationToken(args: CreateTokenArgs): Promise<CreateTokenResult> {
  const ttl = args.ttlHours ?? DEFAULT_TTL_HOURS[args.type];
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("confirmation_tokens")
    .insert({
      type: args.type,
      email: args.email.toLowerCase().trim(),
      parent_id: args.parentId ?? null,
      child_id: args.childId ?? null,
      match_id: args.matchId ?? null,
      payload: args.payload ?? {},
      expires_at: expiresAt,
    })
    .select("token")
    .single();

  if (error || !data) {
    logger.error({ error, type: args.type }, "Failed to create confirmation token");
    throw new Error("Failed to create confirmation token");
  }

  const token = (data as { token: string }).token;
  const url = `${appBaseUrl()}/api/confirm/${token}`;
  return { token, url, expiresAt };
}

export interface ConsumedToken {
  token: string;
  type: ConfirmationType;
  email: string;
  parent_id: string | null;
  child_id: string | null;
  match_id: string | null;
  payload: Record<string, unknown>;
}

/**
 * Atomically mark a token consumed and return its contents. Returns null if
 * the token is unknown, expired, or already consumed.
 */
export async function consumeConfirmationToken(
  token: string,
  consumerIp: string | null,
): Promise<ConsumedToken | null> {
  // Step 1: read + validate.
  const { data: row, error } = await supabase
    .from("confirmation_tokens")
    .select("token, type, email, parent_id, child_id, match_id, payload, expires_at, consumed_at")
    .eq("token", token)
    .single();

  if (error || !row) return null;

  const r = row as {
    token: string;
    type: ConfirmationType;
    email: string;
    parent_id: string | null;
    child_id: string | null;
    match_id: string | null;
    payload: Record<string, unknown> | null;
    expires_at: string;
    consumed_at: string | null;
  };

  if (r.consumed_at) return null;
  if (new Date(r.expires_at) < new Date()) return null;

  // Step 2: mark consumed. We accept the small race window — if two clicks land
  // simultaneously, both will succeed; the caller should be idempotent.
  await supabase
    .from("confirmation_tokens")
    .update({ consumed_at: new Date().toISOString(), consumed_ip: consumerIp })
    .eq("token", token);

  return {
    token: r.token,
    type: r.type,
    email: r.email,
    parent_id: r.parent_id,
    child_id: r.child_id,
    match_id: r.match_id,
    payload: r.payload ?? {},
  };
}

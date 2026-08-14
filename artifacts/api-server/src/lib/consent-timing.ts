/**
 * Timing + idempotency rules for the Group A / A4 address-consent lifecycle.
 *
 * Kept as a pure leaf module (no I/O, no imports) so the "which step is due?"
 * decision — the crux of the reminder/timeout engine's correctness — can be
 * unit-tested directly. routes/lifecycle-jobs.ts owns the I/O around it.
 */

/** First consent reminder, in hours after the match was created. */
export const CONSENT_REMINDER_1_HOURS = 48;
/** Second consent reminder, in days after the match was created. */
export const CONSENT_REMINDER_2_DAYS = 7;
/** Give up and wind the match down after this many days without both consents. */
export const CONSENT_TIMEOUT_DAYS = 14;

/** The subset of a match row the timing decision needs. */
export interface ConsentTimingRow {
  address_confirmed_a: boolean | null;
  address_confirmed_b: boolean | null;
  created_at: string;
  /** Set when a match re-opens for re-consent (a move); the clock restarts here. */
  consent_opened_at?: string | null;
  consent_reminder_1_sent_at: string | null;
  consent_reminder_2_sent_at: string | null;
  consent_timeout_at: string | null;
}

/**
 * When the current consent window started: the re-consent reopen time if the
 * match has been reopened (a move), otherwise the match's creation time.
 */
export function consentWindowStart(row: Pick<ConsentTimingRow, "created_at" | "consent_opened_at">): number {
  return new Date(row.consent_opened_at ?? row.created_at).getTime();
}

export type ConsentAction = "timeout" | "reminder2" | "reminder1" | "none";

/**
 * Given a Pending match row and the current time (ms), which single action is
 * due? Timeout beats reminder-2 beats reminder-1; a step already stamped (or a
 * fully-consented / already-wound-down match) yields "none". Each reminder is
 * gated by its own stamp so it fires exactly once even if the cron catches up
 * late.
 */
export function decideConsentAction(row: ConsentTimingRow, nowMs: number): ConsentAction {
  if (row.address_confirmed_a && row.address_confirmed_b) return "none";
  if (row.consent_timeout_at) return "none";

  const elapsedMs = nowMs - consentWindowStart(row);
  if (elapsedMs >= CONSENT_TIMEOUT_DAYS * 86400000) return "timeout";
  if (elapsedMs >= CONSENT_REMINDER_2_DAYS * 86400000 && !row.consent_reminder_2_sent_at) return "reminder2";
  // Once reminder-2 has gone out, reminder-1 is moot — guard on it too so the
  // ladder holds regardless of the order stamps were written.
  if (
    elapsedMs >= CONSENT_REMINDER_1_HOURS * 3600000 &&
    !row.consent_reminder_1_sent_at &&
    !row.consent_reminder_2_sent_at
  ) {
    return "reminder1";
  }
  return "none";
}

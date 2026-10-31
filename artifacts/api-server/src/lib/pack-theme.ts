/**
 * Calendar-month → pack theme name.
 *
 * Packs are calendar-synced: every family gets the SAME theme in the SAME
 * calendar month, no matter when they joined — pen pals need to be on the
 * same "adventure" together. This is deliberately independent of
 * `subscription_month` (see subscription.ts), which is per-child, counted
 * from that child's own start date, and drives tier/month flow branching —
 * not the theme.
 *
 * Klaviyo can't branch on the current date itself, so we resolve the theme
 * here and hand it over as a flat property on the `pack_due` event.
 *
 * Courtney gave the first three months (2026-10-31); the rest of her
 * 36-month list is still pending. Add entries below in the same
 * "YYYY-MM": "theme" shape as she sends them — nothing else needs to change.
 */
const PACK_THEME_BY_MONTH: Record<string, string> = {
  "2026-12": "hello",
  "2027-01": "forest",
  "2027-02": "ocean",
  // TODO(Courtney): paste the rest of the 36-month list here.
};

/** "YYYY-MM" for a date's calendar month — NOT the subscription-month counter. */
function calendarMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Theme for the pack going out in `date`'s calendar month, or null if that
 * month isn't mapped yet. Callers should treat null as worth surfacing loudly
 * (e.g. a cron-result warning) rather than silently sending packs with no
 * theme — a gap here means Klaviyo has nothing to route on.
 */
export function packThemeForMonth(date: Date): string | null {
  return PACK_THEME_BY_MONTH[calendarMonthKey(date)] ?? null;
}

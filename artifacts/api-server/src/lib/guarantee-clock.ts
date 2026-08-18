/**
 * When a child's 21-day match guarantee starts counting.
 *
 * The guarantee is a promise to find a pen pal within 21 days, so the clock
 * cannot honestly start before matching is open. Families who complete their
 * form during the run-up would otherwise burn part — or all — of their guarantee
 * waiting for a door that isn't open yet, and the day-21 job would flag a breach
 * nobody could have prevented.
 *
 * So the clock starts on the LATER of today and the opening date. After that date
 * this is inert: `opens > today` stops being true and every caller just gets
 * today, which is what it always did.
 *
 * The date is overridable via MATCHING_OPENS_AT (YYYY-MM-DD) so it can move
 * without a code change; the constant is the fallback because changing an env
 * var in the deployment needs access not everyone on the team has.
 */
const DEFAULT_MATCHING_OPENS_AT = "2026-09-07";

function openingDate(): string | null {
  const raw = (process.env["MATCHING_OPENS_AT"] ?? DEFAULT_MATCHING_OPENS_AT).trim();
  // A malformed value must not silently park every family's clock on a garbage
  // date — fall back to normal behaviour instead.
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/**
 * The date to write into `children.match_guarantee_start_date`, as YYYY-MM-DD.
 * Use this everywhere the guarantee clock starts or restarts.
 */
export function guaranteeStartDate(now: Date = new Date()): string {
  const today = now.toISOString().split("T")[0]!;
  const opens = openingDate();
  return opens && opens > today ? opens : today;
}

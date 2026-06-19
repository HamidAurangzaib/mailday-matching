/**
 * Per-child subscription-month math, shared by:
 *   • same-month matching (match_priority_tier on the match record)
 *   • the monthly pack-due cron (subscription_month on the pack_due event)
 *
 * Product rules (confirmed by Courtney 2026-06-19):
 *   • Counted PER CHILD from that child's own start date (children.created_date),
 *     NOT the household signup. A child added later starts at their own Month 1.
 *   • "Month 1" = the first 1st-of-the-month AFTER the child's start date.
 *       start Jan 15 → Month 1 on Feb 1, Month 2 on Mar 1, …
 *       start Jun 20 → Month 1 on Jul 1, …
 *   • The counter KEEPS INCREMENTING past 12 — it never resets. Month 13 is the
 *     first Year-2 pack, Month 24 the last, etc. Klaviyo routes the ranges.
 *
 * Only calendar-month boundaries matter (packs ship on the 1st), so the day of
 * the month is intentionally ignored — the number only changes when the month
 * rolls over.
 */
import { parseISO } from "date-fns";

/**
 * Number of monthly packs a child has reached as of `asOf`.
 * Returns 0 before their first 1st-of-month (no pack yet), then 1, 2, 3, …
 */
export function computeSubscriptionMonth(
  startDate: string | Date,
  asOf: Date = new Date(),
): number {
  const start = typeof startDate === "string" ? parseISO(startDate) : startDate;
  return (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth());
}

/**
 * Same pack-month → "same_month" (shared Poppy story / writing mission),
 * otherwise "any". Drives which K2-style email the family receives.
 */
export function computePriorityTier(
  monthA: number | null,
  monthB: number | null,
): "same_month" | "any" {
  if (monthA === null || monthB === null) return "any";
  return monthA === monthB ? "same_month" : "any";
}

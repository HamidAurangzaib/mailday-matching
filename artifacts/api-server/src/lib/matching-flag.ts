/**
 * Group A kill-switch (GROUP-A-PLAN.md, cross-cutting decision 1).
 *
 * Creating a match is the moment two families' addresses become releasable to
 * each other, so it stays gated until the Group A consent work is built AND
 * tested end-to-end. The gate is an env flag rather than a code change so it can
 * be flipped without a redeploy once testing signs off.
 *
 * Deliberately fails CLOSED: the flag must be exactly "true". A missing, empty
 * or malformed value leaves matching disabled, because failing open here means a
 * real child's address could move before the consent gate has been verified.
 */
export function matchingEnabled(): boolean {
  return (process.env["MATCHING_ENABLED"] ?? "").trim().toLowerCase() === "true";
}

/** Admin-facing explanation shown when the gate blocks a match. */
export const MATCHING_DISABLED_MESSAGE =
  "Matching is currently turned off. This is the Group A safety gate: no match " +
  "can be created until the two-party address-consent flow has been tested. " +
  "Set MATCHING_ENABLED=true once it has.";

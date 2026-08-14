/* Unit tests for the A4 address-consent timing decision. Pure, no I/O.
   Run: esbuild-bundle this file and execute with node (see scratchpad runner). */
import {
  decideConsentAction,
  type ConsentTimingRow,
  type ConsentAction,
} from "./consent-timing.js";

const H = 3600000;
const D = 86400000;
const NOW = Date.parse("2026-08-15T00:00:00.000Z");

function row(ageMs: number, over: Partial<ConsentTimingRow> = {}): ConsentTimingRow {
  return {
    address_confirmed_a: false,
    address_confirmed_b: false,
    created_at: new Date(NOW - ageMs).toISOString(),
    consent_reminder_1_sent_at: null,
    consent_reminder_2_sent_at: null,
    consent_timeout_at: null,
    ...over,
  };
}

let passed = 0;
let failed = 0;
function expect(name: string, got: ConsentAction, want: ConsentAction) {
  if (got === want) { passed++; }
  else { failed++; console.log(`  FAIL ${name}: got "${got}", want "${want}"`); }
}

const STAMP = "2026-08-14T00:00:00.000Z";

// Before 48h — nothing due.
expect("24h, fresh", decideConsentAction(row(24 * H), NOW), "none");
expect("47h, fresh", decideConsentAction(row(47 * H), NOW), "none");

// 48h boundary — reminder 1 (inclusive).
expect("exactly 48h", decideConsentAction(row(48 * H), NOW), "reminder1");
expect("3 days, fresh", decideConsentAction(row(3 * D), NOW), "reminder1");

// reminder 1 already sent → nothing until day 7.
expect("3 days, r1 sent", decideConsentAction(row(3 * D, { consent_reminder_1_sent_at: STAMP }), NOW), "none");

// Day 7 — reminder 2 (takes precedence over a still-unsent reminder 1).
expect("exactly 7 days", decideConsentAction(row(7 * D), NOW), "reminder2");
expect("9 days, r1 sent", decideConsentAction(row(9 * D, { consent_reminder_1_sent_at: STAMP }), NOW), "reminder2");
expect("9 days, r2 sent", decideConsentAction(row(9 * D, { consent_reminder_1_sent_at: STAMP, consent_reminder_2_sent_at: STAMP }), NOW), "none");
// Robustness: reminder-2 sent but reminder-1 never stamped → still "none" (ladder holds).
expect("9 days, r2 sent r1 null", decideConsentAction(row(9 * D, { consent_reminder_2_sent_at: STAMP }), NOW), "none");

// Day 14 — timeout, regardless of which reminders went out.
expect("exactly 14 days", decideConsentAction(row(14 * D), NOW), "timeout");
expect("20 days, both reminders sent", decideConsentAction(row(20 * D, { consent_reminder_1_sent_at: STAMP, consent_reminder_2_sent_at: STAMP }), NOW), "timeout");

// Already wound down → nothing.
expect("20 days, timeout stamped", decideConsentAction(row(20 * D, { consent_timeout_at: STAMP }), NOW), "none");

// Both consented → nothing, at any age.
expect("both confirmed at 20 days", decideConsentAction(row(20 * D, { address_confirmed_a: true, address_confirmed_b: true }), NOW), "none");
expect("both confirmed at 3 days", decideConsentAction(row(3 * D, { address_confirmed_a: true, address_confirmed_b: true }), NOW), "none");

// One side confirmed still nudges the other.
expect("one confirmed, 3 days", decideConsentAction(row(3 * D, { address_confirmed_a: true }), NOW), "reminder1");
expect("one confirmed, 14 days", decideConsentAction(row(14 * D, { address_confirmed_a: true }), NOW), "timeout");

console.log(`\nconsent-timing: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

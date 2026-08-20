/* Unit tests for the age→tier bands. Pure, no I/O.
   Bands (Courtney 2026-08): Minis 4–6, Core 7–12; nothing under 4 or over 12. */
import { computeTier } from "./age.js";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

eq("age 3 -> null (below new minimum)", computeTier(3, "Core"), null);
eq("age 4 -> Minis (new floor)", computeTier(4, "Core"), "Minis");
eq("age 5 -> Minis", computeTier(5, "Core"), "Minis");
eq("age 6 -> Minis (top of Minis)", computeTier(6, "Core"), "Minis");
eq("age 7 -> Core (moves up at 7)", computeTier(7, "Minis"), "Core");
eq("age 12 -> Core", computeTier(12, "Core"), "Core");
eq("age 13 -> null (above max)", computeTier(13, "Core"), null);
eq("homeschool 6 -> Homeschool Minis", computeTier(6, "Homeschool Core"), "Homeschool Minis");
eq("homeschool 7 -> Homeschool Core", computeTier(7, "Homeschool Minis"), "Homeschool Core");
eq("null age -> null", computeTier(null, "Core"), null);

console.log(`\nage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

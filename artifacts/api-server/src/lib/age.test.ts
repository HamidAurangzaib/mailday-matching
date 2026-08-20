/* Unit tests for the age→tier DEFAULTS. Pure, no I/O.
   Bands (Courtney 2026-08): Minis 4–6, Core 6–12 (age 6 is in BOTH; the parent
   chooses). computeTier returns only the DEFAULT by age — a 6-year-old defaults
   to Core. Nothing under 4 or over 12. */
import { computeTier } from "./age.js";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

eq("age 3 -> null (below minimum)", computeTier(3, "Core"), null);
eq("age 4 -> Minis (default)", computeTier(4, "Core"), "Minis");
eq("age 5 -> Minis (default)", computeTier(5, "Core"), "Minis");
eq("age 6 -> Core (DEFAULTS to Core; parent may pick Minis)", computeTier(6, "Core"), "Core");
eq("age 7 -> Core", computeTier(7, "Minis"), "Core");
eq("age 12 -> Core", computeTier(12, "Core"), "Core");
eq("age 13 -> null (above max)", computeTier(13, "Core"), null);
eq("homeschool 5 -> Homeschool Minis", computeTier(5, "Homeschool Core"), "Homeschool Minis");
eq("homeschool 6 -> Homeschool Core (default)", computeTier(6, "Homeschool Minis"), "Homeschool Core");
eq("null age -> null", computeTier(null, "Core"), null);

console.log(`\nage: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

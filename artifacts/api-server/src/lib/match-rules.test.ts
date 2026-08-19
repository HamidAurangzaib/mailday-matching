/* Unit tests for the pairing rules. Pure, no I/O.
   Run: esbuild-bundle this file and execute with node (see scratchpad runner). */
import { validateMatchPair, MAX_AGE_GAP_YEARS } from "./match-rules.js";

let pass = 0, fail = 0;
function check(label: string, got: boolean, want: boolean, reason?: string) {
  if (got === want) pass++;
  else { fail++; console.log(`FAIL ${label}: expected ${want ? "ALLOW" : "REJECT"}, got ${got ? "ALLOW" : "REJECT"}${reason ? " — " + reason : ""}`); }
}

// Fixed "today" is irrelevant — the rule compares the two birthdays to each other.
const kid = (name: string, dob: string, tier: string) => ({ child_first_name: name, date_of_birth: dob, tier });

// ── Courtney's two worry cases ──────────────────────────────────────────────
// A 5-and-a-half-year-old and a 3-year-old: 2.5 years apart. Whole-year ages
// would call this "5 and 3", a gap of 2, and wrongly allow it.
{
  const r = validateMatchPair(kid("Ada", "2021-01-01", "Minis"), kid("Bo", "2023-07-01", "Minis"));
  check("5.5 vs 3.0 on Minis is rejected", r.ok, false, r.reason);
}
// A 5-year-old on Core and an 11-year-old: different worlds.
{
  const r = validateMatchPair(kid("Cy", "2021-01-01", "Core"), kid("Di", "2015-01-01", "Core"));
  check("5 vs 11 on Core is rejected", r.ok, false, r.reason);
}

// ── The gap boundary ────────────────────────────────────────────────────────
check("exactly 2 years apart is allowed",
  validateMatchPair(kid("A", "2018-06-01", "Core"), kid("B", "2020-06-01", "Core")).ok, true);
check("2 years and a month apart is rejected",
  validateMatchPair(kid("A", "2018-05-01", "Core"), kid("B", "2020-06-01", "Core")).ok, false);
check("same birthday is allowed",
  validateMatchPair(kid("A", "2018-06-01", "Core"), kid("B", "2018-06-01", "Core")).ok, true);
check("order does not matter",
  validateMatchPair(kid("B", "2020-06-01", "Core"), kid("A", "2018-05-01", "Core")).ok, false);

// ── Tier bands ──────────────────────────────────────────────────────────────
check("Minis and Core never pair, however close in age",
  validateMatchPair(kid("A", "2019-06-01", "Minis"), kid("B", "2019-07-01", "Core")).ok, false);
check("Core pairs with Homeschool Core",
  validateMatchPair(kid("A", "2018-06-01", "Core"), kid("B", "2019-06-01", "Homeschool Core")).ok, true);
check("Minis pairs with Homeschool Minis",
  validateMatchPair(kid("A", "2021-06-01", "Minis"), kid("B", "2022-06-01", "Homeschool Minis")).ok, true);
check("Homeschool Minis does not pair with Homeschool Core",
  validateMatchPair(kid("A", "2021-06-01", "Homeschool Minis"), kid("B", "2021-07-01", "Homeschool Core")).ok, false);

// ── Missing data refuses rather than assumes ────────────────────────────────
check("missing tier is rejected",
  validateMatchPair({ child_first_name: "A", date_of_birth: "2018-06-01", tier: null },
                    kid("B", "2019-06-01", "Core")).ok, false);
check("no DOB anywhere is rejected",
  validateMatchPair({ child_first_name: "A", tier: "Core" },
                    { child_first_name: "B", tier: "Core" }).ok, false);

// ── Fallback to whole-year ages when one DOB is missing ─────────────────────
check("falls back to ages when one DOB is missing (within range)",
  validateMatchPair({ child_first_name: "A", tier: "Core", age: 8 },
                    kid("B", "2018-06-01", "Core")).ok, true);
check("falls back to ages when one DOB is missing (out of range)",
  validateMatchPair({ child_first_name: "A", tier: "Core", age: 12 },
                    kid("B", "2019-06-01", "Core")).ok, false);

console.log(`\nmatch-rules: ${pass} passed, ${fail} failed (max gap ${MAX_AGE_GAP_YEARS}y)`);
if (fail > 0) process.exit(1);

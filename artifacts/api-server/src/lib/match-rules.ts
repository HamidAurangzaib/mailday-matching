/**
 * The two hard rules about who may be paired with whom.
 *
 * These were previously only instructions in the matching prompt, which meant
 * they held whenever the AI complied and not otherwise — nothing in the code
 * would have rejected a bad pair, and the only real safeguard was a human
 * noticing on the review screen. Courtney's ask (2026-08-19): "If a person
 * misses something, I want the system to catch it."
 *
 * So they live here, applied in two places:
 *   • matching.ts — filters the AI's suggestions before anyone sees them.
 *   • matches.ts  — blocks creation, which is the one that actually matters,
 *                   because that is where a human can act on a bad suggestion.
 *
 * Age is derived from date_of_birth, never from the legacy `children.age`
 * column, which is only correct until the child's next birthday.
 */
import { computeAge } from "./age.js";

/** Never pair children 7-and-over more than this many years apart. */
export const MAX_AGE_GAP_YEARS = 2;
/** Below this age the cap tightens — a 4-year-old and a 6-year-old are at wildly
 *  different writing stages even though they're "only" two years apart. */
export const YOUNG_TIGHTER_UNDER = 7;
/** Maximum gap when the younger of the two children is under YOUNG_TIGHTER_UNDER. */
export const MAX_AGE_GAP_YEARS_YOUNG = 1;

function parseDob(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole calendar months between two dates.
 *
 * Counting in months rather than dividing elapsed days by an average year keeps
 * exact anniversaries exact: children born on the same day two years apart are
 * 24 months apart, not 24.02 because a leap day fell between them.
 */
function monthsBetween(a: Date, b: Date): number {
  const [early, late] = a <= b ? [a, b] : [b, a];
  let months = (late.getFullYear() - early.getFullYear()) * 12 + (late.getMonth() - early.getMonth());
  if (late.getDate() < early.getDate()) months--;
  return months;
}

export interface PairCandidate {
  id?: string;
  child_first_name?: string | null;
  date_of_birth?: string | null;
  age?: number | null;
  tier?: string | null;
}

export interface PairVerdict {
  ok: boolean;
  /** Admin-facing explanation, safe to show or log. */
  reason?: string;
}

/** Best available age: DOB if we have it, else the legacy column. */
export function effectiveAge(c: PairCandidate): number | null {
  const fromDob = computeAge(c.date_of_birth ?? null);
  return fromDob ?? (typeof c.age === "number" ? c.age : null);
}

/** Minis and Core are separate worlds: they receive different monthly packs. */
function band(tier: string | null | undefined): "minis" | "core" | null {
  if (!tier) return null;
  return tier.includes("Minis") ? "minis" : "core";
}

/**
 * May these two children be pen pals?
 *
 * Deliberately strict about missing data: if we cannot establish an age or a
 * tier we refuse rather than assume, because the cost of a wrong pairing falls
 * on a child.
 */
export function validateMatchPair(a: PairCandidate, b: PairCandidate): PairVerdict {
  const nameA = a.child_first_name ?? "child A";
  const nameB = b.child_first_name ?? "child B";

  const bandA = band(a.tier);
  const bandB = band(b.tier);
  if (!bandA || !bandB) {
    return { ok: false, reason: `Cannot check tiers — ${!bandA ? nameA : nameB} has no tier recorded.` };
  }
  if (bandA !== bandB) {
    return {
      ok: false,
      reason:
        `${nameA} (${a.tier}) and ${nameB} (${b.tier}) are in different tiers. ` +
        "Pen pals receive the same monthly pack and writing mission, so they must share a tier.",
    };
  }

  // How far apart these two may be depends on how young they are. For 7-and-over
  // a two-year gap barely shows in a letter. At the bottom it's a chasm: a
  // 4-year-old scribbles while a parent writes, a 6-year-old writes words
  // themselves — pair them and one family does all the work. So if the younger
  // of the two is under 7, we allow only one year. (If one child is under 7 and
  // the other over, the younger being under 7 makes this the tighter rule.)
  const ageA = effectiveAge(a);
  const ageB = effectiveAge(b);
  if (ageA === null || ageB === null) {
    return { ok: false, reason: `Cannot check ages — ${ageA === null ? nameA : nameB} has no date of birth.` };
  }
  const maxGapYears =
    Math.min(ageA, ageB) < YOUNG_TIGHTER_UNDER ? MAX_AGE_GAP_YEARS_YOUNG : MAX_AGE_GAP_YEARS;
  const unit = maxGapYears === 1 ? "year" : "years";

  // Measure from the actual birthdays where we have them. Comparing whole-year
  // ages hides up to a year of difference at each end: a child of 5y11m and one
  // of 4y0m both round to "5 and 4", a gap of 1, while really being nearly two
  // years apart. That is precisely the pairing this rule exists to prevent.
  const dobA = parseDob(a.date_of_birth);
  const dobB = parseDob(b.date_of_birth);

  if (dobA && dobB) {
    const gapMonths = monthsBetween(dobA, dobB);
    if (gapMonths > maxGapYears * 12) {
      return {
        ok: false,
        reason:
          `${nameA} and ${nameB} are ${(gapMonths / 12).toFixed(1)} years apart. ` +
          `The maximum for their ages is ${maxGapYears} ${unit}.`,
      };
    }
    return { ok: true };
  }

  // No date of birth on one side — fall back to whole-year ages, the best we can
  // do (and we already refused above if even that was missing).
  const gap = Math.abs(ageA - ageB);
  if (gap > maxGapYears) {
    return {
      ok: false,
      reason:
        `${nameA} (${ageA}) and ${nameB} (${ageB}) are ${gap} years apart. ` +
        `The maximum for their ages is ${maxGapYears} ${unit}.`,
    };
  }

  return { ok: true };
}

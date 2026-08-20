/**
 * Age & tier utilities. Per the lifecycle map: age must be derived from
 * date_of_birth, never stored as a fixed number — otherwise a child never
 * ages out of Minis. Old code that reads `children.age` should be migrated
 * to call computeAge(child.date_of_birth) instead.
 *
 * Age bands (Courtney, 2026-08). Minimum age is 4. Age 6 sits in BOTH tiers on
 * purpose — some 6-year-olds write sentences, some still mostly draw, and the
 * parent knows which. The tier below is only the DEFAULT suggested by age; the
 * parent's choice at checkout always wins and is never overwritten. Children
 * move up Minis→Core at 7, upward only (TIER_UPGRADE_AGE in lifecycle-jobs), so
 * a 6-year-old deliberately placed on Minis stays there until their 7th birthday.
 *   Minis            → 4–6
 *   Core             → 6–12   (a 6-year-old DEFAULTS to Core)
 *   Homeschool Minis → 4–6    (homeschool variant)
 *   Homeschool Core  → 6–12   (homeschool variant)
 */

export type Tier = "Minis" | "Core" | "Homeschool Minis" | "Homeschool Core";

const TIERS = new Set<Tier>(["Minis", "Core", "Homeschool Minis", "Homeschool Core"]);

/**
 * Integer years between dob and `asOf` (defaults to now). Returns null if
 * the date is invalid or in the future.
 */
export function computeAge(dob: string | Date | null | undefined, asOf: Date = new Date()): number | null {
  if (!dob) return null;
  const d = typeof dob === "string" ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime()) || d > asOf) return null;

  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age--;
  return age;
}

/**
 * The DEFAULT tier suggested for a child of this age. The parent can override at
 * checkout and their choice wins — this is only the pre-selection. Age 6 defaults
 * to Core: most 6-year-olds are writing, and it's easier for a parent to step a
 * child down to Minis than to wonder whether they've outgrown it. Returns null if
 * the age is outside the supported 4–12 band.
 */
export function computeTier(age: number | null, currentTier: Tier | string | null | undefined): Tier | null {
  if (age == null || age < 4 || age > 12) return null;
  const isHomeschool = typeof currentTier === "string" && currentTier.startsWith("Homeschool");
  if (age <= 5) return isHomeschool ? "Homeschool Minis" : "Minis";
  return isHomeschool ? "Homeschool Core" : "Core";
}

/**
 * Sugar: did the child's tier change as a result of aging? Used by the
 * daily aging-out cron in Phase 3.5.
 */
export function tierChangeOnAging(
  dob: string | Date | null | undefined,
  currentTier: Tier | string | null | undefined,
): { from: Tier; to: Tier } | null {
  if (!currentTier || typeof currentTier !== "string" || !TIERS.has(currentTier as Tier)) return null;
  const age = computeAge(dob);
  const correct = computeTier(age, currentTier);
  if (!correct || correct === currentTier) return null;
  return { from: currentTier as Tier, to: correct };
}

/**
 * Does the (child_a, child_b) pair sit in the same age band? Used by tier
 * mismatch detection (Phase 3.6). Cross-band = mismatch.
 */
export function isCrossTier(tierA: string | null | undefined, tierB: string | null | undefined): boolean {
  if (!tierA || !tierB) return false;
  const aMinis = tierA.includes("Minis");
  const bMinis = tierB.includes("Minis");
  return aMinis !== bMinis;
}

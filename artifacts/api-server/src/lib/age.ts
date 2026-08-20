/**
 * Age & tier utilities. Per the lifecycle map: age must be derived from
 * date_of_birth, never stored as a fixed number — otherwise a child never
 * ages out of Minis. Old code that reads `children.age` should be migrated
 * to call computeAge(child.date_of_birth) instead.
 *
 * Age bands (Courtney, 2026-08: minimum age raised 3→4; Minis tops out at 6,
 * children move up to Core at 7 — see TIER_UPGRADE_AGE in lifecycle-jobs):
 *   Minis            → 4–6
 *   Core             → 7–12
 *   Homeschool Minis → 4–6  (homeschool variant)
 *   Homeschool Core  → 7–12 (homeschool variant)
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
 * Decide the correct tier for a child given their current age and the
 * homeschool-ness of their existing tier. Returns null if the age is outside
 * the supported 4–12 band.
 */
export function computeTier(age: number | null, currentTier: Tier | string | null | undefined): Tier | null {
  if (age == null || age < 4 || age > 12) return null;
  const isHomeschool = typeof currentTier === "string" && currentTier.startsWith("Homeschool");
  if (age <= 6) return isHomeschool ? "Homeschool Minis" : "Minis";
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

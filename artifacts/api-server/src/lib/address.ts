/**
 * One place to format the "address we hold for you" line shown on the consent
 * screen and in the consent emails: combines the chosen type ("Home"/"PO Box"/…)
 * with the mailing address — e.g. "Home, 123 Maple St, Springfield IL".
 */
export function formatFullAddress(
  type: string | null | undefined,
  addr: string | null | undefined,
  fallback = "the address on file",
): string {
  const a = (addr ?? "").trim();
  const t = (type ?? "").trim();
  if (a && t) return `${t}, ${a}`;
  return a || fallback;
}

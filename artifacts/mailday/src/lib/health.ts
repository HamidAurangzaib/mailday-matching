import { differenceInDays, parseISO } from "date-fns";
import type { HealthStatus } from "@/components/health-dot";

export type { HealthStatus };

export function computeChildHealth(child: {
  match_status?: string | null;
  billing_paused?: boolean | null;
  safety_flag?: boolean | null;
  guarantee_status?: string | null;
  days_waiting?: number | null;
}): HealthStatus {
  if (child.safety_flag) return "red";
  if (child.guarantee_status === "urgent") return "red";

  if (child.match_status === "Rematch Requested") return "yellow";
  if (child.billing_paused) return "yellow";
  if (child.guarantee_status === "warning") return "yellow";
  if (child.match_status === "Unmatched" && (child.days_waiting ?? 0) > 10) return "yellow";

  return "green";
}

export function computeParentHealth(parent: {
  subscription_status?: string | null;
  at_risk?: boolean | null;
  last_email_open_date?: string | null;
}): HealthStatus {
  const now = new Date();
  const daysSinceOpen =
    parent.last_email_open_date
      ? differenceInDays(now, parseISO(parent.last_email_open_date))
      : null;

  if (
    parent.subscription_status === "Cancelled" ||
    parent.at_risk ||
    (daysSinceOpen !== null && daysSinceOpen > 60)
  ) return "red";

  if (
    parent.subscription_status === "Paused" ||
    (daysSinceOpen !== null && daysSinceOpen > 30)
  ) return "yellow";

  return "green";
}

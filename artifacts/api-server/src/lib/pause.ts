/**
 * Pause-reasons model (Group A / A4, shared shape with C4).
 *
 * A child can be paused for more than one reason at once (no match in 21 days,
 * address consent not given, rematch consent not given). Billing must resume ONLY
 * when every reason is cleared — otherwise a family gets un-paused while still
 * stuck on another reason and we charge them for nothing.
 *
 * The list lives on `children.pause_reasons`; the local `children.billing_paused`
 * flag mirrors "the list is non-empty". Pausing/resuming the actual ReCharge
 * subscription is a separate outbound step the caller performs — this module owns
 * only the local state + the "is this the first reason / did it just empty?"
 * decisions that drive whether an email is sent.
 */
import { supabase } from "./supabase.js";

export type PauseReason = "no_match_21_day" | "address_consent" | "rematch_consent";

export interface PauseUpdate {
  reasons: string[];        // the new list
  billing_paused: boolean;  // list non-empty
  changed: boolean;         // did the list actually change
  firstReason: boolean;     // list went empty -> non-empty (send the pause email once)
  nowEmpty: boolean;        // list went non-empty -> empty (resume + send the "all set" email once)
}

/** Pure state transition — easy to test, no I/O. */
export function computePauseUpdate(
  current: string[] | null | undefined,
  op: "add" | "remove",
  reason: PauseReason,
): PauseUpdate {
  const before = Array.from(new Set(current ?? []));
  const wasEmpty = before.length === 0;
  let reasons = before;

  if (op === "add") {
    reasons = before.includes(reason) ? before : [...before, reason];
  } else {
    reasons = before.filter((r) => r !== reason);
  }

  const changed = reasons.length !== before.length;
  const isEmpty = reasons.length === 0;
  return {
    reasons,
    billing_paused: !isEmpty,
    changed,
    firstReason: op === "add" && wasEmpty && changed,
    nowEmpty: op === "remove" && !wasEmpty && isEmpty,
  };
}

/** Add a pause reason for a child + mirror billing_paused. */
export async function addPauseReason(childId: string, reason: PauseReason): Promise<PauseUpdate> {
  const { data } = await supabase.from("children").select("pause_reasons").eq("id", childId).single();
  const update = computePauseUpdate((data?.pause_reasons as string[] | null) ?? [], "add", reason);
  if (update.changed) {
    await supabase
      .from("children")
      .update({ pause_reasons: update.reasons, billing_paused: update.billing_paused })
      .eq("id", childId);
  }
  return update;
}

/** Remove a pause reason for a child; resume billing locally if the list empties. */
export async function removePauseReason(childId: string, reason: PauseReason): Promise<PauseUpdate> {
  const { data } = await supabase.from("children").select("pause_reasons").eq("id", childId).single();
  const update = computePauseUpdate((data?.pause_reasons as string[] | null) ?? [], "remove", reason);
  if (update.changed) {
    await supabase
      .from("children")
      .update({ pause_reasons: update.reasons, billing_paused: update.billing_paused })
      .eq("id", childId);
  }
  return update;
}

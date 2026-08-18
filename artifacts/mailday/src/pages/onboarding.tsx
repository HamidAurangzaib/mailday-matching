import { useState, useMemo, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Loader2, AlertCircle, Cake, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Turnstile } from "@/components/turnstile";

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERESTS = [
  "Animals", "Art & Drawing", "Basketball", "Board Games", "Baking",
  "Cooking", "Crafts", "Dance", "Dinosaurs", "Gardening",
  "Hiking", "Lego", "Math", "Music", "Nature",
  "Painting", "Pets", "Photography", "Puzzles", "Reading",
  "Robotics", "Science", "Soccer", "Swimming", "Theater",
  "Travel", "Video Games", "Writing",
];

const TIERS = [
  { value: "Core", label: "Core", age: "Ages 6–12" },
  { value: "Minis", label: "Minis", age: "Ages 3–5" },
  { value: "Homeschool Core", label: "Homeschool Core", age: "Ages 6–12" },
  { value: "Homeschool Minis", label: "Homeschool Minis", age: "Ages 3–5" },
];

const DOB_MIN = new Date(new Date().getFullYear() - 18, 0, 1).toISOString().split("T")[0];
const DOB_MAX = new Date(new Date().getFullYear() - 1, 11, 31).toISOString().split("T")[0];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Membership {
  id: string;
  tier: string;
}

interface Parent {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  membership_tier: string | null;
  mailing_address?: string | null;
  address_type?: string | null;
  /** Memberships this family purchased and hasn't assigned to a child yet. */
  available_memberships?: Membership[];
  memberships_remaining?: number;
}

interface ChildForm {
  uid: string;
  child_first_name: string;
  date_of_birth: string;
  tier: string;
  interests: string[];
  expanded: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let uidCounter = 0;
function newChild(defaultTier: string): ChildForm {
  return {
    uid: String(++uidCounter),
    child_first_name: "",
    date_of_birth: "",
    tier: defaultTier,
    interests: [],
    expanded: true,
  };
}

function calcAge(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 1 && age <= 18 ? age : null;
}

// Address step (A4) — required address type + the exact sharing-consent wording.
const ADDRESS_TYPES = ["Home", "Work", "PO Box"];
// Military families move often, which makes a pen pal more valuable rather than
// less. Given its own row: the label is long, and none of the other three
// describe an APO/FPO/DPO address honestly.
const MILITARY_ADDRESS_TYPE = "Military (APO/FPO/DPO)";
// A6 — the one option that may be submitted with no address, because the family
// is still waiting for the PO Box to exist. Must match the backend constant.
const GAK_ADDRESS_TYPE = "Give a Key PO Box";
const ADDRESS_SHARE_CONSENT_TEXT =
  "I understand this address will be shared with my child's pen pal's family so letters can be delivered, and I am choosing an address I am comfortable sharing.";

// Guardian attestation (item D1) — must match the backend's canonical wording.
const GUARDIAN_ATTESTATION_STATEMENTS = [
  "I am this child's parent or legal guardian.",
  "I am 18 years of age or older.",
  "I will read all letters my child sends and receives.",
  "I understand MailDay may refuse or remove any member for any reason, with a refund.",
];

const ALL_TIER_VALUES = TIERS.map((t) => t.value);

/**
 * Which memberships THIS child can still choose from: everything the family
 * purchased, minus the ones the family's other children have already taken.
 * Families with no recorded purchase (pre-existing accounts) can pick any tier.
 */
function tiersAvailableFor(
  purchasedTiers: string[],
  allChildren: ChildForm[],
  currentUid: string,
): string[] {
  if (purchasedTiers.length === 0) return ALL_TIER_VALUES;
  const pool = [...purchasedTiers];
  for (const c of allChildren) {
    if (c.uid === currentUid) continue;
    const i = pool.indexOf(c.tier);
    if (i >= 0) pool.splice(i, 1);
  }
  return [...new Set(pool)];
}

/** Age-based suggestion, limited to what's actually available (3–5 → Minis). */
function bestTierForAge(available: string[], age: number | null): string | undefined {
  if (available.length === 0) return undefined;
  if (age === null) return available[0];
  const wantMinis = age <= 5;
  return available.find((t) => t.endsWith("Minis") === wantMinis) ?? available[0];
}

// ─── Child Form Section ───────────────────────────────────────────────────────

interface ChildSectionProps {
  child: ChildForm;
  index: number;
  total: number;
  availableTiers: string[];
  constrainedToPurchase: boolean;
  onChange: (uid: string, updates: Partial<ChildForm>) => void;
  onRemove: (uid: string) => void;
}

function ChildSection({
  child, index, total, availableTiers, constrainedToPurchase, onChange, onRemove,
}: ChildSectionProps) {
  const age = useMemo(() => calcAge(child.date_of_birth), [child.date_of_birth]);

  // Mirror the /start form: entering the birthday auto-selects the right plan,
  // and the parent can still override by tapping another one.
  useEffect(() => {
    if (!child.date_of_birth) return;
    const suggested = bestTierForAge(availableTiers, age);
    if (suggested && suggested !== child.tier) {
      onChange(child.uid, { tier: suggested });
    }
    // Only re-suggest when the birthday changes — never fight a manual override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.date_of_birth]);

  // If another child took the membership this one had selected, fall back.
  useEffect(() => {
    if (availableTiers.length > 0 && !availableTiers.includes(child.tier)) {
      onChange(child.uid, { tier: bestTierForAge(availableTiers, age) ?? availableTiers[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTiers.join("|")]);

  const tierOptions = TIERS.filter((t) => availableTiers.includes(t.value));

  const toggleInterest = (interest: string) => {
    const prev = child.interests;
    const next = prev.includes(interest)
      ? prev.filter((i) => i !== interest)
      : prev.length < 10
      ? [...prev, interest]
      : prev;
    onChange(child.uid, { interests: next });
  };

  const isComplete = child.child_first_name.trim() && age !== null;

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Section header */}
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={() => onChange(child.uid, { expanded: !child.expanded })}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(child.uid, { expanded: !child.expanded }); }}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${isComplete ? "bg-green-500 text-white" : "bg-[#DD4B39]/10 text-[#DD4B39]"}`}>
            {isComplete ? <CheckCircle2 className="w-4 h-4" /> : index + 1}
          </div>
          <div className="text-left">
            <div className="font-semibold text-sm">
              {child.child_first_name.trim() || `Child ${index + 1}`}
            </div>
            {child.date_of_birth && age !== null && (
              <div className="text-xs text-gray-500">{age} years old</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {total > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(child.uid); }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Remove child"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {child.expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {child.expanded && (
        <div className="px-5 pb-5 space-y-5 border-t bg-white">
          {/* Name */}
          <div className="space-y-1.5 pt-4">
            <Label htmlFor={`name-${child.uid}`}>Child's First Name <span className="text-red-500">*</span></Label>
            <Input
              id={`name-${child.uid}`}
              placeholder="e.g. Emma"
              value={child.child_first_name}
              onChange={(e) => onChange(child.uid, { child_first_name: e.target.value })}
              maxLength={50}
            />
          </div>

          {/* Date of Birth */}
          <div className="space-y-1.5">
            <Label htmlFor={`dob-${child.uid}`}>
              <span className="flex items-center gap-1.5">
                <Cake className="w-3.5 h-3.5 text-[#DD4B39]" />
                Date of Birth <span className="text-red-500">*</span>
              </span>
            </Label>
            <Input
              id={`dob-${child.uid}`}
              type="date"
              value={child.date_of_birth}
              onChange={(e) => onChange(child.uid, { date_of_birth: e.target.value })}
              min={DOB_MIN}
              max={DOB_MAX}
              className="w-52"
            />
            {child.date_of_birth && (
              <p className="text-xs text-gray-500">
                {age !== null
                  ? `${age} years old`
                  : "Please enter a valid birth date (age 1–18)."}
              </p>
            )}
          </div>

          {/* Tier — limited to the memberships this family purchased */}
          <div className="space-y-2">
            <Label>Subscription Plan</Label>
            {tierOptions.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                All of your memberships have been assigned to your other children.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {tierOptions.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => onChange(child.uid, { tier: t.value })}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        child.tier === t.value
                          ? "border-[#DD4B39] bg-[#DD4B39]/5"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="font-medium text-sm">{t.label}</div>
                      <div className="text-xs text-gray-500">{t.age}</div>
                    </button>
                  ))}
                </div>
                {constrainedToPurchase && (
                  <p className="text-xs text-gray-500">
                    {tierOptions.length === 1
                      ? "This is the membership you purchased for this child."
                      : "We've suggested a plan based on their age — tap another to change it."}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Interests */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Interests{" "}
                <span className="font-normal text-gray-400">(pick up to 10 that best describe your child)</span>
              </Label>
              <span className="text-xs text-gray-400">{child.interests.length}/10</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {INTERESTS.map((interest) => {
                const selected = child.interests.includes(interest);
                const maxed = !selected && child.interests.length >= 10;
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    disabled={maxed}
                    className={`rounded-full px-3 py-1 text-sm font-medium border transition-all ${
                      selected
                        ? "bg-[#DD4B39] text-white border-[#DD4B39]"
                        : maxed
                        ? "bg-white text-gray-300 border-gray-100 cursor-not-allowed"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">
              We use these to find a pen pal with similar interests — the more you pick, the better the match!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token");

  const { data: parent, isLoading, error: loadError } = useQuery<Parent>({
    queryKey: ["onboarding", token],
    queryFn: () => customFetch<Parent>(`/api/onboarding/${token}`),
    enabled: !!token,
    retry: false,
  });

  // Phase 8: the memberships this family actually bought. Empty for accounts
  // created before we tracked purchases — those keep the old "any tier" flow.
  const purchasedTiers = useMemo(
    () => (parent?.available_memberships ?? []).map((m) => m.tier),
    [parent],
  );
  const constrainedToPurchase = purchasedTiers.length > 0;

  const defaultTier = parent?.membership_tier || "Core";
  const [children, setChildren] = useState<ChildForm[]>([newChild(defaultTier)]);

  // Once the purchase loads, seed the first child with a membership they own.
  useEffect(() => {
    if (!constrainedToPurchase) return;
    setChildren((prev) =>
      prev.length === 1 && !prev[0].date_of_birth && !purchasedTiers.includes(prev[0].tier)
        ? [{ ...prev[0], tier: purchasedTiers[0] }]
        : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constrainedToPurchase, purchasedTiers.join("|")]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [submitted, setSubmitted] = useState(false);
  const [submittedNames, setSubmittedNames] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Guardian attestation — all four boxes required before the form can submit.
  const [attested, setAttested] = useState<boolean[]>(
    () => GUARDIAN_ATTESTATION_STATEMENTS.map(() => false),
  );
  const allAttested = attested.every(Boolean);
  const toggleAttestation = (i: number) =>
    setAttested((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  // A5 — Turnstile bot check (token sent with the first submit call).
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // A4 — address step: editable address, required type (no default), sharing consent.
  const [address, setAddress] = useState("");
  const [addressType, setAddressType] = useState("");
  const [addressShareAck, setAddressShareAck] = useState(false);
  const addressPrefilled = useRef(false);
  useEffect(() => {
    // Prefill the address from checkout once, but let the parent edit it freely.
    if (!addressPrefilled.current && parent?.mailing_address) {
      setAddress(parent.mailing_address);
      addressPrefilled.current = true;
    }
    if (!addressType && parent?.address_type && ADDRESS_TYPES.includes(parent.address_type)) {
      // Only pre-select if checkout gave a recognised type; otherwise force a choice.
      setAddressType(parent.address_type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent]);
  // A6: a Give-a-Key family has no address to give yet, so the address itself
  // is optional for them. The type and the sharing agreement are still required
  // — they're agreeing to share whichever address ends up on the account.
  const awaitingGakAddress = addressType === GAK_ADDRESS_TYPE;
  const addressComplete =
    (address.trim().length > 0 || awaitingGakAddress) && !!addressType && addressShareAck;

  const updateChild = (uid: string, updates: Partial<ChildForm>) => {
    setChildren((prev) => prev.map((c) => c.uid === uid ? { ...c, ...updates } : c));
  };

  const removeChild = (uid: string) => {
    setChildren((prev) => prev.filter((c) => c.uid !== uid));
  };

  // A family can only enrol as many children as memberships they purchased.
  const canAddChild = !constrainedToPurchase || children.length < purchasedTiers.length;

  const addChild = () => {
    if (!canAddChild) return;
    setChildren((prev) => {
      const remaining = tiersAvailableFor(purchasedTiers, prev, "");
      const tier = constrainedToPurchase
        ? remaining[0] ?? purchasedTiers[0]
        : parent?.membership_tier || "Core";
      return [...prev.map((c) => ({ ...c, expanded: false })), newChild(tier)];
    });
  };

  const canSubmit = children.every((c) => {
    const age = calcAge(c.date_of_birth);
    return c.child_first_name.trim().length > 0 && age !== null;
  }) && addressComplete && allAttested && !!turnstileToken && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setGlobalError(null);
    setProgress({ done: 0, total: children.length });

    // Record the guardian attestation once, before any child, so the account has
    // a documented, timestamped agreement even if a child save later fails.
    try {
      await customFetch(`/api/onboarding/${token}/attestation`, {
        method: "POST",
        body: JSON.stringify({
          agreed: true,
          turnstile_token: turnstileToken,
          mailing_address: address.trim(),
          address_type: addressType,
          address_share_ack: addressShareAck,
        }),
      });
    } catch (err) {
      setSubmitting(false);
      setGlobalError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't record your confirmation. Please try again.",
      );
      return;
    }

    const succeeded: string[] = [];
    const failed: string[] = [];
    let firstErrorMessage: string | null = null;

    for (const child of children) {
      try {
        await customFetch(`/api/onboarding/${token}/child`, {
          method: "POST",
          body: JSON.stringify({
            child_first_name: child.child_first_name.trim(),
            date_of_birth: child.date_of_birth,
            tier: child.tier,
            interests: child.interests,
          }),
        });
        succeeded.push(child.child_first_name.trim());
      } catch (err) {
        failed.push(child.child_first_name.trim());
        if (!firstErrorMessage && err instanceof Error && err.message) {
          firstErrorMessage = err.message;
        }
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    if (succeeded.length > 0 && failed.length === 0) {
      setSubmittedNames(succeeded);
      setSubmitted(true);
    } else if (succeeded.length > 0) {
      // Partial success — say exactly who didn't save so nobody is silently lost.
      setSubmittedNames(succeeded);
      setSubmitted(true);
      setGlobalError(
        `We saved ${succeeded.join(", ")}, but couldn't save ${failed.join(", ")}. ${firstErrorMessage ?? ""}`.trim(),
      );
    } else {
      setGlobalError(
        firstErrorMessage ??
          "Something went wrong. Please try again or contact us if the problem continues.",
      );
    }
    setSubmitting(false);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (!token) {
    return <ErrorScreen message="This link is missing its access code. Please use the exact link from your welcome email." />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF9F4]">
        <Loader2 className="w-8 h-8 animate-spin text-[#DD4B39]" />
      </div>
    );
  }

  if (loadError || !parent) {
    return <ErrorScreen message="This link is invalid or has already been used. Please contact us if you need help getting started." />;
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF9F4] p-4">
        <div className="text-center space-y-6 max-w-md">
          <img
            src={`${import.meta.env.BASE_URL}mailday-logo.png`}
            alt="MailDay"
            className="h-12 mx-auto"
          />
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Georgia, serif" }}>
              {submittedNames.length === 1
                ? `${submittedNames[0]} is on the list!`
                : "You're all set!"}
            </h1>
            {submittedNames.length === 1 ? (
              <p className="text-gray-600 mt-3 text-lg leading-relaxed">
                We've added <strong>{submittedNames[0]}</strong> to our matching queue. As soon as we find their perfect pen pal, we'll send you an introduction email!
              </p>
            ) : (
              <div className="mt-3 space-y-1">
                <p className="text-gray-600 text-lg">
                  We've added the following children to our matching queue:
                </p>
                <ul className="font-semibold text-gray-800 mt-2 space-y-1">
                  {submittedNames.map((n) => (
                    <li key={n}>✓ {n}</li>
                  ))}
                </ul>
                <p className="text-gray-600 mt-3 text-base leading-relaxed">
                  As soon as we find each child's perfect pen pal, we'll send you an introduction email!
                </p>
              </div>
            )}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>What happens next?</strong> Our matching team will hand-pick a pen pal based on age, interests, and location. Matches typically take 5–10 business days.
          </div>

          {/* The 21-day guarantee, in the parent's own words. The 21 days are
              counted from match_guarantee_start_date and enforced by the
              guarantee-breach job; the pause is cleared automatically when the
              match is created. */}
          <div className="bg-[#FFD43B] rounded-xl p-5 text-left space-y-3">
            <span className="inline-block bg-[#1A1A1A] text-white text-[11px] font-bold uppercase tracking-widest rounded-full px-3.5 py-1.5">
              21-Day Promise
            </span>
            <p className="text-[15px] text-[#1A1A1A] leading-relaxed">
              Every match is proposed by our matching software and then reviewed by a person, so now and
              then it takes a little longer. If a pen pal isn't confirmed within 21 days of joining, we
              pause your billing automatically until the match is made — nothing for you to do, no email
              to send. We'd rather find the right match than rush one.
            </p>
          </div>

          <p className="text-xs text-gray-400">Questions? Reply to your welcome email and we'll get back to you.</p>
        </div>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#FFF9F4] py-10 px-4">
      <div className="max-w-xl mx-auto space-y-7">

        {/* Logo + hero */}
        <div className="text-center space-y-4">
          <img
            src={`${import.meta.env.BASE_URL}mailday-logo.png`}
            alt="MailDay"
            className="h-14 mx-auto"
          />
          <div>
            <h1 className="text-3xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Georgia, serif" }}>
              Welcome, {parent.first_name}! 🎉
            </h1>
            <p className="text-gray-600 mt-2 text-base leading-relaxed">
              You're officially a MailDay family. Fill out the form below so we can find each child the perfect pen pal.
            </p>
          </div>
        </div>

        {/* Instructions card */}
        <Card className="border-0 bg-[#DD4B39]/5 shadow-none">
          <CardContent className="pt-4 pb-4 space-y-2">
            <p className="text-sm font-semibold text-[#DD4B39]">Before you start:</p>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>📋 <strong>One section per child</strong> — if you have multiple children, click "Add another child" below</li>
              <li>🎂 <strong>Date of birth</strong> helps us match by age</li>
              <li>💡 <strong>Interests</strong> are the most important part — the more you pick, the better the match!</li>
              <li>✅ Submit once at the end — we'll add all your children at the same time</li>
            </ul>
          </CardContent>
        </Card>

        {/* Child sections */}
        <div className="space-y-4">
          {children.map((child, i) => (
            <ChildSection
              key={child.uid}
              child={child}
              index={i}
              total={children.length}
              availableTiers={tiersAvailableFor(purchasedTiers, children, child.uid)}
              constrainedToPurchase={constrainedToPurchase}
              onChange={updateChild}
              onRemove={removeChild}
            />
          ))}
        </div>

        {/* Add another child — capped at the number of memberships purchased */}
        {canAddChild ? (
          <button
            type="button"
            onClick={addChild}
            className="w-full py-3 border-2 border-dashed border-[#DD4B39]/40 rounded-xl text-[#DD4B39] text-sm font-medium hover:border-[#DD4B39] hover:bg-[#DD4B39]/5 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add another child
            {constrainedToPurchase && (
              <span className="text-xs text-[#DD4B39]/70">
                ({purchasedTiers.length - children.length} membership
                {purchasedTiers.length - children.length === 1 ? "" : "s"} left)
              </span>
            )}
          </button>
        ) : constrainedToPurchase ? (
          <p className="text-center text-xs text-gray-500">
            You've added a child for each membership you purchased. Need another?{" "}
            <a href="https://joinmailday.com/start" className="text-[#DD4B39] underline">
              Add a membership
            </a>
            .
          </p>
        ) : null}

        <Separator />

        {/* Address step (A4) — confirm/edit address, required type, sharing consent */}
        <div className="space-y-4 bg-white border rounded-xl p-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">Where should letters be delivered?</p>
            <p className="text-xs text-gray-500 mt-0.5">
              This is the address from your subscription — please check it's correct, and fix any typo before letters go out.
            </p>
          </div>

          {/* A6: a family waiting on a Give-a-Key PO Box has no address to
              type, so we explain what happens next instead of showing them a
              field they can't fill. */}
          {awaitingGakAddress ? (
            <div className="rounded-lg bg-[#FFF9F4] border border-[#DD4B39]/15 p-3 space-y-1">
              <p className="text-sm font-medium text-gray-800">We'll add your PO Box once it's set up</p>
              <p className="text-xs text-gray-600">
                No address needed right now. When your Give a Key PO Box is ready, send us the receipt and
                we'll email you a link to confirm the address. Your child joins the pen pal queue the moment
                that's done — nothing is posted anywhere before then.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="onb-address">Mailing address</Label>
              <Input
                id="onb-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, city, state, ZIP"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Address type</Label>
            <div className="grid grid-cols-3 gap-2">
              {ADDRESS_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAddressType(t)}
                  className={`p-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    addressType === t
                      ? "border-[#DD4B39] bg-[#DD4B39]/5"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* Own row: the label is long, and an APO/FPO/DPO address is not
                honestly any of the other three. */}
            <button
              type="button"
              onClick={() => setAddressType(MILITARY_ADDRESS_TYPE)}
              className={`w-full p-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                addressType === MILITARY_ADDRESS_TYPE
                  ? "border-[#DD4B39] bg-[#DD4B39]/5"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              Military (APO/FPO/DPO)
            </button>
            {addressType === MILITARY_ADDRESS_TYPE && (
              <p className="text-xs text-gray-500">
                Write it the way the post office expects — your PSC or unit on the street line, then
                APO, FPO or DPO as the city, and AA, AE or AP as the state.
              </p>
            )}
            {/* Full width on its own row: the label is long, and it's a
                different kind of answer from the other three. */}
            <button
              type="button"
              onClick={() => setAddressType(GAK_ADDRESS_TYPE)}
              className={`w-full p-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                addressType === GAK_ADDRESS_TYPE
                  ? "border-[#DD4B39] bg-[#DD4B39]/5"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              I'm setting up a PO Box through Give a Key
            </button>
            {!addressType && (
              <p className="text-xs text-gray-400">Please choose one — we don't set a default on purpose.</p>
            )}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-700">
            <input
              type="checkbox"
              checked={addressShareAck}
              onChange={() => setAddressShareAck((v) => !v)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#DD4B39] focus:ring-[#DD4B39] cursor-pointer"
            />
            <span>{ADDRESS_SHARE_CONSENT_TEXT}</span>
          </label>
        </div>

        {/* Guardian attestation — all four required before submitting */}
        <div className="space-y-3 bg-[#FFF9F4] border border-[#DD4B39]/15 rounded-xl p-4">
          <p className="text-sm font-semibold text-gray-800">Before you finish, please confirm:</p>
          <div className="space-y-2.5">
            {GUARDIAN_ATTESTATION_STATEMENTS.map((statement, i) => (
              <label key={i} className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={attested[i]}
                  onChange={() => toggleAttestation(i)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#DD4B39] focus:ring-[#DD4B39] cursor-pointer"
                />
                <span>{statement}</span>
              </label>
            ))}
          </div>
        </div>

        {/* A5 — bot check */}
        <Turnstile onVerify={setTurnstileToken} />

        {/* Global error */}
        {globalError && (
          <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {globalError}
          </div>
        )}

        {/* Validation nudge */}
        {!canSubmit && !submitting && (
          <p className="text-xs text-center text-gray-400">
            {!(children.every((c) => c.child_first_name.trim() && calcAge(c.date_of_birth) !== null))
              ? "Please fill in a name and date of birth for each child before submitting."
              : !addressComplete
              ? awaitingGakAddress
                ? "Please agree to sharing to continue."
                : "Please confirm your address, pick an address type, and agree to sharing."
              : !allAttested
              ? "Please check all four boxes above to continue."
              : "Please complete the verification above to continue."}
          </p>
        )}

        {/* Submit */}
        <Button
          size="lg"
          className="w-full bg-[#DD4B39] hover:bg-[#c43f2e] text-white h-13 text-base"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Adding {children[progress.done]?.child_first_name || "children"}…{" "}
              ({progress.done}/{progress.total})
            </>
          ) : (
            `Submit${children.length > 1 ? ` all ${children.length} children` : ""}`
          )}
        </Button>

        <p className="text-center text-xs text-gray-400 pb-4">
          MailDay — submitted for {parent.email}
        </p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFF9F4] p-4">
      <div className="text-center space-y-4 max-w-sm">
        <img
          src={`${import.meta.env.BASE_URL}mailday-logo.png`}
          alt="MailDay"
          className="h-12 mx-auto"
        />
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7 text-[#DD4B39]" />
        </div>
        <h1 className="text-xl font-bold text-[#1A1A1A]">Link not found</h1>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
}

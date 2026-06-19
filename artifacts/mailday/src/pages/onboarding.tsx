import { useState, useMemo } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Loader2, AlertCircle, Cake, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

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

interface Parent {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  membership_tier: string | null;
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

// ─── Child Form Section ───────────────────────────────────────────────────────

interface ChildSectionProps {
  child: ChildForm;
  index: number;
  total: number;
  onChange: (uid: string, updates: Partial<ChildForm>) => void;
  onRemove: (uid: string) => void;
}

function ChildSection({ child, index, total, onChange, onRemove }: ChildSectionProps) {
  const age = useMemo(() => calcAge(child.date_of_birth), [child.date_of_birth]);

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

          {/* Tier */}
          <div className="space-y-2">
            <Label>Subscription Plan</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIERS.map((t) => (
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

  const defaultTier = parent?.membership_tier || "Core";
  const [children, setChildren] = useState<ChildForm[]>([newChild(defaultTier)]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [submitted, setSubmitted] = useState(false);
  const [submittedNames, setSubmittedNames] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const updateChild = (uid: string, updates: Partial<ChildForm>) => {
    setChildren((prev) => prev.map((c) => c.uid === uid ? { ...c, ...updates } : c));
  };

  const removeChild = (uid: string) => {
    setChildren((prev) => prev.filter((c) => c.uid !== uid));
  };

  const addChild = () => {
    const tier = parent?.membership_tier || "Core";
    setChildren((prev) => [
      ...prev.map((c) => ({ ...c, expanded: false })),
      newChild(tier),
    ]);
  };

  const canSubmit = children.every((c) => {
    const age = calcAge(c.date_of_birth);
    return c.child_first_name.trim().length > 0 && age !== null;
  }) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setGlobalError(null);
    setProgress({ done: 0, total: children.length });

    const succeeded: string[] = [];
    const failed: string[] = [];

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
      } catch {
        failed.push(child.child_first_name.trim());
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    if (succeeded.length > 0) {
      setSubmittedNames(succeeded);
      setSubmitted(true);
    } else {
      setGlobalError("Something went wrong. Please try again or contact us if the problem continues.");
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
              <li>🎂 <strong>Date of birth</strong> helps us match by age and send birthday reminders to their pen pal</li>
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
              onChange={updateChild}
              onRemove={removeChild}
            />
          ))}
        </div>

        {/* Add another child */}
        <button
          type="button"
          onClick={addChild}
          className="w-full py-3 border-2 border-dashed border-[#DD4B39]/40 rounded-xl text-[#DD4B39] text-sm font-medium hover:border-[#DD4B39] hover:bg-[#DD4B39]/5 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add another child
        </button>

        <Separator />

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
            Please fill in a name and date of birth for each child before submitting.
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

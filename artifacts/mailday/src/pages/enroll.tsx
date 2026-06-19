import { useState, useMemo } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, Loader2, AlertCircle, Cake, Plus, Trash2,
  ChevronDown, ChevronUp, User, Star, Mail,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERESTS = [
  "Animals", "Art & Drawing", "Basketball", "Board Games", "Baking",
  "Cooking", "Crafts", "Dance", "Dinosaurs", "Gardening",
  "Hiking", "Lego", "Math", "Music", "Nature",
  "Painting", "Pets", "Photography", "Puzzles", "Reading",
  "Robotics", "Science", "Soccer", "Swimming", "Theater",
  "Travel", "Video Games", "Writing",
];

const DOB_MIN = new Date(new Date().getFullYear() - 18, 0, 1).toISOString().split("T")[0];
const DOB_MAX = new Date(new Date().getFullYear() - 1, 11, 31).toISOString().split("T")[0];

const TICKER_ITEMS = [
  "Matched within 5–7 days",
  "Hand-picked by humans",
  "Ages 3–12",
  "Real letters. Real kids.",
  "COPPA compliant",
  "No wifi required",
  "Cancel any time",
];

const STEPS = [
  {
    num: 1,
    icon: <User className="w-7 h-7 text-[#DD4B39]" />,
    title: "Tell us about your child",
    desc: "Age, interests, personality — everything we need to find the right match.",
  },
  {
    num: 2,
    icon: <Star className="w-7 h-7 text-[#DD4B39]" />,
    title: "We find their match",
    desc: "Thoughtful, hand-considered matching within 5–7 days of submitting.",
  },
  {
    num: 3,
    icon: <Mail className="w-7 h-7 text-[#DD4B39]" />,
    title: "Write, send, wait, squeal",
    desc: "Monthly packs arrive with everything needed to send something wonderful.",
  },
];


// ─── Types ────────────────────────────────────────────────────────────────────

interface ChildForm {
  uid: string;
  child_first_name: string;
  date_of_birth: string;
  interests: string[];
  expanded: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let uidCounter = 0;
function newChild(): ChildForm {
  return { uid: String(++uidCounter), child_first_name: "", date_of_birth: "", interests: [], expanded: true };
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

// ─── Scrolling ticker ─────────────────────────────────────────────────────────

function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="overflow-hidden bg-[#DD4B39] py-2.5 select-none">
      <div
        className="flex gap-0 whitespace-nowrap"
        style={{ animation: "ticker 28s linear infinite", width: "max-content" }}
      >
        {items.map((item, i) => (
          <span key={i} className="text-white text-sm font-medium px-6 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/50" />
            {item}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

// ─── Child Section ────────────────────────────────────────────────────────────

function ChildSection({
  child, index, total, onChange, onRemove,
}: {
  child: ChildForm;
  index: number;
  total: number;
  onChange: (uid: string, u: Partial<ChildForm>) => void;
  onRemove: (uid: string) => void;
}) {
  const age = useMemo(() => calcAge(child.date_of_birth), [child.date_of_birth]);
  const isComplete = !!(child.child_first_name.trim() && age !== null);

  const toggleInterest = (interest: string) => {
    const prev = child.interests;
    const next = prev.includes(interest)
      ? prev.filter((i) => i !== interest)
      : prev.length < 10 ? [...prev, interest] : prev;
    onChange(child.uid, { interests: next });
  };

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#E8D5C4]">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-[#F0F8FD] transition-colors cursor-pointer"
        onClick={() => onChange(child.uid, { expanded: !child.expanded })}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(child.uid, { expanded: !child.expanded }); }}
      >
        <div className="flex items-center gap-4">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
            isComplete ? "bg-green-500 text-white" : "bg-[#DD4B39] text-white"
          }`}>
            {isComplete ? <CheckCircle2 className="w-5 h-5" /> : index + 1}
          </div>
          <div className="text-left">
            <div className="font-bold text-[#1A1A1A]">
              {child.child_first_name.trim() || `Child ${index + 1}`}
            </div>
            {age !== null && (
              <div className="text-sm text-[#8B6F5E]">{age} years old</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {total > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(child.uid); }}
              onKeyDown={(e) => e.stopPropagation()}
              className="p-2 rounded-lg text-[#8B6F5E] hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Remove child"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {child.expanded
            ? <ChevronUp className="w-5 h-5 text-[#8B6F5E]" />
            : <ChevronDown className="w-5 h-5 text-[#8B6F5E]" />
          }
        </div>
      </div>

      {child.expanded && (
        <div className="px-6 pb-6 space-y-6 border-t border-[#F0E0D0]">
          <div className="space-y-2 pt-5">
            <Label htmlFor={`name-${child.uid}`} className="text-[#1A1A1A] font-semibold">
              Child's first name <span className="text-[#DD4B39]">*</span>
            </Label>
            <Input
              id={`name-${child.uid}`}
              placeholder="e.g. Emma"
              value={child.child_first_name}
              onChange={(e) => onChange(child.uid, { child_first_name: e.target.value })}
              maxLength={50}
              className="h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`dob-${child.uid}`} className="text-[#1A1A1A] font-semibold flex items-center gap-1.5">
              <Cake className="w-4 h-4 text-[#DD4B39]" />
              Date of birth <span className="text-[#DD4B39]">*</span>
            </Label>
            <Input
              id={`dob-${child.uid}`}
              type="date"
              value={child.date_of_birth}
              onChange={(e) => onChange(child.uid, { date_of_birth: e.target.value })}
              min={DOB_MIN}
              max={DOB_MAX}
              className="h-12 w-56 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
            />
            {child.date_of_birth && (
              <p className="text-sm text-[#8B6F5E]">
                {age !== null ? `${age} years old` : "Please enter a valid birth date (ages 1–18)."}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[#1A1A1A] font-semibold">
                What does your child love?
              </Label>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#DD4B39]/10 text-[#DD4B39]">
                {child.interests.length}/10
              </span>
            </div>
            <p className="text-sm text-[#8B6F5E] -mt-1">
              Pick up to 10 — the more you choose, the better the match!
            </p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((interest) => {
                const selected = child.interests.includes(interest);
                const maxed = !selected && child.interests.length >= 10;
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    disabled={maxed}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium border-2 transition-all ${
                      selected
                        ? "bg-[#DD4B39] text-white border-[#DD4B39] shadow-sm"
                        : maxed
                        ? "bg-white text-gray-300 border-gray-100 cursor-not-allowed"
                        : "bg-white text-[#1A1A1A] border-[#E8D5C4] hover:border-[#4AADDE] hover:bg-[#4AADDE]/10 hover:text-[#2a8ab5]"
                    }`}
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Success Screen ───────────────────────────────────────────────────────────

function SuccessScreen({ names }: { names: string[] }) {
  return (
    <div className="min-h-screen bg-[#FEF6EC]">
      <Ticker />
      <div className="flex items-center justify-center py-20 px-4">
        <div className="text-center space-y-8 max-w-lg">
          <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12 mx-auto" />
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          <div>
            <p className="font-heading italic text-[#DD4B39] text-lg mb-2">You did it!</p>
            <h1 className="font-heading font-black text-4xl text-[#1A1A1A] leading-tight">
              {names.length === 1
                ? <>{names[0]} is<br />on the list!</>
                : <>{names.slice(0, -1).join(", ")} &amp; {names[names.length - 1]}<br />are on the list!</>
              }
            </h1>
            <p className="text-[#5C4033] mt-4 text-lg leading-relaxed">
              {names.length === 1
                ? `We'll hand-pick a pen pal for ${names[0]} within 5–7 days. You'll get an email introducing them to each other!`
                : `We'll find perfect pen pals for all ${names.length} of them within 5–7 days and email you the introductions!`
              }
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-[#E8D5C4] p-6 text-left space-y-3">
            <p className="font-bold text-[#1A1A1A]">What happens next:</p>
            <ul className="space-y-2 text-[#5C4033] text-sm">
              <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">1.</span> Our team reviews your child's profile</li>
              <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">2.</span> We find a compatible pen pal matched by age &amp; interests (within 5–7 days)</li>
              <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">3.</span> You'll get an intro email with their pen pal's name and address</li>
              <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">4.</span> Monthly packs arrive with everything they need to write!</li>
            </ul>
          </div>
          <p className="text-sm text-[#8B6F5E]">
            Questions? Email us at{" "}
            <a href="mailto:hello@joinmailday.com" className="underline hover:text-[#4AADDE] transition-colors">
              hello@joinmailday.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Enroll() {
  const params = new URLSearchParams(window.location.search);
  const isPreviewSuccess = params.get("preview") === "success";

  const [email, setEmail] = useState("");
  const [addrType, setAddrType] = useState("");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [children, setChildren] = useState<ChildForm[]>([newChild()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedNames, setSubmittedNames] = useState<string[]>(["Emma"]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const updateChild = (uid: string, updates: Partial<ChildForm>) =>
    setChildren((prev) => prev.map((c) => c.uid === uid ? { ...c, ...updates } : c));

  const removeChild = (uid: string) =>
    setChildren((prev) => prev.filter((c) => c.uid !== uid));

  const addChild = () =>
    setChildren((prev) => [
      ...prev.map((c) => ({ ...c, expanded: false })),
      newChild(),
    ]);

  const emailValid = email.trim().includes("@") && email.trim().includes(".");
  const addressValid = !!(addrType && addrLine1.trim() && addrCity.trim() && addrState.trim() && addrZip.trim());
  const childrenValid = children.every((c) => c.child_first_name.trim() && calcAge(c.date_of_birth) !== null);
  const canSubmit = emailValid && addressValid && childrenValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setGlobalError(null);
    try {
      const mailingAddress = [addrType, addrLine1.trim(), addrLine2.trim(), addrCity.trim(), addrState.trim(), addrZip.trim()]
        .filter(Boolean).join(", ");

      await customFetch("/api/enroll", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          mailing_address: mailingAddress || undefined,
          children: children.map((c) => ({
            child_first_name: c.child_first_name.trim(),
            date_of_birth: c.date_of_birth,
            interests: c.interests,
          })),
        }),
      });
      setSubmittedNames(children.map((c) => c.child_first_name.trim()));
      setSubmitted(true);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Something went wrong. Please try again or email us at hello@joinmailday.com."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted || isPreviewSuccess) {
    return <SuccessScreen names={submittedNames} />;
  }

  return (
    <div className="min-h-screen bg-[#FEF6EC]">

      {/* Header */}
      <div className="flex justify-center pt-8 pb-2 px-4">
        <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12" />
      </div>

      {/* Hero */}
      <div className="text-center px-4 py-10 max-w-2xl mx-auto">
        <p className="font-heading italic text-[#DD4B39] text-xl mb-3">Almost there!</p>
        <h1 className="font-heading font-black text-5xl md:text-6xl text-[#1A1A1A] leading-tight">
          One quick form.<br />
          <span className="text-[#DD4B39]">One very happy mailbox.</span>
        </h1>
        <p className="text-[#5C4033] mt-5 text-lg leading-relaxed max-w-lg mx-auto">
          Tell us a little about your child and we'll hand-pick the perfect pen pal — matched by age and interests.
        </p>
      </div>

      {/* Ticker */}
      <Ticker />

      {/* 3-step cards */}
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="grid grid-cols-3 gap-4">
          {STEPS.map((step, i) => (
            <div key={step.num} className="relative">
              <div className="bg-white rounded-2xl p-5 text-center border border-[#E8D5C4] shadow-sm h-full flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-[#DD4B39] text-white text-sm font-bold flex items-center justify-center mb-3">
                  {step.num}
                </div>
                <div className="mb-3 flex items-center justify-center w-14 h-14 rounded-2xl bg-[#DD4B39]/5">
                  {step.icon}
                </div>
                <p className="font-bold text-[#1A1A1A] text-sm leading-snug mb-1">{step.title}</p>
                <p className="text-xs text-[#8B6F5E] leading-relaxed">{step.desc}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="absolute top-1/3 -right-2.5 z-10 text-[#DD4B39] font-bold text-lg select-none">→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="max-w-xl mx-auto px-4 pb-16 space-y-6">

        {/* Email */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6">
          <Label htmlFor="email" className="text-[#1A1A1A] font-bold text-base block mb-1">
            Your email address <span className="text-[#DD4B39]">*</span>
          </Label>
          <p className="text-sm text-[#8B6F5E] mb-3">Use the email address from your MailDay subscription.</p>
          <Input
            id="email"
            type="email"
            placeholder="jane@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
          />
        </div>

        {/* Mailing address */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <div>
            <Label className="text-[#1A1A1A] font-bold text-base block mb-1">
              Mailing address <span className="text-[#DD4B39]">*</span>
            </Label>
            <p className="text-sm text-[#8B6F5E]">
              Where should pen pal letters be delivered? This can be a home address, work address, or PO box — wherever is safest and most convenient for your family.
            </p>
          </div>
          <div className="space-y-3">
            <Select value={addrType} onValueChange={setAddrType}>
              <SelectTrigger className="h-12 text-base border-[#E8D5C4] focus:ring-[#4AADDE]/40 data-[placeholder]:text-muted-foreground">
                <SelectValue placeholder="Address type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Home">🏠 Home address</SelectItem>
                <SelectItem value="Work">🏢 Work address</SelectItem>
                <SelectItem value="PO Box">📬 PO Box</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Street address"
              value={addrLine1}
              onChange={(e) => setAddrLine1(e.target.value)}
              className="h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
            />
            <Input
              placeholder="Apt, suite, unit (optional)"
              value={addrLine2}
              onChange={(e) => setAddrLine2(e.target.value)}
              className="h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
            />
            <div className="grid grid-cols-3 gap-3">
              <Input
                placeholder="City"
                value={addrCity}
                onChange={(e) => setAddrCity(e.target.value)}
                className="col-span-1 h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
              />
              <Input
                placeholder="State"
                value={addrState}
                onChange={(e) => setAddrState(e.target.value)}
                maxLength={2}
                className="col-span-1 h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40 uppercase"
              />
              <Input
                placeholder="ZIP"
                value={addrZip}
                onChange={(e) => setAddrZip(e.target.value)}
                maxLength={10}
                className="col-span-1 h-12 text-base border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
              />
            </div>
          </div>
        </div>

        {/* Divider label */}
        <div className="flex items-center gap-3">
          <Separator className="flex-1 bg-[#E8D5C4]" />
          <span className="font-heading font-black text-[#DD4B39] text-sm uppercase tracking-widest whitespace-nowrap">
            Now about your kid{children.length > 1 ? "s" : ""}
          </span>
          <Separator className="flex-1 bg-[#E8D5C4]" />
        </div>

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
          className="w-full py-4 border-2 border-dashed border-[#4AADDE]/40 rounded-2xl text-[#4AADDE] font-semibold hover:border-[#4AADDE] hover:bg-[#4AADDE]/5 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add another child
        </button>

        {/* Error */}
        {globalError && (
          <div className="flex items-start gap-3 text-red-700 text-sm bg-red-50 border border-red-200 p-4 rounded-2xl">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{globalError}</span>
          </div>
        )}

        {/* Hint */}
        {!canSubmit && !submitting && (
          <p className="text-sm text-center text-[#8B6F5E]">
            {!emailValid
              ? "Enter your subscription email address to continue."
              : !addressValid
              ? "Please enter the mailing address where letters should be delivered."
              : "Fill in a name and birthday for each child to submit."}
          </p>
        )}

        {/* Submit */}
        <Button
          size="lg"
          className="w-full h-14 text-lg font-bold rounded-2xl bg-[#DD4B39] hover:bg-[#4AADDE] text-white shadow-md hover:shadow-lg transition-all"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Submitting…</>
          ) : (
            <>
              {children.length > 1 ? `Submit all ${children.length} children` : "Submit — find my child's pen pal!"}
            </>
          )}
        </Button>

        <p className="text-center text-xs text-[#8B6F5E] pb-2">
          Questions? Email{" "}
          <a href="mailto:hello@joinmailday.com" className="underline hover:text-[#4AADDE] transition-colors">
            hello@joinmailday.com
          </a>
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, AlertCircle, Gift } from "lucide-react";
import { US_STATES } from "@/lib/us-states";

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERESTS = [
  "Animals", "Art & Drawing", "Basketball", "Board Games", "Baking",
  "Cooking", "Crafts", "Dance", "Dinosaurs", "Gardening",
  "Hiking", "Lego", "Math", "Music", "Nature",
  "Painting", "Pets", "Photography", "Puzzles", "Reading",
  "Robotics", "Science", "Soccer", "Swimming", "Theater",
  "Travel", "Video Games", "Writing",
];

// ─── Ticker ───────────────────────────────────────────────────────────────────

const TICKER = [
  "No income verification required",
  "PO Box setup costs covered",
  "Applied for by families",
  "Funded by donors",
  "Response within 48 hours",
  "COPPA compliant",
];

function Ticker() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="overflow-hidden bg-[#DD4B39] py-2.5 select-none">
      <div className="flex whitespace-nowrap" style={{ animation: "ticker 28s linear infinite", width: "max-content" }}>
        {items.map((item, i) => (
          <span key={i} className="text-white text-sm font-medium px-6 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/50" />
            {item}
          </span>
        ))}
      </div>
      <style>{`@keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function GiveAKeyApply() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [addrType, setAddrType] = useState("");
  const [mailingAddress, setMailingAddress] = useState("");
  const [childFirstName, setChildFirstName] = useState("");
  const [childAge, setChildAge] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [statementOfNeed, setStatementOfNeed] = useState("");
  const [poBoxAck, setPoBoxAck] = useState(false);
  const [subscriptionAck, setSubscriptionAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : prev.length < 5 ? [...prev, interest] : prev
    );
  };

  const ageNum = parseInt(childAge, 10);
  const ageValid = ageNum >= 3 && ageNum <= 12;
  const emailValid = email.trim().includes("@") && email.trim().includes(".");
  const canSubmit =
    firstName.trim() && lastName.trim() && emailValid &&
    state && addrType && mailingAddress.trim() &&
    childFirstName.trim() && ageValid &&
    interests.length > 0 &&
    statementOfNeed.trim().length >= 20 &&
    poBoxAck && subscriptionAck && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await customFetch("/api/give-a-key/apply", {
        method: "POST",
        body: JSON.stringify({
          parent_first_name: firstName.trim(),
          parent_last_name: lastName.trim(),
          parent_email: email.trim().toLowerCase(),
          parent_phone: phone.trim() || undefined,
          state,
          address_type: addrType,
          mailing_address: `${addrType}, ${mailingAddress.trim()}`,
          child_first_name: childFirstName.trim(),
          child_age: ageNum,
          child_interests: interests,
          statement_of_need: statementOfNeed.trim(),
          po_box_acknowledgment: true,
          subscription_acknowledgment: true,
        }),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FEF6EC]">
        <Ticker />
        <div className="flex items-center justify-center py-20 px-4">
          <div className="text-center space-y-6 max-w-lg">
            <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12 mx-auto" />
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <div>
              <p className="font-heading italic text-[#DD4B39] text-lg mb-2">Application received!</p>
              <h1 className="font-heading font-black text-4xl text-[#1A1A1A] leading-tight">
                We'll be in touch<br />within 48 hours.
              </h1>
              <p className="text-[#5C4033] mt-4 text-lg leading-relaxed">
                You won't fall through the cracks. Our team reviews every application personally and will reach out to {firstName} by email.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E8D5C4] p-6 text-left space-y-2">
              <p className="font-bold text-[#1A1A1A] mb-3">What happens next:</p>
              <ul className="space-y-2 text-sm text-[#5C4033]">
                <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">1.</span> Our team reviews your application</li>
                <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">2.</span> You'll hear back within 48 hours with a decision</li>
                <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">3.</span> If approved, we send funds to cover your PO Box setup</li>
                <li className="flex items-start gap-2"><span className="text-[#DD4B39] font-bold mt-0.5">4.</span> Once your PO Box is set up, {childFirstName} gets matched with a pen pal!</li>
              </ul>
            </div>
            <p className="text-sm text-[#8B6F5E]">
              Questions? Email <a href="mailto:hello@joinmailday.com" className="underline hover:text-[#4AADDE] transition-colors">hello@joinmailday.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FEF6EC]">

      {/* Header */}
      <div className="flex justify-center pt-8 pb-2 px-4">
        <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12" />
      </div>

      {/* Hero */}
      <div className="text-center px-4 py-8 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-[#DD4B39]/10 text-[#DD4B39] px-4 py-1.5 rounded-full text-sm font-semibold mb-4">
          <Gift className="w-4 h-4" />
          Give a Key Program
        </div>
        <h1 className="font-heading font-black text-5xl text-[#1A1A1A] leading-tight">
          A PO Box opens<br />
          <span className="text-[#DD4B39]">a world of letters.</span>
        </h1>
        <p className="text-[#5C4033] mt-5 text-lg leading-relaxed max-w-lg mx-auto">
          Give a Key covers the cost of a PO Box setup so your child can safely participate in MailDay. No income verification — just tell us about your family.
        </p>
      </div>

      <Ticker />

      {/* Info cards */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="grid grid-cols-3 gap-4">
          {[
            { num: "1", title: "Apply here", desc: "Tell us about your child and why a PO Box would help." },
            { num: "2", title: "We review", desc: "Our team reads every application and responds within 48 hours." },
            { num: "3", title: "Funds sent", desc: "If approved, we cover your PO Box setup cost via Tremendous." },
          ].map((step) => (
            <div key={step.num} className="bg-white rounded-2xl p-5 text-center border border-[#E8D5C4] shadow-sm">
              <div className="w-8 h-8 rounded-full bg-[#DD4B39] text-white text-sm font-bold flex items-center justify-center mx-auto mb-3">
                {step.num}
              </div>
              <p className="font-bold text-[#1A1A1A] text-sm mb-1">{step.title}</p>
              <p className="text-xs text-[#8B6F5E] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="max-w-xl mx-auto px-4 pb-16 space-y-6">

        {/* Parent info */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <h2 className="font-bold text-[#1A1A1A] text-base">About you</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">First name <span className="text-[#DD4B39]">*</span></Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Last name <span className="text-[#DD4B39]">*</span></Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Email address <span className="text-[#DD4B39]">*</span></Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Phone number <span className="text-[#8B6F5E] font-normal">(optional)</span></Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000" className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">State <span className="text-[#DD4B39]">*</span></Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="h-11 border-[#E8D5C4]">
                <SelectValue placeholder="Select your state" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <div>
            <h2 className="font-bold text-[#1A1A1A] text-base mb-1">Current mailing address <span className="text-[#DD4B39]">*</span></h2>
            <p className="text-sm text-[#8B6F5E]">Where should we send correspondence? This is separate from the PO Box you're applying for.</p>
          </div>
          <Select value={addrType} onValueChange={setAddrType}>
            <SelectTrigger className="h-11 border-[#E8D5C4]">
              <SelectValue placeholder="Address type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Home">🏠 Home address</SelectItem>
              <SelectItem value="Work">🏢 Work address</SelectItem>
              <SelectItem value="PO Box">📬 Existing PO Box</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={mailingAddress}
            onChange={(e) => setMailingAddress(e.target.value)}
            placeholder="Full address"
            className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
          />
        </div>

        <div className="flex items-center gap-3">
          <Separator className="flex-1 bg-[#E8D5C4]" />
          <span className="font-heading font-black text-[#DD4B39] text-sm uppercase tracking-widest whitespace-nowrap">About your child</span>
          <Separator className="flex-1 bg-[#E8D5C4]" />
        </div>

        {/* Child info */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Child's first name <span className="text-[#DD4B39]">*</span></Label>
              <Input value={childFirstName} onChange={(e) => setChildFirstName(e.target.value)} placeholder="Emma" className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Age <span className="text-[#DD4B39]">*</span></Label>
              <Input
                type="number" min={3} max={12}
                value={childAge}
                onChange={(e) => setChildAge(e.target.value)}
                placeholder="3–12"
                className="h-11 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
              />
              {childAge && !ageValid && (
                <p className="text-xs text-red-500">Age must be between 3 and 12</p>
              )}
            </div>
          </div>

          {/* Interests */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">What does your child love? <span className="text-[#DD4B39]">*</span></Label>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#DD4B39]/10 text-[#DD4B39]">{interests.length}/5</span>
            </div>
            <p className="text-xs text-[#8B6F5E]">Pick up to 5 — helps us find the best pen pal match.</p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((interest) => {
                const selected = interests.includes(interest);
                const maxed = !selected && interests.length >= 5;
                return (
                  <button
                    key={interest}
                    type="button"
                    onClick={() => toggleInterest(interest)}
                    disabled={maxed}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium border-2 transition-all ${
                      selected ? "bg-[#DD4B39] text-white border-[#DD4B39]"
                      : maxed ? "bg-white text-gray-300 border-gray-100 cursor-not-allowed"
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

        {/* Statement of need */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-3">
          <div>
            <Label className="text-[#1A1A1A] font-bold text-base block mb-1">
              Tell us about your family <span className="text-[#DD4B39]">*</span>
            </Label>
            <p className="text-sm text-[#8B6F5E]">
              Why would a PO Box help your child participate in MailDay? No income verification or documentation required — just share what feels right.
            </p>
          </div>
          <Textarea
            value={statementOfNeed}
            onChange={(e) => setStatementOfNeed(e.target.value)}
            placeholder="Share a little about your family and why having a PO Box would make a difference for your child..."
            className="min-h-36 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40 resize-none"
          />
          <p className="text-xs text-[#8B6F5E] text-right">{statementOfNeed.length} characters</p>
        </div>

        {/* Acknowledgments */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <h2 className="font-bold text-[#1A1A1A]">Before you submit</h2>
          <div className="flex items-start gap-3">
            <Checkbox
              id="pobox-ack"
              checked={poBoxAck}
              onCheckedChange={(v) => setPoBoxAck(!!v)}
              className="mt-0.5 border-[#E8D5C4] data-[state=checked]:bg-[#DD4B39] data-[state=checked]:border-[#DD4B39]"
            />
            <Label htmlFor="pobox-ack" className="text-sm text-[#1A1A1A] leading-relaxed cursor-pointer">
              I understand that Give a Key covers the cost of my PO Box setup only. My monthly MailDay membership is a separate charge I am responsible for.
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="sub-ack"
              checked={subscriptionAck}
              onCheckedChange={(v) => setSubscriptionAck(!!v)}
              className="mt-0.5 border-[#E8D5C4] data-[state=checked]:bg-[#DD4B39] data-[state=checked]:border-[#DD4B39]"
            />
            <Label htmlFor="sub-ack" className="text-sm text-[#1A1A1A] leading-relaxed cursor-pointer">
              I understand that if approved, I will need to set up my own PO Box at my local USPS location using the funds provided.
            </Label>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 text-red-700 text-sm bg-red-50 border border-red-200 p-4 rounded-2xl">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full h-14 text-lg font-bold rounded-2xl bg-[#DD4B39] hover:bg-[#4AADDE] text-white shadow-md transition-all"
        >
          {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Submitting…</> : "Submit my application"}
        </Button>

        <p className="text-center text-xs text-[#8B6F5E] pb-2">
          Questions? Email <a href="mailto:hello@joinmailday.com" className="underline hover:text-[#4AADDE] transition-colors">hello@joinmailday.com</a>
        </p>
      </div>
    </div>
  );
}

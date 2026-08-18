import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Turnstile } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, AlertCircle, MailCheck, ShieldCheck } from "lucide-react";

function SuccessScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-[#FEF6EC] flex items-center justify-center py-20 px-4">
      <div className="text-center space-y-6 max-w-lg">
        <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12 mx-auto" />
        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <MailCheck className="w-12 h-12 text-green-600" />
        </div>
        <div>
          <h1 className="font-heading font-black text-3xl text-[#1A1A1A] leading-tight">Check your email</h1>
          <p className="text-[#5C4033] mt-4 text-lg leading-relaxed">{message}</p>
        </div>
        <p className="text-sm text-[#8B6F5E]">
          Didn't get it? Check your spam folder, or email us at{" "}
          <a href="mailto:hello@joinmailday.com" className="underline hover:text-[#4AADDE] transition-colors">
            hello@joinmailday.com
          </a>
        </p>
      </div>
    </div>
  );
}

export default function AddressChange() {
  const [email, setEmail] = useState("");
  const [addrType, setAddrType] = useState("");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null); // A5

  const emailValid = email.trim().includes("@") && email.trim().includes(".");
  const addressValid = !!(addrType && addrLine1.trim() && addrCity.trim() && addrState.trim() && addrZip.trim());
  const canSubmit = emailValid && addressValid && !!turnstileToken && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setGlobalError(null);
    try {
      const newAddress = [addrLine1.trim(), addrLine2.trim(), addrCity.trim(), addrState.trim(), addrZip.trim()]
        .filter(Boolean).join(", ");
      const res = await customFetch<{ ok: boolean; message: string }>("/api/address-change/request", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          new_address: newAddress,
          address_type: addrType,
          turnstile_token: turnstileToken,
        }),
      });
      setSuccessMsg(res.message);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Something went wrong. Please try again or email us at hello@joinmailday.com.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (successMsg) return <SuccessScreen message={successMsg} />;

  return (
    <div className="min-h-screen bg-[#FEF6EC]">
      <div className="flex justify-center pt-8 pb-2 px-4">
        <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12" />
      </div>

      <div className="text-center px-4 py-8 max-w-2xl mx-auto">
        <p className="font-heading italic text-[#DD4B39] text-xl mb-3">Moving? Moved?</p>
        <h1 className="font-heading font-black text-4xl md:text-5xl text-[#1A1A1A] leading-tight">
          Update your mailing address
        </h1>
        <p className="text-[#5C4033] mt-4 text-lg leading-relaxed max-w-lg mx-auto">
          Tell us where letters should go now. For your family's safety, we'll email a confirmation
          link to the address on file — the change only takes effect once you click it.
        </p>
      </div>

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

        {/* New address */}
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <div>
            <Label className="text-[#1A1A1A] font-bold text-base block mb-1">
              New mailing address <span className="text-[#DD4B39]">*</span>
            </Label>
            <p className="text-sm text-[#8B6F5E]">
              Where should pen pal letters be delivered now? A home address, work address, or PO box —
              whatever is safest and most convenient.
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
                <SelectItem value="Military (APO/FPO/DPO)">🎖️ Military (APO/FPO/DPO)</SelectItem>
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

        {/* Safety note */}
        <div className="rounded-2xl border bg-[#FFF5E6] border-[#F0D9A8] px-4 py-3 flex items-start gap-2 text-sm text-[#8a6d3b]">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            If your child is matched with a pen pal, we'll ask both families to reconfirm before any
            letter goes to the new address — so nothing is ever sent somewhere you didn't approve.
          </span>
        </div>

        {globalError && (
          <div className="flex items-start gap-3 text-red-700 text-sm bg-red-50 border border-red-200 p-4 rounded-2xl">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{globalError}</span>
          </div>
        )}

        {/* A5 — bot check */}
        <Turnstile onVerify={setTurnstileToken} />

        {!canSubmit && !submitting && (
          <p className="text-sm text-center text-[#8B6F5E]">
            {!emailValid
              ? "Enter your subscription email address to continue."
              : !addressValid
              ? "Please fill in your new mailing address."
              : "Please complete the verification above to continue."}
          </p>
        )}

        <Button
          size="lg"
          className="w-full h-14 text-lg font-bold rounded-2xl bg-[#DD4B39] hover:bg-[#4AADDE] text-white shadow-md hover:shadow-lg transition-all"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Sending…</>
          ) : (
            <><CheckCircle2 className="w-5 h-5 mr-2" />Email me the confirmation link</>
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

import { useState, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, AlertCircle, Upload, FileText, X } from "lucide-react";

function Ticker() {
  const items = ["Set up your PO Box at USPS", "Then come back here", "Submit your address and receipt", "We verify and activate your membership", "Your child gets matched!", "Set up your PO Box at USPS", "Then come back here", "Submit your address and receipt", "We verify and activate your membership", "Your child gets matched!"];
  return (
    <div className="overflow-hidden bg-[#DD4B39] py-2.5 select-none">
      <div className="flex whitespace-nowrap" style={{ animation: "ticker 30s linear infinite", width: "max-content" }}>
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

export default function GiveAKeyPoBox() {
  const [email, setEmail] = useState("");
  const [poBoxAddress, setPoBoxAddress] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emailValid = email.trim().includes("@") && email.trim().includes(".");
  const canSubmit = emailValid && poBoxAddress.trim() && receiptFile && !submitting;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!validTypes.includes(file.type)) {
      setError("Please upload a JPG, PNG, or PDF file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }
    setError(null);
    setReceiptFile(file);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !receiptFile) return;
    setSubmitting(true);
    setError(null);

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(receiptFile);
      });

      await customFetch("/api/give-a-key/po-box", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          po_box_address: poBoxAddress.trim(),
          receipt_data: base64,
          receipt_filename: receiptFile.name,
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
              <p className="font-heading italic text-[#DD4B39] text-lg mb-2">Receipt submitted!</p>
              <h1 className="font-heading font-black text-4xl text-[#1A1A1A] leading-tight">
                We're reviewing<br />your receipt.
              </h1>
              <p className="text-[#5C4033] mt-4 text-lg leading-relaxed">
                Our team will verify your receipt and activate your membership shortly. You'll receive an email once your child is ready to be matched!
              </p>
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
      <div className="flex justify-center pt-8 pb-2 px-4">
        <img src={`${import.meta.env.BASE_URL}mailday-logo.png`} alt="MailDay" className="h-12" />
      </div>

      <div className="text-center px-4 py-8 max-w-2xl mx-auto">
        <p className="font-heading italic text-[#DD4B39] text-xl mb-3">You did it!</p>
        <h1 className="font-heading font-black text-5xl text-[#1A1A1A] leading-tight">
          Submit your<br />
          <span className="text-[#DD4B39]">PO Box receipt.</span>
        </h1>
        <p className="text-[#5C4033] mt-5 text-lg leading-relaxed max-w-lg mx-auto">
          You've set up your PO Box — now submit your address and proof of setup so we can activate your child's MailDay membership.
        </p>
      </div>

      <Ticker />

      <div className="max-w-xl mx-auto px-4 py-8 pb-16 space-y-6">
        <div className="bg-white rounded-2xl border border-[#E8D5C4] shadow-sm p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#1A1A1A] font-bold">Your email address <span className="text-[#DD4B39]">*</span></Label>
            <p className="text-sm text-[#8B6F5E]">Use the email from your Give a Key application.</p>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="h-12 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#1A1A1A] font-bold">Your new PO Box address <span className="text-[#DD4B39]">*</span></Label>
            <p className="text-sm text-[#8B6F5E]">Include the full PO Box address as shown on your receipt.</p>
            <Input
              value={poBoxAddress}
              onChange={(e) => setPoBoxAddress(e.target.value)}
              placeholder="PO Box 1234, Springfield, IL 62701"
              className="h-12 border-[#E8D5C4] focus-visible:ring-[#4AADDE]/40"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[#1A1A1A] font-bold">Receipt <span className="text-[#DD4B39]">*</span></Label>
            <p className="text-sm text-[#8B6F5E]">Upload your USPS PO Box receipt — photo or PDF, under 10 MB.</p>

            {receiptFile ? (
              <div className="flex items-center gap-3 p-4 border-2 border-[#4AADDE]/40 bg-[#4AADDE]/5 rounded-xl">
                <FileText className="w-5 h-5 text-[#4AADDE] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A] truncate">{receiptFile.name}</p>
                  <p className="text-xs text-[#8B6F5E]">{(receiptFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setReceiptFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-[#8B6F5E] hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-[#E8D5C4] rounded-xl text-[#8B6F5E] hover:border-[#4AADDE]/50 hover:bg-[#4AADDE]/5 hover:text-[#4AADDE] transition-all flex flex-col items-center gap-2"
              >
                <Upload className="w-6 h-6" />
                <span className="font-medium">Click to upload receipt</span>
                <span className="text-xs">JPG, PNG, or PDF — max 10 MB</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
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
          {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Submitting…</> : "Submit PO Box & receipt"}
        </Button>

        <p className="text-center text-xs text-[#8B6F5E] pb-2">
          Questions? Email <a href="mailto:hello@joinmailday.com" className="underline hover:text-[#4AADDE] transition-colors">hello@joinmailday.com</a>
        </p>
      </div>
    </div>
  );
}

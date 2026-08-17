/**
 * /enroll — RETIRED (2026-08-17, at Courtney's request).
 *
 * This was the original self-serve sign-up form: a parent typed the email they
 * subscribed with, and we looked them up and added their children. It has been
 * replaced entirely by the token-based onboarding link, which every family now
 * receives by email after purchase.
 *
 * It was retired rather than merely left alone because it had quietly become a
 * weaker duplicate of onboarding:
 *
 *   • It captured neither the guardian attestation (D1) nor the address-sharing
 *     acknowledgement (A4) — both attorney-required — yet the children it made
 *     went straight into the matching pool.
 *   • It never claimed a membership_slot, so a family who used it and then also
 *     opened their emailed link would be invited to add the same child again,
 *     producing a duplicate that nothing detected.
 *
 * The route is kept alive on purpose, serving this notice instead of a 404, so
 * any old bookmark or stray link lands somewhere that explains itself. The
 * matching POST /api/enroll endpoint is gone.
 */
import { Mail } from "lucide-react";

export default function Enroll() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFF9F4] p-4">
      <div className="text-center space-y-6 max-w-md">
        <img
          src={`${import.meta.env.BASE_URL}mailday-logo.png`}
          alt="MailDay"
          className="h-12 mx-auto"
        />
        <div className="w-20 h-20 bg-[#DD4B39]/10 rounded-full flex items-center justify-center mx-auto">
          <Mail className="w-9 h-9 text-[#DD4B39]" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-[#1A1A1A]" style={{ fontFamily: "Georgia, serif" }}>
            Check your email
          </h1>
          <p className="text-gray-600 mt-3 text-lg leading-relaxed">
            Signing up now happens through your own personal link, which we email you as soon as your
            subscription starts. Look for your welcome email from MailDay and follow the link inside.
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Can't find it? Check your spam folder, then email us at{" "}
          <a href="mailto:hello@joinmailday.com" className="underline font-medium">
            hello@joinmailday.com
          </a>{" "}
          and we'll send you a fresh one.
        </div>
      </div>
    </div>
  );
}

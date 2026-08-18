import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { createConfirmationToken } from "../lib/confirmation.js";
import { sendEmail } from "../lib/email.js";
import { verifyTurnstile, tokenFromBody } from "../lib/turnstile.js";

const router: IRouter = Router();

const ALLOWED_ADDRESS_TYPES = ["Home", "Work", "PO Box", "Military (APO/FPO/DPO)"];

// POST /api/address-change/request — public self-service address change for an
// existing member who has moved.
//
// We NEVER apply the change here. We email a one-click confirmation link to the
// address ON FILE, so only someone with access to the account's inbox can
// redirect a family's letters (audit §3.3). To avoid revealing whether an email
// belongs to a member, the response is identical whether or not the account
// exists. If the family is in a live match, confirming the link also triggers
// the Item-3 two-party re-consent flow (handled in routes/confirm.ts).
router.post("/address-change/request", async (req, res) => {
  try {
    // A5: bot protection.
    const turnstile = await verifyTurnstile(tokenFromBody(req.body), req.ip);
    if (!turnstile.ok) {
      req.log?.warn({ reason: turnstile.reason }, "Address-change: Turnstile verification failed");
      res.status(400).json({ error: "Bot verification failed. Please refresh the page and try again." });
      return;
    }

    const body = req.body as { email?: string; new_address?: string; address_type?: string };
    const email = body.email?.toLowerCase().trim();
    const newAddress = body.new_address?.trim();
    const addressType = body.address_type?.trim();

    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "A valid email address is required." });
      return;
    }
    if (!newAddress) {
      res.status(400).json({ error: "A new mailing address is required." });
      return;
    }
    if (addressType && !ALLOWED_ADDRESS_TYPES.includes(addressType)) {
      res.status(400).json({ error: "Please choose a valid address type." });
      return;
    }

    // Same response whether or not the account exists — never leak membership.
    const genericOk = {
      ok: true,
      message:
        "If that email matches a MailDay account, we've just sent a confirmation link to it. " +
        "Open that email and click the link to apply your new address — nothing changes until you do.",
    };

    const { data: parent } = await supabase
      .from("parents")
      .select("id, mailing_address")
      .eq("email", email)
      .single();

    if (!parent) {
      req.log?.info({ email }, "Address-change requested for unknown email (generic response)");
      res.json(genericOk);
      return;
    }

    const { url: confirmUrl } = await createConfirmationToken({
      type: "address_change",
      email,
      parentId: parent.id,
      payload: { new_address: newAddress, address_type: addressType ?? null, target: "parent" },
    });

    await sendEmail({
      to: email,
      templateKey: "address_change_confirm",
      vars: {
        new_address: addressType ? `${addressType}, ${newAddress}` : newAddress,
        confirm_url: confirmUrl,
      },
    });

    req.log?.info({ parentId: parent.id }, "Self-service address-change confirmation email sent");
    res.json(genericOk);
  } catch (err) {
    req.log?.error({ err }, "Address-change request error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

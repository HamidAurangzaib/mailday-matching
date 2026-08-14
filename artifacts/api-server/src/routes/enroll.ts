import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { createConfirmationToken } from "../lib/confirmation.js";
import { sendEmail } from "../lib/email.js";
import { computeAge, computeTier } from "../lib/age.js";
import { verifyTurnstile, tokenFromBody } from "../lib/turnstile.js";

const router: IRouter = Router();

// POST /api/enroll — public endpoint, no auth required
// Accepts a parent email + one or more children.
// Looks up the parent by email (already created via Shopify webhook),
// then adds each child under their account.
// If no parent is found, returns a clear error so they know to subscribe first.

router.post("/enroll", async (req, res) => {
  try {
    // A5: bot protection — verify the Turnstile token before doing anything.
    const turnstile = await verifyTurnstile(tokenFromBody(req.body), req.ip);
    if (!turnstile.ok) {
      req.log?.warn({ reason: turnstile.reason }, "Enroll: Turnstile verification failed");
      res.status(400).json({ error: "Bot verification failed. Please refresh the page and try again." });
      return;
    }

    const body = req.body as {
      email: string;
      mailing_address?: string;
      children: Array<{
        child_first_name: string;
        date_of_birth?: string;
        interests?: string[];
      }>;
    };

    const email = body.email?.toLowerCase()?.trim();
    if (!email) {
      res.status(400).json({ error: "Email address is required" });
      return;
    }

    if (!Array.isArray(body.children) || body.children.length === 0) {
      res.status(400).json({ error: "At least one child is required" });
      return;
    }

    // Look up parent by email — must already exist (created by Shopify webhook)
    const { data: parent } = await supabase
      .from("parents")
      .select("id, membership_tier")
      .eq("email", email)
      .single();

    if (!parent) {
      res.status(404).json({
        error: "We couldn't find an account with that email address. Please use the email you signed up with, or contact us for help.",
      });
      return;
    }

    if (!body.mailing_address?.trim()) {
      res.status(400).json({ error: "A mailing address is required so we know where to send letters." });
      return;
    }

    // Address-change confirmation (audit §3.3): we do NOT overwrite the
    // mailing address from this public endpoint. Instead, we email the parent
    // a one-click link they have to follow to apply the change. This stops a
    // stranger who knows a customer's email from redirecting their letters.
    const proposedAddress = body.mailing_address.trim();
    const currentAddress = (parent as Record<string, unknown>)["mailing_address"] as string | null | undefined;

    if (proposedAddress !== (currentAddress ?? "")) {
      const { url: confirmUrl } = await createConfirmationToken({
        type: "address_change",
        email,
        parentId: parent.id,
        payload: { new_address: proposedAddress },
      });

      await sendEmail({
        to: email,
        templateKey: "address_change_confirm",
        vars: {
          new_address: proposedAddress,
          confirm_url: confirmUrl,
        },
      });

      req.log?.info(
        { parentId: parent.id },
        "Enroll: address change requested — confirmation email sent",
      );
    }

    // Create each child under this parent
    const createdChildren: string[] = [];
    const failedChildren: string[] = [];

    for (const child of body.children) {
      if (!child.child_first_name?.trim()) continue;

      // Phase 2.2: age + tier must be derived from date_of_birth. Required field.
      const childAge = computeAge(child.date_of_birth);
      if (childAge === null || childAge < 1 || childAge > 18) {
        req.log?.warn({ dob: child.date_of_birth }, "Enroll: child rejected (invalid DOB)");
        failedChildren.push(child.child_first_name.trim());
        continue;
      }
      const parentTier = (parent.membership_tier as string | null) ?? "Core";
      const computedTier = computeTier(childAge, parentTier) ?? parentTier;

      const { data: newChild, error: childErr } = await supabase
        .from("children")
        .insert({
          parent_id: parent.id,
          child_first_name: child.child_first_name.trim(),
          age: childAge,
          date_of_birth: child.date_of_birth,
          tier: computedTier,
          interests: child.interests || [],
          match_status: "Unmatched",
          onboarding_complete: true,
        })
        .select("id, child_first_name")
        .single();

      if (childErr || !newChild) {
        req.log?.error({ childErr }, "Enroll: failed to create child");
        failedChildren.push(child.child_first_name.trim());
      } else {
        createdChildren.push(newChild.child_first_name);
      }
    }

    req.log?.info({ parentId: parent.id, createdChildren }, "Enroll: children added");

    res.status(201).json({
      parent_id: parent.id,
      children_created: createdChildren,
      children_failed: failedChildren,
    });
  } catch (err) {
    req.log?.error({ err }, "Enroll error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

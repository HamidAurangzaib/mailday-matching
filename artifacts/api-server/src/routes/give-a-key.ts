import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { createConfirmationToken } from "../lib/confirmation.js";
import { sendEmail } from "../lib/email.js";
import { emitKlaviyoEvent } from "../lib/klaviyo-events.js";
import { verifyTurnstile, tokenFromBody } from "../lib/turnstile.js";
import { activateAwaitingAddressChildren } from "../lib/gak-address.js";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getFundStats() {
  const [{ data: donations }, { data: activeApps }, { data: settings }] = await Promise.all([
    supabase.from("give_a_key_donations").select("donation_amount"),
    supabase.from("give_a_key_applications").select("id, amount_disbursed").eq("application_status", "Active"),
    supabase.from("give_a_key_settings").select("po_box_reimbursement_amount").eq("id", 1).single(),
  ]);

  const totalDonations = (donations || []).reduce((sum, d) => sum + Number(d.donation_amount), 0);
  const reimbursementAmount = Number(settings?.po_box_reimbursement_amount ?? 75);
  const activeSponsored = (activeApps || []).length;

  // Use actual amount_disbursed where available; fall back to reimbursement_amount for older records
  const totalDispersed = (activeApps || []).reduce((sum, app) => {
    const actual = (app as Record<string, unknown>).amount_disbursed;
    return sum + (actual !== null && actual !== undefined ? Number(actual) : reimbursementAmount);
  }, 0);
  const isDispersedEstimated = (activeApps || []).some((app) => {
    const actual = (app as Record<string, unknown>).amount_disbursed;
    return actual === null || actual === undefined;
  });

  const fundBalance = totalDonations - totalDispersed;
  return { totalDonations, reimbursementAmount, activeSponsored, fundBalance, totalDispersed, isDispersedEstimated };
}

async function createTask(
  applicationId: string,
  type: string,
  title: string,
  description: string | null,
  parentName: string,
  parentEmail: string
) {
  await supabase.from("give_a_key_tasks").insert({
    application_id: applicationId,
    type,
    title,
    description,
    parent_name: parentName,
    parent_email: parentEmail,
  });
}

// ─── PUBLIC — no auth ─────────────────────────────────────────────────────────

// POST /api/give-a-key/apply
router.post("/give-a-key/apply", async (req, res) => {
  try {
    // A5: bot protection.
    const turnstile = await verifyTurnstile(tokenFromBody(req.body), req.ip);
    if (!turnstile.ok) {
      req.log?.warn({ reason: turnstile.reason }, "GAK apply: Turnstile verification failed");
      res.status(400).json({ error: "Bot verification failed. Please refresh the page and try again." });
      return;
    }

    const body = req.body as {
      parent_first_name: string;
      parent_last_name: string;
      parent_email: string;
      parent_phone?: string;
      state: string;
      mailing_address: string;
      address_type: string;
      child_first_name: string;
      child_age: number;
      child_interests: string[];
      statement_of_need: string;
      po_box_acknowledgment: boolean;
      subscription_acknowledgment: boolean;
    };

    if (!body.parent_first_name?.trim() || !body.parent_last_name?.trim() || !body.parent_email?.trim()) {
      res.status(400).json({ error: "Parent name and email are required" });
      return;
    }
    if (!body.state || !body.mailing_address?.trim() || !body.address_type) {
      res.status(400).json({ error: "Address information is required" });
      return;
    }
    if (!body.child_first_name?.trim() || !body.child_age) {
      res.status(400).json({ error: "Child name and age are required" });
      return;
    }
    if (body.child_age < 4 || body.child_age > 12) {
      res.status(400).json({ error: "Child age must be between 4 and 12" });
      return;
    }
    if (!body.statement_of_need?.trim()) {
      res.status(400).json({ error: "Statement of need is required" });
      return;
    }
    if (!body.po_box_acknowledgment || !body.subscription_acknowledgment) {
      res.status(400).json({ error: "Both acknowledgments must be accepted" });
      return;
    }

    const { data, error } = await supabase
      .from("give_a_key_applications")
      .insert({
        parent_first_name: body.parent_first_name.trim(),
        parent_last_name: body.parent_last_name.trim(),
        parent_email: body.parent_email.toLowerCase().trim(),
        parent_phone: body.parent_phone?.trim() || null,
        state: body.state,
        mailing_address: body.mailing_address.trim(),
        address_type: body.address_type,
        child_first_name: body.child_first_name.trim(),
        child_age: body.child_age,
        child_interests: body.child_interests || [],
        statement_of_need: body.statement_of_need.trim(),
        po_box_acknowledgment: true,
        subscription_acknowledgment: true,
        application_status: "Pending",
      })
      .select("id")
      .single();

    if (error || !data) {
      req.log?.error({ error }, "Give a Key: failed to create application");
      res.status(500).json({ error: "Failed to submit application. Please try again." });
      return;
    }

    req.log?.info({ applicationId: data.id }, "Give a Key: application submitted");
    res.status(201).json({ application_id: data.id });
  } catch (err) {
    req.log?.error({ err }, "Give a Key apply error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/give-a-key/po-box — submit PO box details after approval
router.post("/give-a-key/po-box", async (req, res) => {
  try {
    const body = req.body as {
      email: string;
      po_box_address: string;
      receipt_data?: string;
      receipt_filename?: string;
    };

    if (!body.email?.trim() || !body.po_box_address?.trim()) {
      res.status(400).json({ error: "Email and PO box address are required" });
      return;
    }

    const { data: application } = await supabase
      .from("give_a_key_applications")
      .select("id, application_status, parent_first_name, parent_last_name, parent_email")
      .eq("parent_email", body.email.toLowerCase().trim())
      .eq("application_status", "Approved")
      .order("application_date", { ascending: false })
      .limit(1)
      .single();

    if (!application) {
      res.status(404).json({
        error: "We couldn't find an approved application for that email address. Please check your email or contact us if you need help.",
      });
      return;
    }

    let po_box_receipt_url: string | null = null;

    if (body.receipt_data && body.receipt_filename) {
      // Receipt upload hardening (audit report §3.4):
      //  1. 5 MB hard cap on decoded payload
      //  2. Magic-byte sniff: only JPEG / PNG / PDF accepted, regardless of filename
      //  3. Content-Type derived from the verified type, not the filename
      //  4. Signed URL (1 hour) instead of a permanent public URL
      //     NOTE: also flip the bucket "give-a-key-receipts" to PRIVATE in the
      //     Supabase dashboard. The signed URL gives a short-lived view; the
      //     public bucket would still leak everything in it.
      const MAX_BYTES = 5 * 1024 * 1024;
      try {
        const base64Data = body.receipt_data.replace(/^data:[^;]+;base64,/, "");
        const fileBuffer = Buffer.from(base64Data, "base64");

        if (fileBuffer.length === 0 || fileBuffer.length > MAX_BYTES) {
          req.log?.warn({ size: fileBuffer.length }, "Give a Key: receipt rejected (size)");
          res.status(413).json({ error: "Receipt file must be between 1 byte and 5 MB" });
          return;
        }

        // Detect file type from magic bytes, not from the filename.
        let detected: { ext: string; contentType: string } | null = null;
        if (
          fileBuffer.length >= 3 &&
          fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff
        ) {
          detected = { ext: "jpg", contentType: "image/jpeg" };
        } else if (
          fileBuffer.length >= 8 &&
          fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 &&
          fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47 &&
          fileBuffer[4] === 0x0d && fileBuffer[5] === 0x0a &&
          fileBuffer[6] === 0x1a && fileBuffer[7] === 0x0a
        ) {
          detected = { ext: "png", contentType: "image/png" };
        } else if (
          fileBuffer.length >= 4 &&
          fileBuffer[0] === 0x25 && fileBuffer[1] === 0x50 &&
          fileBuffer[2] === 0x44 && fileBuffer[3] === 0x46
        ) {
          detected = { ext: "pdf", contentType: "application/pdf" };
        }

        if (!detected) {
          req.log?.warn("Give a Key: receipt rejected (unsupported type)");
          res.status(415).json({ error: "Receipt must be a JPG, PNG, or PDF file" });
          return;
        }

        const storagePath = `${application.id}.${detected.ext}`;

        const { error: uploadError } = await supabase.storage
          .from("give-a-key-receipts")
          .upload(storagePath, fileBuffer, { contentType: detected.contentType, upsert: true });

        if (uploadError) {
          req.log?.warn({ uploadError }, "Give a Key: receipt upload failed (bucket may not exist)");
        } else {
          // Signed URL valid for 1 hour; the admin UI should re-request a fresh
          // URL each time a receipt is viewed (TODO in receipt-viewer page).
          const { data: signed, error: signedErr } = await supabase.storage
            .from("give-a-key-receipts")
            .createSignedUrl(storagePath, 60 * 60);
          if (signedErr || !signed) {
            req.log?.warn({ signedErr }, "Give a Key: failed to create signed URL");
          } else {
            po_box_receipt_url = signed.signedUrl;
          }
        }
      } catch (uploadErr) {
        req.log?.warn({ uploadErr }, "Give a Key: receipt processing error");
      }
    }

    // Audit §3.3: the PO box address itself is held in a confirmation token
    // until the parent clicks the email link. Only the receipt upload (already
    // hardened in Phase 0) writes to the application now. The admin team can
    // still see the receipt + that a submission was made; the address fills in
    // once the parent confirms.
    await supabase
      .from("give_a_key_applications")
      .update({ po_box_receipt_url })
      .eq("id", application.id);

    const proposedPoBox = body.po_box_address.trim();
    const app = application as Record<string, unknown>;
    const pName = `${app.parent_first_name} ${app.parent_last_name}`;
    const pEmail = app.parent_email as string;

    const { url: confirmUrl } = await createConfirmationToken({
      type: "address_change",
      email: pEmail,
      payload: {
        new_address: proposedPoBox,
        target: "gak_application",
        application_id: application.id,
      },
    });

    await sendEmail({
      to: pEmail,
      templateKey: "address_change_confirm",
      vars: { new_address: proposedPoBox, confirm_url: confirmUrl },
    });

    // Auto-create the admin task. Wording adjusted: receipt is here, address
    // is pending parent confirmation.
    await createTask(
      application.id,
      "verify_receipt",
      `Verify PO box receipt — ${pName}`,
      po_box_receipt_url
        ? "Family submitted their PO box receipt photo. Address confirmation email has been sent — they need to click the link before activation. Review the receipt in the meantime."
        : "Family started the PO box step but didn't attach a receipt photo. Follow up to collect a receipt; the address-confirmation email has been sent.",
      pName,
      pEmail,
    );

    req.log?.info(
      { applicationId: application.id },
      "Give a Key: PO box receipt received; awaiting email-confirmation of address",
    );
    res.status(200).json({ success: true, address_pending_confirmation: true });
  } catch (err) {
    req.log?.error({ err }, "Give a Key PO box error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PROTECTED ────────────────────────────────────────────────────────────────

// GET /api/give-a-key/applications
router.get("/give-a-key/applications", requireAuth, async (req: AuthRequest, res) => {
  try {
    const status = req.query.status as string | undefined;
    const isAdmin = req.user?.role === "admin";

    let query = supabase
      .from("give_a_key_applications")
      .select("*")
      .order("application_date", { ascending: true });

    if (status) {
      query = query.eq("application_status", status);
    } else if (!isAdmin) {
      query = query.in("application_status", ["Pending", "Waitlisted"]);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: "Failed to fetch applications" });
      return;
    }
    res.json(data || []);
  } catch (err) {
    req.log?.error({ err }, "Give a Key: fetch applications error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/give-a-key/applications/:id
router.get("/give-a-key/applications/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("give_a_key_applications")
      .select("*")
      .eq("id", req.params["id"])
      .single();
    if (error || !data) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/applications/:id/status
router.patch("/give-a-key/applications/:id/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const body = req.body as {
      action: "approve" | "waitlist" | "reject" | "set";
      rejection_reason?: string;
      status?: string;
    };

    const { data: application } = await supabase
      .from("give_a_key_applications")
      .select("id, parent_first_name, parent_last_name, parent_email")
      .eq("id", req.params["id"])
      .single();

    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const app = application as { id: string; parent_first_name: string; parent_last_name: string; parent_email: string };
    const parentName = `${app.parent_first_name} ${app.parent_last_name}`;

    let newStatus: string;
    const updateData: Record<string, unknown> = {};

    if (body.action === "approve") {
      const { fundBalance, reimbursementAmount } = await getFundStats();
      if (fundBalance >= reimbursementAmount) {
        newStatus = "Approved";
        updateData.tremendous_sent = false;
      } else {
        newStatus = "Waitlisted";
      }
    } else if (body.action === "waitlist") {
      newStatus = "Waitlisted";
    } else if (body.action === "reject") {
      if (!body.rejection_reason?.trim()) {
        res.status(400).json({ error: "Rejection reason is required" });
        return;
      }
      newStatus = "Rejected";
      updateData.rejection_reason = body.rejection_reason.trim();
    } else if (body.action === "set") {
      const validStatuses = ["Pending", "Approved", "Waitlisted", "Active", "Rejected"];
      if (!body.status || !validStatuses.includes(body.status as string)) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      newStatus = body.status as string;
    } else {
      res.status(400).json({ error: "Invalid action" });
      return;
    }

    updateData.application_status = newStatus;
    await supabase.from("give_a_key_applications").update(updateData).eq("id", req.params["id"]);

    // Auto-create action item task for family communication
    if (newStatus === "Approved") {
      await createTask(app.id, "notify_approved",
        `Email ${parentName} — notify approval & share PO Box form link`,
        "They're approved! Send them the PO Box form link so they can get started.",
        parentName, app.parent_email);
    } else if (newStatus === "Waitlisted") {
      await createTask(app.id, "notify_waitlisted",
        `Email ${parentName} — notify they're on the waitlist`,
        "Let them know we'll reach out as soon as funds become available.",
        parentName, app.parent_email);
    } else if (newStatus === "Rejected") {
      await createTask(app.id, "notify_rejected",
        `Email ${parentName} — notify rejection`,
        updateData.rejection_reason ? `Reason: ${updateData.rejection_reason as string}` : null,
        parentName, app.parent_email);
    }

    req.log?.info({ applicationId: req.params["id"], newStatus }, "Give a Key: status updated");
    res.json({ application_id: req.params["id"], status: newStatus });
  } catch (err) {
    req.log?.error({ err }, "Give a Key: status update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/applications/:id/notes
router.patch("/give-a-key/applications/:id/notes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { internal_notes } = req.body as { internal_notes: string };
    await supabase
      .from("give_a_key_applications")
      .update({ internal_notes: internal_notes ?? "" })
      .eq("id", req.params["id"]);
    res.json({ success: true });
  } catch (err) {
    req.log?.error({ err }, "Give a Key: notes update error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/applications/:id/tremendous-sent
router.patch("/give-a-key/applications/:id/tremendous-sent", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { amount_disbursed } = req.body as { amount_disbursed?: number };
    const update: Record<string, unknown> = { tremendous_sent: true, tremendous_sent_at: new Date().toISOString() };
    if (amount_disbursed !== undefined && amount_disbursed > 0) {
      update.amount_disbursed = amount_disbursed;
    }
    const [, { data: appData }] = await Promise.all([
      supabase.from("give_a_key_applications").update(update).eq("id", req.params["id"]),
      supabase.from("give_a_key_applications")
        .select("parent_first_name, parent_last_name, parent_email")
        .eq("id", req.params["id"])
        .single(),
    ]);
    if (appData) {
      const a = appData as { parent_first_name: string; parent_last_name: string; parent_email: string };
      const pName = `${a.parent_first_name} ${a.parent_last_name}`;
      await createTask(String(req.params["id"]), "tremendous_followup",
        `Follow up with ${pName} — check they're setting up their PO Box`,
        "Tremendous funds have been sent. Follow up in 1–2 weeks if no receipt has been submitted.",
        pName, a.parent_email);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/applications/:id/verify-receipt — admin only
router.patch("/give-a-key/applications/:id/verify-receipt", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data: application } = await supabase
      .from("give_a_key_applications")
      .select("*")
      .eq("id", req.params["id"])
      .single();

    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    // Create or update parent record
    const { data: existingParent } = await supabase
      .from("parents")
      .select("id")
      .eq("email", application.parent_email)
      .single();

    let parentId: string;

    if (existingParent) {
      parentId = existingParent.id as string;
      await supabase
        .from("parents")
        .update({
          give_a_key_recipient: true,
          mailing_address: application.po_box_address || application.mailing_address,
        })
        .eq("id", parentId);
    } else {
      const { data: newParent, error: parentError } = await supabase
        .from("parents")
        .insert({
          email: application.parent_email,
          first_name: application.parent_first_name,
          last_name: application.parent_last_name,
          phone: application.parent_phone || null,
          state: application.state,
          mailing_address: application.po_box_address || application.mailing_address,
          give_a_key_recipient: true,
          subscription_status: "Active",
          membership_tier: "Core",
          join_date: new Date().toISOString().split("T")[0],
        })
        .select("id")
        .single();

      if (parentError || !newParent) {
        req.log?.error({ parentError }, "Give a Key: failed to create parent");
        res.status(500).json({ error: "Failed to create parent record" });
        return;
      }
      parentId = newParent.id as string;
    }

    // Create the child record — unless this family already onboarded.
    //
    // A6 lets a family finish onboarding before their PO Box exists, which
    // creates the child there and holds it at 'Awaiting Address'. Inserting
    // again here would give the family a duplicate child, and the duplicate
    // would be the one in the matching pool.
    const { data: existingChild } = await supabase
      .from("children")
      .select("id")
      .eq("parent_id", parentId)
      .eq("child_first_name", application.child_first_name)
      .maybeSingle();

    if (existingChild) {
      req.log?.info(
        { parentId, childId: existingChild.id },
        "Give a Key: child already exists from onboarding — not duplicating",
      );
    } else {
      await supabase.from("children").insert({
        parent_id: parentId,
        child_first_name: application.child_first_name,
        date_of_birth: null,
        tier: "Core",
        interests: application.child_interests || [],
        match_status: "Unmatched",
        onboarding_complete: true,
        billing_paused: false,
      });
    }

    // Activate application. This must be written BEFORE the A6 activation call
    // below, which re-reads receipt_verified to decide whether both halves of
    // the pair are present.
    await supabase
      .from("give_a_key_applications")
      .update({
        receipt_verified: true,
        application_status: "Active",
        activation_date: new Date().toISOString(),
      })
      .eq("id", req.params["id"]);

    // A6: the receipt was the missing half. If the PO Box address has already
    // been confirmed by the parent, their waiting children join the pool now.
    const released = await activateAwaitingAddressChildren(String(req.params["id"]), {
      actorEmail: req.user?.email ?? "admin",
      source: "receipt_verification",
    });

    const pName = `${(application as Record<string,unknown>).parent_first_name} ${(application as Record<string,unknown>).parent_last_name}`;
    const pEmail = (application as Record<string,unknown>).parent_email as string;
    const stillWaitingOnAddress = released.reason === "not_ready";
    await createTask(String(req.params["id"]), "notify_activated",
      `Email ${pName} — welcome to MailDay!`,
      stillWaitingOnAddress
        ? "Their membership is now active. Their child is NOT in the matching queue yet — we're still waiting on the PO Box address confirmation email to be clicked."
        : "Their membership is now active and their child is in the matching queue.",
      pName, pEmail);

    req.log?.info(
      { applicationId: req.params["id"], parentId, released: released.activated },
      "Give a Key: receipt verified, family activated",
    );
    res.json({ success: true, parent_id: parentId, children_released: released.activated });
  } catch (err) {
    req.log?.error({ err }, "Give a Key: verify receipt error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/give-a-key/tasks
router.get("/give-a-key/tasks", requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("give_a_key_tasks")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/give-a-key/tasks/open-count
router.get("/give-a-key/tasks/open-count", requireAuth, async (_req, res) => {
  try {
    const { count } = await supabase
      .from("give_a_key_tasks")
      .select("id", { count: "exact", head: true })
      .eq("completed", false);
    res.json({ count: count ?? 0 });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/tasks/:id/complete
router.patch("/give-a-key/tasks/:id/complete", requireAuth, async (req: AuthRequest, res) => {
  try {
    const completedBy = req.user?.email ?? req.user?.id ?? "unknown";
    const now = new Date().toISOString();
    // Try with completed_by; fall back if column doesn't exist in schema yet
    const { error } = await supabase
      .from("give_a_key_tasks")
      .update({ completed: true, completed_at: now, completed_by: completedBy })
      .eq("id", req.params["id"]);
    if (error) {
      await supabase
        .from("give_a_key_tasks")
        .update({ completed: true, completed_at: now })
        .eq("id", req.params["id"]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/give-a-key/fund — stats (role-scoped)
router.get("/give-a-key/fund", requireAuth, async (req: AuthRequest, res) => {
  try {
    const isAdmin = req.user?.role === "admin";

    const [fundStats, { count: pendingCount }, { count: waitlistedCount }, { count: receiptsCount }, { count: tremendousPendingCount }] =
      await Promise.all([
        getFundStats(),
        supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Pending"),
        supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Waitlisted"),
        supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).not("po_box_receipt_url", "is", null).eq("receipt_verified", false),
        supabase.from("give_a_key_applications").select("id", { count: "exact", head: true }).eq("application_status", "Approved").eq("tremendous_sent", false),
      ]);

    const response: Record<string, unknown> = {
      pending_count: pendingCount ?? 0,
      waitlisted_count: waitlistedCount ?? 0,
      active_count: fundStats.activeSponsored,
      receipts_pending: receiptsCount ?? 0,
      can_activate_from_waitlist: fundStats.fundBalance >= fundStats.reimbursementAmount && (waitlistedCount ?? 0) > 0,
      reimbursement_amount: fundStats.reimbursementAmount,
    };

    if (isAdmin) {
      response.fund_balance = fundStats.fundBalance;
      response.total_donations = fundStats.totalDonations;
      response.total_dispersed = fundStats.totalDispersed;
      response.is_dispersed_estimated = fundStats.isDispersedEstimated;
      response.tremendous_pending = tremendousPendingCount ?? 0;
    }

    res.json(response);
  } catch (err) {
    req.log?.error({ err }, "Give a Key: fund stats error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/give-a-key/donations — admin only
router.get("/give-a-key/donations", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data, error } = await supabase
      .from("give_a_key_donations")
      .select("*")
      .order("donation_date", { ascending: false });
    if (error) {
      res.status(500).json({ error: "Failed to fetch donations" });
      return;
    }
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/give-a-key/donations — admin only
router.post("/give-a-key/donations", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as {
      donor_first_name: string;
      donor_last_name: string;
      donor_email: string;
      donation_amount: number;
      donation_date: string;
      notes?: string;
    };

    const { data, error } = await supabase
      .from("give_a_key_donations")
      .insert({
        donor_first_name: body.donor_first_name.trim(),
        donor_last_name: body.donor_last_name.trim(),
        donor_email: body.donor_email.toLowerCase().trim(),
        donation_amount: body.donation_amount,
        donation_date: body.donation_date,
        notes: body.notes?.trim() || null,
        source: "manual",
      })
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: "Failed to record donation" });
      return;
    }

    // Forward to Klaviyo so the K9 donor thank-you flow can fire.
    // Silent fail if Klaviyo errors — donation still recorded in our DB.
    void emitKlaviyoEvent({
      event: "gak_donation_recorded",
      profile: {
        email: data.donor_email as string,
        first_name: data.donor_first_name as string,
        last_name: data.donor_last_name as string,
      },
      properties: {
        donation_id: data.id,
        amount: Number(data.donation_amount),
        donation_date: data.donation_date,
        source: "manual",
      },
    }).catch((err) => req.log?.warn({ err }, "K9 Klaviyo event emit failed (manual donation)"));

    req.log?.info({ donationId: data.id, amount: body.donation_amount }, "Give a Key: donation recorded");
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/donations/:id — admin only, manual donations only
router.patch("/give-a-key/donations/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const body = req.body as {
      donor_first_name?: string;
      donor_last_name?: string;
      donor_email?: string;
      donation_amount?: number;
      donation_date?: string;
      notes?: string;
    };
    const { data: existing } = await supabase
      .from("give_a_key_donations")
      .select("source")
      .eq("id", req.params["id"])
      .single();
    if (!existing) {
      res.status(404).json({ error: "Donation not found" });
      return;
    }
    if ((existing as { source?: string }).source === "shopify") {
      res.status(400).json({ error: "Shopify donations cannot be edited" });
      return;
    }
    const update: Record<string, unknown> = {};
    if (body.donor_first_name) update.donor_first_name = body.donor_first_name.trim();
    if (body.donor_last_name) update.donor_last_name = body.donor_last_name.trim();
    if (body.donor_email) update.donor_email = body.donor_email.toLowerCase().trim();
    if (body.donation_amount !== undefined) update.donation_amount = body.donation_amount;
    if (body.donation_date) update.donation_date = body.donation_date;
    if (body.notes !== undefined) update.notes = body.notes.trim() || null;
    const { data, error } = await supabase
      .from("give_a_key_donations")
      .update(update)
      .eq("id", req.params["id"])
      .select()
      .single();
    if (error || !data) {
      res.status(500).json({ error: "Failed to update donation" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/give-a-key/donations/:id — admin only
router.delete("/give-a-key/donations/:id", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    await supabase.from("give_a_key_donations").delete().eq("id", req.params["id"]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/give-a-key/seed — admin only, inserts test data
router.post("/give-a-key/seed", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    await supabase.from("give_a_key_applications").insert([
      {
        parent_first_name: "Maria", parent_last_name: "Johnson",
        parent_email: "maria.johnson@example.com", parent_phone: "555-201-1234",
        state: "TX", mailing_address: "Home, 1421 Elm St, Austin TX 78701", address_type: "Home",
        child_first_name: "Emma", child_age: 8,
        child_interests: ["Reading", "Art & Drawing", "Animals", "Writing", "Crafts"],
        statement_of_need: "We are a single-parent household and I work two jobs to make ends meet. Emma loves reading more than anything and I know having a pen pal would light her up. A PO Box would give her a safe, private address to send and receive letters without us having to use our home address.",
        po_box_acknowledgment: true, subscription_acknowledgment: true,
        application_status: "Pending",
        application_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
      {
        parent_first_name: "Darius", parent_last_name: "Martinez",
        parent_email: "darius.martinez@example.com",
        state: "CA", mailing_address: "Home, 88 Ocean Ave, Long Beach CA 90802", address_type: "Home",
        child_first_name: "Liam", child_age: 6,
        child_interests: ["Dinosaurs", "Lego", "Science"],
        statement_of_need: "Liam has been asking us about pen pals ever since his teacher read the class a book about letters. We live in a shelter right now after leaving a difficult home situation. A PO Box would give Liam a stable address and something happy to look forward to during a really hard time for our family.",
        po_box_acknowledgment: true, subscription_acknowledgment: true,
        application_status: "Pending",
        application_date: new Date(Date.now() - 5 * 86400000).toISOString(),
      },
      {
        parent_first_name: "Tanya", parent_last_name: "Williams",
        parent_email: "tanya.w@example.com", parent_phone: "555-304-9988",
        state: "NY", mailing_address: "Work, 200 Park Ave, New York NY 10003", address_type: "Work",
        child_first_name: "Olivia", child_age: 10,
        child_interests: ["Music", "Dance", "Theater", "Photography", "Travel"],
        statement_of_need: "I'm a home health aide and my daughter Olivia spends a lot of time alone after school. She's incredibly creative and social but we don't have the budget for extracurriculars. A pen pal would give her something to be excited about every week. We can't use a home address for safety reasons — a PO Box would be perfect.",
        po_box_acknowledgment: true, subscription_acknowledgment: true,
        application_status: "Approved", tremendous_sent: false,
        application_date: new Date(Date.now() - 8 * 86400000).toISOString(),
      },
      {
        parent_first_name: "Kevin", parent_last_name: "Brown",
        parent_email: "kevin.brown@example.com",
        state: "FL", mailing_address: "Home, 77 Sunrise Blvd, Orlando FL 32801", address_type: "Home",
        child_first_name: "Noah", child_age: 7,
        child_interests: ["Soccer", "Animals", "Nature", "Hiking"],
        statement_of_need: "Noah is on the autism spectrum and has a hard time making friends at school. His therapist suggested pen pals as a low-pressure way to build social skills. We're a family of five on one income and the PO Box fee is just not in the budget right now.",
        po_box_acknowledgment: true, subscription_acknowledgment: true,
        application_status: "Waitlisted",
        application_date: new Date(Date.now() - 12 * 86400000).toISOString(),
      },
      {
        parent_first_name: "Priya", parent_last_name: "Davis",
        parent_email: "priya.davis@example.com", parent_phone: "555-887-2211",
        state: "WA", mailing_address: "PO Box 5502, Seattle WA 98101", address_type: "PO Box",
        child_first_name: "Sophia", child_age: 9,
        child_interests: ["Baking", "Cooking", "Gardening", "Reading", "Puzzles"],
        statement_of_need: "Sophia is our shy but imaginative daughter. She thrives with one-on-one connections and we believe a pen pal relationship would be transformative for her. We're on a fixed income and truly grateful this program exists.",
        po_box_acknowledgment: true, subscription_acknowledgment: true,
        application_status: "Active", tremendous_sent: true, receipt_verified: true,
        po_box_address: "PO Box 5502, Seattle WA 98101",
        activation_date: new Date(Date.now() - 3 * 86400000).toISOString(),
        application_date: new Date(Date.now() - 20 * 86400000).toISOString(),
      },
    ]);

    await supabase.from("give_a_key_donations").insert([
      {
        donor_first_name: "Jane", donor_last_name: "Smith",
        donor_email: "jane.smith@example.com",
        donation_amount: 150.00, donation_date: "2026-05-01",
        notes: "Happy to support this program!", source: "manual",
      },
      {
        donor_first_name: "Robert", donor_last_name: "Johnson",
        donor_email: "robert.j@example.com",
        donation_amount: 75.00, donation_date: "2026-05-05",
        source: "manual",
      },
      {
        donor_first_name: "Alice", donor_last_name: "Chen",
        donor_email: "alice.chen@example.com",
        donation_amount: 200.00, donation_date: "2026-05-10",
        notes: "Shopify order #10042 — Give a Key Donation", source: "shopify",
      },
      {
        donor_first_name: "Michael", donor_last_name: "Wilson",
        donor_email: "m.wilson@example.com",
        donation_amount: 100.00, donation_date: "2026-05-12",
        notes: "In honor of my daughter who loves pen pals", source: "manual",
      },
    ]);

    req.log?.info("Give a Key: test data seeded");
    res.json({ success: true, message: "Test data seeded: 5 applications, 4 donations" });
  } catch (err) {
    req.log?.error({ err }, "Give a Key: seed error");
    res.status(500).json({ error: "Seed failed", detail: String(err) });
  }
});

// GET /api/give-a-key/settings — admin only
router.get("/give-a-key/settings", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data } = await supabase.from("give_a_key_settings").select("*").eq("id", 1).single();
    res.json(data || { id: 1, po_box_reimbursement_amount: 75 });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/give-a-key/settings — admin only
router.patch("/give-a-key/settings", requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { po_box_reimbursement_amount } = req.body as { po_box_reimbursement_amount: number };
    const { data, error } = await supabase
      .from("give_a_key_settings")
      .upsert({ id: 1, po_box_reimbursement_amount, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: "Failed to update settings" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

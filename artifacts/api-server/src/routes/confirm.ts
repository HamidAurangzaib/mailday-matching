/**
 * GET /api/confirm/:token — public endpoint that consumes a confirmation token
 * (created by lib/confirmation.ts) and applies the corresponding effect.
 *
 * This route handles all four token types via a switch. Each branch is short
 * and self-contained; we return either a friendly HTML page (so a parent
 * clicking from an email gets a nice message) or a JSON body (for testing).
 *
 * To return HTML, we set Content-Type explicitly. The frontend is a SPA so
 * we don't have server-side templates — these are small static pages.
 */

import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase.js";
import { consumeConfirmationToken } from "../lib/confirmation.js";
import { logAudit } from "../lib/audit.js";
import { emitKlaviyoEvent } from "../lib/klaviyo-events.js";

const router: IRouter = Router();

// Version stamp stored on every A3 consent record. Bump when the consent wording
// or legal meaning changes, so old records stay attributable to what was shown.
const CONSENT_VERSION = "a3-2026-08";

// ─── Tiny HTML page helper ────────────────────────────────────────────────────

function htmlPage(title: string, body: string, primaryColor = "#DD4B39"): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       background:#FFF5E6;color:#1a1a1a;margin:0;padding:60px 24px;line-height:1.6;}
  .card{max-width:480px;margin:0 auto;background:#fff;border-radius:14px;
        padding:36px 32px;box-shadow:0 4px 14px rgba(0,0,0,0.06);text-align:center;}
  h1{font-size:24px;margin:0 0 12px;color:${primaryColor};}
  p{margin:0 0 12px;color:#3a3528;}
  .small{color:#9a9486;font-size:13px;margin-top:24px;}
</style></head><body><div class="card">${body}</div></body></html>`;
}

const SUCCESS = (title: string, msg: string) =>
  htmlPage(title, `<h1>${title}</h1><p>${msg}</p><p class="small">You can close this tab.</p>`);

const FAIL = (msg: string) =>
  htmlPage(
    "This link can't be used",
    `<h1 style="color:#A32D2D">This link can't be used</h1>
     <p>${msg}</p>
     <p class="small">If you weren't expecting this, you can safely ignore it.</p>`,
    "#A32D2D",
  );

// ─── GET /api/confirm/:token ──────────────────────────────────────────────────

router.get("/confirm/:token", async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const token = req.params["token"];
  if (!token) {
    res.status(400).send(FAIL("The link is missing its confirmation code."));
    return;
  }

  const consumed = await consumeConfirmationToken(token, req.ip ?? null);
  if (!consumed) {
    res.status(400).send(
      FAIL("This link has expired or has already been used. Please request a new one."),
    );
    return;
  }

  try {
    switch (consumed.type) {
      case "address_change": {
        // Payload: { new_address, target?: 'parent'|'gak_application', application_id? }
        const newAddress = (consumed.payload["new_address"] as string | undefined)?.trim();
        if (!newAddress) {
          res.status(400).send(FAIL("This link is missing the new address."));
          return;
        }
        const target = (consumed.payload["target"] as string | undefined) ?? "parent";

        if (target === "gak_application") {
          const applicationId = consumed.payload["application_id"] as string | undefined;
          if (!applicationId) {
            res.status(400).send(FAIL("This link is missing the application reference."));
            return;
          }
          const { data: before } = await supabase
            .from("give_a_key_applications")
            .select("id, po_box_address")
            .eq("id", applicationId)
            .single();

          await supabase
            .from("give_a_key_applications")
            .update({ po_box_address: newAddress })
            .eq("id", applicationId);

          await logAudit({
            actorEmail: consumed.email,
            action: "gak_application.po_box_change",
            entityType: "gak_application",
            entityId: applicationId,
            payloadBefore: { po_box_address: before?.po_box_address ?? null },
            payloadAfter: { po_box_address: newAddress },
            metadata: { source: "confirmation_link" },
            req,
          });

          req.log?.info({ applicationId }, "GAK PO-box address confirmed via email link");
          res.send(
            SUCCESS(
              "PO Box address confirmed",
              "Thanks — your PO Box address has been saved to your Give a Key application. Our team will verify your receipt and activate your membership shortly.",
            ),
          );
          return;
        }

        // Default: parents.mailing_address
        if (!consumed.parent_id) {
          res.status(400).send(FAIL("This link is missing a parent reference."));
          return;
        }
        const { data: before } = await supabase
          .from("parents")
          .select("id, email, mailing_address")
          .eq("id", consumed.parent_id)
          .single();

        await supabase
          .from("parents")
          .update({ mailing_address: newAddress })
          .eq("id", consumed.parent_id);

        await logAudit({
          actorEmail: consumed.email,
          action: "parent.address_change",
          entityType: "parent",
          entityId: consumed.parent_id,
          payloadBefore: { mailing_address: before?.mailing_address ?? null },
          payloadAfter: { mailing_address: newAddress },
          metadata: { source: "confirmation_link" },
          req,
        });

        req.log?.info(
          { parentId: consumed.parent_id },
          "Address change confirmed via email link",
        );
        res.send(
          SUCCESS(
            "Address updated",
            "Your mailing address has been updated. The next pack will go to the new address.",
          ),
        );
        return;
      }

      case "address_confirm_match": {
        // Payload: { side: 'a' | 'b' }
        if (!consumed.match_id) {
          res.status(400).send(FAIL("This link is missing the match reference."));
          return;
        }
        const side = consumed.payload["side"] as "a" | "b" | undefined;
        if (side !== "a" && side !== "b") {
          res.status(400).send(FAIL("This link is malformed (missing side)."));
          return;
        }

        const nowIso = new Date().toISOString();
        const updateFields: Record<string, unknown> = side === "a"
          ? { address_confirmed_a: true, address_confirmed_a_at: nowIso }
          : { address_confirmed_b: true, address_confirmed_b_at: nowIso };

        await supabase.from("matches").update(updateFields).eq("id", consumed.match_id);

        // A3: this click is a two-party address-sharing consent, not just a
        // confirmation. Record it as the legal artifact — the exact button text
        // the parent saw (incl. the pen pal's name), the version, the IP. One
        // row per parent per match (UNIQUE(match_id,parent_id)), so a re-click
        // is a harmless no-op rather than a duplicate.
        const penpalFirstName =
          (consumed.payload["penpal_first_name"] as string | undefined)?.trim() || "";
        const consentButtonText = penpalFirstName
          ? `I consent to share my mailing address with ${penpalFirstName}'s family`
          : "I consent to share my mailing address with my child's pen pal's family";
        if (consumed.parent_id) {
          const { error: consentErr } = await supabase
            .from("match_consents")
            .upsert(
              {
                match_id: consumed.match_id,
                parent_id: consumed.parent_id,
                child_id: consumed.child_id,
                consented_at: nowIso,
                button_text: consentButtonText,
                penpal_first_name: penpalFirstName || null,
                version: CONSENT_VERSION,
                consented_ip: req.ip ?? null,
              },
              { onConflict: "match_id,parent_id", ignoreDuplicates: true },
            );
          if (consentErr) {
            req.log?.error(
              { consentErr, matchId: consumed.match_id, parentId: consumed.parent_id },
              "Failed to record match consent",
            );
          }
        }

        // Release addresses only once BOTH sides have consented — promote to Active.
        const { data: match } = await supabase
          .from("matches")
          .select("id, address_confirmed_a, address_confirmed_b, match_status")
          .eq("id", consumed.match_id)
          .single();

        let promoted = false;
        if (
          match &&
          match.address_confirmed_a &&
          match.address_confirmed_b &&
          match.match_status === "Pending"
        ) {
          await supabase
            .from("matches")
            .update({ match_status: "Active", promoted_to_active_at: nowIso })
            .eq("id", consumed.match_id);
          promoted = true;

          await logAudit({
            action: "match.promoted_to_active",
            entityType: "match",
            entityId: consumed.match_id,
            metadata: { source: "address_confirmation_both_sides" },
            req,
          });

          // Block D: emit `match_promoted_to_active` to Klaviyo so the K2
          // Day-14 first-letter nudge flow can start its clock. Fire one event
          // per parent so each profile's flow timer ticks independently.
          //
          // Block E suppression: skip the emit for a family that is currently
          // at_risk (ghosting per Klaviyo) or on a voluntary pause. Sending K2
          // to a ghosting family would step on the win-back sequence; sending
          // to a vacationing family pre-empts their resume.
          const { data: fullMatch } = await supabase
            .from("matches")
            .select("id, child_a_id, child_b_id, promoted_to_active_at")
            .eq("id", consumed.match_id)
            .single();
          if (fullMatch) {
            const m = fullMatch as { id: string; child_a_id: string; child_b_id: string; promoted_to_active_at: string };
            const [aData, bData] = await Promise.all([
              supabase.from("children")
                .select("id, child_first_name, parents(id, email, first_name, at_risk, pause_type)")
                .eq("id", m.child_a_id).single(),
              supabase.from("children")
                .select("id, child_first_name, parents(id, email, first_name, at_risk, pause_type)")
                .eq("id", m.child_b_id).single(),
            ]);
            type Side = {
              id: string;
              child_first_name: string;
              parents: {
                id: string;
                email: string;
                first_name: string | null;
                at_risk: boolean | null;
                pause_type: string | null;
              } | null;
            };
            const a = aData.data as unknown as Side | null;
            const b = bData.data as unknown as Side | null;

            const shouldSuppress = (p: Side["parents"] | undefined | null): string | null => {
              if (!p) return "no parent record";
              if (p.at_risk) return "at_risk=true";
              if (p.pause_type === "voluntary") return "pause_type=voluntary";
              return null;
            };

            if (a?.parents?.email && b) {
              const suppressReason = shouldSuppress(a.parents);
              if (suppressReason) {
                req.log?.info(
                  { side: "a", parentId: a.parents.id, reason: suppressReason, matchId: m.id },
                  "K2 emit suppressed",
                );
              } else {
                void emitKlaviyoEvent({
                  event: "match_promoted_to_active",
                  profile: { email: a.parents.email, first_name: a.parents.first_name ?? undefined },
                  properties: {
                    match_id: m.id,
                    child_first_name: a.child_first_name,
                    pen_pal_first_name: b.child_first_name,
                    promoted_at: m.promoted_to_active_at,
                  },
                }).catch((err) => req.log?.warn({ err, side: "a" }, "K2 event emit failed"));
              }
            }
            if (b?.parents?.email && a) {
              const suppressReason = shouldSuppress(b.parents);
              if (suppressReason) {
                req.log?.info(
                  { side: "b", parentId: b.parents.id, reason: suppressReason, matchId: m.id },
                  "K2 emit suppressed",
                );
              } else {
                void emitKlaviyoEvent({
                  event: "match_promoted_to_active",
                  profile: { email: b.parents.email, first_name: b.parents.first_name ?? undefined },
                  properties: {
                    match_id: m.id,
                    child_first_name: b.child_first_name,
                    pen_pal_first_name: a.child_first_name,
                    promoted_at: m.promoted_to_active_at,
                  },
                }).catch((err) => req.log?.warn({ err, side: "b" }, "K2 event emit failed"));
              }
            }
          }
        }

        await logAudit({
          actorEmail: consumed.email,
          action: "match.address_consent_recorded",
          entityType: "match",
          entityId: consumed.match_id,
          payloadAfter: { side, consent_version: CONSENT_VERSION, both_consented: promoted },
          req,
        });

        res.send(
          SUCCESS(
            "Thank you — consent recorded",
            promoted
              ? `Both families have said yes to sharing addresses, so your child's pen pal match is now live${
                  penpalFirstName ? ` with ${penpalFirstName}'s family` : ""
                }. The first pack ships next.`
              : `Thank you — you've said yes to sharing your address${
                  penpalFirstName ? ` with ${penpalFirstName}'s family` : ""
                }. Nothing travels in either direction until the other family says yes too; we'll email you the moment they do.`,
          ),
        );
        return;
      }

      case "pause_offer": {
        // Payload: { months: 1|2|3 } OR { decline: true }
        // Phase 3.9 final wiring: on accept → set pause_type='voluntary',
        // clear intent_to_cancel_at, keep family Active but billing-paused
        // locally. The team manually pauses ReCharge (per the lifecycle map,
        // ReCharge billing changes stay a human step). On decline → the
        // 48h-grace cron will skip the wait and finalise immediately on its
        // next run, but for snappier UX we also bump the timer here so the
        // next run picks them up.
        if (!consumed.parent_id) {
          res.status(400).send(FAIL("This link is missing a parent reference."));
          return;
        }
        const decline = consumed.payload["decline"] === true;
        const months = Number(consumed.payload["months"] ?? 0);

        if (decline) {
          // Bump intent_to_cancel_at to the past so finalise-cancellations
          // picks this up on its next run within minutes.
          await supabase
            .from("parents")
            .update({
              pause_offer_accepted: false,
              intent_to_cancel_at: new Date(Date.now() - 49 * 3600 * 1000).toISOString(),
            })
            .eq("id", consumed.parent_id);
        } else {
          await supabase
            .from("parents")
            .update({
              pause_offer_accepted: true,
              pause_type: "voluntary",
              billing_paused: true,
              intent_to_cancel_at: null,
            })
            .eq("id", consumed.parent_id);
          await supabase
            .from("children")
            .update({ billing_paused: true })
            .eq("parent_id", consumed.parent_id);

          // Mark any cancellation row from this episode as reactivated.
          await supabase
            .from("cancellations")
            .update({
              reactivated: true,
              reactivated_date: new Date().toISOString().split("T")[0],
              reactivated_by: "pause_offer_accepted",
            })
            .eq("parent_id", consumed.parent_id)
            .eq("reactivated", false);
        }

        await logAudit({
          actorEmail: consumed.email,
          action: decline ? "parent.pause_offer_declined" : "parent.pause_offer_accepted",
          entityType: "parent",
          entityId: consumed.parent_id,
          payloadAfter: { months: decline ? 0 : months },
          req,
        });

        res.send(
          SUCCESS(
            decline ? "Cancellation confirmed" : "Pause requested",
            decline
              ? "Got it. Your cancellation will go through within a few hours. Thanks for trying MailDay — we'll be here if you ever come back."
              : `Got it — we'll pause your membership${months ? ` for ${months} month${months > 1 ? "s" : ""}` : ""}. Courtney will follow up by email to confirm the ReCharge side.`,
          ),
        );
        return;
      }

      case "reactivate": {
        // Payload: {}. Phase 4 / day-30 win-back. For Phase 1 we just stamp
        // intent and audit; the reactivation flow itself is built later.
        if (!consumed.parent_id) {
          res.status(400).send(FAIL("This link is missing a parent reference."));
          return;
        }
        await logAudit({
          actorEmail: consumed.email,
          action: "parent.reactivate_clicked",
          entityType: "parent",
          entityId: consumed.parent_id,
          req,
        });
        res.send(
          SUCCESS(
            "Welcome back",
            "We've noted your interest. Courtney will be in touch shortly to reactivate your membership.",
          ),
        );
        return;
      }

      default: {
        res.status(400).send(FAIL("Unknown confirmation type."));
        return;
      }
    }
  } catch (err) {
    req.log?.error({ err, token, type: consumed.type }, "Confirmation handler error");
    res.status(500).send(FAIL("Something went wrong applying this change. Please contact MailDay."));
  }
});

export default router;

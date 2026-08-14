-- Group A / A3: turn the match-notification email into the two-party consent
-- screen (Courtney's exact copy). We keep the whole warm Poppy email intact —
-- the "big news" intro, the pen pal's fun facts, the first-pack link, the stamp
-- reminder — and change ONLY the five things A3 requires:
--   1. the grey call-to-action box  → the two-party consent explainer
--   2. show the parent's own address (the {{full_address}} we will share) above the button
--   3. the button text              → "I consent to share my mailing address with {{pen_pal_first_name}}'s family"
--   4. the sub-line under the button → "…{{pen_pal_first_name}}'s parent is being asked the same thing…"
--   5. REMOVE the old "Mailing address for {{pen_pal_first_name}} will appear after confirmation."
--      line — under two-party consent the pen pal's address is never shown, only mailed,
--      and only once BOTH families have said yes.
--
-- The link itself is unchanged ({{confirm_address_url}}); routes/confirm.ts now
-- records that click as a legal consent in match_consents and releases addresses
-- only when both sides have consented.
--
-- Idempotent + safe: only refreshes the template if it was never customised
-- (updated_by IS NULL). It will NOT clobber a match_notification an admin has
-- since edited — if Courtney has edited this template in the live admin UI, this
-- consent copy must be merged into her version by hand.

UPDATE email_templates
SET
  body_html = $body$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Big news — <strong>{{child_first_name}}</strong> has a pen pal!</p>
<p>Their name is <strong>{{pen_pal_first_name}}</strong>, they're {{pen_pal_age}}, and here are three things about them: {{fun_fact_1}}, {{fun_fact_2}}, {{fun_fact_3}}.</p>
<p>{{pen_pal_first_name}}'s family got an email today too — with {{child_first_name}}'s name and fun facts — so there's a kid on the other end already excited to hear from yours.</p>
<p>Your first pack is here: <a href="{{pack_url}}">{{pack_url}}</a></p>
<p>The mission this week: write your first letter. Don't overthink it — the pack has a prompt card if anyone gets stuck.</p>
<p style="background:#FFF5E6;border-left:4px solid #DD4B39;padding:12px 16px;margin:24px 0">
Now — one grown-up thing, and then I'll get out of the way. Before any letters travel, both families have to say yes to sharing addresses. Yours to {{pen_pal_first_name}}'s family, theirs to you. Nothing moves in either direction until both of you do. It's how I keep every one of my letter-writers safe.
</p>
<p style="margin:0 0 6px;color:#666;font-size:14px">The address we'll share for you:</p>
<blockquote style="border-left:4px solid #DD4B39;padding:10px 14px;background:#FFF5E6;margin:0 0 24px">{{full_address}}</blockquote>
<p style="margin:24px 0"><a href="{{confirm_address_url}}" style="display:inline-block;background:#DD4B39;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">I consent to share my mailing address with {{pen_pal_first_name}}'s family</a></p>
<p style="color:#666;font-size:13px">{{pen_pal_first_name}}'s parent is being asked the same thing. As soon as you've both said yes, the addresses go out.</p>
<p>And don't forget your stamp. (We will remind you every single time.)</p>
<p>Yours by post,<br/>Poppy</p>
</div>$body$,
  body_text = $txt$Big news — {{child_first_name}} has a pen pal!

Their name is {{pen_pal_first_name}}, they're {{pen_pal_age}}, and here are three things about them: {{fun_fact_1}}, {{fun_fact_2}}, {{fun_fact_3}}.

{{pen_pal_first_name}}'s family got an email today too — with {{child_first_name}}'s name and fun facts — so there's a kid on the other end already excited to hear from yours.

Your first pack is here: → {{pack_url}}

The mission this week: write your first letter. Don't overthink it — the pack has a prompt card if anyone gets stuck.

Now — one grown-up thing, and then I'll get out of the way. Before any letters travel, both families have to say yes to sharing addresses. Yours to {{pen_pal_first_name}}'s family, theirs to you. Nothing moves in either direction until both of you do. It's how I keep every one of my letter-writers safe.

The address we'll share for you:
{{full_address}}

I consent to share my mailing address with {{pen_pal_first_name}}'s family:
→ {{confirm_address_url}}

{{pen_pal_first_name}}'s parent is being asked the same thing. As soon as you've both said yes, the addresses go out.

And don't forget your stamp. (We will remind you every single time.)

Yours by post,
Poppy$txt$,
  variables = ARRAY['child_first_name','pen_pal_first_name','pen_pal_age','fun_fact_1','fun_fact_2','fun_fact_3','full_address','pack_url','confirm_address_url']
WHERE template_key = 'match_notification'
  AND updated_by IS NULL;

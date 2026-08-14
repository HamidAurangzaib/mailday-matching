-- Group A / A3: the match-notification email is the two-party consent screen.
--
-- This is the team's branded Poppy design (built in the admin UI on 2026-08-05)
-- with the attorney-required consent specifics applied on top of it:
--   * grey box: both families must say yes to SHARING addresses (yours to the pen
--     pal's family, theirs to you) — not merely "confirm your address"
--   * the parent's own {{full_address}} is shown above the button
--   * button text = the exact wording recorded as the legal consent in
--     match_consents: "I consent to share my mailing address with {pen pal}'s family"
--   * the misleading "address appears the second you do" line is gone
--
-- Idempotent + safe: applies to a fresh seed (updated_by IS NULL) or re-applies
-- over our own prior write, but never clobbers a genuine later human edit.

UPDATE email_templates SET
  body_html = $body$<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>
      Meet {{ pen_pal_first_name }}
    </title>
<!--[if !mso]><!-->
    <link href="https://fonts.googleapis.com" rel="preconnect"/>
    <link href="https://fonts.gstatic.com" rel="preconnect" crossorigin="anonymous"/>
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&amp;family=Caveat:wght@600;700&amp;display=swap" rel="stylesheet"/>
    <style type="text/css">
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Caveat:wght@600;700&display=swap');
  body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
  .caveat { font-family: 'Caveat', 'Brush Script MT', cursive; }
</style>
<!--<![endif]-->
<!--[if mso]><style type="text/css">body, table, td, div, p, a {font-family: Arial, Helvetica, sans-serif !important;}</style><![endif]-->
  </head>
  <body>
    <div style="display:none;font-size:1px;color:#FFF5E6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      {{ child_first_name }} has a pen pal &mdash; one quick thing to do first.
    </div>
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FFF5E6;" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(26,26,26,0.08);" width="600">
            <tr>
              <td align="center" bgcolor="#DD4B39" style="padding:36px 32px 28px;background-color:#DD4B39;border-bottom:3px solid #FFD23F;">
                <img alt="MailDay" src="https://cdn.shopify.com/s/files/1/0809/3732/0685/files/Primary_Logo_-_White_-_Transparent_Background_PNG_and_SVG_4.png?v=1781584495" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:280px;" width="280"/>
                <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:22px;color:#FFF5E6;margin-top:10px;line-height:1;">
                  No wifi required.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px 32px;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  Big news. The kind I run down the road waving an envelope for.
                </p>
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  <strong>{{ child_first_name }}</strong> has a pen pal!
                </p>
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  Their name is <strong>{{ pen_pal_first_name }}</strong>. They're {{ pen_pal_age }}. And here's what I already know about them: {{ fun_fact_1 }}, {{ fun_fact_2 }}, and &mdash; my favorite &mdash; {{ fun_fact_3 }}.
                </p>
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  I dropped a letter to {{ pen_pal_first_name }}'s family this morning too, all about {{ child_first_name }}. So right now, somewhere out there, there's a kid grinning at the exact same news you are. Two mailboxes, about to get very interesting.
                </p>
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin:24px 0;">
                  <tr>
                    <td style="border-left:4px solid #DD4B39;background-color:#FFF5E6;border-radius:0 6px 6px 0;padding:16px 18px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A1A1A;">
                      Now &mdash; one grown-up thing, and then I'll get out of the way. Before any letters travel, both families have to say yes to sharing addresses. Yours to {{ pen_pal_first_name }}'s family, theirs to you. Nothing moves in either direction until both of you do. It's how I keep every one of my letter-writers safe.
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 6px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#777;text-align:center;">The address we&rsquo;ll share for you:</p>
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin:0 0 18px;">
                  <tr>
                    <td style="border-left:4px solid #DD4B39;background-color:#FFF5E6;border-radius:0 6px 6px 0;padding:12px 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1A1A1A;text-align:center;">{{ full_address }}</td>
                  </tr>
                </table>
                <p style="text-align:center;margin:24px 0;">
                  <a href="{{ confirm_address_url }}" style="display:inline-block;background:#DD4B39;color:#FFFFFF !important;padding:14px 28px;border-radius:8px;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:800;text-decoration:none;font-size:16px;margin:16px 0;box-shadow:0 4px 12px rgba(221,75,57,0.35);">I consent to share my mailing address with {{ pen_pal_first_name }}'s family</a>
                </p>
                <p style="margin:0 0 20px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#777;text-align:center;">
                  {{ pen_pal_first_name }}'s parent is being asked the same thing. As soon as you've both said yes, the addresses go out.
                </p>
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  Then here's the good part. On the 1st, your first pack lands &mdash; a letter from me, this month's mission, stationery, cut outs/stickers, an envelope to fold. Everything {{ child_first_name }} needs to write back. Confirm now and it'll all be sitting ready the day it arrives.
                </p>
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  And when that first letter's finished &mdash; stamp. Don't forget the stamp! I will remind you every single time until the end of days. It's sort of my whole personality.
                </p>
                <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
                  Can't wait to see where these two take it.
                </p>
                <div style="margin-top:32px;padding-top:20px;border-top:1px dashed #E0D8C8;">
                  <div style="font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;color:#1A1A1A;">
                    Yours by post,
                  </div>
                  <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:30px;line-height:1;color:#DD4B39;margin-top:4px;">
                    Poppy
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px;background-color:#FFF5E6;border-top:1px solid #E0D8C8;text-align:center;font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:12px;color:#777;">
                <div style="margin-bottom:8px;font-weight:700;color:#DD4B39;font-size:13px;">
                  MailDay&trade;
                </div>
                <div style="margin-bottom:12px;">
                  joinmailday.com &middot; hello@joinmailday.com
                </div>
                <div style="line-height:1.5;">
                  You're getting this because {{ child_first_name }} was matched with a pen pal on your MailDay&trade; account.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>$body$,
  body_text = $txt$Big news — {{child_first_name}} has a pen pal!

Their name is {{pen_pal_first_name}}, they're {{pen_pal_age}}, and here are three things about them: {{fun_fact_1}}, {{fun_fact_2}}, {{fun_fact_3}}.

{{pen_pal_first_name}}'s family got an email today too — with {{child_first_name}}'s name and fun facts — so there's a kid on the other end already excited to hear from yours.

Your first pack is here: → {{pack_url}}

The mission this week: write your first letter. Don't overthink it — the pack has a prompt card if anyone gets stuck.

Now — one grown-up thing, and then I'll get out of the way. Before any letters travel, both families have to say yes to sharing addresses. Yours to {{pen_pal_first_name}}'s family, theirs to you. Nothing moves in either direction until both of you do.

The address we'll share for you:
{{full_address}}

I consent to share my mailing address with {{pen_pal_first_name}}'s family:
→ {{confirm_address_url}}

{{pen_pal_first_name}}'s parent is being asked the same thing. As soon as you've both said yes, the addresses go out.

And don't forget your stamp. (We will remind you every single time.)

Yours by post,
Poppy
$txt$,
  variables = ARRAY['child_first_name','pen_pal_first_name','pen_pal_age','fun_fact_1','fun_fact_2','fun_fact_3','full_address','pack_url','confirm_address_url'],
  updated_by = 'groupA-a3-consent-fix'
WHERE template_key = 'match_notification'
  AND (updated_by IS NULL OR updated_by = 'groupA-a3-consent-fix');

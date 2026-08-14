-- Group A / A4: the 5 new consent-workflow email templates (Courtney's exact copy).
-- Idempotent: inserts, or refreshes subject/body if the key already exists but was
-- never customised. We DO NOT clobber a template an admin has since edited
-- (updated_by IS NOT NULL) — so re-running never overwrites Courtney's edits.

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_html, body_text, variables)
VALUES ('consent_reminder_1', $subj$still waiting on one grown-up$subj$, $fn$Poppy at MailDay$fn$, 'hello@joinmailday.com', $body$<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Caveat:wght@600;700&display=swap');
      body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
      .caveat { font-family: 'Caveat','Brush Script MT',cursive; }
    </style>
  </head>
  <body>
    <div style="display:none;font-size:1px;color:#FFF5E6;max-height:0;max-width:0;opacity:0;overflow:hidden;">One click and these two can finally start writing.</div>
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FFF5E6;" width="100%">
      <tr><td align="center" style="padding:32px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(26,26,26,0.08);" width="600">
          <tr><td align="center" bgcolor="#DD4B39" style="padding:32px;background-color:#DD4B39;border-bottom:3px solid #FFD23F;">
            <img alt="MailDay" src="https://cdn.shopify.com/s/files/1/0809/3732/0685/files/Primary_Logo_-_White_-_Transparent_Background_PNG_and_SVG_4.png?v=1781584495" style="display:block;border:0;height:auto;max-width:260px;" width="260"/>
            <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:22px;color:#FFF5E6;margin-top:10px;">No wifi required.</div>
          </td></tr>
          <tr><td style="padding:36px 40px 32px;">
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">{{ penpal_first_name }} is out there. {{ child_first_name }} is right here. And the two of them cannot write a word until you and {{ penpal_first_name }}'s grown-up both say yes.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">That is the only thing standing between these two and a very good year.</p>
            <div style="text-align:center;margin:28px 0;"><a href="{{ consent_url }}" style="display:inline-block;background-color:#DD4B39;color:#FFFFFF;text-decoration:none;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:800;font-size:16px;padding:15px 30px;border-radius:10px;">I consent to share my mailing address with {{ penpal_first_name }}'s family</a></div>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">One click. Then I promise I will stop writing to you and start writing to {{ child_first_name }} instead.</p>
            <div style="margin-top:28px;padding-top:18px;border-top:1px dashed #E0D8C8;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;color:#1A1A1A;">Yours by post,<br/>Poppy</div>
          </td></tr>
          <tr><td style="padding:22px 40px;background-color:#FFF5E6;border-top:1px solid #E0D8C8;text-align:center;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:12px;color:#777;">
            <div style="font-weight:700;color:#DD4B39;">MailDay&trade;</div>
            <div style="margin-top:6px;">joinmailday.com &middot; hello@joinmailday.com</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>$body$, $txt${{penpal_first_name}} is out there. {{child_first_name}} is right here. And the two of them cannot write a word until you and {{penpal_first_name}}'s grown-up both say yes.

That is the only thing standing between these two and a very good year.

Consent to share your address: {{consent_url}}

One click. Then I promise I will stop writing to you and start writing to {{child_first_name}} instead.

Yours by post,
Poppy$txt$, ARRAY['child_first_name','penpal_first_name','consent_url'])
ON CONFLICT (template_key) DO UPDATE
  SET subject = EXCLUDED.subject, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, variables = EXCLUDED.variables
  WHERE email_templates.updated_by IS NULL;

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_html, body_text, variables)
VALUES ('consent_reminder_2', $subj$still holding {{ child_first_name }}'s match$subj$, $fn$MailDay$fn$, 'hello@joinmailday.com', $body$<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Caveat:wght@600;700&display=swap');
      body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
      .caveat { font-family: 'Caveat','Brush Script MT',cursive; }
    </style>
  </head>
  <body>
    <div style="display:none;font-size:1px;color:#FFF5E6;max-height:0;max-width:0;opacity:0;overflow:hidden;">There's another kid on the other end waiting to hear something.</div>
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FFF5E6;" width="100%">
      <tr><td align="center" style="padding:32px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(26,26,26,0.08);" width="600">
          <tr><td align="center" bgcolor="#DD4B39" style="padding:32px;background-color:#DD4B39;border-bottom:3px solid #FFD23F;">
            <img alt="MailDay" src="https://cdn.shopify.com/s/files/1/0809/3732/0685/files/Primary_Logo_-_White_-_Transparent_Background_PNG_and_SVG_4.png?v=1781584495" style="display:block;border:0;height:auto;max-width:260px;" width="260"/>
            <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:22px;color:#FFF5E6;margin-top:10px;">No wifi required.</div>
          </td></tr>
          <tr><td style="padding:36px 40px 32px;">
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Hi {{ parent_first_name }},</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">We are still holding {{ child_first_name }}'s pen pal match. There is another kid on the other end waiting to hear something.</p>
            <div style="margin:16px 0;padding:14px 18px;background-color:#FFF5E6;border:1px solid #E0D8C8;border-radius:8px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:15px;color:#1A1A1A;">Your address on file: <strong>{{ full_address }}</strong></div>
            <div style="text-align:center;margin:28px 0;"><a href="{{ consent_url }}" style="display:inline-block;background-color:#DD4B39;color:#FFFFFF;text-decoration:none;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:800;font-size:16px;padding:15px 30px;border-radius:10px;">I consent to share my mailing address with {{ penpal_first_name }}'s family</a></div>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">If you would rather not share an address, that is completely fine and you do not need to reply. In one week we will pause your billing so you are not paying for something that is not happening, and {{ penpal_first_name }} will be matched with someone else.</p>
            <div style="margin-top:28px;padding-top:18px;border-top:1px dashed #E0D8C8;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;color:#1A1A1A;">Yours truly,<br/>MailDay</div>
          </td></tr>
          <tr><td style="padding:22px 40px;background-color:#FFF5E6;border-top:1px solid #E0D8C8;text-align:center;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:12px;color:#777;">
            <div style="font-weight:700;color:#DD4B39;">MailDay&trade;</div>
            <div style="margin-top:6px;">joinmailday.com &middot; hello@joinmailday.com</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>$body$, $txt$Hi {{parent_first_name}},

We are still holding {{child_first_name}}'s pen pal match. There is another kid on the other end waiting to hear something.

Your address on file: {{full_address}}

Consent to share your address: {{consent_url}}

If you would rather not share an address, that is completely fine and you do not need to reply. In one week we will pause your billing so you are not paying for something that is not happening, and {{penpal_first_name}} will be matched with someone else.

Yours truly,
MailDay$txt$, ARRAY['parent_first_name','child_first_name','penpal_first_name','full_address','consent_url'])
ON CONFLICT (template_key) DO UPDATE
  SET subject = EXCLUDED.subject, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, variables = EXCLUDED.variables
  WHERE email_templates.updated_by IS NULL;

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_html, body_text, variables)
VALUES ('consent_pause', $subj$we paused your membership$subj$, $fn$MailDay$fn$, 'hello@joinmailday.com', $body$<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Caveat:wght@600;700&display=swap');
      body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
      .caveat { font-family: 'Caveat','Brush Script MT',cursive; }
    </style>
  </head>
  <body>
    <div style="display:none;font-size:1px;color:#FFF5E6;max-height:0;max-width:0;opacity:0;overflow:hidden;">No sense charging you while nothing is happening.</div>
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FFF5E6;" width="100%">
      <tr><td align="center" style="padding:32px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(26,26,26,0.08);" width="600">
          <tr><td align="center" bgcolor="#DD4B39" style="padding:32px;background-color:#DD4B39;border-bottom:3px solid #FFD23F;">
            <img alt="MailDay" src="https://cdn.shopify.com/s/files/1/0809/3732/0685/files/Primary_Logo_-_White_-_Transparent_Background_PNG_and_SVG_4.png?v=1781584495" style="display:block;border:0;height:auto;max-width:260px;" width="260"/>
            <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:22px;color:#FFF5E6;margin-top:10px;">No wifi required.</div>
          </td></tr>
          <tr><td style="padding:36px 40px 32px;">
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Hi {{ parent_first_name }},</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">We never heard back about sharing {{ child_first_name }}'s mailing address, so we have paused your billing. No sense charging you while nothing is happening.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Nothing is lost. {{ child_first_name }}'s spot is still here, and we can get them matched whenever you are ready.</p>
            <div style="text-align:center;margin:28px 0;"><a href="{{ reactivate_url }}" style="display:inline-block;background-color:#DD4B39;color:#FFFFFF;text-decoration:none;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:800;font-size:16px;padding:15px 30px;border-radius:10px;">Pick up where we left off</a></div>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">If life just got busy, we understand. If MailDay is not the right fit right now, that is okay too. You do not need to tell us either way.</p>
            <div style="margin-top:28px;padding-top:18px;border-top:1px dashed #E0D8C8;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;color:#1A1A1A;">Yours truly,<br/>MailDay</div>
          </td></tr>
          <tr><td style="padding:22px 40px;background-color:#FFF5E6;border-top:1px solid #E0D8C8;text-align:center;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:12px;color:#777;">
            <div style="font-weight:700;color:#DD4B39;">MailDay&trade;</div>
            <div style="margin-top:6px;">joinmailday.com &middot; hello@joinmailday.com</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>$body$, $txt$Hi {{parent_first_name}},

We never heard back about sharing {{child_first_name}}'s mailing address, so we have paused your billing. No sense charging you while nothing is happening.

Nothing is lost. {{child_first_name}}'s spot is still here, and we can get them matched whenever you are ready.

Pick up where we left off: {{reactivate_url}}

If life just got busy, we understand. If MailDay is not the right fit right now, that is okay too. You do not need to tell us either way.

Yours truly,
MailDay$txt$, ARRAY['parent_first_name','child_first_name','reactivate_url'])
ON CONFLICT (template_key) DO UPDATE
  SET subject = EXCLUDED.subject, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, variables = EXCLUDED.variables
  WHERE email_templates.updated_by IS NULL;

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_html, body_text, variables)
VALUES ('consent_declined', $subj$your MailDay membership$subj$, $fn$MailDay$fn$, 'hello@joinmailday.com', $body$<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Caveat:wght@600;700&display=swap');
      body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
      .caveat { font-family: 'Caveat','Brush Script MT',cursive; }
    </style>
  </head>
  <body>
    <div style="display:none;font-size:1px;color:#FFF5E6;max-height:0;max-width:0;opacity:0;overflow:hidden;">We've cancelled your membership — nothing further you need to do.</div>
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FFF5E6;" width="100%">
      <tr><td align="center" style="padding:32px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(26,26,26,0.08);" width="600">
          <tr><td align="center" bgcolor="#DD4B39" style="padding:32px;background-color:#DD4B39;border-bottom:3px solid #FFD23F;">
            <img alt="MailDay" src="https://cdn.shopify.com/s/files/1/0809/3732/0685/files/Primary_Logo_-_White_-_Transparent_Background_PNG_and_SVG_4.png?v=1781584495" style="display:block;border:0;height:auto;max-width:260px;" width="260"/>
            <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:22px;color:#FFF5E6;margin-top:10px;">No wifi required.</div>
          </td></tr>
          <tr><td style="padding:36px 40px 32px;">
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Hi {{ parent_first_name }},</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">We have cancelled your membership. No charge going forward, and nothing further you need to do.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Sharing a mailing address is how the letters actually get where they are going, so without it we cannot make the pen pal part work. We completely understand it is not right for every family.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">If anything changes down the road, you are welcome back anytime. Same door, still open.</p>
            <div style="margin-top:28px;padding-top:18px;border-top:1px dashed #E0D8C8;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;color:#1A1A1A;">Yours truly,<br/>MailDay</div>
          </td></tr>
          <tr><td style="padding:22px 40px;background-color:#FFF5E6;border-top:1px solid #E0D8C8;text-align:center;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:12px;color:#777;">
            <div style="font-weight:700;color:#DD4B39;">MailDay&trade;</div>
            <div style="margin-top:6px;">joinmailday.com &middot; hello@joinmailday.com</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>$body$, $txt$Hi {{parent_first_name}},

We have cancelled your membership. No charge going forward, and nothing further you need to do.

Sharing a mailing address is how the letters actually get where they are going, so without it we cannot make the pen pal part work. We completely understand it is not right for every family.

If anything changes down the road, you are welcome back anytime. Same door, still open.

Yours truly,
MailDay$txt$, ARRAY['parent_first_name'])
ON CONFLICT (template_key) DO UPDATE
  SET subject = EXCLUDED.subject, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, variables = EXCLUDED.variables
  WHERE email_templates.updated_by IS NULL;

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_html, body_text, variables)
VALUES ('match_didnt_work_out', $subj$a quick update about {{ child_first_name }}'s match$subj$, $fn$MailDay$fn$, 'hello@joinmailday.com', $body$<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Caveat:wght@600;700&display=swap');
      body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
      .caveat { font-family: 'Caveat','Brush Script MT',cursive; }
    </style>
  </head>
  <body>
    <div style="display:none;font-size:1px;color:#FFF5E6;max-height:0;max-width:0;opacity:0;overflow:hidden;">Nothing to do with you — we're already looking for someone new.</div>
    <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#FFF5E6;" width="100%">
      <tr><td align="center" style="padding:32px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(26,26,26,0.08);" width="600">
          <tr><td align="center" bgcolor="#DD4B39" style="padding:32px;background-color:#DD4B39;border-bottom:3px solid #FFD23F;">
            <img alt="MailDay" src="https://cdn.shopify.com/s/files/1/0809/3732/0685/files/Primary_Logo_-_White_-_Transparent_Background_PNG_and_SVG_4.png?v=1781584495" style="display:block;border:0;height:auto;max-width:260px;" width="260"/>
            <div class="caveat" style="font-family:'Caveat','Brush Script MT',cursive;font-size:22px;color:#FFF5E6;margin-top:10px;">No wifi required.</div>
          </td></tr>
          <tr><td style="padding:36px 40px 32px;">
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Hi {{ parent_first_name }},</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Small hiccup. Something came up on the other family's end and they are not able to move forward. Nothing to do with you or {{ child_first_name }}. We are already looking for someone new.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">No letters were sent yet, so nothing was lost on either end. {{ child_first_name }} has not missed anything.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">We hand-match every pen pal, which means it takes a few days rather than a few seconds. We would rather get it right than get it fast. You will hear from us as soon as we have found the right kid.</p>
            <p style="margin:0 0 16px;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">Thanks for your patience. We know waiting is the hard part.</p>
            <div style="margin-top:28px;padding-top:18px;border-top:1px dashed #E0D8C8;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;color:#1A1A1A;">Yours truly,<br/>MailDay</div>
          </td></tr>
          <tr><td style="padding:22px 40px;background-color:#FFF5E6;border-top:1px solid #E0D8C8;text-align:center;font-family:Nunito,Helvetica,Arial,sans-serif;font-size:12px;color:#777;">
            <div style="font-weight:700;color:#DD4B39;">MailDay&trade;</div>
            <div style="margin-top:6px;">joinmailday.com &middot; hello@joinmailday.com</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>$body$, $txt$Hi {{parent_first_name}},

Small hiccup. Something came up on the other family's end and they are not able to move forward. Nothing to do with you or {{child_first_name}}. We are already looking for someone new.

No letters were sent yet, so nothing was lost on either end. {{child_first_name}} has not missed anything.

We hand-match every pen pal, which means it takes a few days rather than a few seconds. We would rather get it right than get it fast. You will hear from us as soon as we have found the right kid.

Thanks for your patience. We know waiting is the hard part.

Yours truly,
MailDay$txt$, ARRAY['parent_first_name','child_first_name'])
ON CONFLICT (template_key) DO UPDATE
  SET subject = EXCLUDED.subject, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, variables = EXCLUDED.variables
  WHERE email_templates.updated_by IS NULL;

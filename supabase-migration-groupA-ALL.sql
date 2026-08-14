-- ============================================================================
-- Group A — consolidated migration bundle (A3 + A4 + Item 3).
-- Safe to run as one script: every statement is idempotent (IF NOT EXISTS /
-- ON CONFLICT / DROP CONSTRAINT IF EXISTS), so re-running or partially-applied
-- state is fine. Paste this whole file into the Supabase SQL editor and Run.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE: supabase-migration-groupA-address-consent.sql
-- ─────────────────────────────────────────────────────────────────────────

-- Group A (A4 step 3/8): the onboarding address step.
-- At onboarding the parent confirms/edits their mailing address, picks a required
-- address type, and checks a box agreeing the address will be shared with their
-- pen pal's family. We record when that box was checked, on the parent record.
-- (mailing_address + address_type already exist on parents.) Idempotent.

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS address_share_ack_at TIMESTAMPTZ;


-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE: supabase-migration-groupA-consent.sql
-- ─────────────────────────────────────────────────────────────────────────

-- Group A (A3/A4): two-party address-sharing consent + the pause-reasons model.
-- Idempotent.

-- The legal consent record. One row per parent per match: the exact button text
-- they saw (including the pen pal's name), the version, and when they agreed.
-- This is what "release addresses only after BOTH consent" is decided from, and
-- what the admin consent-status view reads.
CREATE TABLE IF NOT EXISTS match_consents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  parent_id          UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  child_id           UUID REFERENCES children(id) ON DELETE SET NULL,
  consented_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  button_text        TEXT NOT NULL,     -- exact wording shown, incl. pen pal name
  penpal_first_name  TEXT,
  version            TEXT,
  consented_ip       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One consent per parent per match (a re-click is a no-op, not a duplicate row).
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_consents_unique
  ON match_consents(match_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_match_consents_match ON match_consents(match_id);

-- Pause-reasons model (built now for A4; the shape C4 will also use). A child can
-- be paused for more than one reason at once; billing resumes only when the list
-- is empty. A4 writes 'address_consent'; C-work later adds the others.
--   allowed values: 'no_match_21_day', 'address_consent', 'rematch_consent'
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS pause_reasons TEXT[] NOT NULL DEFAULT '{}';


-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE: supabase-migration-groupA-consent-emails.sql
-- ─────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE: supabase-migration-groupA-match-consent-email.sql
-- ─────────────────────────────────────────────────────────────────────────

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


-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE: supabase-migration-groupA-consent-lifecycle.sql
-- ─────────────────────────────────────────────────────────────────────────

-- Group A / A4: the two-party address-consent reminder + day-14 timeout engine.
-- Idempotent. Adds the once-per-step stamp columns the cron guards on, and
-- widens two enum-style CHECK constraints so the timeout/decline paths can label
-- their data honestly (rather than overloading 'admin_dissolved').

-- 1. Idempotency stamps on `matches`. The A4 cron sends reminder 1 at 48h and
--    reminder 2 at day 7, and winds the match down at day 14 — each guarded by
--    its own "IS NULL" stamp so it fires exactly once.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS consent_reminder_1_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_reminder_2_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_timeout_at         TIMESTAMPTZ;

-- 2. Two new close-reason codes: a match can now be wound down because address
--    consent timed out, or because a family actively declined to share.
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_close_reason_code_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_close_reason_code_check
  CHECK (close_reason_code IS NULL OR close_reason_code IN (
    'rematch_requested',
    'tier_mismatch',
    'cancellation',
    'admin_dissolved',
    'data_deletion',
    'consent_timeout',
    'consent_declined'
  ));

-- 3. Two new lifecycle_task types for the human follow-ups A4 creates: pause a
--    non-responsive family's ReCharge billing after a consent timeout, and
--    review a family that actively declined. (Re-adds the full existing list.)
ALTER TABLE lifecycle_tasks
  DROP CONSTRAINT IF EXISTS lifecycle_tasks_type_check;
ALTER TABLE lifecycle_tasks
  ADD CONSTRAINT lifecycle_tasks_type_check
  CHECK (type IN (
    'send_poppy_card',
    'chase_address_confirmation',
    'contact_guarantee_breach',
    'review_tier_mismatch',
    'incomplete_onboarding_followup',
    'pause_offer_followup',
    'review_orphaned_partner',
    'coppa_deletion_pending',
    'consent_timeout_pause',
    'consent_declined_review',
    'consent_reactivated'
  ));

-- Supports the cron's scan: Pending matches ordered by age, timeout not yet run.
CREATE INDEX IF NOT EXISTS idx_matches_pending_consent
  ON matches(match_status, created_at)
  WHERE match_status = 'Pending';


-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE: supabase-migration-groupA-family-moves.sql
-- ─────────────────────────────────────────────────────────────────────────

-- Group A / Item 3 (family moves): when a matched family changes their address,
-- the match re-opens for two-party consent to the NEW address (reusing the A4
-- flow). Idempotent.

-- When a match re-opens for re-consent, its consent clock must restart — the A4
-- reminder/timeout engine measures elapsed time from here, falling back to
-- created_at for brand-new matches (where this stays NULL). Without it, reopening
-- a long-Active match would look 14+ days old and time out instantly.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS consent_opened_at TIMESTAMPTZ;

-- Lets the app remember the address a match's consent was granted against, so a
-- later move can tell "this consent is for the old address" and require re-consent.
-- (The live source of truth stays parents.mailing_address; this is the snapshot
-- both sides actually consented to share.)
ALTER TABLE match_consents
  ADD COLUMN IF NOT EXISTS consented_address TEXT;


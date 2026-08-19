-- ============================================================================
-- Tier upgrade at 7: the billing task type + the parent's email.
--
-- When a Minis child turns 7 they move up to Core. They keep their pen pal, the
-- parent is emailed, and billing is deliberately NOT touched — Core may be
-- priced differently from Minis, and software should not quietly change what a
-- family pays. Hence the task.
--
-- Safe to run as one script: idempotent throughout. The template insert will not
-- overwrite copy Courtney has already edited in the app (updated_by IS NULL).
-- ============================================================================


-- 1. The billing follow-up task type. (Re-adds the full existing list — a CHECK
--    cannot be altered in place.)
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
    'consent_reactivated',
    'gak_address_overdue',
    'tier_upgrade_billing'
  ));


-- 2. The parent's email. Starter copy only — it appears in Admin → Email
--    Templates like every other, for Courtney to rewrite in her own voice.
INSERT INTO email_templates (template_key, subject, from_name, from_email, body_html, body_text, variables)
VALUES (
  'tier_upgraded_to_core',
  $subj${{child_first_name}} is moving up to Core$subj$,
  $fn$MailDay$fn$,
  'hello@joinmailday.com',
  $body$<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap');
      body, table, td, div, p, a { font-family: 'Nunito', Helvetica, Arial, sans-serif; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#FFF9F4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9F4;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;padding:32px;">
          <tr><td>
            <p style="font-size:16px;color:#1A1A1A;margin:0 0 16px;">Hi {{parent_first_name}},</p>
            <p style="font-size:16px;color:#3a3528;line-height:1.6;margin:0 0 16px;">
              {{child_first_name}} has turned {{age}}, so from their next pack they'll be moving up
              from Minis to Core.
            </p>
            <p style="font-size:16px;color:#3a3528;line-height:1.6;margin:0 0 16px;">
              Core packs ask a little more of them &mdash; more writing, longer prompts, and
              activities pitched at older children. Same MailDay, just grown up a bit.
            </p>
            <p style="font-size:16px;color:#3a3528;line-height:1.6;margin:0 0 16px;">
              <strong>Their pen pal isn't changing.</strong> They keep writing to exactly the same
              friend &mdash; only the pack in the envelope is different.
            </p>
            <p style="font-size:16px;color:#3a3528;line-height:1.6;margin:0 0 16px;">
              If you'd rather {{child_first_name}} stayed on Minis a while longer, just reply to this
              email and we'll put it back. Plenty of children aren't ready at exactly seven, and
              that's completely fine.
            </p>
            <p style="font-size:16px;color:#1A1A1A;margin:24px 0 0;">Warmly,<br/>The MailDay team</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>$body$,
  $txt$Hi {{parent_first_name}},

{{child_first_name}} has turned {{age}}, so from their next pack they'll be moving up from Minis to Core.

Core packs ask a little more of them - more writing, longer prompts, and activities pitched at older children. Same MailDay, just grown up a bit.

Their pen pal isn't changing. They keep writing to exactly the same friend - only the pack in the envelope is different.

If you'd rather {{child_first_name}} stayed on Minis a while longer, just reply to this email and we'll put it back. Plenty of children aren't ready at exactly seven, and that's completely fine.

Warmly,
The MailDay team$txt$,
  ARRAY['parent_first_name','child_first_name','age','new_tier']
)
ON CONFLICT (template_key) DO UPDATE
  SET subject = EXCLUDED.subject, from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email,
      body_html = EXCLUDED.body_html, body_text = EXCLUDED.body_text, variables = EXCLUDED.variables
  WHERE email_templates.updated_by IS NULL;

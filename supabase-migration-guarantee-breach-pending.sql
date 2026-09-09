-- Guarantee-breach "pause pending" email variant.
--
-- The day-21 guarantee-breach cron now sends THIS instead of `guarantee_breach`
-- whenever the ReCharge billing pause did NOT actually apply (auto-pause is in
-- dry-run / RECHARGE_WRITES_ENABLED off, the family has no single linked
-- subscription, or the pause failed). The regular `guarantee_breach` email says
-- "I've paused your billing" — which must only go out when that is TRUE. This
-- variant reassures the family and commits to handling their billing WITHOUT
-- claiming a pause that hasn't happened, so a family is never told they're paused
-- while ReCharge is still charging them. The human ReCharge task does the real pause.
--
-- Idempotent: ON CONFLICT DO NOTHING seeds a fresh DB but never overwrites a
-- version the team has customised. (Production already carries the branded
-- design, cloned from the live guarantee_breach template and applied directly.)

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_text, body_html, variables)
VALUES (
  'guarantee_breach_pending',
  'An update on your child''s pen pal match',
  'Courtney | MailDay',
  'hello@joinmailday.com',
  $TXT$Hi —

Honest update: we haven't found the right pen pal for {{child_first_name}} yet, and our promise is 21 days — so I'm writing before that clock runs out, not after.

Here's where things stand. I'm making sure you're not charged while you wait — I'm handling the billing side personally so the guarantee holds while we keep searching. Nothing for you to do.

{{child_first_name}} is first in line for our next round, and I expect to have a name for you soon.

Thanks for hanging in with us.

Courtney
Founder, MailDay
$TXT$,
  $HTML$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Hi —</p>
<p>Honest update: we haven't found the right pen pal for <strong>{{child_first_name}}</strong> yet, and our promise is 21 days — so I'm writing before that clock runs out, not after.</p>
<p>Here's where things stand. I'm making sure you're not charged while you wait — I'm handling the billing side personally so the guarantee holds while we keep searching. Nothing for you to do.</p>
<p>{{child_first_name}} is first in line for our next round, and I expect to have a name for you soon.</p>
<p>Thanks for hanging in with us.</p>
<p>Courtney<br/>Founder, MailDay</p>
</div>$HTML$,
  ARRAY['child_first_name','parent_first_name','days_waiting']
)
ON CONFLICT (template_key) DO NOTHING;

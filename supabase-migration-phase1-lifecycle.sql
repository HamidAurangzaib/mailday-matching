-- =============================================================================
-- MailDay Matching — Phase 1 (Lifecycle Foundations) Migration
-- =============================================================================
-- Run this in your Supabase SQL Editor:
--   https://supabase.com/dashboard/project/wqepgxxsipztfzkldiix/sql/new
--
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- What this adds, in order:
--   A. New columns on existing tables (matches, children, parents, cancellations)
--   B. lifecycle_tasks      — generic team tasks (Poppy cards, address chases, etc.)
--   C. audit_log            — who did what, when (COPPA + general accountability)
--   D. confirmation_tokens  — one-click email-link confirmations (address change,
--                             pause offer, address-at-match, reactivate)
--   E. email_templates      — Resend templates editable from the admin UI
--   F. Seed the 4 Resend templates with Courtney's drafts from the lifecycle map
-- =============================================================================

-- ── A. NEW COLUMNS ───────────────────────────────────────────────────────────

-- matches: address-confirmation state machine and structured close reason
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS address_confirmed_a    BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS address_confirmed_b    BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS address_confirmed_a_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS address_confirmed_b_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promoted_to_active_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_mismatch_flagged  BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS close_reason_code      TEXT;

-- The existing match_status CHECK constraint only allows 'Active','Closed'.
-- Phase 2 introduces a 'Pending' state for matches awaiting both address
-- confirmations. We can't ALTER a CHECK in place; we drop and recreate.
-- (If the constraint name in your DB differs, run the introspection at the
--  bottom of this file to find it.)
DO $$
DECLARE c_name TEXT;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'matches'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%match_status%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE matches DROP CONSTRAINT %I', c_name);
  END IF;
  ALTER TABLE matches
    ADD CONSTRAINT matches_match_status_check
    CHECK (match_status IN ('Pending', 'Active', 'Closed', 'Ended'));
END $$;

-- close_reason_code enum-style (Phase 4 will fill this in for old rows)
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_close_reason_code_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_close_reason_code_check
  CHECK (close_reason_code IS NULL OR close_reason_code IN (
    'rematch_requested',
    'tier_mismatch',
    'cancellation',
    'admin_dissolved',
    'data_deletion'
  ));

-- children: cancellation + COPPA delete timestamps + match-priority flag
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rematch_priority  BOOLEAN DEFAULT FALSE;

-- parents: distinguish pause types, cancellation grace window, win-back tracking
-- Note: billing_paused was missing from the original schema even though existing
-- code (ReCharge cancellation webhook + lifecycle jobs) writes to it. Adding it
-- here so a fresh DB apply of this migration includes it.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS billing_paused         BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pause_type             TEXT,
  ADD COLUMN IF NOT EXISTS intent_to_cancel_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_offer_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_offer_accepted   BOOLEAN,
  ADD COLUMN IF NOT EXISTS offboarded_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_nudge_sent_at TIMESTAMPTZ;

ALTER TABLE parents
  DROP CONSTRAINT IF EXISTS parents_pause_type_check;
ALTER TABLE parents
  ADD CONSTRAINT parents_pause_type_check
  CHECK (pause_type IS NULL OR pause_type IN ('voluntary','guarantee'));

-- cancellations: structured reason code (only if the cancellations table
-- already exists — its base migration `supabase-cancellations-migration.sql`
-- is separate and may not have been applied yet).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='cancellations'
  ) THEN
    ALTER TABLE cancellations
      ADD COLUMN IF NOT EXISTS reason_code TEXT;

    BEGIN
      ALTER TABLE cancellations DROP CONSTRAINT IF EXISTS cancellations_reason_code_check;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ALTER TABLE cancellations
      ADD CONSTRAINT cancellations_reason_code_check
      CHECK (reason_code IS NULL OR reason_code IN (
        'price','no_letters','wrong_fit','moving','financial_hardship',
        'forgot','seasonal','aged_out','other'
      ));
  END IF;
END $$;


-- ── B. lifecycle_tasks ───────────────────────────────────────────────────────
-- Generic team tasks surfaced in Action Items. Replaces the per-feature task
-- tables for new lifecycle work. (give_a_key_tasks and cancellation_tasks stay
-- as they are; this table is additive.)

CREATE TABLE IF NOT EXISTS lifecycle_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  parent_id   UUID REFERENCES parents(id)  ON DELETE CASCADE,
  child_id    UUID REFERENCES children(id) ON DELETE CASCADE,
  match_id    UUID REFERENCES matches(id)  ON DELETE CASCADE,
  due_at      TIMESTAMPTZ,
  completed   BOOLEAN     NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lifecycle_tasks_type_check CHECK (type IN (
    'send_poppy_card',
    'chase_address_confirmation',
    'contact_guarantee_breach',
    'review_tier_mismatch',
    'incomplete_onboarding_followup',
    'pause_offer_followup',
    'review_orphaned_partner',
    'coppa_deletion_pending'
  ))
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_completed ON lifecycle_tasks(completed);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_type      ON lifecycle_tasks(type);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_parent    ON lifecycle_tasks(parent_id);


-- ── C. audit_log ─────────────────────────────────────────────────────────────
-- Append-only record of who did what to which entity.

CREATE TABLE IF NOT EXISTS audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       UUID,        -- nullable for system/cron actions
  actor_email    TEXT,
  actor_ip       TEXT,
  action         TEXT NOT NULL, -- e.g. 'child.delete','match.dissolve','parent.address_change'
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL, -- TEXT so we can log against UUID-based entities AND string-keyed ones like email_templates

  payload_before JSONB,
  payload_after  JSONB,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity     ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);


-- ── D. confirmation_tokens ───────────────────────────────────────────────────
-- One-click email-link confirmations. Used by:
--   • address_change         — closes audit §3.3 (enroll + GAK PO-box)
--   • address_confirm_match  — Phase 2 (match-notification email)
--   • pause_offer            — Phase 3 (pause vs cancel)
--   • reactivate             — Phase 4 (day-30 win-back)

CREATE TABLE IF NOT EXISTS confirmation_tokens (
  token        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,
  parent_id    UUID REFERENCES parents(id)  ON DELETE CASCADE,
  child_id     UUID REFERENCES children(id) ON DELETE CASCADE,
  match_id     UUID REFERENCES matches(id)  ON DELETE CASCADE,
  email        TEXT,         -- the address that received the link (proves ownership)
  payload      JSONB,        -- type-specific data (e.g. new mailing_address)
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  consumed_ip  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT confirmation_tokens_type_check CHECK (type IN (
    'address_change',
    'address_confirm_match',
    'pause_offer',
    'reactivate'
  ))
);

CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_parent  ON confirmation_tokens(parent_id);
CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_expires ON confirmation_tokens(expires_at);


-- ── E. email_templates ───────────────────────────────────────────────────────
-- The 4 Resend templates Courtney edits via the admin "Email Templates" page
-- (built in Phase 2.7). Stored as plain text/markdown with {{var}} placeholders.

CREATE TABLE IF NOT EXISTS email_templates (
  template_key TEXT PRIMARY KEY,
  subject      TEXT NOT NULL,
  from_name    TEXT NOT NULL,
  from_email   TEXT NOT NULL,
  body_html    TEXT NOT NULL,
  body_text    TEXT NOT NULL,
  variables    TEXT[] NOT NULL DEFAULT '{}', -- documentation aid for the editor
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT
);


-- ── F. SEED THE 4 RESEND TEMPLATES ────────────────────────────────────────────
-- Drawn verbatim from the lifecycle map. Courtney can edit any of these later
-- via the admin UI. Subjects and from-names match her drafts. ON CONFLICT means
-- this seed only runs the first time; subsequent migration re-runs leave
-- Courtney's edits intact.

INSERT INTO email_templates (template_key, subject, from_name, from_email, body_text, body_html, variables) VALUES
(
  'onboarding_nudge',
  'Your MailDay pen pal is waiting on one thing',
  'Courtney | MailDay',
  'hello@joinmailday.com',
  $TXT$Hi! — quick one.

Your MailDay membership is all set, but we noticed the onboarding form isn't finished yet — and we can't match your child with a pen pal until it is.

It's three minutes, promise. Just your child's name, birthday, and a few things they love.

→ {{onboarding_url}}

The sooner it's in, the sooner there's a letter on the way.

No wifi required,
Courtney
$TXT$,
  $HTML$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Hi! — quick one.</p>
<p>Your MailDay membership is all set, but we noticed the onboarding form isn't finished yet — and we can't match your child with a pen pal until it is.</p>
<p>It's three minutes, promise. Just your child's name, birthday, and a few things they love.</p>
<p style="margin:24px 0"><a href="{{onboarding_url}}" style="display:inline-block;background:#DD4B39;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">Finish the form</a></p>
<p>The sooner it's in, the sooner there's a letter on the way.</p>
<p>No wifi required,<br/>Courtney</p>
</div>$HTML$,
  ARRAY['onboarding_url','parent_first_name']
),
(
  'match_notification',
  'Meet {{pen_pal_first_name}}. Your first pack is inside.',
  'Poppy at MailDay',
  'hello@joinmailday.com',
  $TXT$Big news — {{child_first_name}} has a pen pal!

Their name is {{pen_pal_first_name}}, they're {{pen_pal_age}}, and here are three things about them: {{fun_fact_1}}, {{fun_fact_2}}, {{fun_fact_3}}.

{{pen_pal_first_name}}'s family got an email today too — with {{child_first_name}}'s name and fun facts — so there's a kid on the other end already excited to hear from yours.

Your first pack is here: → {{pack_url}}

The mission this week: write your first letter. Don't overthink it — the pack has a prompt card if anyone gets stuck.

Before we send your address to {{pen_pal_first_name}}'s family, please confirm it's still right. One click:

→ {{confirm_address_url}}

(This is a child-safety step — letters can't go out until both families confirm.)

Mailing address for {{pen_pal_first_name}} will appear after confirmation.

And don't forget your stamp. (We will remind you every single time.)

Yours by post,
Poppy
$TXT$,
  $HTML$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Big news — <strong>{{child_first_name}}</strong> has a pen pal!</p>
<p>Their name is <strong>{{pen_pal_first_name}}</strong>, they're {{pen_pal_age}}, and here are three things about them: {{fun_fact_1}}, {{fun_fact_2}}, {{fun_fact_3}}.</p>
<p>{{pen_pal_first_name}}'s family got an email today too — with {{child_first_name}}'s name and fun facts — so there's a kid on the other end already excited to hear from yours.</p>
<p>Your first pack is here: <a href="{{pack_url}}">{{pack_url}}</a></p>
<p>The mission this week: write your first letter. Don't overthink it — the pack has a prompt card if anyone gets stuck.</p>
<p style="background:#FFF5E6;border-left:4px solid #DD4B39;padding:12px 16px;margin:24px 0">
Before we send your address to {{pen_pal_first_name}}'s family, please confirm it's still right. One click:
</p>
<p style="margin:24px 0"><a href="{{confirm_address_url}}" style="display:inline-block;background:#DD4B39;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">Confirm my mailing address</a></p>
<p style="color:#666;font-size:13px">This is a child-safety step — letters can't go out until both families confirm.</p>
<p>Mailing address for {{pen_pal_first_name}} will appear after confirmation.</p>
<p>And don't forget your stamp. (We will remind you every single time.)</p>
<p>Yours by post,<br/>Poppy</p>
</div>$HTML$,
  ARRAY['child_first_name','pen_pal_first_name','pen_pal_age','fun_fact_1','fun_fact_2','fun_fact_3','pack_url','confirm_address_url']
),
(
  'guarantee_breach',
  'An update on your child''s pen pal match',
  'Courtney | MailDay',
  'hello@joinmailday.com',
  $TXT$Hi — I wanted to reach out personally.

We promise every child a pen pal within 21 days, and we haven't found the right match for {{child_first_name}} yet. I'm sorry about that — a good match matters more to us than a fast one, and we'd rather get it right.

Here's what we're doing: I've paused your billing, so you won't be charged again until your child is actually matched. Nothing for you to do.

Your child is now top priority in our next matching round. I expect to have news for you very soon.

Thank you for your patience — it means a lot.

No wifi required,
Courtney
$TXT$,
  $HTML$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Hi — I wanted to reach out personally.</p>
<p>We promise every child a pen pal within 21 days, and we haven't found the right match for <strong>{{child_first_name}}</strong> yet. I'm sorry about that — a good match matters more to us than a fast one, and we'd rather get it right.</p>
<p>Here's what we're doing: I've paused your billing, so you won't be charged again until your child is actually matched. Nothing for you to do.</p>
<p>Your child is now top priority in our next matching round. I expect to have news for you very soon.</p>
<p>Thank you for your patience — it means a lot.</p>
<p>No wifi required,<br/>Courtney</p>
</div>$HTML$,
  ARRAY['child_first_name','parent_first_name','days_waiting']
),
(
  'pause_offer',
  'Before you go — would a pause help?',
  'Courtney | MailDay',
  'hello@joinmailday.com',
  $TXT$Hi — I saw you started to cancel, and I completely understand. Life gets full.

Before you go, one option: instead of cancelling, you can pause your membership for 1, 2, or 3 months. Your child keeps their pen pal, nothing gets lost, and billing simply stops until you're ready.

A lot of families pause for a busy season and come right back. The door stays open either way.

→ {{pause_url}}
→ {{confirm_cancel_url}}

Whatever you choose — thank you for giving your kid this. It mattered.

No wifi required,
Courtney
$TXT$,
  $HTML$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Hi — I saw you started to cancel, and I completely understand. Life gets full.</p>
<p>Before you go, one option: instead of cancelling, you can pause your membership for 1, 2, or 3 months. Your child keeps their pen pal, nothing gets lost, and billing simply stops until you're ready.</p>
<p>A lot of families pause for a busy season and come right back. The door stays open either way.</p>
<p style="margin:24px 0">
  <a href="{{pause_url}}" style="display:inline-block;background:#DD4B39;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;margin-right:8px">Pause my membership</a>
  <a href="{{confirm_cancel_url}}" style="display:inline-block;background:#fff;color:#666;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;border:1px solid #ddd">No thanks, continue cancelling</a>
</p>
<p>Whatever you choose — thank you for giving your kid this. It mattered.</p>
<p>No wifi required,<br/>Courtney</p>
</div>$HTML$,
  ARRAY['parent_first_name','pause_url','confirm_cancel_url']
),
-- 5th template: transactional, used by the address-change confirmation flow on
-- /enroll and /give-a-key/po-box. Not in Courtney's lifecycle 4 — purely
-- infrastructure for closing audit §3.3. Editable in admin UI same as the others.
(
  'address_change_confirm',
  'Confirm your mailing address change',
  'MailDay',
  'hello@joinmailday.com',
  $TXT$Hi — someone (we hope it was you) asked to update the mailing address on your MailDay account to:

{{new_address}}

If that was you, click this link to confirm. This link expires in 24 hours.

→ {{confirm_url}}

If it wasn't you, just ignore this email — your address won't change unless the link is clicked.

— The MailDay team
$TXT$,
  $HTML$<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6">
<p>Hi — someone (we hope it was you) asked to update the mailing address on your MailDay account to:</p>
<blockquote style="border-left:4px solid #DD4B39;padding:10px 14px;background:#FFF5E6;margin:18px 0">{{new_address}}</blockquote>
<p>If that was you, click this link to confirm. This link expires in 24 hours.</p>
<p style="margin:24px 0"><a href="{{confirm_url}}" style="display:inline-block;background:#DD4B39;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">Confirm address change</a></p>
<p style="color:#666;font-size:13px">If it wasn't you, just ignore this email — your address won't change unless the link is clicked.</p>
<p>— The MailDay team</p>
</div>$HTML$,
  ARRAY['new_address','confirm_url']
)
ON CONFLICT (template_key) DO NOTHING;


-- ── G. Useful indexes for Phase 2 hot paths ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_matches_pending_addrs
  ON matches(match_status, address_confirmed_a, address_confirmed_b)
  WHERE match_status = 'Pending';

CREATE INDEX IF NOT EXISTS idx_parents_offboarded_at  ON parents(offboarded_at);
CREATE INDEX IF NOT EXISTS idx_parents_at_risk        ON parents(at_risk) WHERE at_risk = TRUE;
CREATE INDEX IF NOT EXISTS idx_parents_intent_cancel  ON parents(intent_to_cancel_at) WHERE intent_to_cancel_at IS NOT NULL;


-- ── DONE ─────────────────────────────────────────────────────────────────────
-- After running this:
--   1. Restart the API server (it'll pick up the new schema on first query).
--   2. The admin "Email Templates" page (Phase 2.7) will list these 5 templates.
--   3. Phase 1 code lands and will start using these tables.

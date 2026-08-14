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

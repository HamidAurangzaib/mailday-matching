-- ============================================================================
-- Group A / A6 — Give-a-Key families who don't have an address yet.
--
-- A family setting up a PO Box through Give a Key finishes onboarding before
-- they have anywhere for letters to go. Their child must be held out of the
-- matching pool until the PO Box exists, then released automatically.
--
-- Safe to run as one script: every statement is idempotent. Paste this whole
-- file into the Supabase SQL editor and Run.
-- ============================================================================


-- 1. The holding status.
--
-- The matcher selects children WHERE match_status IN ('Unmatched','Rematch
-- Requested'), so introducing a new status value keeps these children out of
-- the pool with no change to the matcher itself — there is no second exclusion
-- rule that could be forgotten later.
--
-- The existing CHECK is inline from CREATE TABLE, so its name is whatever
-- Postgres generated. Look it up rather than assume.
DO $$
DECLARE c_name TEXT;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'children'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%match_status%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE children DROP CONSTRAINT %I', c_name);
  END IF;
  ALTER TABLE children
    ADD CONSTRAINT children_match_status_check
    CHECK (match_status IN (
      'Unmatched',
      'Matched',
      'Rematch Requested',
      'Rematched',
      'Paused',
      'Cancelled',
      'Awaiting Address'
    ));
END $$;


-- 2. When the wait began, so the 30-day follow-up can be timed.
--
-- Nullable by design: only an Awaiting Address child carries it, and it is
-- cleared on activation so a child who waits, activates, and later returns to
-- the pool can't inherit a stale clock.
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS awaiting_address_since TIMESTAMPTZ;


-- 3. The follow-up task type for a family still without an address after 30
--    days. A6 is explicit that this is a nudge, never a cancellation.
--    (Re-adds the full existing list — a CHECK can't be altered in place.)
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
    'gak_address_overdue'
  ));


-- 4. Supports the cron's scan: the oldest still-waiting children first.
CREATE INDEX IF NOT EXISTS idx_children_awaiting_address
  ON children(awaiting_address_since)
  WHERE match_status = 'Awaiting Address';

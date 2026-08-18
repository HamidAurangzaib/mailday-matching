-- ============================================================================
-- Guarantee auto-pause — push the ReCharge charge date instead of a manual step.
--
-- At day 21 the guarantee-breach job already flips billing_paused and emails the
-- family. Actually stopping the money was a manual ReCharge step, which made the
-- customer-facing "21-day promise" depend on someone remembering to do it.
--
-- ReCharge has no pause primitive in the 2021-11 API, so "pause" means pushing
-- the next charge date forward and restoring it when the match is made. These
-- columns hold the bookkeeping needed to put it back exactly as it was.
--
-- Safe to run as one script: every statement is idempotent.
-- ============================================================================


-- 1. Which ReCharge subscription belongs to this family.
--
-- The column already exists in the base schema but nothing ever populated it.
-- The hourly sync now fills it, and ONLY when the family has exactly one active
-- subscription — with per-child memberships a family can hold several, and we
-- will not guess which child's membership to stop. Families with more than one
-- keep the manual task.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS recharge_subscription_id TEXT;


-- 2. The charge date we found before pausing, so resuming restores the family's
--    real schedule rather than an invented one.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS guarantee_pause_original_charge_date DATE;


-- 3. When the automation acted. NULL means the pause was manual (or hasn't
--    happened), which is what tells the resume path whether there is anything
--    of ours to undo.
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS guarantee_pause_applied_at TIMESTAMPTZ;


-- 4. Supports the resume lookup on match creation.
CREATE INDEX IF NOT EXISTS idx_parents_guarantee_pause
  ON parents(guarantee_pause_applied_at)
  WHERE guarantee_pause_applied_at IS NOT NULL;

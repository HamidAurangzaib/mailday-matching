-- Group A (A4 step 3/8): the onboarding address step.
-- At onboarding the parent confirms/edits their mailing address, picks a required
-- address type, and checks a box agreeing the address will be shared with their
-- pen pal's family. We record when that box was checked, on the parent record.
-- (mailing_address + address_type already exist on parents.) Idempotent.

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS address_share_ack_at TIMESTAMPTZ;

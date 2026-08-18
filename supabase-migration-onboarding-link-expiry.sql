-- ============================================================================
-- Give the onboarding link its own expiry.
--
-- Expiry was derived from parents.created_at + 30 days, which conflated "how old
-- is this family's record" with "how old is this link". The practical
-- consequence: a link could not be reissued. Minting a fresh token for a family
-- whose record is 25 days old still produced a link that died in 5 days, so a
-- family who missed their window — through our fault or theirs — could not be
-- helped without falsifying their join date.
--
-- This column is the override. NULL keeps the existing created_at + 30 days
-- behaviour, so nothing changes for anyone until it is deliberately set.
--
-- Safe to run as one script: additive and re-runnable.
-- ============================================================================

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS onboarding_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN parents.onboarding_token_expires_at IS
  'Explicit expiry for this family''s onboarding link. NULL = fall back to created_at + 30 days.';

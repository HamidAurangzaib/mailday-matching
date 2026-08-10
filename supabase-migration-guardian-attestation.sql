-- Guardian attestation (standalone, ahead of Group A / item D1).
-- At onboarding, the parent must confirm four attorney-specified statements
-- (parent/guardian, 18+, will read all letters, accepts removal-with-refund).
-- We record WHEN they attested and WHICH version of the wording they saw, so
-- there's a documented basis to remove a member if ever needed. Per-parent
-- (not per-child) — one attestation covers the account. Idempotent.

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS guardian_attestation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guardian_attestation_version TEXT;

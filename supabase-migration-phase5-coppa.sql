-- =============================================================================
-- MailDay Matching — Phase 5 (COPPA hard delete + audit log viewer)
-- =============================================================================
-- Idempotent — safe to re-run.
--
-- What this adds:
--   A. matches.anonymised_at — set when a child reference is erased, with
--      both child_a_id / child_b_id nulled out for the affected side(s).
--   B. parents.coppa_erase_requested_at — set when the team initiates erasure.
--      After 7 days, the daily cron actually executes the cascade. While set,
--      the family is treated as "pending erasure" in the UI.
--   C. parents.coppa_erased_at — set when the erasure executes. Allows us to
--      distinguish "offboarded" (lost as a member) from "erased" (legally
--      removed). offboarded_at + coppa_erased_at can both be present.
-- =============================================================================

-- A. matches — anonymisation marker
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ;

-- The existing FKs on child_a_id / child_b_id reference children(id). For
-- anonymisation we need those columns to accept NULL. They were declared NOT
-- NULL in the original schema. Relax that.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'matches'
      AND column_name = 'child_a_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE matches ALTER COLUMN child_a_id DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'matches'
      AND column_name = 'child_b_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE matches ALTER COLUMN child_b_id DROP NOT NULL;
  END IF;
END $$;

-- B + C. parents — erasure timestamps
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS coppa_erase_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coppa_erase_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS coppa_erased_at TIMESTAMPTZ;

-- Indexes for the daily cron + admin views
CREATE INDEX IF NOT EXISTS idx_parents_coppa_pending
  ON parents(coppa_erase_requested_at)
  WHERE coppa_erase_requested_at IS NOT NULL AND coppa_erased_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_anonymised_at
  ON matches(anonymised_at) WHERE anonymised_at IS NOT NULL;

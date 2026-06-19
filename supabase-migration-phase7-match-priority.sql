-- Phase 7 (same-month matching) — add match_priority_tier to match records.
-- Set when a match is created: 'same_month' if both children are on the same
-- per-child subscription month (shared Poppy story / writing mission), else 'any'.
-- Drives which first-letter email the family receives. Idempotent.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS match_priority_tier TEXT;

-- Optional sanity constraint: only the two known values (or NULL for legacy rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'matches' AND constraint_name = 'matches_priority_tier_check'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT matches_priority_tier_check
      CHECK (match_priority_tier IN ('same_month', 'any') OR match_priority_tier IS NULL);
  END IF;
END $$;

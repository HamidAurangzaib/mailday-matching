-- Group A (A3/A4): two-party address-sharing consent + the pause-reasons model.
-- Idempotent.

-- The legal consent record. One row per parent per match: the exact button text
-- they saw (including the pen pal's name), the version, and when they agreed.
-- This is what "release addresses only after BOTH consent" is decided from, and
-- what the admin consent-status view reads.
CREATE TABLE IF NOT EXISTS match_consents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  parent_id          UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  child_id           UUID REFERENCES children(id) ON DELETE SET NULL,
  consented_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  button_text        TEXT NOT NULL,     -- exact wording shown, incl. pen pal name
  penpal_first_name  TEXT,
  version            TEXT,
  consented_ip       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One consent per parent per match (a re-click is a no-op, not a duplicate row).
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_consents_unique
  ON match_consents(match_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_match_consents_match ON match_consents(match_id);

-- Pause-reasons model (built now for A4; the shape C4 will also use). A child can
-- be paused for more than one reason at once; billing resumes only when the list
-- is empty. A4 writes 'address_consent'; C-work later adds the others.
--   allowed values: 'no_match_21_day', 'address_consent', 'rematch_consent'
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS pause_reasons TEXT[] NOT NULL DEFAULT '{}';

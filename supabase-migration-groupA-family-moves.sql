-- Group A / Item 3 (family moves): when a matched family changes their address,
-- the match re-opens for two-party consent to the NEW address (reusing the A4
-- flow). Idempotent.

-- When a match re-opens for re-consent, its consent clock must restart — the A4
-- reminder/timeout engine measures elapsed time from here, falling back to
-- created_at for brand-new matches (where this stays NULL). Without it, reopening
-- a long-Active match would look 14+ days old and time out instantly.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS consent_opened_at TIMESTAMPTZ;

-- Lets the app remember the address a match's consent was granted against, so a
-- later move can tell "this consent is for the old address" and require re-consent.
-- (The live source of truth stays parents.mailing_address; this is the snapshot
-- both sides actually consented to share.)
ALTER TABLE match_consents
  ADD COLUMN IF NOT EXISTS consented_address TEXT;

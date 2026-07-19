-- Phase 8 — per-child memberships.
--
-- Problem this solves: a Shopify order can contain MORE THAN ONE membership,
-- at different tiers (e.g. 1× Homeschool Core + 1× Minis). The old code collapsed
-- the whole order into a single `parents.membership_tier`, so the second child's
-- purchased tier was silently lost, and each child's tier was then *derived* from
-- the parent's tier + the child's age (which is why a paid-for "Minis" child could
-- come out as "Homeschool Minis").
--
-- New model: one row per PURCHASED membership. A child claims a slot at onboarding,
-- so a child's tier is always exactly what was paid for, and a family can never
-- enrol more children than memberships they bought.
--
-- `parents.membership_tier` is intentionally left in place as a legacy/summary
-- field (set to the primary purchased tier) — lots of reporting reads it.
-- Idempotent.

CREATE TABLE IF NOT EXISTS membership_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  tier              TEXT NOT NULL,
  billing_type      TEXT,
  -- Provenance so we can trace a slot back to the order that created it.
  shopify_order_id  TEXT,
  source            TEXT NOT NULL DEFAULT 'shopify',
  -- NULL until a child claims this membership during onboarding.
  child_id          UUID REFERENCES children(id) ON DELETE SET NULL,
  assigned_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_slots_tier_check'
  ) THEN
    ALTER TABLE membership_slots
      ADD CONSTRAINT membership_slots_tier_check
      CHECK (tier IN ('Core', 'Minis', 'Homeschool Core', 'Homeschool Minis'));
  END IF;
END $$;

-- Fast lookup of a family's unclaimed memberships during onboarding.
CREATE INDEX IF NOT EXISTS idx_membership_slots_parent_unassigned
  ON membership_slots(parent_id)
  WHERE child_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_membership_slots_child
  ON membership_slots(child_id)
  WHERE child_id IS NOT NULL;

-- One membership can only ever be claimed by one child.
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_slots_child_unique
  ON membership_slots(child_id)
  WHERE child_id IS NOT NULL;

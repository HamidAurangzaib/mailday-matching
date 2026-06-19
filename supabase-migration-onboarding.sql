-- MailDay — Migration: Add onboarding_token to parents
-- Run this in your Supabase SQL Editor if you already ran the initial schema.
-- Safe to run multiple times.

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS onboarding_token UUID DEFAULT gen_random_uuid();

-- Add a unique index so tokens can't collide
CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_onboarding_token ON parents(onboarding_token);

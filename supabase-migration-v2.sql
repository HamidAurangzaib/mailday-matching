-- MailDay Matching — Migration v2
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wqepgxxsipztfzkldiix/sql/new
--
-- What this adds:
--   1. date_of_birth on children (enables birthday reminders)
--   2. matched_by_user_id on matches (enables per-VA performance tracking)
--   3. Row Level Security — protects data if the anon key is ever exposed

-- =====================
-- 1. ADD date_of_birth TO children
-- =====================
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- =====================
-- 2. ADD matched_by_user_id TO matches
-- =====================
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS matched_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_matches_matched_by ON matches(matched_by_user_id);

-- =====================
-- 3. ENABLE ROW LEVEL SECURITY
--    Your API server must use the SERVICE ROLE KEY (not anon key) after this.
--    The service role bypasses RLS entirely — only anonymous/JWT requests are restricted.
-- =====================

-- Enable RLS on all tables
ALTER TABLE parents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive policies
DROP POLICY IF EXISTS allow_all_parents  ON parents;
DROP POLICY IF EXISTS allow_all_children ON children;
DROP POLICY IF EXISTS allow_all_matches  ON matches;
DROP POLICY IF EXISTS allow_all_users    ON users;

-- Deny everything by default for anon/authenticated roles
-- (Service role is exempt from RLS automatically)
-- These policies are intentionally restrictive: no access for anon callers.
-- Your Express API uses the service role key, so it is never affected.

CREATE POLICY deny_anon_parents  ON parents  FOR ALL TO anon USING (false);
CREATE POLICY deny_anon_children ON children FOR ALL TO anon USING (false);
CREATE POLICY deny_anon_matches  ON matches  FOR ALL TO anon USING (false);
CREATE POLICY deny_anon_users    ON users    FOR ALL TO anon USING (false);

-- =====================
-- AFTER RUNNING THIS MIGRATION:
-- 1. Go to your Replit project secrets
-- 2. Add a new secret: SUPABASE_SERVICE_ROLE_KEY = (your service_role key from Supabase dashboard)
-- 3. Update artifacts/api-server/src/lib/supabase.ts to use the service role key
-- =====================

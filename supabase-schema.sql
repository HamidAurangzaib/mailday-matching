-- MailDay Matching — Supabase Schema
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/wqepgxxsipztfzkldiix/sql/new

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================
-- PARENTS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  state TEXT,
  mailing_address TEXT,
  address_type TEXT,
  shopify_customer_id TEXT,
  recharge_subscription_id TEXT,
  membership_tier TEXT,
  billing_type TEXT,
  subscription_status TEXT,
  join_date DATE,
  referral_source TEXT,
  community_status TEXT,
  give_a_key_recipient BOOLEAN DEFAULT FALSE,
  last_email_open_date DATE,
  at_risk BOOLEAN DEFAULT FALSE,
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- CHILDREN TABLE
-- =====================
CREATE TABLE IF NOT EXISTS children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  child_first_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('Core', 'Minis', 'Homeschool Core', 'Homeschool Minis')),
  interests TEXT[] DEFAULT '{}',
  homeschool_edition BOOLEAN DEFAULT FALSE,
  homeschool_tier TEXT,
  homeschool_approach TEXT,
  match_status TEXT NOT NULL DEFAULT 'Unmatched'
    CHECK (match_status IN ('Unmatched', 'Matched', 'Rematch Requested', 'Rematched', 'Paused', 'Cancelled')),
  rematch_count INTEGER DEFAULT 0,
  match_guarantee_start_date DATE DEFAULT CURRENT_DATE,
  billing_paused BOOLEAN DEFAULT FALSE,
  safety_flag BOOLEAN DEFAULT FALSE,
  internal_notes TEXT,
  created_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- MATCHES TABLE
-- =====================
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_a_id UUID NOT NULL REFERENCES children(id),
  child_b_id UUID NOT NULL REFERENCES children(id),
  match_date DATE DEFAULT CURRENT_DATE,
  match_status TEXT NOT NULL DEFAULT 'Active' CHECK (match_status IN ('Active', 'Closed')),
  shared_interests TEXT[] DEFAULT '{}',
  match_notification_sent_a BOOLEAN DEFAULT FALSE,
  match_notification_sent_b BOOLEAN DEFAULT FALSE,
  close_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- APP USERS TABLE (Admin & VA auth — separate from Supabase Auth)
-- =====================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'va' CHECK (role IN ('admin', 'va')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- INDEXES
-- =====================
CREATE INDEX IF NOT EXISTS idx_children_parent_id ON children(parent_id);
CREATE INDEX IF NOT EXISTS idx_children_match_status ON children(match_status);
CREATE INDEX IF NOT EXISTS idx_children_tier ON children(tier);
CREATE INDEX IF NOT EXISTS idx_matches_child_a ON matches(child_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_child_b ON matches(child_b_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(match_status);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date);

-- =====================
-- DISABLE ROW LEVEL SECURITY (internal admin tool — server uses service role key)
-- =====================
ALTER TABLE parents DISABLE ROW LEVEL SECURITY;
ALTER TABLE children DISABLE ROW LEVEL SECURITY;
ALTER TABLE matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- =====================
-- SEED: Initial admin user (change the password immediately after first login)
-- =====================
INSERT INTO users (email, password_hash, role)
VALUES (
  'admin@mailday.com',
  '$2b$10$p.C4ZQQBDnM6E8tmhV1oG.eHdmiOrb4JpslVkGtOE8zD1NlmdPIUm',
  'admin'
)
ON CONFLICT (email) DO NOTHING;

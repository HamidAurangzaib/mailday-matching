import pkg from 'pg';
const { Client } = pkg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = `
CREATE TABLE IF NOT EXISTS influencers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  instagram_handle TEXT,
  tiktok_handle TEXT,
  platform TEXT NOT NULL DEFAULT 'Instagram',
  follower_count INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Nano',
  affiliate_code TEXT UNIQUE,
  affiliate_link TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  revenue_per_conversion NUMERIC(8,2) NOT NULL DEFAULT 14.00,
  commission_owed NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  outreach_status TEXT NOT NULL DEFAULT 'Not Contacted',
  last_outreach_date DATE,
  last_content_posted_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS influencer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS influencer_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pack_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_name TEXT NOT NULL,
  month_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  total_active_members_at_send INTEGER NOT NULL DEFAULT 0,
  core_members_count INTEGER NOT NULL DEFAULT 0,
  minis_members_count INTEGER NOT NULL DEFAULT 0,
  homeschool_core_count INTEGER NOT NULL DEFAULT 0,
  homeschool_minis_count INTEGER NOT NULL DEFAULT 0,
  delivery_emails_sent INTEGER NOT NULL DEFAULT 0,
  delivery_emails_failed INTEGER NOT NULL DEFAULT 0,
  delivery_emails_manually_resent INTEGER NOT NULL DEFAULT 0,
  confirmation_status TEXT NOT NULL DEFAULT 'Pending',
  confirmed_by TEXT,
  confirmed_date DATE,
  notes TEXT,
  created_date DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(month_number, year)
);

CREATE TABLE IF NOT EXISTS pack_delivery_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_delivery_log_id UUID NOT NULL REFERENCES pack_delivery_log(id) ON DELETE CASCADE,
  parent_id UUID,
  child_id UUID,
  failure_reason TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_date DATE,
  resolved_by TEXT,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE parents ADD COLUMN IF NOT EXISTS affiliate_code TEXT;

CREATE INDEX IF NOT EXISTS idx_influencers_outreach_status ON influencers(outreach_status);
CREATE INDEX IF NOT EXISTS idx_influencers_tier ON influencers(tier);
CREATE INDEX IF NOT EXISTS idx_influencer_notes_influencer_id ON influencer_notes(influencer_id);
CREATE INDEX IF NOT EXISTS idx_influencer_content_influencer_id ON influencer_content(influencer_id);
CREATE INDEX IF NOT EXISTS idx_pack_delivery_log_year ON pack_delivery_log(year);
CREATE INDEX IF NOT EXISTS idx_pack_delivery_failures_log_id ON pack_delivery_failures(pack_delivery_log_id);
CREATE INDEX IF NOT EXISTS idx_pack_delivery_failures_resolved ON pack_delivery_failures(resolved);
`;

try {
  await client.query(sql);
  console.log('Migration completed successfully');
} catch (err) {
  console.error('Migration error:', err.message);
} finally {
  await client.end();
}

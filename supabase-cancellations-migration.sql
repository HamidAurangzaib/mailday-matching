-- MailDay Matching — Cancellation Tracker Migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/wqepgxxsipztfzkldiix/sql/new
-- Safe to run multiple times (uses IF NOT EXISTS)

-- ── Cancellations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES parents(id),
  child_id UUID REFERENCES children(id),
  recharge_subscription_id TEXT,
  cancellation_date DATE NOT NULL,
  tenure_months INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Core',
  billing_type TEXT NOT NULL DEFAULT 'Monthly',
  cancellation_reason_raw TEXT,
  cancellation_reason_category TEXT,
  save_attempted BOOLEAN NOT NULL DEFAULT FALSE,
  save_outcome TEXT,
  save_notes TEXT,
  reactivated BOOLEAN NOT NULL DEFAULT FALSE,
  reactivated_date DATE,
  reactivated_by TEXT,
  webhook_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Cancellation Notes (timeline) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id UUID NOT NULL REFERENCES cancellations(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Cancellation Tasks (action items) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id UUID NOT NULL REFERENCES cancellations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cancellations_parent_id ON cancellations(parent_id);
CREATE INDEX IF NOT EXISTS idx_cancellations_date ON cancellations(cancellation_date);
CREATE INDEX IF NOT EXISTS idx_cancellations_reason_category ON cancellations(cancellation_reason_category);
CREATE INDEX IF NOT EXISTS idx_cancellations_save_attempted ON cancellations(save_attempted);
CREATE INDEX IF NOT EXISTS idx_cancellation_notes_cancellation_id ON cancellation_notes(cancellation_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_tasks_cancellation_id ON cancellation_tasks(cancellation_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_tasks_completed ON cancellation_tasks(completed);

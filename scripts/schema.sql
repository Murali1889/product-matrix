-- ============================================
-- HyperVerge Dashboard Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Drop existing tables (if recreating)
-- DROP TABLE IF EXISTS client_api_overrides;
-- DROP TABLE IF EXISTS client_overrides;

-- ============================================
-- Client Overrides Table
-- Stores manual edits to client data (industry, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS client_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,

  -- Editable fields
  industry TEXT,
  segment TEXT,
  geography TEXT,
  legal_name TEXT,
  billing_currency TEXT,
  notes TEXT,

  -- Metadata
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_client_overrides_client_id ON client_overrides(client_id);
CREATE INDEX IF NOT EXISTS idx_client_overrides_client_name ON client_overrides(client_name);

-- ============================================
-- Client API Cost Overrides Table
-- Stores manual cost entries for APIs with "No cost"
-- ============================================
CREATE TABLE IF NOT EXISTS client_api_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,

  -- API identification
  api_name TEXT NOT NULL,
  month TEXT NOT NULL,  -- "Jan 2026", "Dec 2025", etc.

  -- Override values
  cost_override DECIMAL(15, 2),
  usage_override INTEGER,
  notes TEXT,

  -- Metadata
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one override per client + API + month
  UNIQUE(client_id, api_name, month)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_client_api_overrides_client_id ON client_api_overrides(client_id);
CREATE INDEX IF NOT EXISTS idx_client_api_overrides_month ON client_api_overrides(month);

-- ============================================
-- Industry Options Table (for dropdown)
-- ============================================
CREATE TABLE IF NOT EXISTS industry_options (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default industry options
INSERT INTO industry_options (name, display_order) VALUES
  ('NBFC', 1),
  ('Banking', 2),
  ('Insurance', 3),
  ('Brokerage', 4),
  ('Payment Service Provider', 5),
  ('Gig Economy', 6),
  ('Gaming', 7),
  ('E-commerce', 8),
  ('Wealth Management', 9),
  ('Healthcare', 10),
  ('Telecom', 11),
  ('Fintech', 12),
  ('Lending', 13),
  ('Digital Lenders', 14),
  ('Crypto', 15),
  ('Other', 99)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to client_overrides
DROP TRIGGER IF EXISTS set_updated_at_client_overrides ON client_overrides;
CREATE TRIGGER set_updated_at_client_overrides
  BEFORE UPDATE ON client_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to client_api_overrides
DROP TRIGGER IF EXISTS set_updated_at_client_api_overrides ON client_api_overrides;
CREATE TRIGGER set_updated_at_client_api_overrides
  BEFORE UPDATE ON client_api_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS Policies (if needed)
-- ============================================
-- ALTER TABLE client_overrides ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE client_api_overrides ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all" ON client_overrides FOR ALL USING (true);
-- CREATE POLICY "Allow all" ON client_api_overrides FOR ALL USING (true);

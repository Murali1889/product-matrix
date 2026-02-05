-- Supabase Database Schema for Client Revenue Data
-- Run this in Supabase SQL Editor to create the tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CLIENTS TABLE
-- Stores client profile information
-- ============================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_name VARCHAR(255) NOT NULL UNIQUE,
  legal_name VARCHAR(500),
  geography VARCHAR(100),
  segment VARCHAR(100),
  billing_entity VARCHAR(100),
  payment_model VARCHAR(100),
  status VARCHAR(50),
  zoho_id VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(client_name);
CREATE INDEX IF NOT EXISTS idx_clients_segment ON clients(segment);
CREATE INDEX IF NOT EXISTS idx_clients_geography ON clients(geography);

-- ============================================
-- CLIENT MONTHLY REVENUE TABLE
-- Stores monthly revenue data for each client
-- This is the main editable table in the Matrix view
-- ============================================
CREATE TABLE IF NOT EXISTS client_monthly_revenue (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  month VARCHAR(20) NOT NULL, -- Format: "Jan 2026"
  year INTEGER NOT NULL,
  month_number INTEGER NOT NULL, -- 1-12 for sorting
  total_revenue_usd DECIMAL(15, 2) DEFAULT 0,
  hv_api_revenue_usd DECIMAL(15, 2) DEFAULT 0,
  other_revenue_usd DECIMAL(15, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure unique month per client
  UNIQUE(client_id, month)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_monthly_revenue_client ON client_monthly_revenue(client_id);
CREATE INDEX IF NOT EXISTS idx_monthly_revenue_month ON client_monthly_revenue(year, month_number);
CREATE INDEX IF NOT EXISTS idx_monthly_revenue_year ON client_monthly_revenue(year);

-- ============================================
-- CLIENT API USAGE TABLE
-- Stores API-level revenue breakdown per month
-- ============================================
CREATE TABLE IF NOT EXISTS client_api_usage (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  monthly_revenue_id UUID REFERENCES client_monthly_revenue(id) ON DELETE CASCADE,
  api_name VARCHAR(255) NOT NULL,
  sub_module VARCHAR(255),
  revenue_usd DECIMAL(15, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_api_usage_monthly ON client_api_usage(monthly_revenue_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_api_name ON client_api_usage(api_name);

-- ============================================
-- UPDATED_AT TRIGGER FUNCTION
-- Automatically updates the updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to clients table
DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to monthly revenue table
DROP TRIGGER IF EXISTS update_monthly_revenue_updated_at ON client_monthly_revenue;
CREATE TRIGGER update_monthly_revenue_updated_at
  BEFORE UPDATE ON client_monthly_revenue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS for production security
-- ============================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_monthly_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_api_usage ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (adjust as needed)
CREATE POLICY "Allow all for authenticated users" ON clients
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON client_monthly_revenue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON client_api_usage
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- For development/anon access (remove in production)
CREATE POLICY "Allow all for anon" ON clients
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON client_monthly_revenue
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon" ON client_api_usage
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- View: Client with total revenue
CREATE OR REPLACE VIEW client_summary AS
SELECT
  c.id,
  c.client_name,
  c.legal_name,
  c.geography,
  c.segment,
  c.billing_entity,
  c.payment_model,
  c.status,
  COALESCE(SUM(mr.total_revenue_usd), 0) as total_revenue,
  COUNT(DISTINCT mr.month) as active_months,
  MAX(mr.month) as latest_month
FROM clients c
LEFT JOIN client_monthly_revenue mr ON c.id = mr.client_id
GROUP BY c.id;

-- View: Monthly totals across all clients
CREATE OR REPLACE VIEW monthly_totals AS
SELECT
  month,
  year,
  month_number,
  SUM(total_revenue_usd) as total_revenue,
  SUM(hv_api_revenue_usd) as hv_api_revenue,
  SUM(other_revenue_usd) as other_revenue,
  COUNT(DISTINCT client_id) as active_clients
FROM client_monthly_revenue
GROUP BY month, year, month_number
ORDER BY year DESC, month_number DESC;

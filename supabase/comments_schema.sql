-- Comments Schema for Product Matrix
-- Cell comments: comments on individual client + API cells
-- Client comments: general notes per client

CREATE TABLE IF NOT EXISTS cell_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_name VARCHAR(255) NOT NULL,
  api_name VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  author VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cell_comments_lookup ON cell_comments(client_name, api_name);
CREATE INDEX idx_cell_comments_created ON cell_comments(created_at DESC);

CREATE TABLE IF NOT EXISTS client_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_name VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  author VARCHAR(255) NOT NULL,
  category VARCHAR(20) DEFAULT 'note' CHECK (category IN ('note', 'action', 'risk', 'opportunity')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_client_comments_lookup ON client_comments(client_name);
CREATE INDEX idx_client_comments_created ON client_comments(created_at DESC);

-- Enable RLS
ALTER TABLE cell_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_comments ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated" ON cell_comments FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON client_comments FOR ALL USING (true);

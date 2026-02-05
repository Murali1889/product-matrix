-- ============================================
-- PRODUCT FEEDBACK TABLE SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main feedback table
CREATE TABLE IF NOT EXISTS product_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Feedback content
    feedback TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'bug' CHECK (type IN ('bug', 'feature', 'improvement', 'question', 'other')),
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'open', 'inProgress', 'underReview', 'onHold', 'resolved', 'closed', 'wontFix')),
    status_comment TEXT,

    -- User info
    user_name VARCHAR(255) DEFAULT 'Anonymous',
    user_email VARCHAR(255),

    -- Page context
    url TEXT,
    user_agent TEXT,
    viewport_width INTEGER,
    viewport_height INTEGER,

    -- Media attachments (base64 for screenshots, URLs for videos)
    screenshot TEXT,           -- Base64 encoded PNG for screenshots
    video_url TEXT,            -- Supabase Storage URL for video recordings
    attachment_url TEXT,       -- Supabase Storage URL for other attachments
    attachment_name VARCHAR(255),
    attachment_type VARCHAR(100),

    -- Console/Network logs (stored as JSONB for flexibility)
    event_logs JSONB,

    -- Element info (for element selection feedback)
    element_info JSONB,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_product_feedback_status ON product_feedback(status);
CREATE INDEX IF NOT EXISTS idx_product_feedback_type ON product_feedback(type);
CREATE INDEX IF NOT EXISTS idx_product_feedback_user_email ON product_feedback(user_email);
CREATE INDEX IF NOT EXISTS idx_product_feedback_created_at ON product_feedback(created_at DESC);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_product_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_product_feedback_updated_at ON product_feedback;
CREATE TRIGGER update_product_feedback_updated_at
    BEFORE UPDATE ON product_feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_product_feedback_updated_at();

-- Status history table (optional - for tracking status changes)
CREATE TABLE IF NOT EXISTS product_feedback_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feedback_id UUID NOT NULL REFERENCES product_feedback(id) ON DELETE CASCADE,
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    comment TEXT,
    changed_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_status_history_feedback_id ON product_feedback_status_history(feedback_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Enable these for production security
-- ============================================

-- Enable RLS
ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_feedback_status_history ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to insert feedback
CREATE POLICY "Anyone can insert feedback" ON product_feedback
    FOR INSERT WITH CHECK (true);

-- Policy: Allow authenticated users to read all feedback (for dashboard)
CREATE POLICY "Anyone can read feedback" ON product_feedback
    FOR SELECT USING (true);

-- Policy: Allow authenticated users to update feedback status
CREATE POLICY "Anyone can update feedback" ON product_feedback
    FOR UPDATE USING (true);

-- Same for status history
CREATE POLICY "Anyone can insert status history" ON product_feedback_status_history
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can read status history" ON product_feedback_status_history
    FOR SELECT USING (true);

-- ============================================
-- STORAGE BUCKET FOR VIDEOS & ATTACHMENTS
-- Run these commands to create storage bucket
-- ============================================

-- In Supabase Dashboard > Storage, create a bucket called 'feedback-media'
-- Or use SQL:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('feedback-media', 'feedback-media', true);

-- Storage policies (run in SQL Editor):
-- Allow anyone to upload to feedback-media bucket
-- CREATE POLICY "Anyone can upload feedback media" ON storage.objects
--     FOR INSERT WITH CHECK (bucket_id = 'feedback-media');

-- Allow anyone to read feedback media
-- CREATE POLICY "Anyone can read feedback media" ON storage.objects
--     FOR SELECT USING (bucket_id = 'feedback-media');

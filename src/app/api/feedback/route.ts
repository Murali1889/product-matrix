import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Check if Supabase is configured
const isConfigured = () => {
  return (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_KEY &&
    process.env.SUPABASE_URL.startsWith('https://')
  );
};

export interface ProductFeedbackPayload {
  feedback: string;
  type?: 'bug' | 'feature' | 'improvement' | 'question' | 'other';
  user_name?: string;
  user_email?: string | null;
  url?: string;
  user_agent?: string;
  viewport_width?: number;
  viewport_height?: number;
  screenshot?: string;
  video_url?: string;
  attachment_url?: string;
  attachment_name?: string;
  attachment_type?: string;
  event_logs?: any[];
  element_info?: any;
}

// GET - Fetch all feedback
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured', data: [] },
      { status: 200 }
    );
  }

  try {
    const { data, error } = await supabase
      .from('product_feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching feedback:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error: any) {
    console.error('Error in GET /api/feedback:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Submit new feedback
export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  try {
    const body: ProductFeedbackPayload = await request.json();

    const insertData = {
      feedback: body.feedback,
      type: body.type || 'bug',
      status: 'new',
      user_name: body.user_name || 'Anonymous',
      user_email: body.user_email,
      url: body.url,
      user_agent: body.user_agent,
      viewport_width: body.viewport_width,
      viewport_height: body.viewport_height,
      screenshot: body.screenshot,
      video_url: body.video_url,
      attachment_url: body.attachment_url,
      attachment_name: body.attachment_name,
      attachment_type: body.attachment_type,
      event_logs: body.event_logs || [],
      element_info: body.element_info || null,
    };

    const { data, error } = await supabase
      .from('product_feedback')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Error submitting feedback:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error in POST /api/feedback:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH - Update feedback status
export async function PATCH(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { id, status, comment, changed_by } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: 'id and status are required' },
        { status: 400 }
      );
    }

    // Get current status
    const { data: current, error: fetchError } = await supabase
      .from('product_feedback')
      .select('status')
      .eq('id', id)
      .single();

    if (fetchError) {
      console.error('Error fetching current status:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const oldStatus = current?.status;

    // Update status
    const { error: updateError } = await supabase
      .from('product_feedback')
      .update({
        status,
        status_comment: comment,
      })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating status:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Record in status history (if table exists)
    try {
      await supabase
        .from('product_feedback_status_history')
        .insert({
          feedback_id: id,
          old_status: oldStatus,
          new_status: status,
          comment,
          changed_by,
        });
    } catch (historyError) {
      console.warn('Failed to record status history:', historyError);
      // Don't fail the request - status was updated
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in PATCH /api/feedback:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete feedback
export async function DELETE(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('product_feedback')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting feedback:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/feedback:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
